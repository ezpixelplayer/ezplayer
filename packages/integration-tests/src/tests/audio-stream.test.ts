/** Live audio stream end to end: play a song with audio through the real
 *  player and listen on its LAN audio WebSocket the way the jukebox / preview /
 *  viewer page do. Proves the whole chain — derived-audio ffmpeg, the mp3
 *  decode worker, the playback loop's chunking, the opus encoder and the wire
 *  format — by decoding what arrives and checking it is the sine we uploaded,
 *  timestamped ahead of the player's clock. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { AudioWireCodec, parseAudioWireFrame, splitOpusPackets, type AudioWireFrame } from '@ezplayer/ezplayer-core';
import OpusScript from 'opusscript';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { writeFseq } from '../fixtures/fseq.js';
import { sineWav } from '../fixtures/wav.js';

const CHANNELS = 30;
const FRAME_MS = 50;
const SONG_SECS = 8;
const TONE_HZ = 440;

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

type Rec = { id: string; work: { title: string; length: number }; files: { fseq?: string; audio?: string } };

async function postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Collect wire frames from the player's LAN audio socket until `until` says stop. */
function listen(wsUrl: string, until: (frames: AudioWireFrame[]) => boolean, timeoutMs: number) {
    const frames: AudioWireFrame[] = [];
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    const opened = new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error(`audio socket failed to open: ${wsUrl}`)), { once: true });
    });
    const done = new Promise<AudioWireFrame[]>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`audio stream: only ${frames.length} frames after ${timeoutMs} ms`));
        }, timeoutMs);
        ws.addEventListener('message', (ev) => {
            if (!(ev.data instanceof ArrayBuffer)) return;
            const f = parseAudioWireFrame(new Uint8Array(ev.data.slice(0)));
            if (!f) return reject(new Error(`unparseable audio frame (${ev.data.byteLength} bytes)`));
            frames.push({ ...f, payload: f.payload.slice() });
            if (until(frames)) {
                clearTimeout(timer);
                resolve(frames);
            }
        });
    });
    return { opened, done, close: () => ws.close() };
}

/** RMS of the left channel of an opus frame, after the encoder's pre-skip. */
function decodeRms(f: AudioWireFrame): number {
    const dec = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    try {
        const pcm: number[] = [];
        for (const p of splitOpusPackets(f.payload)) {
            const out = dec.decode(Buffer.from(p));
            const s16 = new Int16Array(out.buffer, out.byteOffset, out.byteLength / 2);
            for (let i = 0; i < s16.length; i += 2) pcm.push(s16[i]! / 32768);
        }
        const body = pcm.slice(f.preSkip, f.preSkip + f.frames);
        let sum = 0;
        for (const v of body) sum += v * v;
        return Math.sqrt(sum / Math.max(1, body.length));
    } finally {
        dec.delete();
    }
}

beforeAll(async () => {
    mock = await startMockController({ channels: CHANNELS, ddpPort: 4048 });
    show = await createFixtureShow({ channels: CHANNELS });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);

    await writeFseq(path.join(show.dir, 'Tone.fseq'), {
        channels: CHANNELS,
        frames: (SONG_SECS * 1000) / FRAME_MS,
        msPerFrame: FRAME_MS,
        pattern: (f, ch) => ch.fill(f & 0xff),
    });
    const wav = sineWav({ seconds: SONG_SECS, sampleRate: 44100, frequencyHz: TONE_HZ, amplitude: 0.5 });
    expect((await fpp.uploadFile('music', 'Tone.wav', wav)).status).toBe(200);
    const res = await postJson(`${app.base}/api/ezp/sequences`, [
        { files: { fseq: 'Tone.fseq', audio: 'Tone.wav' }, work: { title: 'Tone', length: 0 } },
    ]);
    expect(res.status).toBe(200);
    const recs = ((await res.json()) as { sequences: Rec[] }).sequences;
    expect(recs.find((r) => r.work.title === 'Tone')).toBeDefined();
    expect(
        (
            await fpp.putPlaylist('ToneList', {
                name: 'ToneList',
                mainPlaylist: [{ type: 'sequence', sequenceName: 'Tone.fseq' }],
            })
        ).status,
    ).toBe(200);
});

afterAll(async () => {
    await fpp?.command('Stop Now').catch(() => undefined);
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('live audio stream', () => {
    it('delivers opus audio of the playing song, timestamped ahead of the player clock', async () => {
        const wsUrl = `${app.base.replace(/^http/, 'ws')}/api/ezp/audiostream`;
        const isMusic = (f: AudioWireFrame) => f.codec !== AudioWireCodec.Silence;
        const stream = listen(wsUrl, (frames) => frames.filter(isMusic).length >= 20, 40_000);
        await stream.opened;

        await fpp.command('Start Playlist', 'ToneList', 0, 0, 0);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'tone start', timeoutMs: 30_000 });
        const t0 = Date.now();
        const frames = await stream.done;
        stream.close();
        await fpp.command('Stop Now');

        // Wire shape: v2, stereo 48 kHz, 100 ms hop with a crossfade tail.
        for (const f of frames) {
            expect(f.version).toBe(2);
            expect(f.sampleRate).toBe(48000);
            expect(f.channels).toBe(2);
            expect(f.hopFrames).toBe(4800);
            expect(f.frames).toBeGreaterThanOrEqual(f.hopFrames);
        }

        // Music is opus, not the PCM fallback (that would mean the encoder failed to load).
        const music = frames.filter(isMusic);
        const codecs = new Set(music.map((f) => f.codec));
        expect(codecs).toEqual(new Set([AudioWireCodec.Opus]));
        for (const f of music) expect(f.preSkip).toBeGreaterThan(0);
        // Compressed: a 110 ms stereo chunk is ~42 KB raw.
        for (const f of music) expect(f.payload.byteLength).toBeLessThan(6000);

        // It is the tone we uploaded: a 0.5-amplitude sine has RMS ≈ 0.35; silence
        // or garbage would be near zero. Check a few frames past the start.
        const rms = music.slice(5, 10).map(decodeRms);
        for (const r of rms) expect(r).toBeGreaterThan(0.15);

        // Timing: chunks are contiguous 100 ms hops within one song, stamped a
        // little ahead of the player's clock (never in the past by the time they
        // are sent), and the player's clock is this machine's clock.
        for (let i = 1; i < music.length; i++) {
            const a = music[i - 1]!;
            const b = music[i]!;
            if (a.incarnation !== b.incarnation) continue;
            expect(Math.abs(b.playAt - a.playAt - 100)).toBeLessThanOrEqual(1);
        }
        for (const f of music) {
            expect(f.playAt - f.serverNow).toBeGreaterThan(-150);
            expect(f.playAt - f.serverNow).toBeLessThan(3000);
        }
        const last = music[music.length - 1]!;
        expect(Math.abs(last.serverNow - Date.now())).toBeLessThan(30_000);
        expect(last.serverNow).toBeGreaterThan(t0 - 1000);
    }, 90_000);
});
