/** Schedule-driven start: post a schedule window covering "now" over the FPP
 *  API and verify playback begins with no further commands, with light data
 *  at the mock. Time-window tests carry inherent flake risk — vitest retries
 *  once, and the window is generous (starts a minute ago, ends in 10). */

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

function hhmmss(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function ymd(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

beforeAll(async () => {
    mock = await startMockController({ channels: 150, ddpPort: 4048 });
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);

    await fpp.uploadFile('sequences', 'Sched.fseq', buildFseq({ channels: 150, frames: 1200, value: 77 })); // 60s
    const res = await fpp.putPlaylist('Nightly', {
        name: 'Nightly',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'Sched.fseq' }],
    });
    expect(res.status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('scheduled start', () => {
    it('starts playback from a schedule window covering now', async () => {
        const now = new Date();
        const from = new Date(now.getTime() - 60_000);
        const to = new Date(now.getTime() + 10 * 60_000);
        // Crossing midnight would put from/to on different days; skip the last
        // 11 minutes of the day rather than encode extended-time handling here.
        if (from.getDate() !== to.getDate()) return;

        const put = await fpp.putSchedule([
            {
                enabled: 1,
                day: 7,
                playlist: 'Nightly',
                startTime: hhmmss(from),
                endTime: hhmmss(to),
                startDate: ymd(now),
                endDate: ymd(now),
                repeat: 1,
                stopType: 0,
            },
        ]);
        expect(put.status).toBe(200);

        const playing = await fpp.waitForStatus((s) => s.status_name === 'playing', {
            label: 'schedule fired',
            timeoutMs: 45_000,
        });
        expect(playing.current_playlist.playlist).toBe('Nightly');
        expect(playing.current_sequence).toBe('Sched.fseq');

        await mock.ddp.waitForFrames(10, { timeoutMs: 20_000 });
        expect(Array.from(mock.ddp.channelRange(0, 3))).toEqual([77, 77, 77]);

        // Clear the schedule -> playback should wind down
        expect((await fpp.putSchedule([])).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'schedule cleared', timeoutMs: 45_000 });
    });
});
