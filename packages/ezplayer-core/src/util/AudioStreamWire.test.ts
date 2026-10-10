import { describe, expect, it } from 'vitest';

import {
    AUDIO_WIRE_HEADER_BYTES,
    AudioWireCodec,
    buildAudioWireFrame,
    joinOpusPackets,
    parseAudioWireFrame,
    splitOpusPackets,
} from './AudioStreamWire';

describe('AudioStreamWire', () => {
    it('round-trips a v2 opus frame', () => {
        const packets = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
        const payload = joinOpusPackets(packets);
        const bytes = buildAudioWireFrame(
            {
                codec: AudioWireCodec.Opus,
                serverNow: 1_750_000_000_123.5,
                playAt: 1_750_000_000_400,
                incarnation: 7,
                seq: 12345,
                sampleRate: 48000,
                channels: 2,
                preSkip: 312,
                frames: 5280,
                hopFrames: 4800,
            },
            payload,
        );
        expect(bytes.byteLength).toBe(AUDIO_WIRE_HEADER_BYTES + payload.byteLength);
        const f = parseAudioWireFrame(bytes);
        expect(f).not.toBeNull();
        expect(f!.version).toBe(2);
        expect(f!.codec).toBe(AudioWireCodec.Opus);
        expect(f!.serverNow).toBe(1_750_000_000_123.5);
        expect(f!.playAt).toBe(1_750_000_000_400);
        expect(f!.incarnation).toBe(7);
        expect(f!.seq).toBe(12345);
        expect(f!.preSkip).toBe(312);
        expect(f!.frames).toBe(5280);
        expect(f!.hopFrames).toBe(4800);
        const back = splitOpusPackets(f!.payload);
        expect(back.map((p) => Array.from(p))).toEqual([
            [1, 2, 3],
            [4, 5],
        ]);
    });

    it('parses from an ArrayBuffer view with an offset', () => {
        const frame = buildAudioWireFrame(
            {
                codec: AudioWireCodec.Silence,
                serverNow: 1,
                playAt: 2,
                incarnation: 0,
                seq: 1,
                sampleRate: 48000,
                channels: 2,
                preSkip: 0,
                frames: 4800,
                hopFrames: 4800,
            },
            new Uint8Array(0),
        );
        const padded = new Uint8Array(frame.byteLength + 8);
        padded.set(frame, 8);
        const f = parseAudioWireFrame(padded.subarray(8));
        expect(f?.codec).toBe(AudioWireCodec.Silence);
        expect(f?.frames).toBe(4800);
        expect(f?.payload.byteLength).toBe(0);
    });

    it('rejects a PCM frame whose payload does not match its frame count', () => {
        const frame = buildAudioWireFrame(
            {
                codec: AudioWireCodec.PcmF32,
                serverNow: 1,
                playAt: 2,
                incarnation: 0,
                seq: 1,
                sampleRate: 48000,
                channels: 2,
                preSkip: 0,
                frames: 10,
                hopFrames: 10,
            },
            new Uint8Array(3 * 4),
        );
        expect(parseAudioWireFrame(frame)).toBeNull();
    });

    it('parses a legacy v1 frame from an older player', () => {
        const sampleCount = 6; // 3 stereo frames
        const bytes = new Uint8Array(36 + sampleCount * 4);
        const dv = new DataView(bytes.buffer);
        dv.setFloat64(0, 1000, true); // serverNow
        dv.setFloat64(8, 1300, true); // playAt
        dv.setUint32(16, 3, true); // incarnation
        dv.setUint32(20, 44100, true);
        dv.setUint32(24, 2, true);
        dv.setUint32(28, sampleCount, true);
        dv.setUint32(32, 4, true); // advanceSamples = 2 frames
        const samples = new Float32Array(bytes.buffer, 36, sampleCount);
        samples.set([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        const f = parseAudioWireFrame(bytes);
        expect(f).not.toBeNull();
        expect(f!.version).toBe(1);
        expect(f!.codec).toBe(AudioWireCodec.PcmF32);
        expect(f!.sampleRate).toBe(44100);
        expect(f!.channels).toBe(2);
        expect(f!.frames).toBe(3);
        expect(f!.hopFrames).toBe(2);
        expect(f!.playAt).toBe(1300);
        const pcm = new Float32Array(f!.payload.buffer, f!.payload.byteOffset, 6);
        expect(pcm[5]).toBeCloseTo(0.6);
    });

    it('returns null for garbage', () => {
        expect(parseAudioWireFrame(new Uint8Array(10))).toBeNull();
        expect(parseAudioWireFrame(new Uint8Array(0))).toBeNull();
    });
});
