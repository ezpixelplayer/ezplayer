import { describe, expect, it } from 'vitest';
import { resolveAudioBuses } from '@ezplayer/ezplayer-core';
import {
    AudioBusEngine,
    BUS_RATE,
    StereoResampler,
    decodeAudioPacket,
    decodeWav,
    encodeAudioPacket,
    type BusChunk,
} from './audiobus';

const T0 = 1_000_000;
const MAIN_LEAD = 800;

function engine(buses = [{ name: 'tree', leadMs: 100, chunkMs: 20 }]) {
    const e = new AudioBusEngine(MAIN_LEAD);
    e.configure(resolveAudioBuses({ audioBuses: buses }));
    return e;
}

const f32 = (samples: number[] | Float32Array) => new Uint8Array(Float32Array.from(samples).buffer);

/** Stereo ramp clip: frame n holds n+1 on the left and -(n+1) on the right, scaled small. */
function rampClip(frames: number): Float32Array {
    const out = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
        out[i * 2] = (i + 1) / 100000;
        out[i * 2 + 1] = -(i + 1) / 100000;
    }
    return out;
}

/** Run the pump every `stepMs` and lay the chunks out on one timeline starting at `fromMs`. */
function run(e: AudioBusEngine, fromMs: number, forMs: number, stepMs = 5) {
    const chunks: BusChunk[] = [];
    for (let t = fromMs; t <= fromMs + forMs; t += stepMs) chunks.push(...e.pump(t));
    const timeline = new Float32Array(((forMs + 2000) * BUS_RATE * 2) / 1000);
    for (const c of chunks) timeline.set(c.samples, Math.round((c.playAt - fromMs) * 48) * 2);
    const at = (ms: number, frame = 0) => timeline[(Math.round((ms - fromMs) * 48) + frame) * 2];
    return { chunks, timeline, at };
}

