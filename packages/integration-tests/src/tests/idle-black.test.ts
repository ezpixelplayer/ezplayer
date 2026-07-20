/** `sendIdleBlackFrames: false` — the multi-player setting: EZPlayer must
 *  leave the wire completely untouched outside active playback (no ~5Hz idle
 *  blacks, no blackout on stop), so another player can own the controllers.
 *  Default-on behavior (idle blacks, dark after stop) is covered by
 *  playback.test's "goes dark" case. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
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
    mock = await startMockController({ channels: 150, ddpPort: 4048 });
    show = await createFixtureShow({ channels: 150 });
    await fsp.mkdir(path.join(show.dir, '.ezplayer'), { recursive: true });
    await fsp.writeFile(
        path.join(show.dir, '.ezplayer', 'playbackSettings.json'),
        JSON.stringify({
            audioSyncAdjust: 0,
            backgroundSequence: 'overlay',
            viewerControl: { enabled: false, type: 'disabled', schedule: [] },
            volumeControl: { defaultVolume: 100, schedule: [] },
            sendIdleBlackFrames: false,
        }),
    );
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
    await fpp.uploadFile('sequences', 'QuietSong.fseq', buildFseq({ channels: 150, frames: 200, value: 42 })); // 10s
    const res = await fpp.putPlaylist('QuietShow', {
        name: 'QuietShow',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'QuietSong.fseq' }],
    });
    expect(res.status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('sendIdleBlackFrames disabled', () => {
    it('sends nothing while idle, real frames while playing, and no black on stop', async () => {
        // Idle: with blacks disabled, an idle player is silent (default sends ~5Hz black).
        mock.ddp.reset();
        await new Promise((r) => setTimeout(r, 2500));
        expect(mock.ddp.framesReceived()).toBe(0);

        // Playback is unaffected.
        await fpp.command('Start Playlist', 'QuietShow', 0, 0, 0);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'quiet play', timeoutMs: 20_000 });
        await mock.ddp.waitForFrames(10, { timeoutMs: 20_000 });
        expect(Array.from(mock.ddp.channelRange(0, 3))).toEqual([42, 42, 42]);

        // Stop: stream ceases with NO blackout frame — last frame keeps its data.
        await fpp.command('Stop Now');
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'quiet stop', timeoutMs: 10_000 });
        await new Promise((r) => setTimeout(r, 1000)); // any stray black would land here
        const frames = mock.ddp.frameSummaries();
        expect(frames.length).toBeGreaterThan(0);
        expect(frames[frames.length - 1].black).toBe(false);
        expect(frames.filter((f) => f.black).length).toBe(0);

        // And silence resumes.
        const countAfterStop = mock.ddp.framesReceived();
        await new Promise((r) => setTimeout(r, 1500));
        expect(mock.ddp.framesReceived()).toBe(countAfterStop);
    }, 60_000);
});
