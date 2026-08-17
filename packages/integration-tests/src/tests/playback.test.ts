/** End-to-end playback: FPP Start Playlist -> status advances AND real DDP
 *  frames arrive at the mock controller with the expected channel data. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient, type EzpPStatus } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

/** Poll the raw pushed pStatus (GET /api/ezp/current-show) until pred passes.
 *  This is the same object the electron UI and the LAN web viewers render, so
 *  staleness here is exactly what a user sees on screen. */
async function waitForPStatus(
    pred: (p: EzpPStatus | undefined) => boolean,
    label: string,
    timeoutMs = 15_000,
): Promise<EzpPStatus> {
    const deadline = Date.now() + timeoutMs;
    let last: EzpPStatus | undefined;
    for (;;) {
        last = (await fpp.currentShow()).pStatus;
        if (pred(last)) return last ?? {};
        if (Date.now() > deadline) {
            throw new Error(`waitForPStatus (${label}) timed out; last=${JSON.stringify(last).slice(0, 400)}`);
        }
        await new Promise((r) => setTimeout(r, 500));
    }
}

beforeAll(async () => {
    // The player's DDP sender targets the controller IP on the fixed DDP port,
    // so the mock must own 4048 (vitest runs these files sequentially).
    mock = await startMockController({ channels: 150, ddpPort: 4048 });
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);

    await fpp.uploadFile('sequences', 'SongA.fseq', buildFseq({ channels: 150, frames: 400, value: 42 })); // 20s
    const res = await fpp.putPlaylist('Main Show', {
        name: 'Main Show',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'SongA.fseq' }],
    });
    expect(res.status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('playback', () => {
    it('Start Playlist plays with advancing elapsed and DDP frames at the mock', async () => {
        const start = await fpp.command('Start Playlist', 'Main Show', 0, 0, 0);
        expect(start.status).toBe(200);

        const playing = await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'playing' });
        expect(playing.current_sequence).toBe('SongA.fseq');
        expect(playing.current_playlist.playlist).toBe('Main Show');
        expect(playing.current_playlist.count).toBe('1');

        // seconds_elapsed is a string and must advance on the wall clock
        const e1 = Number(playing.seconds_elapsed);
        await new Promise((r) => setTimeout(r, 2500));
        const later = await fpp.status();
        expect(Number(later.seconds_elapsed)).toBeGreaterThan(e1);
        expect(typeof later.milliseconds_elapsed).toBe('number');

        // Real light data arrives: ~20fps push frames carrying the fixture value
        await mock.ddp.waitForFrames(20, { timeoutMs: 20_000 });
        expect(Array.from(mock.ddp.channelRange(0, 3))).toEqual([42, 42, 42]);
        expect(Array.from(mock.ddp.channelRange(147, 3))).toEqual([42, 42, 42]);
    });

    it('pause freezes elapsed; resume unfreezes', async () => {
        expect((await fpp.command('Pause Playlist')).status).toBe(200);
        const paused = await fpp.waitForStatus((s) => s.status_name === 'paused', { label: 'paused' });
        const frozen = Number(paused.seconds_elapsed);
        await new Promise((r) => setTimeout(r, 2000));
        const still = await fpp.status();
        expect(Number(still.seconds_elapsed)).toBe(frozen);

        expect((await fpp.command('Resume Playlist')).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'resumed' });
    });

    it('volume is readable but not writable (settings-driven)', async () => {
        expect((await fpp.command('Volume Set', 37)).status).toBe(404);
        const vol = (await (await fetch(`${app.base}/api/system/volume`)).json()) as { volume: number };
        expect(typeof vol.volume).toBe('number');
    });

    it('Stop Now goes idle and output goes dark', async () => {
        // Pre-condition: raw pStatus (what the UI and web viewers render) shows
        // the track as now playing.
        await waitForPStatus((p) => !!p?.now_playing, 'now_playing set while playing');

        expect((await fpp.command('Stop Now')).status).toBe(200);
        const idle = await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle' });
        // FPP idle shape
        expect(idle.current_sequence).toBe('');
        expect(idle.seconds_elapsed).toBe('0');
        expect(idle.time_elapsed).toBe('00:00');
        expect(idle.current_playlist).toMatchObject({ playlist: '', index: '0', count: '0' });

        // The raw pStatus must drop now_playing too — this is what NowPlayingCard
        // and the viewer pages key off, and it used to stay stale after an abort.
        const stopped = await waitForPStatus(
            (p) => p?.status === 'Stopped' && !p?.now_playing,
            'now_playing cleared after Stop Now',
        );
        expect(stopped.now_playing).toBeUndefined();

        // EZPlayer keeps pushing black frames while idle (lights off, not
        // silence) — assert the data goes dark rather than the wire quiet.
        const deadline = Date.now() + 20_000;
        for (;;) {
            const f = mock.ddp.lastFrame();
            if (f && f.channels.every((b) => b === 0)) break;
            if (Date.now() > deadline) throw new Error('output never went dark after Stop Now');
            await new Promise((r) => setTimeout(r, 250));
        }

        // And with sendIdleBlackFrames at its default, they keep coming at the
        // idle cadence (~5Hz) — the counterpart of idle-black.test's silence.
        mock.ddp.reset();
        await new Promise((r) => setTimeout(r, 1600));
        const idleFrames = mock.ddp.frameSummaries();
        expect(idleFrames.length).toBeGreaterThanOrEqual(4);
        expect(idleFrames.every((f) => f.black)).toBe(true);
    });

    // The native command endpoint is what the UI play buttons use (playlist
    // list, songs list, show-status test area) — cover it alongside FPP-compat.
    it('native playplaylist via /api/ezp/player-command plays the playlist', async () => {
        const playlists = (await fpp.currentShow()).playlists as Array<{ id: string; title: string }>;
        const pl = playlists.find((p) => p.title === 'Main Show');
        expect(pl).toBeTruthy();

        const res = await fpp.ezpCommand({
            command: 'playplaylist',
            playlistId: pl!.id,
            immediate: true,
            priority: 5,
            requestId: 'it-native-playplaylist',
        });
        expect(res.status).toBe(200);

        const playing = await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'native playlist' });
        expect(playing.current_sequence).toBe('SongA.fseq');
        expect(playing.current_playlist.playlist).toBe('Main Show');

        expect((await fpp.command('Stop Now')).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle after native playlist' });
    });

    it('native playsong via /api/ezp/player-command plays a single sequence', async () => {
        const sequences = (await fpp.currentShow()).sequences as Array<{
            id: string;
            files?: { fseq?: string };
        }>;
        // files.fseq may be a bare name or an absolute path depending on origin
        const seq = sequences.find((s) => s.files?.fseq?.replace(/\\/g, '/').endsWith('SongA.fseq'));
        expect(seq).toBeTruthy();

        const res = await fpp.ezpCommand({
            command: 'playsong',
            songId: seq!.id,
            immediate: true,
            priority: 5,
            requestId: 'it-native-playsong',
        });
        expect(res.status).toBe(200);

        const playing = await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'native song' });
        expect(playing.current_sequence).toBe('SongA.fseq');

        expect((await fpp.command('Stop Now')).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle after native song' });
    });

    it('natural end clears now_playing in raw pStatus', async () => {
        // Short 5s sequence so the playlist ends on its own.
        await fpp.uploadFile('sequences', 'SongB.fseq', buildFseq({ channels: 150, frames: 100, value: 17 }));
        const res = await fpp.putPlaylist('Short Show', {
            name: 'Short Show',
            mainPlaylist: [{ type: 'sequence', sequenceName: 'SongB.fseq' }],
        });
        expect(res.status).toBe(200);

        expect((await fpp.command('Start Playlist', 'Short Show', 0, 0, 0)).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'short playing' });
        await waitForPStatus((p) => !!p?.now_playing, 'now_playing set during short show');

        // Let it run out on its own, then the pushed status must go fully idle.
        await fpp.waitForStatus((s) => s.status_name === 'idle', {
            label: 'idle after natural end',
            timeoutMs: 30_000,
        });
        const ended = await waitForPStatus(
            (p) => p?.status === 'Stopped' && !p?.now_playing,
            'now_playing cleared after natural end',
        );
        expect(ended.now_playing).toBeUndefined();
    });
});
