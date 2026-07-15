/** End-to-end playback: FPP Start Playlist -> status advances AND real DDP
 *  frames arrive at the mock controller with the expected channel data. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockController, type MockController } from '@ezplayer/epp-moc-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

let moc: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

beforeAll(async () => {
    // The player's DDP sender targets the controller IP on the fixed DDP port,
    // so the mock must own 4048 (vitest runs these files sequentially).
    moc = await startMockController({ channels: 150, ddpPort: 4048 });
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
    await moc?.stop();
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
        await moc.ddp.waitForFrames(20, { timeoutMs: 20_000 });
        expect(Array.from(moc.ddp.channelRange(0, 3))).toEqual([42, 42, 42]);
        expect(Array.from(moc.ddp.channelRange(147, 3))).toEqual([42, 42, 42]);
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

    it('Volume Set is reflected in status', async () => {
        expect((await fpp.command('Volume Set', 37)).status).toBe(200);
        await fpp.waitForStatus((s) => s.volume === 37, { label: 'volume 37', timeoutMs: 10_000 });
    });

    it('Stop Now goes idle and output goes dark', async () => {
        expect((await fpp.command('Stop Now')).status).toBe(200);
        const idle = await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle' });
        // FPP idle shape
        expect(idle.current_sequence).toBe('');
        expect(idle.seconds_elapsed).toBe('0');
        expect(idle.time_elapsed).toBe('00:00');
        expect(idle.current_playlist).toMatchObject({ playlist: '', index: '0', count: '0' });

        // EZPlayer keeps pushing black frames while idle (lights off, not
        // silence) — assert the data goes dark rather than the wire quiet.
        const deadline = Date.now() + 20_000;
        for (;;) {
            const f = moc.ddp.lastFrame();
            if (f && f.channels.every((b) => b === 0)) break;
            if (Date.now() > deadline) throw new Error('output never went dark after Stop Now');
            await new Promise((r) => setTimeout(r, 250));
        }
    });
});