describe('AudioBusEngine clips', () => {
    it('plays a clip once, whole, no sooner than the bus lead', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        expect(lease).toMatchObject({ bus: 'tree', leadMs: 100, chunkMs: 20 });
        e.addClip(lease.id, lease.token, 'ramp', f32(rampClip(3000)), T0);
        const played = e.play(lease.id, lease.token, { clip: 'ramp' }, T0 + 3);
        expect(played.lateMs).toBe(0);
        expect(played.startsAt).toBeGreaterThanOrEqual(T0 + 103);
        expect(played.startsAt).toBeLessThanOrEqual(T0 + 123);

        const { chunks, at } = run(e, T0 + 3, 400);
        expect(chunks.every((c) => c.bus === 'tree' && c.samples.length === 960 * 2)).toBe(true);
        // 3000 frames from a chunk edge is four chunks; none are sent for the quiet after.
        expect(chunks.length).toBe(4);
        expect(new Set(chunks.map((c) => c.incarnation)).size).toBe(1);
        expect(at(played.startsAt, -1)).toBe(0);
        expect(at(played.startsAt, 0)).toBeCloseTo(1 / 100000, 7);
        expect(at(played.startsAt, 2999)).toBeCloseTo(3000 / 100000, 7);
        expect(at(played.startsAt, 3000)).toBe(0);
        expect(e.list(T0 + 500)[0].voices).toBe(0);
    });

    it('holds a clip for its time and starts a new run of chunks there', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        e.addClip(lease.id, lease.token, 'ramp', f32(rampClip(480)), T0);
        const first = e.play(lease.id, lease.token, { clip: 'ramp' }, T0);
        const later = e.play(lease.id, lease.token, { clip: 'ramp', at: T0 + 1000.5 }, T0);
        expect(later).toMatchObject({ startsAt: T0 + 1000.5, lateMs: 0 });
        const { chunks, at } = run(e, T0, 1500);
        expect(chunks.length).toBe(2);
        expect(chunks[1].playAt).toBe(T0 + 1000);
        expect(chunks[1].incarnation).not.toBe(chunks[0].incarnation);
        expect(at(first.startsAt, 479)).toBeCloseTo(480 / 100000, 7);
        expect(at(T0 + 1000.5, 0)).toBeCloseTo(1 / 100000, 7);
    });

    it('does not hold a sound asked for now behind one scheduled for later', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        e.addClip(lease.id, lease.token, 'ramp', f32(rampClip(480)), T0);
        e.play(lease.id, lease.token, { clip: 'ramp', at: T0 + 3000 }, T0);
        expect(e.pump(T0)).toEqual([]);
        expect(e.pump(T0 + 50)).toEqual([]);
        const now = e.play(lease.id, lease.token, { clip: 'ramp' }, T0 + 60);
        expect(now.startsAt).toBeLessThanOrEqual(T0 + 60 + 100 + 20);
        const { chunks } = run(e, T0 + 60, 3500);
        expect(chunks.map((c) => c.playAt)).toEqual([now.startsAt, T0 + 3000]);
    });

    it('keeps the time of a clip asked for too soon and drops its start', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        e.addClip(lease.id, lease.token, 'ramp', f32(rampClip(4800)), T0);
        const r = e.play(lease.id, lease.token, { clip: 'ramp', at: T0 - 30 }, T0);
        expect(r).toMatchObject({ lateMs: 30, startsAt: T0 });
        const { at } = run(e, T0, 300);
        // Frame 1440 of the clip (30 ms in) sounds at T0.
        expect(at(T0, 0)).toBeCloseTo(1441 / 100000, 7);
    });

    it('fades a stopped voice and loops one until stopped', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        const ones = new Float32Array(960).fill(0.5);
        e.addClip(lease.id, lease.token, 'tone', f32(ones), T0);
        const v = e.play(lease.id, lease.token, { clip: 'tone', loop: true, gain: 0.5 }, T0);
        const a = run(e, T0, 500);
        // Still sounding long after the 10 ms clip would have ended.
        expect(a.at(v.startsAt + 300)).toBeCloseTo(0.25, 6);
        expect(e.stop(lease.id, lease.token, v.voice, 20, T0 + 505)).toBe(1);
        const b = run(e, T0 + 505, 400);
        const levels = Array.from({ length: 200 }, (_, i) => b.at(T0 + 620 + i));
        expect(Math.max(...levels)).toBeLessThanOrEqual(0.25);
        expect(levels.filter((x) => x > 0 && x < 0.25).length).toBeGreaterThan(10);
        expect(levels[199]).toBe(0);
        expect(e.list(T0 + 1000)[0].voices).toBe(0);
    });

    it('ends a stopped clip at its last frame, however long the fade', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        // 100 ms of clip, stopped halfway with a 2 s fade: it must not start over.
        e.addClip(lease.id, lease.token, 'ones', f32(new Float32Array(4800 * 2).fill(0.5)), T0);
        const played = e.play(lease.id, lease.token, { clip: 'ones' }, T0);
        e.stop(lease.id, lease.token, undefined, 2000, played.startsAt - 100 + 50);
        const { timeline } = run(e, T0, 3000);
        let last = timeline.length - 1;
        while (last > 0 && timeline[last] === 0) last--;
        expect(Math.floor(last / 2)).toBe(Math.round((played.startsAt - T0) * 48) + 4799);
        expect(e.list(T0 + 3000)[0].voices).toBe(0);
    });

    it('refuses a clip that is too long before reading its samples', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', sampleRate: 8000, channels: 1 }, T0);
        expect(() => e.addClip(lease.id, lease.token, 'long', new Uint8Array(8000 * 2 * 121), T0)).toThrow(
            /longer than 120 s/,
        );
        // A WAV header claiming 8-bit mono at 8 kHz: 121 s of it.
        const wav = new Uint8Array(44 + 8000 * 121);
        const dv = new DataView(wav.buffer);
        wav.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);
        dv.setUint32(16, 16, true);
        dv.setUint16(20, 1, true);
        dv.setUint16(22, 1, true);
        dv.setUint32(24, 8000, true);
        dv.setUint16(34, 8, true);
        wav.set([0x64, 0x61, 0x74, 0x61], 36);
        dv.setUint32(40, 8000 * 121, true);
        expect(() => e.addClip(lease.id, lease.token, 'long', wav, T0)).toThrow(/longer than 120 s/);
    });

    it('converts clips to 48 kHz and reads WAV files', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', sampleRate: 24000, channels: 1, encoding: 's16le' }, T0);
        const pcm = new Int16Array(2400).fill(8192);
        expect(e.addClip(lease.id, lease.token, 'raw', new Uint8Array(pcm.buffer), T0).durationMs).toBeCloseTo(100, 0);

        const wav = new Uint8Array(44 + 8);
        const dv = new DataView(wav.buffer);
        wav.set([0x52, 0x49, 0x46, 0x46], 0);
        wav.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
        dv.setUint32(16, 16, true);
        dv.setUint16(20, 1, true);
        dv.setUint16(22, 2, true);
        dv.setUint32(24, 48000, true);
        dv.setUint16(34, 16, true);
        wav.set([0x64, 0x61, 0x74, 0x61], 36);
        dv.setUint32(40, 8, true);
        dv.setInt16(44, 16384, true);
        dv.setInt16(46, -16384, true);
        dv.setInt16(48, 32767, true);
        dv.setInt16(50, 0, true);
        const { rate, stereo } = decodeWav(wav);
        expect(rate).toBe(48000);
        expect(Array.from(stereo)).toEqual([0.5, -0.5, 32767 / 32768, 0]);
        expect(e.addClip(lease.id, lease.token, 'wav', wav, T0).durationMs).toBeCloseTo(2 / 48, 6);
        expect(() =>
            e.addClip(
                lease.id,
                lease.token,
                'bad',
                new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 1, 2, 3, 4]),
                T0,
            ),
        ).toThrow(/WAV/);
    });
});

