/** Advanced DDP-port override: with `advanced.ddpPort` seeded in the show's
 *  playbackSettings.json, output must arrive on that port instead of 4048 —
 *  the knob that lets test rigs bind ephemeral ports. */

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
    mock = await startMockController({ channels: 150, ddpPort: 0 }); // ephemeral — NOT 4048
    show = await createFixtureShow({ channels: 150 });
    // Seed settings before boot; the ddpPort override applies when controllers open.
    await fsp.mkdir(path.join(show.dir, '.ezplayer'), { recursive: true });
    await fsp.writeFile(
        path.join(show.dir, '.ezplayer', 'playbackSettings.json'),
        JSON.stringify({
            audioSyncAdjust: 0,
            backgroundSequence: 'overlay',
            viewerControl: { enabled: false, type: 'disabled', schedule: [] },
            volumeControl: { defaultVolume: 100, schedule: [] },
            advanced: { ddpPort: mock.ddpPort },
        }),
    );
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
    await fpp.uploadFile('sequences', 'PortSong.fseq', buildFseq({ channels: 150, frames: 400, value: 37 }));
    const res = await fpp.putPlaylist('PortShow', {
        name: 'PortShow',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'PortSong.fseq' }],
    });
    expect(res.status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('advanced DDP port override', () => {
    it('sends DDP output to the overridden port', async () => {
        await fpp.command('Start Playlist', 'PortShow', 0, 0, 0);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'port play', timeoutMs: 20_000 });
        await mock.ddp.waitForFrames(10, { timeoutMs: 20_000 });
        expect(Array.from(mock.ddp.channelRange(0, 3))).toEqual([37, 37, 37]);
        await fpp.command('Stop Now');
    }, 60_000);
});
