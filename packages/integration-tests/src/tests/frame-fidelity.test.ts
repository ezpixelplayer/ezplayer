/** Frame-accurate playback: schedule a uniquely-patterned sequence a few
 *  seconds ahead (second-precision native schedule), capture every DDP frame
 *  at the mock, and match CRCs against the source fseq. Content corruption
 *  (a CRC matching no source frame) must be zero — that's the regression net
 *  for blending/dimming/decode changes. Drops and jitter are measured and
 *  reported; black frames are tagged, with leading/trailing excluded. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { writeFseq } from '../fixtures/fseq.js';
import { analyzeFrames, expectedFrameCrcs } from '../analysis/frame-fidelity.js';

const CHANNELS = 150;
const FRAMES = 300; // 15s @ 50ms
const FRAME_MS = 50;

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;
let fseqPath: string;

function hms(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

beforeAll(async () => {
    mock = await startMockController({ channels: CHANNELS, ddpPort: 4048 });
    show = await createFixtureShow({ channels: CHANNELS });
    fseqPath = path.join(show.dir, 'Fid.fseq');
    // Unique content per frame: index in bytes 0-1, constant marker, varying fill
    await writeFseq(fseqPath, {
        channels: CHANNELS,
        frames: FRAMES,
        msPerFrame: FRAME_MS,
        pattern: (f, ch) => {
            ch.fill(1 + (f % 250));
            ch[0] = f & 0xff;
            ch[1] = (f >> 8) & 0xff;
            ch[2] = 0xa5;
        },
    });

    // Nothing may be sending to our DDP port before the app starts — a frame
    // here means a stray player from another run would corrupt the analysis.
    await new Promise((r) => setTimeout(r, 600));
    if (mock.ddp.framesReceived() > 0) {
        throw new Error('DDP frames arriving before app start — stray player process is polluting the port');
    }

    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
    const res = await fpp.putPlaylist('Fidelity', {
        name: 'Fidelity',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'Fid.fseq' }],
    });
    expect(res.status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('frame fidelity', () => {
    it('plays a scheduled sequence frame-accurately with zero content corruption', async () => {
        const now = new Date();
        const start = new Date(now.getTime() + 5000); // player gets a few seconds to get going
        const end = new Date(start.getTime() + 3 * 60_000);
        if (start.getDate() !== end.getDate()) return; // skip near midnight

        const playlists = (await fpp.currentShow()).playlists as Array<{ id: string; title: string }>;
        const pl = playlists.find((p) => p.title === 'Fidelity')!;
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        // Native schedule (fromTime supports seconds precision, unlike FPP HH:MM)
        const put = await fetch(`${app.base}/api/ezp/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([
                {
                    id: 'fidelity-sched',
                    scheduleType: 'main',
                    playlistId: pl.id,
                    title: 'Fidelity',
                    playlistTitle: 'Fidelity',
                    date: midnight.getTime(),
                    fromTime: hms(start),
                    toTime: hms(end),
                    duration: 0,
                },
            ]),
        });
        expect(put.status).toBe(200);

        mock.ddp.reset();
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'fidelity start', timeoutMs: 30_000 });
        await fpp.waitForStatus((s) => s.status_name === 'idle', {
            label: 'fidelity end',
            timeoutMs: FRAMES * FRAME_MS + 30_000,
        });
        await new Promise((r) => setTimeout(r, 1000)); // let trailing frames land

        const expected = await expectedFrameCrcs(fseqPath, CHANNELS);
        const report = analyzeFrames(mock.ddp.frameSummaries(), expected, FRAME_MS);
        const startDeltaMs = report.firstMatchedAt !== undefined ? report.firstMatchedAt - start.getTime() : undefined;
        console.log('[frame-fidelity]', JSON.stringify({ ...report, startDeltaMs }));

        // Content: every non-black frame must be a real source frame
        expect(report.unknown).toBe(0);
        expect(report.orderViolations).toBe(0);
        // Coverage: measured, with slack for loaded CI machines
        expect(report.distinctMatched).toBeGreaterThan(expected.length * 0.9);
        // Starts at the beginning, near the scheduled instant (a frame or two
        // can drop during spin-up; exact value is in the report line)
        expect(report.firstIndex).toBeLessThanOrEqual(5);
        expect(Math.abs(startDeltaMs!)).toBeLessThan(2000);

        // Cleanup for any later tests
        await fetch(`${app.base}/api/ezp/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ id: 'fidelity-sched', deleted: true }]),
        });
    });
});
