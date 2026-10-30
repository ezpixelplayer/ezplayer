/** MultiSync master packets: sequence and media sync on the wire, driven by
 *  the per-frame hook with a controlled clock. A UDP socket on loopback plays
 *  the remote; packets are decoded per FPP src/MultiSync.h. */

import dgram from 'node:dgram';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEDIA_SYNC_INTERVAL_MS, MultiSyncSender } from './multisync';

const ACTIONS = ['start', 'stop', 'sync', 'open'] as const;

interface Pkt {
    action: (typeof ACTIONS)[number];
    fileType: number;
    frame: number;
    seconds: number;
    file: string;
}

function decode(buf: Buffer): Pkt {
    expect(buf.toString('latin1', 0, 4)).toBe('FPPD');
    expect(buf[4]).toBe(1); // CTRL_PKT_SYNC
    const len = buf.readUInt16LE(5);
    const p = buf.subarray(7, 7 + len);
    const nul = p.indexOf(0, 10);
    return {
        action: ACTIONS[p[0]],
        fileType: p[1],
        frame: p.readUInt32LE(2),
        seconds: p.readFloatLE(6),
        file: p.toString('utf8', 10, nul === -1 ? p.length : nul),
    };
}

let sock: dgram.Socket;
let port: number;
let received: Pkt[];
let sender: MultiSyncSender;