describe('AudioBusEngine streams', () => {
    it('joins chunks sent without a time into one unbroken stream', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        const all = rampClip(4800);
        let t = T0;
        const chunks: BusChunk[] = [];
        for (let k = 0; k < 10; k++, t += 10) {
            const state = e.stream(
                lease.id,
                lease.token,
                f32(all.subarray(k * 960, (k + 1) * 960)),
                undefined,
                k + 1,
                t,
            );
            expect(state.lateMs).toBe(0);
            chunks.push(...e.pump(t));
        }
        // A repeated packet is ignored.
        e.stream(lease.id, lease.token, f32(all.subarray(0, 960)), undefined, 3, t);
        for (; t < T0 + 600; t += 5) chunks.push(...e.pump(t));
        const start = Math.min(...chunks.map((c) => c.playAt));
        const line = new Float32Array(48000 * 2);
        for (const c of chunks) line.set(c.samples, Math.round((c.playAt - start) * 48) * 2);
        const first = line.findIndex((x) => x !== 0);
        expect(Array.from(line.subarray(first, first + 9600))).toEqual(Array.from(all));
        expect(line.subarray(first + 9600).every((x) => x === 0)).toBe(true);
        expect(new Set(chunks.map((c) => c.incarnation)).size).toBe(1);
    });

    it('places timed chunks, joins neighbours and reports what came late', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        const a = new Float32Array(960 * 2).fill(0.25);
        e.stream(lease.id, lease.token, f32(a), T0 + 300, 1, T0);
        // 0.4 ms off the end of the first: joined exactly.
        e.stream(lease.id, lease.token, f32(a), T0 + 320.4, 2, T0);
        expect(e.list(T0)[0].bufferedMs).toBe(340);
        const { at } = run(e, T0, 500);
        expect(at(T0 + 300, -1)).toBe(0);
        expect(at(T0 + 300, 0)).toBe(0.25);
        expect(at(T0 + 300, 1919)).toBe(0.25);
        expect(at(T0 + 300, 1920)).toBe(0);
        const late = e.stream(lease.id, lease.token, f32(a), T0 + 400, 3, T0 + 500);
        expect(late.lateMs).toBe(20);
        expect(() => e.stream(lease.id, lease.token, f32(a), T0 + 500_000, 4, T0)).toThrow(/too far ahead/);
        // The same limit holds for the end of a chunk, and for chunks that follow on with no time.
        const big = f32(new Float32Array(48000 * 2 * 31));
        e.stream(lease.id, lease.token, big, T0 + 1000, 5, T0);
        expect(() => e.stream(lease.id, lease.token, big, undefined, 6, T0)).toThrow(/too far ahead/);
        expect(e.list(T0)[0].bufferedMs).toBe(32000);
    });

    it('resamples a 44.1 kHz mono stream without breaks between chunks', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', sampleRate: 44100, channels: 1, encoding: 's16le' }, T0);
        const hz = 441;
        const pcm = Int16Array.from({ length: 44100 / 2 }, (_, i) =>
            Math.round(16000 * Math.sin((2 * Math.PI * hz * i) / 44100)),
        );
        let t = T0;
        const chunks: BusChunk[] = [];
        for (let k = 0; k * 441 < pcm.length; k++, t += 10) {
            const part = pcm.subarray(k * 441, (k + 1) * 441);
            e.stream(
                lease.id,
                lease.token,
                new Uint8Array(part.buffer, part.byteOffset, part.byteLength),
                undefined,
                k + 1,
                t,
            );
            chunks.push(...e.pump(t));
        }
        for (; t < T0 + 1000; t += 5) chunks.push(...e.pump(t));
        const start = Math.min(...chunks.map((c) => c.playAt));
        const line = new Float32Array(48000 * 2);
        for (const c of chunks) line.set(c.samples, Math.round((c.playAt - start) * 48) * 2);
        const first = line.findIndex((x) => x !== 0) / 2;
        // Half a second in becomes close to 24000 frames out.
        const last = line.findLastIndex((x) => x !== 0) / 2;
        expect(last - first).toBeGreaterThan(23900);
        expect(last - first).toBeLessThan(24010);
        // A 441 Hz sine never steps more than its slope allows: no clicks at the joins.
        const maxStep = (16000 / 32768) * 2 * Math.PI * (hz / 48000) * 1.05;
        for (let i = first + 4; i < last - 4; i++) {
            expect(Math.abs(line[(i + 1) * 2] - line[i * 2])).toBeLessThan(maxStep);
        }
    });

    it('StereoResampler keeps the length ratio across pieces', () => {
        const r = new StereoResampler(32000);
        let out = 0;
        for (let k = 0; k < 10; k++) out += r.push(new Float32Array(320 * 2), k === 9).length / 2;
        expect(out).toBe(4800);
    });
});

