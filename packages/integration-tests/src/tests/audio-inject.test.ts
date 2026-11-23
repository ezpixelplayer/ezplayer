/** Audio injection end to end: buses are listed and registered, a clip and a
 *  UDP stream sent to the show audio reach a listener at the time asked for,
 *  and the immediate bus plays a clip within its short lead. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import net from 'node:net';
import { AudioWireCodec, parseAudioWireFrame, splitOpusPackets, type AudioWireFrame } from '@ezplayer/ezplayer-core';
import OpusScript from 'opusscript';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { sineWav } from '../fixtures/wav.js';

let show: FixtureShow;
let app: EzPlayerProc;

interface Bus {
    name: string;
    leadMs: number;
    chunkMs: number;
    volume: number;
    builtIn: boolean;
    playLocally: boolean;
    listeners: string[];
    leases: number;
    chunks: number;
    peak: number;
}

interface Lease {
    id: number;
    token: number;
    bus: string;
    leadMs: number;
    chunkMs: number;
    voices: number;
    bufferedMs: number;
    lateMs: number;
    clips: { name: string; durationMs: number }[];
}

interface Reply {
    ok: boolean;
    error?: string;
    now: number;
    udpPort: number;
    buses: Bus[];
    listeners: { name: string; connected: boolean; addresses: string[]; buses: string[] }[];
    leases: Lease[];
    lease: Lease;
    clip: { name: string; durationMs: number };
    play: { voice: number; startsAt: number; lateMs: number };
    stopped: number;
}

async function call(
    method: string,
    path: string,
    body?: object | Uint8Array,
): Promise<{ status: number; body: Reply }> {
    const raw = body instanceof Uint8Array;
    const res = await fetch(`${app.base}/api/ezp/audio${path}`, {
        method,
        headers: body ? { 'content-type': raw ? 'application/octet-stream' : 'application/json' } : undefined,
        body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as Reply };
}

async function ok(method: string, path: string, body?: object | Uint8Array): Promise<Reply> {
    const r = await call(method, path, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
}

const at = (lease: Lease, rest = '') =>
    `/leases/${lease.id}${rest}${rest.includes('?') ? '&' : '?'}token=${lease.token}`;

/** Listen to the show audio until `ms` have passed; returns each 100 ms frame's time and level. */
async function listenFor(ms: number, during: () => Promise<void>): Promise<{ playAt: number; rms: number }[]> {
    const frames: AudioWireFrame[] = [];
    const ws = new WebSocket(`${app.base.replace(/^http/, 'ws')}/api/ezp/audiostream`);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('audio socket failed to open')), { once: true });
    });
    ws.addEventListener('message', (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        const f = parseAudioWireFrame(new Uint8Array(ev.data.slice(0)));
        if (f) frames.push({ ...f, payload: f.payload.slice() });
    });
    await during();
    await new Promise((r) => setTimeout(r, ms));
    ws.close();
    expect(new Set(frames.map((f) => f.codec))).toEqual(new Set([AudioWireCodec.Opus]));
    const dec = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    try {
        return frames.map((f) => {
            let sum = 0;
            let n = 0;
            for (const p of splitOpusPackets(f.payload)) {
                const out = dec.decode(Buffer.from(p));
                const s16 = new Int16Array(out.buffer, out.byteOffset, out.byteLength / 2);
                for (let i = 0; i < s16.length; i += 2) {
                    sum += (s16[i]! / 32768) ** 2;
                    n++;
                }
            }
            return { playAt: f.playAt, rms: Math.sqrt(sum / Math.max(1, n)) };
        });
    } finally {
        dec.delete();
    }
}

/** A sine as raw PCM: 16-bit little-endian stereo at 48 kHz. */
function sinePcm(seconds: number, hz: number, amplitude: number): Uint8Array {
    const frames = Math.round(seconds * 48000);
    const pcm = new Int16Array(frames * 2);
    for (let i = 0; i < frames; i++) {
        pcm[i * 2] = pcm[i * 2 + 1] = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * hz * i) / 48000));
    }
    return new Uint8Array(pcm.buffer);
}

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
});

