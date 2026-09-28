import { describe, expect, it } from 'vitest';
import OpusScript from 'opusscript';

import { AudioWireCodec, parseAudioWireFrame, splitOpusPackets } from '@ezplayer/ezplayer-core';
import type { AudioChunkReadResult } from '@ezplayer/ezplayer-core';

import { AudioStreamEncoder, OPUS_FRAME_SIZE, toStereo48k } from './audio-stream-encoder';

function sineChunk(sampleRate: number, channels: number, frames: number, hop: number, hz = 440): AudioChunkReadResult {
    const samples = new Float32Array(frames * channels);
    for (let f = 0; f < frames; f++) {
        const v = 0.5 * Math.sin((2 * Math.PI * hz * f) / sampleRate);
        for (let c = 0; c < channels; c++) samples[f * channels + c] = v;
    }
    return {
        seq: 42,
        playAtRealTime: 1_750_000_000_000,
        incarnation: 3,
        sampleRate,
        channels,
        samples,
        advanceSamples: hop * channels,
    };
}

/** Normalized cross-correlation at zero lag. */
function similarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let aa = 0;
    let bb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        dot += a[i]! * b[i]!;
        aa += a[i]! * a[i]!;
        bb += b[i]! * b[i]!;
    }
    return dot / Math.sqrt(aa * bb);
}

describe('AudioStreamEncoder', () => {
    it('emits a Silence frame for an all-zero chunk without touching the codec', () => {
        const enc = new AudioStreamEncoder();
        const chunk = sineChunk(48000, 1, 4800, 4800);
        chunk.samples.fill(0);
        const frame = parseAudioWireFrame(enc.encodeChunk(chunk, 123));
        expect(frame?.codec).toBe(AudioWireCodec.Silence);
        expect(frame?.frames).toBe(4800);
        expect(frame?.hopFrames).toBe(4800);
        expect(frame?.channels).toBe(2);
        expect(frame?.sampleRate).toBe(48000);
        expect(frame?.serverNow).toBe(123);
        expect(enc.usingOpus).toBe(false);
    });

    it('opus-encodes a 44.1 kHz stereo chunk so it decodes standalone to the same audio', () => {
        const enc = new AudioStreamEncoder();
        // 110 ms hop+tail at 44.1 kHz.
        const chunk = sineChunk(44100, 2, 4851, 4410, 440);
        const bytes = enc.encodeChunk(chunk, 5);
        const frame = parseAudioWireFrame(bytes);
        expect(frame).not.toBeNull();
        expect(frame!.codec).toBe(AudioWireCodec.Opus);
        expect(enc.usingOpus).toBe(true);
        expect(frame!.sampleRate).toBe(48000);
        expect(frame!.frames).toBe(5280);
        expect(frame!.hopFrames).toBe(4800);
        expect(frame!.preSkip).toBe(enc.lookaheadFrames);
        expect(frame!.preSkip).toBeGreaterThan(0);
        expect(frame!.preSkip).toBeLessThanOrEqual(OPUS_FRAME_SIZE);
        // Well under the raw PCM size (5280 frames * 2 ch * 4 B = 42 KB).
        expect(bytes.byteLength).toBeLessThan(4000);

        const packets = splitOpusPackets(frame!.payload);
        expect(packets.length).toBe(Math.ceil((5280 + frame!.preSkip) / OPUS_FRAME_SIZE));

        // Decode with a fresh decoder, the way a listener that just joined would.
        const dec = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
        const out = new Float32Array(packets.length * OPUS_FRAME_SIZE);
        let w = 0;
        for (const p of packets) {
            const pcm = dec.decode(Buffer.from(p));
            const s16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
            for (let i = 0; i < s16.length; i += 2) out[w++] = s16[i]! / 32768;
        }
        dec.delete();
        const decoded = out.subarray(frame!.preSkip, frame!.preSkip + frame!.frames);
        const expected = toStereo48k(chunk.samples, 2, 4851, 44100, 5280);
        const expectedL = new Float32Array(5280);
        for (let i = 0; i < 5280; i++) expectedL[i] = expected[i * 2]!;
        // Skip the crossfade-masked first 10 ms; compare the body.
        expect(similarity(decoded.subarray(480), expectedL.subarray(480))).toBeGreaterThan(0.97);
        enc.close();
    });

    it('two consecutive chunks encode independently (second starts with a reset encoder)', () => {
        const enc = new AudioStreamEncoder();
        const a = sineChunk(48000, 2, 5280, 4800, 330);
        const b = sineChunk(48000, 2, 5280, 4800, 330);
        const fa = parseAudioWireFrame(enc.encodeChunk(a, 1))!;
        const fb = parseAudioWireFrame(enc.encodeChunk(b, 2))!;
        expect(Array.from(fa.payload)).toEqual(Array.from(fb.payload));
        enc.close();
    });

    it('falls back to Float32 PCM when opus is disabled', () => {
        const enc = new AudioStreamEncoder({ disableOpus: true });
        const chunk = sineChunk(48000, 1, 5280, 4800);
        const frame = parseAudioWireFrame(enc.encodeChunk(chunk, 9));
        expect(frame?.codec).toBe(AudioWireCodec.PcmF32);
        expect(frame?.channels).toBe(2);
        const pcm = new Float32Array(frame!.payload.buffer, frame!.payload.byteOffset, 5280 * 2);
        // Mono duplicated to both channels, unchanged at 48 kHz.
        expect(pcm[100 * 2]).toBeCloseTo(chunk.samples[100]!, 6);
        expect(pcm[100 * 2 + 1]).toBeCloseTo(chunk.samples[100]!, 6);
    });

    it('resamples 44.1 kHz to 48 kHz preserving a sine', () => {
        const src = sineChunk(44100, 1, 4410, 4410, 1000).samples;
        const out = toStereo48k(src, 1, 4410, 44100, 4800);
        const expected = new Float32Array(4800);
        for (let f = 0; f < 4800; f++) expected[f] = 0.5 * Math.sin((2 * Math.PI * 1000 * f) / 48000);
        const left = new Float32Array(4800);
        for (let f = 0; f < 4800; f++) left[f] = out[f * 2]!;
        expect(similarity(left, expected)).toBeGreaterThan(0.999);
    });
});
