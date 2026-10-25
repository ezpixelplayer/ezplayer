/** FPP MultiSync master: with multisync enabled and the mock as a unicast
 *  remote, playback must emit OPEN/START, monotonically advancing SYNC
 *  frames at the expected cadence, and STOP at the end — the packets an
 *  FPP or xSchedule remote follows. A song with audio also gets media
 *  (fileType 1) OPEN/START, periodic SYNC with the audio position, and STOP.
 *  Each sync packet must go out with the frame it describes, not ahead of it,
 *  and the /ws status must follow song changes at once, with a position. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockController, type MockController, type SyncEvent } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';
import { sineWav } from '../fixtures/wav.js';

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

/** The lights lead the audio by this much (ms) in the media test; the media
 *  packets must show it while the sequence packets do not. */
const AUDIO_SYNC_ADJUST_MS = 200;

/** Frames carry their own number in channels 0-1 so a DDP push can be matched
 *  to the sync packet describing it. */
const numberedFrames = (frames: number) =>
    buildFseq({
        channels: 150,
        frames,
        pattern: (frame, data) => {
            data.fill(42);
            data[0] = frame & 0xff;
            data[1] = frame >> 8;
        },
    });

async function setSync(audioSyncAdjust: number) {
    const settings = await fetch(`${app.base}/api/ezp/playback-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            audioSyncAdjust,
            backgroundSequence: 'overlay',
            viewerControl: { enabled: false, type: 'disabled', schedule: [] },
            volumeControl: { defaultVolume: 100, schedule: [] },
            sync: { multisync: { enabled: true, remotes: [`127.0.0.1:${mock.multisyncPort}`] } },
        }),
    });
    expect(settings.status).toBe(200);
}

beforeAll(async () => {
    mock = await startMockController({ channels: 150, ddpPort: 4048, multisyncPort: 0 });
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
    await fpp.uploadFile('sequences', 'SyncSong.fseq', numberedFrames(400)); // 20s
    let res = await fpp.putPlaylist('SyncShow', {
        name: 'SyncShow',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'SyncSong.fseq' }],
    });
    expect(res.status).toBe(200);

    await fpp.uploadFile('sequences', 'MediaSong.fseq', numberedFrames(400)); // 20s
    await fpp.uploadFile('music', 'MediaSong.wav', sineWav({ seconds: 20 }));
    res = await fpp.putPlaylist('MediaShow', {
        name: 'MediaShow',
        mainPlaylist: [{ type: 'both', sequenceName: 'MediaSong.fseq', mediaName: 'MediaSong.wav' }],
    });
    expect(res.status).toBe(200);

    await fpp.uploadFile('sequences', 'ShortA.fseq', numberedFrames(60)); // 3s
    await fpp.uploadFile('sequences', 'ShortB.fseq', numberedFrames(60)); // 3s
    res = await fpp.putPlaylist('TwoShow', {
        name: 'TwoShow',
        mainPlaylist: [
            { type: 'sequence', sequenceName: 'ShortA.fseq' },
            { type: 'sequence', sequenceName: 'ShortB.fseq' },
        ],
    });
    expect(res.status).toBe(200);

    await setSync(0);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

const seqEvents = (events: SyncEvent[]) => events.filter((e) => e.fileType === 0);
const mediaEvents = (events: SyncEvent[]) => events.filter((e) => e.fileType === 1);

async function playForAWhile(playlist: string, ms: number) {
    mock.sync!.reset();
    await fpp.command('Start Playlist', playlist, '0');
    await mock.sync!.waitForEvent((e) => e.action === 'start', { timeoutMs: 20_000 });
    await new Promise((r) => setTimeout(r, ms));
    await fpp.command('Stop Now');
    await mock.sync!.waitForEvent((e) => e.action === 'stop', { timeoutMs: 10_000 });
    await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'stopped', timeoutMs: 10_000 });
}

describe('FPP MultiSync master', () => {
    it('emits open/start, advancing sync frames, and stop', async () => {
        await playForAWhile('SyncShow', 3000);

        const events = mock.sync!.events();
        // No audio on this song: nothing but sequence packets.
        expect(mediaEvents(events)).toEqual([]);
        const open = events.find((e) => e.action === 'open');
        const start = events.find((e) => e.action === 'start');
        expect(open?.filename).toBe('SyncSong.fseq');
        expect(start?.filename).toBe('SyncSong.fseq');
        expect(events.indexOf(open!)).toBeLessThan(events.indexOf(start!));

        const syncs = events.filter((e) => e.action === 'sync');
        expect(syncs.length).toBeGreaterThan(3);
        for (const s of syncs) {
            expect(s.filename).toBe('SyncSong.fseq');
            expect(s.fileType).toBe(0);
            // seconds must track frames at the 50ms fixture frame interval
            expect(s.seconds).toBeCloseTo(s.frame * 0.05, 2);
        }
        for (let i = 1; i < syncs.length; i++) {
            expect(syncs[i].frame).toBeGreaterThan(syncs[i - 1].frame);
        }
        // Cadence: after the early burst, syncs come every 16 frames (~800ms)
        const gaps = syncs.slice(1).map((s, i) => s.frame - syncs[i].frame);
        expect(Math.max(...gaps)).toBeLessThanOrEqual(20);

        expect(events[events.length - 1].action).toBe('stop');
        expect(events[events.length - 1].filename).toBe('SyncSong.fseq');
    }, 60_000);

    it('sends each sync packet with the frame it describes, not ahead of it', async () => {
        await playForAWhile('SyncShow', 3000);
        const events = mock.sync!.events();
        const syncs = seqEvents(events).filter((e) => e.action === 'sync' && e.frame > 3);
        expect(syncs.length).toBeGreaterThan(2);
        // Only this run's pushes: earlier tests played the same numbered frames.
        const runStart = events[0].t - 500;
        const ddp = mock.ddp.allFrames().filter((f) => f.t >= runStart && f.channels && !f.black);
        expect(ddp.length).toBeGreaterThan(20);
        const frameNo = (ch: Uint8Array) => ch[0] | (ch[1] << 8);
        let matched = 0;
        for (const s of syncs) {
            const push = ddp.find((f) => frameNo(f.channels!) === s.frame);
            if (!push) continue; // the frame may have been skipped
            matched++;
            // Sync goes out as the frame's deadline arrives, then the frame's
            // single DDP packet follows within the send slot. A packet prepared a
            // frame early would land ~50 ms before its push.
            const lead = push.t - s.t;
            expect(lead, `sync for frame ${s.frame} led its DDP push by ${lead} ms`).toBeLessThan(30);
            expect(lead, `sync for frame ${s.frame} trailed its DDP push by ${-lead} ms`).toBeGreaterThan(-15);
        }
        expect(matched).toBeGreaterThan(2);
    }, 60_000);

    it('sends media sync for the audio file, carrying the audio position with the sync adjust', async () => {
        await setSync(AUDIO_SYNC_ADJUST_MS);
        try {
            mock.sync!.reset();
            await fpp.command('Start Playlist', 'MediaShow', '0');
            await mock.sync!.waitForEvent((e) => e.action === 'start' && e.fileType === 1, { timeoutMs: 20_000 });
            await new Promise((r) => setTimeout(r, 3000));
            await fpp.command('Stop Now');
            await mock.sync!.waitForEvent((e) => e.action === 'stop' && e.fileType === 1, { timeoutMs: 10_000 });
            await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'stopped', timeoutMs: 10_000 });

            const events = mock.sync!.events();
            const media = mediaEvents(events);
            const seqSyncs = seqEvents(events).filter((e) => e.action === 'sync');

            // Both files are opened and started; the audio only once the lights are
            // AUDIO_SYNC_ADJUST_MS in, so its start follows the sequence's.
            expect(media.map((e) => e.action).slice(0, 2)).toEqual(['open', 'start']);
            for (const e of media) {
                expect(e.filename).toBe('MediaSong.wav');
                expect(e.frame).toBe(0); // media packets carry no frame number
            }
            // The audio START goes out when the audio is at 0, i.e. when the lights
            // are AUDIO_SYNC_ADJUST_MS in (the sequence may itself start a frame or
            // two late, so compare positions, not arrival times).
            const mediaStart = media.find((e) => e.action === 'start')!;
            expect(mediaStart.seconds).toBeLessThan(0.06);
            const seqAtMediaStart = seqSyncs.reduce((a, b) =>
                Math.abs(b.t - mediaStart.t) < Math.abs(a.t - mediaStart.t) ? b : a,
            );
            const lightsAtMediaStart = seqAtMediaStart.seconds + (mediaStart.t - seqAtMediaStart.t) / 1000;
            expect(Math.abs(lightsAtMediaStart - AUDIO_SYNC_ADJUST_MS / 1000)).toBeLessThan(0.1);

            // Media SYNC about every 500 ms, each advancing, each describing the
            // audio position — the sync adjust behind the lights at that moment.
            const mediaSyncs = media.filter((e) => e.action === 'sync');
            expect(mediaSyncs.length).toBeGreaterThanOrEqual(4);
            for (let i = 1; i < mediaSyncs.length; i++) {
                expect(mediaSyncs[i].seconds).toBeGreaterThan(mediaSyncs[i - 1].seconds);
                const gapMs = mediaSyncs[i].t - mediaSyncs[i - 1].t;
                expect(gapMs).toBeGreaterThan(350);
                expect(gapMs).toBeLessThan(800);
            }
            for (const m of mediaSyncs) {
                // The sequence packet nearest in time gives the lights' position then.
                const near = seqSyncs.reduce((a, b) => (Math.abs(b.t - m.t) < Math.abs(a.t - m.t) ? b : a));
                const lightsAtM = near.seconds + (m.t - near.t) / 1000;
                expect(Math.abs(lightsAtM - m.seconds - AUDIO_SYNC_ADJUST_MS / 1000)).toBeLessThan(0.15);
            }

            // Stop closes both.
            const last = events.slice(-2).map((e) => [e.action, e.fileType]);
            expect(last).toEqual(
                expect.arrayContaining([
                    ['stop', 0],
                    ['stop', 1],
                ]),
            );
        } finally {
            await setSync(0);
        }
    }, 60_000);
});

interface PStatusSample {
    t: number;
    status: string;
    now_playing?: { sequence_id?: string; title?: string; at?: number; until?: number };
    position?: { content_ms: number; audio_ms?: number; sampled_at: number };
}

/** Collect every pStatus the player pushes on /ws, stamped at receipt. */
function watchPStatus() {
    const samples: PStatusSample[] = [];
    const ws = new WebSocket(`${app.base.replace(/^http/, 'ws')}/ws`);
    const opened = new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve(), { once: true });
        ws.addEventListener('error', () => reject(new Error('status socket failed to open')), { once: true });
    });
    ws.addEventListener('message', (ev) => {
        if (typeof ev.data !== 'string') return;
        const msg = JSON.parse(ev.data);
        if (msg?.type === 'snapshot' && msg.data?.pStatus) samples.push({ t: Date.now(), ...msg.data.pStatus });
    });
    const until = async (pred: (s: PStatusSample) => boolean, timeoutMs: number) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const hit = samples.find(pred);
            if (hit) return hit;
            await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error(`no matching pStatus within ${timeoutMs} ms; got ${samples.length}`);
    };
    return { samples, opened, until, close: () => ws.close() };
}

describe('status push on playback events', () => {
    it('pushes pStatus with a position as songs start and end on their own', async () => {
        const w = watchPStatus();
        await w.opened;
        try {
            await fpp.command('Start Playlist', 'TwoShow', '0');
            const first = await w.until((s) => s.status === 'Playing' && !!s.now_playing?.sequence_id, 20_000);
            const second = await w.until(
                (s) =>
                    s.status === 'Playing' &&
                    !!s.now_playing &&
                    s.now_playing.sequence_id !== first.now_playing!.sequence_id,
                20_000,
            );
            const stopped = await w.until(
                (s) => w.samples.indexOf(s) > w.samples.indexOf(second) && s.status === 'Stopped',
                20_000,
            );

            // The second song's first status arrives as it starts, not on the next
            // one-second tick: within a frame or two of its start time (`at` is the
            // engine clock, wall time on the player; same host, same clock here).
            expect(second.now_playing!.at).toBeDefined();
            expect(second.t - second.now_playing!.at!).toBeLessThan(250);
            // ...and so does the end of the show.
            expect(second.now_playing!.until).toBeDefined();
            expect(stopped.t - second.now_playing!.until!).toBeLessThan(250);

            // Position: where the song is at the engine clock. No audio here and no
            // lead pad, so the song's start is `sampled_at - content_ms`, and the 3 s
            // song ends at `until` (`at` is re-clamped to the clock on each push and
            // does not mark the start).
            for (const s of [first, second]) {
                expect(s.position).toBeDefined();
                expect(s.position!.audio_ms).toBeUndefined();
                expect(s.position!.content_ms).toBeGreaterThanOrEqual(0);
                expect(s.position!.sampled_at - s.position!.content_ms + 3000).toBeCloseTo(s.now_playing!.until!, -2);
            }
            expect(second.position!.content_ms).toBeLessThan(200);
            expect(stopped.position).toBeUndefined();
        } finally {
            w.close();
            await fpp.command('Stop Now');
            await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'stopped', timeoutMs: 10_000 });
        }
    }, 60_000);
});
