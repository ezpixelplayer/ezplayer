import { describe, expect, it } from 'vitest';
import OpusScript from 'opusscript';

import {
    AUDIO_WIRE_FLAG_CONTINUOUS,
    AUDIO_WIRE_FLAG_STREAM_START,
    AudioWireCodec,
    parseAudioWireFrame,
    splitOpusPackets,
    type AudioWireFrame,
} from '@ezplayer/ezplayer-core';
import type { AudioChunkReadResult } from '@ezplayer/ezplayer-core';

import { AudioStreamEncoder, EMIT_PACKETS, OPUS_FRAME_SIZE, toStereo48k } from './audio-stream-encoder';

const SR = 48000;
const HOP = 4800;
const TAIL = 480;
const T0 = 1_750_000_000_000;

/** Source signal: stereo sine, left = right. */
function sine(sampleRate: number, frame: number, hz: number): number {
    return 0.5 * Math.sin((2 * Math.PI * hz * frame) / sampleRate);
}

/** Chunk `i` the way playbackmaster makes it: hop + ramped tail, head ramped up
 *  (except the very first), tail ramped down, raised-cosine. */
function musicChunk(i: number, hz = 440, sampleRate = SR): AudioChunkReadResult {
    const ratio = sampleRate / SR;
    const hop = Math.round(HOP * ratio);
    const tail = Math.round(TAIL * ratio);
    const frames = hop + tail;
    const start = i * hop;
    const samples = new Float32Array(frames * 2);
    for (let f = 0; f < frames; f++) {
        let v = sine(sampleRate, start + f, hz);
        if (f < tail && i > 0) v *= 0.5 - 0.5 * Math.cos((Math.PI * (f + 0.5)) / tail);
        if (f >= hop) v *= 0.5 + 0.5 * Math.cos((Math.PI * (f - hop + 0.5)) / tail);
        samples[f * 2] = v;
        samples[f * 2 + 1] = v;
    }
    return {
        seq: i,
        playAtRealTime: T0 + i * 100,
        incarnation: 3,
        sampleRate,
        channels: 2,
        samples,
        advanceSamples: hop * 2,
    };
}

function silenceChunk(i: number, ms = 100): AudioChunkReadResult {
    const n = ms * 48;
    return {
        seq: i,
        playAtRealTime: T0 + i * 100,
        incarnation: 3,
        sampleRate: SR,
        channels: 1,
        samples: new Float32Array(n),
        advanceSamples: n,
    };
}

/** Decode a run of continuous frames with one decoder, the way the browser does
 *  (startup transient zeroed, output shifted earlier by preSkip). Returns the
 *  left channel aligned to the first frame's playAt. */
function decodeRun(frames: AudioWireFrame[]): Float32Array {
    const dec = new OpusScript(SR, 2, OpusScript.Application.AUDIO);
    const out: number[] = [];
    try {
        for (const f of frames) {
            expect(f.codec).toBe(AudioWireCodec.Opus);
            expect((f.flags ?? 0) & AUDIO_WIRE_FLAG_CONTINUOUS).toBeTruthy();
            const chunk: number[] = [];
            for (const p of splitOpusPackets(f.payload)) {
                const pcm = dec.decode(Buffer.from(p));
                const s16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
                for (let i = 0; i < s16.length; i += 2) chunk.push(s16[i]! / 32768);
            }
            expect(chunk.length).toBe(f.frames);
            if ((f.flags ?? 0) & AUDIO_WIRE_FLAG_STREAM_START) chunk.fill(0, 0, f.preSkip);
            out.push(...chunk);
        }
    } finally {
        dec.delete();
    }
    // The client plays decoded audio at playAt - preSkip; aligning to playAt means dropping preSkip samples.
    return Float32Array.from(out.slice(frames[0]!.preSkip));
}

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