describe('audio injection', () => {
    it('lists the built-in buses and keeps registered ones in settings', async () => {
        const start = await ok('GET', '/buses');
        expect(start.buses.map((b) => b.name)).toEqual(['main', 'immediate']);
        expect(start.buses[0]).toMatchObject({ builtIn: true, chunkMs: 100 });
        expect(start.buses[0]!.leadMs).toBeGreaterThanOrEqual(700);
        expect(start.buses[1]).toMatchObject({ builtIn: true, leadMs: 40, chunkMs: 20, volume: 100 });
        expect(Math.abs(start.now - Date.now())).toBeLessThan(2000);

        const added = await ok('POST', '/buses', { name: 'tree', leadMs: 100, chunkMs: 25, volume: 60 });
        expect(added.buses[2]).toMatchObject({ name: 'tree', builtIn: false, leadMs: 100, chunkMs: 25, volume: 60 });
        const stored = await fetch(`${app.base}/api/ezp/playback-settings/audioBuses`);
        expect(await stored.json()).toEqual([{ name: 'tree', leadMs: 100, chunkMs: 25, volume: 60 }]);
        // A second write changes only what it names.
        expect((await ok('POST', '/buses', { name: 'tree', volume: 30 })).buses[2]).toMatchObject({
            leadMs: 100,
            volume: 30,
        });

        expect((await call('POST', '/buses', { name: 'main' })).status).toBe(400);
        expect((await call('POST', '/buses', { name: 'bad/name' })).status).toBe(400);
        expect((await call('DELETE', '/buses/immediate')).status).toBe(400);
        expect((await call('DELETE', '/buses/nowhere')).status).toBe(404);
        expect((await ok('DELETE', '/buses/tree')).buses.map((b) => b.name)).toEqual(['main', 'immediate']);
    });

    it('registers a bus that a lease names for the first time', async () => {
        const opened = await ok('POST', '/leases', { bus: 'porch', name: 'it-porch' });
        expect(opened.lease).toMatchObject({ bus: 'porch', leadMs: 40, chunkMs: 20 });
        expect((await ok('GET', '/buses')).buses.find((b) => b.name === 'porch')).toMatchObject({ leases: 1 });
        const stored = await fetch(`${app.base}/api/ezp/playback-settings/audioBuses`);
        expect(await stored.json()).toEqual([{ name: 'porch' }]);
        // Removing the bus ends its leases.
        await ok('DELETE', '/buses/porch');
        const deadline = Date.now() + 3000;
        while ((await ok('GET', '/leases')).leases.length > 0 && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect((await ok('GET', '/leases')).leases).toEqual([]);
    });

    it('plays a clip into the show audio at the time asked for', async () => {
        const { lease } = await ok('POST', '/leases', { name: 'it-clip' });
        expect(lease.bus).toBe('main');
        const wav = sineWav({ seconds: 1, sampleRate: 44100, frequencyHz: 660, amplitude: 0.5 });
        const clip = await ok('PUT', at(lease, '/clips/beep'), new Uint8Array(wav));
        expect(clip.clip.name).toBe('beep');
        expect(clip.clip.durationMs).toBeCloseTo(1000, -1);

        let startsAt = 0;
        const heard = await listenFor(3500, async () => {
            // Let the listener stream settle, then ask for a time 1.5 s out.
            await new Promise((r) => setTimeout(r, 800));
            const { now } = await ok('GET', '/buses');
            const played = await ok('POST', at(lease, '/play'), { clip: 'beep', at: now + 1500 });
            expect(played.play.lateMs).toBe(0);
            startsAt = played.play.startsAt;
        });
        const loud = heard.filter((f) => f.rms > 0.2);
        const dump = heard.map((f) => `${Math.round(f.playAt - startsAt)}:${f.rms.toFixed(2)}`).join(' ');
        // One second of a 0.5 sine: about ten 100 ms frames near RMS 0.35.
        expect(loud.length, dump).toBeGreaterThanOrEqual(8);
        expect(loud.length, dump).toBeLessThanOrEqual(12);
        expect(Math.abs(loud[0]!.playAt - startsAt), dump).toBeLessThanOrEqual(120);
        expect(
            heard.filter((f) => f.playAt < startsAt - 250).every((f) => f.rms < 0.01),
            dump,
        ).toBe(true);

        // A looping voice is stopped by its handle; the lease then holds no voices.
        const loop = await ok('POST', at(lease, '/play'), { clip: 'beep', loop: true, gain: 0.25 });
        expect((await ok('POST', at(lease, '/stop'), { voice: loop.play.voice, fadeMs: 50 })).stopped).toBe(1);
        expect((await call('POST', at(lease, '/play'), { clip: 'none' })).status).toBe(400);
        expect((await call('POST', `/leases/${lease.id}/play?token=1`, { clip: 'beep' })).status).toBe(404);
        await ok('DELETE', at(lease));
        expect((await call('POST', at(lease, '/keepalive'))).status).toBe(404);
    });

    it('takes a stream over UDP and over HTTP', async () => {
        const opened = await ok('POST', '/leases', {
            name: 'it-stream',
            sampleRate: 48000,
            channels: 2,
            encoding: 's16le',
        });
        const lease = opened.lease;
        expect(opened.udpPort).toBeGreaterThan(0);
        const pcm = sinePcm(1, 440, 0.5);
        const sock = dgram.createSocket('udp4');
        let startsAt = 0;
        const heard = await listenFor(3500, async () => {
            await new Promise((r) => setTimeout(r, 800));
            startsAt = (await ok('GET', '/buses')).now + 1500;
            // 20 ms packets, each stamped with its own time.
            const bytes = 960 * 4;
            for (let k = 0; k * bytes < pcm.length; k++) {
                const data = pcm.subarray(k * bytes, (k + 1) * bytes);
                const p = Buffer.alloc(24 + data.length);
                p.writeUInt32BE(0x455a4131, 0);
                p.writeUInt32BE(lease.id, 4);
                p.writeUInt32BE(lease.token, 8);
                p.writeUInt32BE(k + 1, 12);
                p.writeDoubleBE(startsAt + k * 20, 16);
                p.set(data, 24);
                sock.send(p, opened.udpPort, '127.0.0.1');
                if (k % 10 === 9) await new Promise((r) => setTimeout(r, 2));
            }
            const queued = (await ok('GET', '/leases')).leases.find((l) => l.id === lease.id)!;
            expect(queued.lateMs).toBe(0);
            expect(queued.bufferedMs).toBeGreaterThan(2000);
        });
        sock.close();
        const loud = heard.filter((f) => f.rms > 0.2);
        const dump = heard.map((f) => `${Math.round(f.playAt - startsAt)}:${f.rms.toFixed(2)}`).join(' ');
        expect(loud.length, dump).toBeGreaterThanOrEqual(8);
        expect(loud.length, dump).toBeLessThanOrEqual(12);
        expect(Math.abs(loud[0]!.playAt - startsAt), dump).toBeLessThanOrEqual(120);

        // The same over HTTP, with no time: it follows on as soon as the bus allows.
        const put = await ok('PUT', at(lease, '/stream'), pcm.subarray(0, 9600 * 4));
        expect((put as unknown as { stream: { bufferedMs: number } }).stream.bufferedMs).toBeGreaterThan(700);
        await ok('DELETE', at(lease));
    });

    it('plays on the immediate bus within its lead', async () => {
        const before = (await ok('GET', '/buses')).buses.find((b) => b.name === 'immediate')!;
        const { lease } = await ok('POST', '/leases', { bus: 'immediate', name: 'it-now' });
        await ok('PUT', at(lease, '/clips/zap'), sinePcm(0.2, 880, 0.5));
        const played = await ok('POST', at(lease, '/play'), { clip: 'zap' });
        // Lead 40 ms plus at most one 20 ms chunk.
        expect(played.play.startsAt - played.now).toBeGreaterThanOrEqual(40);
        expect(played.play.startsAt - played.now).toBeLessThanOrEqual(61);
        await new Promise((r) => setTimeout(r, 500));
        const after = (await ok('GET', '/buses')).buses.find((b) => b.name === 'immediate')!;
        expect(after.chunks - before.chunks).toBe(10);
        expect(after.peak).toBeGreaterThan(0.45);
        expect(after.peak).toBeLessThanOrEqual(0.5);
        expect((await ok('GET', '/leases')).leases.find((l) => l.id === lease.id)!.voices).toBe(0);
        await ok('DELETE', at(lease));
    });

    it('serves a bus to subscribers as timed PCM', async () => {
        // Off this computer's speakers: only subscribers play it.
        const made = await ok('POST', '/buses', { name: 'yard', leadMs: 150, playLocally: false });
        expect(made.buses.find((b) => b.name === 'yard')).toMatchObject({ leadMs: 150, playLocally: false });
        const frames: AudioWireFrame[] = [];
        const ws = new WebSocket(`${app.base.replace(/^http/, 'ws')}/api/ezp/audiostream?bus=yard`);
        ws.binaryType = 'arraybuffer';
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener('open', () => resolve(), { once: true });
            ws.addEventListener('error', () => reject(new Error('bus socket failed to open')), { once: true });
        });
        ws.addEventListener('message', (ev) => {
            if (!(ev.data instanceof ArrayBuffer)) return;
            const f = parseAudioWireFrame(new Uint8Array(ev.data.slice(0)));
            if (f) frames.push({ ...f, payload: f.payload.slice() });
        });
        await new Promise((r) => setTimeout(r, 200));

        const { lease } = await ok('POST', '/leases', { bus: 'yard', name: 'it-yard' });
        await ok('PUT', at(lease, '/clips/zap'), sinePcm(0.2, 880, 0.5));
        const played = await ok('POST', at(lease, '/play'), { clip: 'zap' });
        await new Promise((r) => setTimeout(r, 700));
        ws.close();

        // 200 ms from a chunk edge is ten 20 ms pieces, one after another.
        expect(frames.length).toBe(10);
        expect(frames[0]!.playAt).toBe(played.play.startsAt);
        for (const [i, f] of frames.entries()) {
            expect(f).toMatchObject({ codec: AudioWireCodec.PcmF32, sampleRate: 48000, channels: 2, frames: 960 });
            expect(f.playAt).toBe(frames[0]!.playAt + i * 20);
            // Sent the bus's lead ahead of its time.
            expect(f.playAt - f.serverNow).toBeGreaterThan(100);
            expect(f.playAt - f.serverNow).toBeLessThanOrEqual(151);
        }
        const pcm = new Float32Array(frames[2]!.payload.buffer, frames[2]!.payload.byteOffset, 960 * 2);
        expect(Math.max(...pcm)).toBeGreaterThan(0.45);
        expect(Math.max(...pcm)).toBeLessThanOrEqual(0.5);
        await ok('DELETE', '/buses/yard');
    });

    it('sends a bus to a listener that connected by name, as 16-bit PCM', async () => {
        const frames: AudioWireFrame[] = [];
        const ws = new WebSocket(`${app.base.replace(/^http/, 'ws')}/api/ezp/audiostream?listener=it-pi&format=s16`);
        ws.binaryType = 'arraybuffer';
        await new Promise<void>((resolve, reject) => {
            ws.addEventListener('open', () => resolve(), { once: true });
            ws.addEventListener('error', () => reject(new Error('listener socket failed to open')), { once: true });
        });
        ws.addEventListener('message', (ev) => {
            if (!(ev.data instanceof ArrayBuffer)) return;
            const f = parseAudioWireFrame(new Uint8Array(ev.data.slice(0)));
            if (f) frames.push({ ...f, payload: f.payload.slice() });
        });
        // Connecting is what makes it known, and it stays in settings.
        await new Promise((r) => setTimeout(r, 300));
        expect((await ok('GET', '/listeners')).listeners).toEqual([
            { name: 'it-pi', connected: true, addresses: [expect.any(String)], buses: [] },
        ]);
        const stored = await fetch(`${app.base}/api/ezp/playback-settings/audioListeners`);
        expect(await stored.json()).toEqual([{ name: 'it-pi' }]);

        const { lease } = await ok('POST', '/leases', { bus: 'porch', name: 'it-porch' });
        await ok('PUT', at(lease, '/clips/zap'), sinePcm(0.2, 880, 0.5));
        // Nothing reaches it until the bus is sent to it.
        await ok('POST', at(lease, '/play'), { clip: 'zap' });
        await new Promise((r) => setTimeout(r, 500));
        expect(frames.length).toBe(0);
        const made = await ok('POST', '/buses', {
            name: 'porch',
            leadMs: 150,
            playLocally: false,
            listeners: ['it-pi'],
        });
        expect(made.buses.find((b) => b.name === 'porch')).toMatchObject({ listeners: ['it-pi'] });
        await new Promise((r) => setTimeout(r, 100));
        const played = await ok('POST', at(lease, '/play'), { clip: 'zap' });
        await new Promise((r) => setTimeout(r, 700));

        expect(frames.length).toBe(10);
        expect(frames[0]!.playAt).toBe(played.play.startsAt);
        for (const f of frames) {
            expect(f).toMatchObject({ codec: AudioWireCodec.PcmS16, sampleRate: 48000, channels: 2, frames: 960 });
            expect(f.payload.byteLength).toBe(960 * 2 * 2);
        }
        const pcm = new Int16Array(frames[2]!.payload.buffer, frames[2]!.payload.byteOffset, 960 * 2);
        expect(Math.max(...pcm)).toBeGreaterThan(0.45 * 32767);
        expect(Math.max(...pcm)).toBeLessThanOrEqual(Math.round(0.5 * 32767));
        expect((await ok('GET', '/listeners')).listeners[0]).toMatchObject({ connected: true, buses: ['porch'] });

        ws.close();
        await new Promise((r) => setTimeout(r, 200));
        expect((await ok('GET', '/listeners')).listeners[0]).toMatchObject({ name: 'it-pi', connected: false });
        // Forgetting it takes it off the buses too.
        expect((await ok('DELETE', '/listeners/it-pi')).listeners).toEqual([]);
        expect((await ok('GET', '/buses')).buses.find((b) => b.name === 'porch')).toMatchObject({ listeners: [] });
        expect((await call('DELETE', '/listeners/it-pi')).status).toBe(404);
        await ok('DELETE', '/buses/porch');
    });

    it('stays up through a malformed upgrade request', async () => {
        const port = Number(new URL(app.base).port);
        await new Promise<void>((resolve, reject) => {
            const s = net.connect(port, '127.0.0.1', () => {
                s.write(
                    'GET //[ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
                        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
                );
                setTimeout(() => {
                    s.destroy();
                    resolve();
                }, 300);
            });
            s.on('error', reject);
        });
        expect((await ok('GET', '/buses')).ok).toBe(true);
    });

    it('keeps both buses when two programs name new ones at once, and stops at the limit', async () => {
        const [a, b] = await Promise.all([
            ok('POST', '/leases', { bus: 'raceA' }),
            ok('POST', '/leases', { bus: 'raceB' }),
        ]);
        const names = (await ok('GET', '/buses')).buses.map((x) => x.name);
        expect(names).toEqual(expect.arrayContaining(['raceA', 'raceB']));
        // Neither lease was lost to the other's settings write.
        await ok('POST', at(a.lease, '/keepalive'));
        await ok('POST', at(b.lease, '/keepalive'));

        // Sixteen in all: the built-in two, these two, and twelve more.
        for (let i = 0; i < 12; i++) await ok('POST', '/buses', { name: `cap${i}` });
        const full = await call('POST', '/buses', { name: 'cap12' });
        expect(full.status).toBe(400);
        expect(full.body.error).toMatch(/all 16/);
        expect((await call('POST', '/leases', { bus: 'cap13' })).status).toBe(400);
        const stored = await fetch(`${app.base}/api/ezp/playback-settings/audioBuses`);
        expect(((await stored.json()) as unknown[]).length).toBe(14);
        // One that exists can still be changed.
        await ok('POST', '/buses', { name: 'cap3', volume: 10 });
        for (const name of ['raceA', 'raceB', ...Array.from({ length: 12 }, (_, i) => `cap${i}`)]) {
            await ok('DELETE', `/buses/${name}`);
        }
        // A number sent as text is refused.
        expect((await call('POST', '/leases', { gain: '0.8' })).status).toBe(400);
    });

    it('drops a lease nobody keeps alive', async () => {
        const { lease } = await ok('POST', '/leases', { bus: 'immediate', ttlMs: 1000 });
        await new Promise((r) => setTimeout(r, 600));
        await ok('POST', at(lease, '/keepalive'));
        await new Promise((r) => setTimeout(r, 600));
        expect((await ok('GET', '/leases')).leases.some((l) => l.id === lease.id)).toBe(true);
        await new Promise((r) => setTimeout(r, 2500));
        expect((await ok('GET', '/leases')).leases.some((l) => l.id === lease.id)).toBe(false);
    });
});
