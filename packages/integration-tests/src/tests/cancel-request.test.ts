/** Cancelling an on-demand request while it plays: a scheduled show is
 *  interrupted by a requested song, the request is cancelled by id, and the
 *  show must pick back up — light data and the engine clock both moving again.
 *  The schedule window is generous (starts a minute ago, ends in 10); vitest
 *  retries once for the inherent time-window flake. */

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

interface PlayingItem {
    sequence_id?: string;
    request_id?: string;
    schedule_id?: string;
}
interface PStatus {
    status?: string;
    engine_time?: number;
    now_playing?: PlayingItem;
    queue?: PlayingItem[];
}

function hhmmss(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

function ymd(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

async function pStatus(): Promise<PStatus | undefined> {
    return (await fpp.currentShow()).pStatus as PStatus | undefined;
}

async function waitFor<T>(what: () => Promise<T | undefined | false>, label: string, timeoutMs = 30_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const got = await what();
        if (got) return got;
        if (Date.now() > deadline) {
            throw new Error(`waitFor (${label}) timed out; pStatus=${JSON.stringify(await pStatus()).slice(0, 500)}`);
        }
        await new Promise((r) => setTimeout(r, 250));
    }
}

const lights = () => mock.ddp.channelRange(0, 1)[0];

beforeAll(async () => {
    mock = await startMockController({ channels: 150, ddpPort: 4048 });
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);

    await fpp.uploadFile('sequences', 'Sched.fseq', buildFseq({ channels: 150, frames: 2400, value: 77 })); // 120s
    await fpp.uploadFile('sequences', 'Request.fseq', buildFseq({ channels: 150, frames: 1200, value: 99 })); // 60s
    for (const [name, file] of [
        ['Nightly', 'Sched.fseq'],
        ['Requests', 'Request.fseq'],
    ]) {
        const res = await fpp.putPlaylist(name, { name, mainPlaylist: [{ type: 'sequence', sequenceName: file }] });
        expect(res.status).toBe(200);
    }
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('cancel a playing request', () => {
    it('stops the request and the interrupted schedule carries on', async () => {
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

        // The schedule is on, with its light data at the controller.
        const scheduled = await waitFor(
            async () => {
                const p = await pStatus();
                return p?.now_playing?.schedule_id && lights() === 77 ? p : undefined;
            },
            'schedule playing',
            45_000,
        );
        const schedSeqId = scheduled.now_playing!.sequence_id;

        // Request the other song on demand, over the schedule.
        const requestSeq = (await fpp.currentShow()).sequences.find((s) => s.files?.fseq?.includes('Request.fseq'));
        expect(requestSeq).toBeDefined();
        const requestId = 'it-cancel-request';
        const play = await fpp.ezpCommand({
            command: 'playsong',
            songId: requestSeq!.id,
            immediate: true,
            priority: 5,
            requestId,
        });
        expect(play.status).toBe(200);
        await waitFor(
            async () => (await pStatus())?.now_playing?.request_id === requestId && lights() === 99,
            'request playing',
        );

        // Cancel it by id.
        expect((await fpp.ezpCommand({ command: 'deleterequest', requestId })).status).toBe(200);

        // The schedule's song is what plays again, and nothing is left queued.
        const resumed = await waitFor(async () => {
            const p = await pStatus();
            return !p?.now_playing?.request_id && p?.now_playing?.sequence_id === schedSeqId && lights() === 77
                ? p
                : undefined;
        }, 'schedule resumed');
        expect(resumed.status).toBe('Playing');
        expect(resumed.queue ?? []).toEqual([]);

        // And it is actually running, not parked on one frame: the engine clock moves.
        const t0 = resumed.engine_time!;
        await new Promise((r) => setTimeout(r, 3000));
        const later = await pStatus();
        expect(later?.now_playing?.sequence_id).toBe(schedSeqId);
        expect(later!.engine_time! - t0).toBeGreaterThan(2000);
        await mock.ddp.waitForFrames(10, { timeoutMs: 10_000 });
        expect(lights()).toBe(77);

        // Clear the schedule and stop, so the app winds down cleanly.  Clearing
        // alone lets the started song play out — here, the rest of two minutes.
        expect((await fpp.putSchedule([])).status).toBe(200);
        expect((await fpp.command('Stop Now')).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'stopped', timeoutMs: 45_000 });
    });
});