describe('AudioBusEngine show audio', () => {
    it('adds injected sound to the chunks the playback loop publishes', () => {
        const e = engine();
        const lease = e.open({ encoding: 'f32le' }, T0);
        expect(lease).toMatchObject({ bus: 'main', leadMs: MAIN_LEAD });
        e.addClip(lease.id, lease.token, 'ramp', f32(rampClip(9600)), T0);
        expect(e.mainPending(T0)).toBe(false);
        const r = e.play(lease.id, lease.token, { clip: 'ramp' }, T0);
        expect(r.startsAt).toBe(T0 + MAIN_LEAD);
        const line = new Float32Array(48000 * 2);
        // Chunks carry a 10 ms tail that overlaps the head of the next, as the outputs play them.
        for (let k = 0; k < 6; k++) {
            const chunk = new Float32Array((4800 + 480) * 2);
            const start = T0 + 700 + k * 100;
            const added = e.mixMain(chunk, 2, 48000, start, 4800);
            expect(added).toBe(k <= 2);
            for (let i = 0; i < chunk.length; i++) line[k * 4800 * 2 + i] += chunk[i];
        }
        const first = line.findIndex((x) => x !== 0);
        expect(first).toBe(4800 * 2);
        const want = rampClip(9600);
        for (let i = 0; i < want.length; i++) expect(line[first + i]).toBeCloseTo(want[i], 6);
        expect(line.subarray(first + want.length).every((x) => x === 0)).toBe(true);
        expect(e.list(T0 + 2000)[0].voices).toBe(0);
    });

    it('fades injected sound across the seam of chunks with a tail, and not after one without', () => {
        const e = engine();
        const lease = e.open({ encoding: 'f32le' }, T0);
        e.addClip(lease.id, lease.token, 'ones', f32(new Float32Array(48000).fill(0.5)), T0);
        e.play(lease.id, lease.token, { clip: 'ones', at: T0 + 1000 }, T0);
        // A quiet chunk has no tail, so the next one starts at full level.
        const quiet = new Float32Array(4800 * 2);
        e.mixMain(quiet, 2, 48000, T0 + 1000, 4800);
        expect(quiet[9598]).toBeCloseTo(0.5, 6);
        const a = new Float32Array((4410 + 441) * 2);
        e.mixMain(a, 2, 44100, T0 + 1100, 4410);
        expect(a[0]).toBeCloseTo(0.5, 6);
        expect(a[4409 * 2]).toBeCloseTo(0.5, 6);
        expect(a[(4410 + 440) * 2]).toBeLessThan(0.001);
        const b = new Float32Array((4410 + 441) * 2);
        e.mixMain(b, 2, 44100, T0 + 1200, 4410);
        for (let i = 0; i < 441; i++) expect(a[(4410 + i) * 2] + b[i * 2]).toBeCloseTo(0.5, 6);
        expect(b[441 * 2]).toBeCloseTo(0.5, 6);
    });

    it('follows a chunk at another rate without a seam, and a mono one', () => {
        const e = engine();
        const lease = e.open({ encoding: 'f32le' }, T0);
        const hz = 480;
        const tone = new Float32Array(48000 * 2);
        for (let i = 0; i < 48000; i++) tone[i * 2] = tone[i * 2 + 1] = 0.5 * Math.sin((2 * Math.PI * hz * i) / 48000);
        e.addClip(lease.id, lease.token, 'tone', f32(tone), T0);
        const r = e.play(lease.id, lease.token, { clip: 'tone', at: T0 + 1000 }, T0);
        expect(r.lateMs).toBe(0);
        const line: number[] = [];
        for (let k = 0; k < 5; k++) {
            const chunk = new Float32Array(4410 * 2);
            e.mixMain(chunk, 2, 44100, T0 + 1000 + k * 100, 4410);
            for (let i = 0; i < 4410; i++) line.push(chunk[i * 2]);
        }
        for (let i = 2; i < line.length - 2; i++) {
            expect(line[i]).toBeCloseTo(0.5 * Math.sin((2 * Math.PI * hz * i) / 44100), 2);
        }
        const mono = new Float32Array(4800);
        expect(e.mixMain(mono, 1, 48000, T0 + 1500, 4800)).toBe(true);
        expect(mono[100]).toBeCloseTo(tone[(24000 + 100) * 2], 6);
    });

    it('ramps a gain change across a chunk', () => {
        const e = engine();
        const lease = e.open({ encoding: 'f32le', gain: 1 }, T0);
        e.addClip(lease.id, lease.token, 'ones', f32(new Float32Array(48000).fill(0.5)), T0);
        e.play(lease.id, lease.token, { clip: 'ones', at: T0 + 1000 }, T0);
        const a = new Float32Array(9600);
        e.mixMain(a, 2, 48000, T0 + 1000, 4800);
        expect(a[9598]).toBeCloseTo(0.5, 6);
        e.setGain(lease.id, lease.token, 0, T0);
        const b = new Float32Array(9600);
        e.mixMain(b, 2, 48000, T0 + 1100, 4800);
        expect(b[0]).toBeLessThan(0.5);
        expect(b[0]).toBeGreaterThan(0.49);
        expect(b[4800]).toBeCloseTo(0.25, 2);
        expect(Math.abs(b[9598])).toBeLessThan(0.001);
    });
});