describe('AudioStreamEncoder (continuous opus)', () => {
    it('emits one 100 ms frame per chunk, tagged continuous, first one tagged stream start', () => {
        const enc = new AudioStreamEncoder();
        const f0 = enc.push(musicChunk(0), 1).map((b) => parseAudioWireFrame(b)!);
        const f1 = enc.push(musicChunk(1), 2).map((b) => parseAudioWireFrame(b)!);
        expect(f0).toHaveLength(1);
        expect(f1).toHaveLength(1);
        expect(enc.usingOpus).toBe(true);
        expect(f0[0]!.flags).toBe(AUDIO_WIRE_FLAG_CONTINUOUS | AUDIO_WIRE_FLAG_STREAM_START);
        expect(f1[0]!.flags).toBe(AUDIO_WIRE_FLAG_CONTINUOUS);
        for (const f of [f0[0]!, f1[0]!]) {
            expect(f.sampleRate).toBe(SR);
            expect(f.channels).toBe(2);
            expect(f.frames).toBe(EMIT_PACKETS * OPUS_FRAME_SIZE);
            expect(f.hopFrames).toBe(f.frames);
            expect(f.preSkip).toBe(enc.lookaheadFrames);
            expect(splitOpusPackets(f.payload)).toHaveLength(EMIT_PACKETS);
            // ~128 kbps → ~1.6 KB per 100 ms; raw PCM would be 38 KB.
            expect(f.payload.byteLength).toBeLessThan(4000);
        }
        expect(f0[0]!.playAt).toBe(T0);
        expect(f1[0]!.playAt).toBe(T0 + 100);
        expect(f1[0]!.seq).toBe(f0[0]!.seq + 1);
        enc.close();
    });

    it('undoes the crossfade: a ramped chunk sequence decodes to the continuous sine', () => {
        const enc = new AudioStreamEncoder();
        const frames: AudioWireFrame[] = [];
        for (let i = 0; i < 8; i++) frames.push(...enc.push(musicChunk(i), i).map((b) => parseAudioWireFrame(b)!));
        expect(frames).toHaveLength(8);
        const got = decodeRun(frames);
        const want = new Float32Array(got.length);
        for (let f = 0; f < want.length; f++) want[f] = sine(SR, f, 440);
        // Skip the first 20 ms (codec warm-up) and compare the body, including
        // every chunk boundary.
        expect(similarity(got.subarray(960), want.subarray(960))).toBeGreaterThan(0.99);
        // No level dips at chunk boundaries: RMS of each 10 ms window within 1 dB of the sine's.
        const sineRms = 0.5 / Math.SQRT2;
        for (let s = 960; s + 480 <= got.length - 480; s += 480) {
            let e = 0;
            for (let i = s; i < s + 480; i++) e += got[i]! * got[i]!;
            const rms = Math.sqrt(e / 480);
            expect(Math.abs(20 * Math.log10(rms / sineRms))).toBeLessThan(1);
        }
        enc.close();
    });

    it('resamples a 44.1 kHz source into the same stream', () => {
        const enc = new AudioStreamEncoder();
        const frames: AudioWireFrame[] = [];
        for (let i = 0; i < 6; i++)
            frames.push(...enc.push(musicChunk(i, 1000, 44100), i).map((b) => parseAudioWireFrame(b)!));
        expect(frames).toHaveLength(6);
        const got = decodeRun(frames);
        const want = new Float32Array(got.length);
        for (let f = 0; f < want.length; f++) want[f] = sine(SR, f, 1000);
        expect(similarity(got.subarray(960), want.subarray(960))).toBeGreaterThan(0.98);
        enc.close();
    });

    it('keeps the stream running through silence and re-chunks odd silence lengths', () => {
        const enc = new AudioStreamEncoder();
        const out: AudioWireFrame[] = [];
        out.push(...enc.push(musicChunk(0), 0).map((b) => parseAudioWireFrame(b)!));
        // 37 ms + 63 ms of silence, contiguous with the music.
        const s1 = silenceChunk(1, 37);
        const s2 = { ...silenceChunk(2, 63), playAtRealTime: s1.playAtRealTime + 37 };
        out.push(...enc.push(s1, 1).map((b) => parseAudioWireFrame(b)!));
        out.push(...enc.push(s2, 2).map((b) => parseAudioWireFrame(b)!));
        // 100 + 37 + 63 = 200 ms in → exactly two frames out, no restart.
        expect(out).toHaveLength(2);
        expect(out[1]!.flags).toBe(AUDIO_WIRE_FLAG_CONTINUOUS);
        expect(out[1]!.playAt).toBe(T0 + 100);
        // libopus spends a few packets decaying after content; steady digital
        // silence then costs ~3 bytes per packet (about 1 kbps).
        for (let i = 3; i < 6; i++) out.push(...enc.push(silenceChunk(i), i).map((b) => parseAudioWireFrame(b)!));
        expect(out).toHaveLength(5);
        expect(out[4]!.payload.byteLength).toBeLessThan(120);
        enc.close();
    });

    it('a timestamp jump flushes the queue and starts a new tagged stream', () => {
        const enc = new AudioStreamEncoder();
        enc.push(musicChunk(0), 0);
        enc.push(musicChunk(1), 1);
        const jumped = { ...musicChunk(2), playAtRealTime: T0 + 5000 };
        const out = enc.push(jumped, 2).map((b) => parseAudioWireFrame(b)!);
        // Flush of the pending 10 ms tail (one padded packet), then the new chunk.
        expect(out.length).toBeGreaterThanOrEqual(2);
        const flushed = out[0]!;
        expect(flushed.frames).toBe(OPUS_FRAME_SIZE);
        expect(flushed.playAt).toBe(T0 + 200);
        const fresh = out[out.length - 1]!;
        expect(fresh.flags).toBe(AUDIO_WIRE_FLAG_CONTINUOUS | AUDIO_WIRE_FLAG_STREAM_START);
        expect(fresh.playAt).toBe(T0 + 5000);
        enc.close();
    });

    it('flush() emits the remainder and the next push starts a new stream', () => {
        const enc = new AudioStreamEncoder();
        enc.push(musicChunk(0), 0);
        const tail = enc.flush(1).map((b) => parseAudioWireFrame(b)!);
        expect(tail).toHaveLength(1);
        expect(tail[0]!.frames).toBe(OPUS_FRAME_SIZE);
        const next = enc.push(musicChunk(1), 2).map((b) => parseAudioWireFrame(b)!);
        expect((next[0]!.flags ?? 0) & AUDIO_WIRE_FLAG_STREAM_START).toBeTruthy();
        enc.close();
    });

    it('falls back to standalone PCM / Silence frames when opus is disabled', () => {
        const enc = new AudioStreamEncoder({ disableOpus: true });
        const m = parseAudioWireFrame(enc.push(musicChunk(0), 9)[0]!)!;
        expect(m.codec).toBe(AudioWireCodec.PcmF32);
        expect(m.flags).toBe(0);
        expect(m.frames).toBe(HOP + TAIL);
        expect(m.hopFrames).toBe(HOP);
        const s = parseAudioWireFrame(enc.push(silenceChunk(1), 9)[0]!)!;
        expect(s.codec).toBe(AudioWireCodec.Silence);
    });

    it('resamples 44.1 kHz to 48 kHz preserving a sine', () => {
        const src = new Float32Array(4410);
        for (let f = 0; f < 4410; f++) src[f] = 0.5 * Math.sin((2 * Math.PI * 1000 * f) / 44100);
        const out = toStereo48k(src, 1, 4410, 44100, 4800);
        const expected = new Float32Array(4800);
        for (let f = 0; f < 4800; f++) expected[f] = 0.5 * Math.sin((2 * Math.PI * 1000 * f) / 48000);
        const left = new Float32Array(4800);
        for (let f = 0; f < 4800; f++) left[f] = out[f * 2]!;
        expect(similarity(left, expected)).toBeGreaterThan(0.999);
    });
});
