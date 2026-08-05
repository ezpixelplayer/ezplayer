/** FPP MultiSync master: with multisync enabled and the mock as a unicast
 *  remote, playback must emit OPEN/START, monotonically advancing SYNC
 *  frames at the expected cadence, and STOP at the end — the packets an
 *  FPP or xSchedule remote follows. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

beforeAll(async () => {
    mock = await startMockController({ channels: 150, ddpPort: 4048, multisyncPort: 0 });
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
    await fpp.uploadFile('sequences', 'SyncSong.fseq', buildFseq({ channels: 150, frames: 400, value: 42 })); // 20s
    const res = await fpp.putPlaylist('SyncShow', {
        name: 'SyncShow',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'SyncSong.fseq' }],
    });
    expect(res.status).toBe(200);

    // Enable multisync targeting the mock's ephemeral sync port.
    const settings = await fetch(`${app.base}/api/ezp/playback-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            audioSyncAdjust: 0,
            backgroundSequence: 'overlay',
            viewerControl: { enabled: false, type: 'disabled', schedule: [] },
            volumeControl: { defaultVolume: 100, schedule: [] },
            sync: { multisync: { enabled: true, remotes: [`127.0.0.1:${mock.multisyncPort}`] } },
        }),
    });
    expect(settings.status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('FPP MultiSync master', () => {
    it('emits open/start, advancing sync frames, and stop', async () => {
        mock.sync!.reset();
        await fpp.command('Start Playlist', 'SyncShow', '0');
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'sync play', timeoutMs: 20_000 });

        await mock.sync!.waitForEvent((e) => e.action === 'start', { timeoutMs: 10_000 });
        // Let a few seconds of sync packets accumulate, then stop.
        await new Promise((r) => setTimeout(r, 3000));
        await fpp.command('Stop Now');
        await mock.sync!.waitForEvent((e) => e.action === 'stop', { timeoutMs: 10_000 });

        const events = mock.sync!.events();
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
});