/** Wait until `n` packets have arrived (UDP on loopback is quick, but async). */
async function drain(n: number): Promise<Pkt[]> {
    const deadline = Date.now() + 2000;
    while (received.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    expect(received.length).toBe(n);
    return received.splice(0);
}

beforeEach(async () => {
    received = [];
    sock = dgram.createSocket('udp4');
    sock.on('message', (m) => received.push(decode(m)));
    await new Promise<void>((r) => sock.bind(0, '127.0.0.1', r));
    port = sock.address().port;
    sender = new MultiSyncSender();
    sender.configure({ enabled: true, remotes: [`127.0.0.1:${port}`] });
});

afterEach(() => {
    sender.configure({ enabled: false });
    sock.close();
});

const seqAt = (frameNumber: number, msperframe = 50) => ({
    file: 'Song.fseq',
    frameNumber,
    secondsElapsed: (frameNumber * msperframe) / 1000,
});

describe('MultiSyncSender', () => {
    it('opens and starts the sequence and its audio together, then syncs each on its own cadence', async () => {
        let now = 1000;
        sender.onFrame({ seq: seqAt(0), media: { file: 'Song.mp3', secondsElapsed: 0 } }, now);
        // seq OPEN, START, SYNC (early frame); media OPEN, START
        let pk = await drain(5);
        expect(pk.map((p) => [p.action, p.fileType])).toEqual([
            ['open', 0],
            ['start', 0],
            ['sync', 0],
            ['open', 1],
            ['start', 1],
        ]);
        expect(pk.every((p) => (p.fileType === 0 ? p.file === 'Song.fseq' : p.file === 'Song.mp3'))).toBe(true);
        expect(pk[4].frame).toBe(0); // media carries no frame number

        // Frames 1..3 sync every frame; media stays quiet until its interval elapses.
        for (let f = 1; f <= 3; f++) {
            now += 50;
            sender.onFrame({ seq: seqAt(f), media: { file: 'Song.mp3', secondsElapsed: f * 0.05 } }, now);
        }
        pk = await drain(3);
        expect(pk.map((p) => [p.action, p.fileType, p.frame])).toEqual([
            ['sync', 0, 1],
            ['sync', 0, 2],
            ['sync', 0, 3],
        ]);

        // Advance past the media interval: the next frame carries a media SYNC with
        // the audio's own position (here trailing the lights by a sync adjust).
        now = 1000 + MEDIA_SYNC_INTERVAL_MS;
        sender.onFrame({ seq: seqAt(10), media: { file: 'Song.mp3', secondsElapsed: 0.5 - 0.08 } }, now);
        pk = await drain(1);
        expect(pk[0]).toMatchObject({ action: 'sync', fileType: 1, frame: 0, file: 'Song.mp3' });
        expect(pk[0].seconds).toBeCloseTo(0.42, 5);

        // Sequence cadence: 16 frames after the last seq sync (frame 3) → frame 19.
        now += 50;
        sender.onFrame({ seq: seqAt(19), media: { file: 'Song.mp3', secondsElapsed: 0.87 } }, now);
        pk = await drain(1);
        expect(pk[0]).toMatchObject({ action: 'sync', fileType: 0, frame: 19 });
        expect(pk[0].seconds).toBeCloseTo(0.95, 5);
    });

    it('starts the audio later than the lights when the audio has not begun, and stops it when it ends', async () => {
        // Lights running, audio pushed into the future by a sync adjust: no media yet.
        sender.onFrame({ seq: seqAt(0) }, 0);
        let pk = await drain(3);
        expect(pk.every((p) => p.fileType === 0)).toBe(true);

        sender.onFrame({ seq: seqAt(1), media: { file: 'Song.mp3', secondsElapsed: 0.01 } }, 50);
        pk = await drain(3); // seq SYNC (early), media OPEN, START
        expect(pk.map((p) => [p.action, p.fileType])).toEqual([
            ['sync', 0],
            ['open', 1],
            ['start', 1],
        ]);
        expect(pk[2].seconds).toBeCloseTo(0.01, 5);

        // Audio ran out before the lights (negative adjust, or a shorter file).
        sender.onFrame({ seq: seqAt(2) }, 100);
        pk = await drain(2);
        expect(pk.map((p) => [p.action, p.fileType])).toEqual([
            ['sync', 0],
            ['stop', 1],
        ]);
        expect(pk[1].file).toBe('Song.mp3');

        // Idle stops the sequence; the media is already closed.
        sender.onIdle();
        pk = await drain(1);
        expect(pk[0]).toMatchObject({ action: 'stop', fileType: 0, file: 'Song.fseq' });
    });

    it('changes songs with stop/open/start for both files', async () => {
        sender.onFrame({ seq: seqAt(0), media: { file: 'A.mp3', secondsElapsed: 0 } }, 0);
        await drain(5);
        sender.onFrame(
            { seq: { file: 'B.fseq', frameNumber: 0, secondsElapsed: 0 }, media: { file: 'B.mp3', secondsElapsed: 0 } },
            50,
        );
        const pk = await drain(7);
        expect(pk.map((p) => [p.action, p.fileType, p.file])).toEqual([
            ['stop', 0, 'Song.fseq'],
            ['open', 0, 'B.fseq'],
            ['start', 0, 'B.fseq'],
            ['sync', 0, 'B.fseq'],
            ['stop', 1, 'A.mp3'],
            ['open', 1, 'B.mp3'],
            ['start', 1, 'B.mp3'],
        ]);
    });

    it('keeps the sequence packets and drops media when mediaSync is off', async () => {
        sender.configure({ enabled: true, remotes: [`127.0.0.1:${port}`], mediaSync: false });
        sender.onFrame({ seq: seqAt(0), media: { file: 'Song.mp3', secondsElapsed: 0 } }, 0);
        const pk = await drain(3);
        expect(pk.every((p) => p.fileType === 0)).toBe(true);
        // Turning it off mid-song closes the audio out on the remotes.
        sender.configure({ enabled: true, remotes: [`127.0.0.1:${port}`], mediaSync: true });
        sender.onFrame({ seq: seqAt(1), media: { file: 'Song.mp3', secondsElapsed: 0.05 } }, 50);
        await drain(3);
        sender.configure({ enabled: true, remotes: [`127.0.0.1:${port}`], mediaSync: false });
        const stop = await drain(1);
        expect(stop[0]).toMatchObject({ action: 'stop', fileType: 1, file: 'Song.mp3' });
    });

    it('closes out both files when disabled', async () => {
        sender.onFrame({ seq: seqAt(0), media: { file: 'Song.mp3', secondsElapsed: 0 } }, 0);
        await drain(5);
        sender.configure({ enabled: false });
        const pk = await drain(2);
        expect(pk.map((p) => [p.action, p.fileType])).toEqual([
            ['stop', 0],
            ['stop', 1],
        ]);
    });
});