describe('AudioBusEngine leases and buses', () => {
    it('refuses unknown buses, wrong tokens and bad formats', () => {
        const e = engine();
        expect(() => e.open({ bus: 'nowhere' }, T0)).toThrow(/no audio bus named nowhere/);
        expect(() => e.open({ encoding: 'mp3' as never }, T0)).toThrow(/encoding/);
        expect(() => e.open({ gain: 9 }, T0)).toThrow(/gain/);
        // Numbers sent as text are refused, not used.
        expect(() => e.open({ gain: '0.8' as never }, T0)).toThrow(/gain must be a number/);
        expect(() => e.open({ ttlMs: '30s' as never }, T0)).toThrow(/ttlMs must be a number/);
        expect(() => e.open({ sampleRate: '48000' as never }, T0)).toThrow(/sampleRate must be a number/);
        const lease = e.open({}, T0);
        expect(() => e.keepalive(lease.id, lease.token + 1, T0)).toThrow(/unknown lease/);
        expect(() => e.play(lease.id, lease.token, { clip: 'none' }, T0)).toThrow(/no clip named none/);
    });

    it('holds a closed lease until its fade is done, without counting it against the limit', () => {
        const e = engine();
        const leases = Array.from({ length: 64 }, () => e.open({ bus: 'tree' }, T0));
        expect(() => e.open({ bus: 'tree' }, T0)).toThrow(/too many audio leases/);
        for (const l of leases) e.close(l.id, l.token, T0);
        expect(e.list(T0)).toEqual([]);
        expect(e.held).toBe(64);
        expect(e.open({ bus: 'tree' }, T0).bus).toBe('tree');
        e.sweep(T0 + 5000);
        expect(e.held).toBe(1);
    });

    it('expires idle leases and drops those of a removed bus', () => {
        const e = engine();
        const a = e.open({ bus: 'tree', ttlMs: 2000 }, T0);
        const b = e.open({ bus: 'immediate', ttlMs: 2000 }, T0);
        e.keepalive(b.id, b.token, T0 + 1500);
        expect(e.sweep(T0 + 2500)).toEqual([a.id]);
        const c = e.open({ bus: 'tree' }, T0);
        e.configure(resolveAudioBuses(undefined));
        expect(e.list(T0).map((l) => l.id)).toEqual([b.id]);
        expect(() => e.keepalive(c.id, c.token, T0)).toThrow();
    });

    it('fades out what a closed lease was playing', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        e.addClip(lease.id, lease.token, 'ones', f32(new Float32Array(48000 * 2).fill(0.5)), T0);
        e.stream(lease.id, lease.token, f32(new Float32Array(48000 * 2).fill(0.25)), T0 + 100, 1, T0);
        e.play(lease.id, lease.token, { clip: 'ones', at: T0 + 100 }, T0);
        const a = run(e, T0, 200);
        expect(a.at(T0 + 150)).toBeCloseTo(0.75, 6);
        e.close(lease.id, lease.token, T0 + 205);
        expect(e.list(T0 + 205)).toEqual([]);
        expect(e.busStatus(T0 + 205)[2].leases).toBe(0);
        expect(() => e.keepalive(lease.id, lease.token, T0 + 205)).toThrow(/unknown lease/);
        const b = run(e, T0 + 205, 300);
        const levels = Array.from({ length: 60 }, (_, i) => b.at(T0 + 300 + i));
        // It ramps to nothing within 10 ms of where rendering had reached, with no step.
        expect(levels.some((x) => x > 0 && x < 0.75)).toBe(true);
        expect(levels[59]).toBe(0);
        expect(b.chunks.length).toBeLessThanOrEqual(2);
        expect(e.sweep(T0 + 5000)).toEqual([]);
    });

    it('reports each bus with its timing, leases and level', () => {
        const e = engine();
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        e.addClip(lease.id, lease.token, 'ones', f32(new Float32Array(960 * 2).fill(0.75)), T0);
        e.play(lease.id, lease.token, { clip: 'ones' }, T0);
        run(e, T0, 200);
        const status = e.busStatus(T0 + 200);
        expect(status.map((b) => b.name)).toEqual(['main', 'immediate', 'tree']);
        expect(status[0]).toMatchObject({ builtIn: true, leadMs: MAIN_LEAD, leases: 0 });
        expect(status[2]).toMatchObject({ builtIn: false, leadMs: 100, chunkMs: 20, leases: 1, chunks: 1, peak: 0.75 });
        expect(e.busStatus(T0 + 5000)[2].peak).toBe(0);
    });

    it('renders further ahead when the speakers are trimmed early', () => {
        const e = engine();
        e.setTimeAdjust(-50);
        const lease = e.open({ bus: 'tree', encoding: 'f32le' }, T0);
        e.addClip(lease.id, lease.token, 'ones', f32(new Float32Array(960 * 2).fill(0.5)), T0);
        const r = e.play(lease.id, lease.token, { clip: 'ones' }, T0);
        expect(r.startsAt).toBeGreaterThanOrEqual(T0 + 150);
        expect(e.pump(T0 + 10).length).toBe(1);
    });
});

describe('audio stream packets', () => {
    it('round-trips', () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const p = decodeAudioPacket(
            encodeAudioPacket({ id: 7, token: 0xfedcba98, seq: 42, playAt: 1712345678901.25, data }),
        );
        expect(p).toEqual({ id: 7, token: 0xfedcba98, seq: 42, playAt: 1712345678901.25, data });
        expect(decodeAudioPacket(new Uint8Array(30))).toBeUndefined();
    });
});
