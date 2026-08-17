/** Lead/trail time on the wire: positive values pad the slot with black
 *  (and silence) before/after the content; negative values trim material
 *  from that end. Schedule a uniquely-patterned sequence at a known instant
 *  and check when content frames actually start/stop at the mock, which
 *  frames play, and that pads are actively blanked (DDP going quiet would
 *  freeze pixels on the last frame). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq, writeFseq } from '../fixtures/fseq.js';
import {
    analyzeFrames,
    expectedFrameCrcs,
    type FidelityReport,
    type FrameSummary,
} from '../analysis/frame-fidelity.js';

const CHANNELS = 150;
const FRAMES = 200; // 10s @ 50ms
const FRAME_MS = 50;
const SEQ_MS = FRAMES * FRAME_MS;

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;
let fseqPath: string;
let expectedCrcs: number[];

function hms(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** Upsert lead/trail onto the LT.fseq sequence record via the native API. */
async function setLeadTrail(lead: number, trail: number): Promise<void> {
    const sequences = (await fpp.currentShow()).sequences;
    const seq = sequences.find((s) => s.files?.fseq?.replace(/\\/g, '/').endsWith('LT.fseq'));
    expect(seq).toBeTruthy();
    const res = await fetch(`${app.base}/api/ezp/sequences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ ...seq, settings: { ...(seq!.settings ?? {}), lead_time: lead, trail_time: trail } }]),
    });
    expect(res.status).toBe(200);
    // settings propagate to the play worker via a schedule update; let it land
    await new Promise((r) => setTimeout(r, 500));
}

interface RunResult {
    start: Date;
    idleAt: number;
    report: FidelityReport;
    summaries: FrameSummary[];
    /** arrival of the last content (CRC-matched) frame */
    lastContentAt?: number;
    /** arrival of the first black frame after the last content frame */
    blackAfterContentAt?: number;
}

/** Schedule the playlist at now+5s, run to idle, return timing + frame report.
 *  Returns undefined when the run would cross midnight (retry-day flake). */
async function runScheduled(id: string, slotMs: number): Promise<RunResult | undefined> {
    const now = new Date();
    const start = new Date(now.getTime() + 5000);
    const end = new Date(start.getTime() + 3 * 60_000);
    if (start.getDate() !== end.getDate()) return undefined; // skip near midnight

    const playlists = (await fpp.currentShow()).playlists as Array<{ id: string; title: string }>;
    const pl = playlists.find((p) => p.title === 'LeadTrail')!;
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const put = await fetch(`${app.base}/api/ezp/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
            {
                id,
                scheduleType: 'main',
                playlistId: pl.id,
                title: id,
                playlistTitle: 'LeadTrail',
                date: midnight.getTime(),
                fromTime: hms(start),
                toTime: hms(end),
                duration: 0,
            },
        ]),
    });
    expect(put.status).toBe(200);

    mock.ddp.reset();
    await fpp.waitForStatus((s) => s.status_name === 'playing', { label: `${id} start`, timeoutMs: 30_000 });
    await fpp.waitForStatus((s) => s.status_name === 'idle', { label: `${id} end`, timeoutMs: slotMs + 30_000 });
    const idleAt = Date.now();
    await new Promise((r) => setTimeout(r, 1000)); // let trailing frames land

    await fetch(`${app.base}/api/ezp/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ id, deleted: true }]),
    });

    const summaries = mock.ddp.frameSummaries();
    const report = analyzeFrames(summaries, expectedCrcs, FRAME_MS);
    const crcSet = new Set(expectedCrcs);
    let lastContentAt: number | undefined;
    for (const f of summaries) if (!f.black && crcSet.has(f.crc)) lastContentAt = f.t;
    let blackAfterContentAt: number | undefined;
    if (lastContentAt !== undefined) {
        for (const f of summaries) {
            if (f.black && f.t > lastContentAt) {
                blackAfterContentAt = f.t;
                break;
            }
        }
    }
    return { start, idleAt, report, summaries, lastContentAt, blackAfterContentAt };
}

beforeAll(async () => {
    mock = await startMockController({ channels: CHANNELS, ddpPort: 4048 });
    show = await createFixtureShow({ channels: CHANNELS });
    fseqPath = path.join(show.dir, 'LT.fseq');
    // Unique content per frame so CRC matching recovers the frame index
    await writeFseq(fseqPath, {
        channels: CHANNELS,
        frames: FRAMES,
        msPerFrame: FRAME_MS,
        pattern: (f, ch) => {
            ch.fill(1 + (f % 250));
            ch[0] = f & 0xff;
            ch[1] = (f >> 8) & 0xff;
            ch[2] = 0xc3;
        },
    });
    expectedCrcs = await expectedFrameCrcs(fseqPath, CHANNELS);

    await new Promise((r) => setTimeout(r, 600));
    if (mock.ddp.framesReceived() > 0) {
        throw new Error('DDP frames arriving before app start — stray player process is polluting the port');
    }

    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
    const res = await fpp.putPlaylist('LeadTrail', {
        name: 'LeadTrail',
        mainPlaylist: [{ type: 'sequence', sequenceName: 'LT.fseq' }],
    });
    expect(res.status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('lead/trail time', () => {
    it('positive lead/trail pads black before and after the content', async () => {
        const LEAD_MS = 4000;
        const TRAIL_MS = 3000;
        await setLeadTrail(LEAD_MS / 1000, TRAIL_MS / 1000);
        const run = await runScheduled('lt-pad', LEAD_MS + SEQ_MS + TRAIL_MS);
        if (!run) return;
        const { start, idleAt, report, lastContentAt, blackAfterContentAt } = run;
        const startDeltaMs = report.firstMatchedAt !== undefined ? report.firstMatchedAt - start.getTime() : undefined;
        console.log(
            '[lead-trail pad]',
            JSON.stringify({ ...report, startDeltaMs, idleDeltaMs: idleAt - start.getTime() }),
        );

        // Content integrity: full sequence plays, from the first frame
        expect(report.unknown).toBe(0);
        expect(report.orderViolations).toBe(0);
        expect(report.firstIndex).toBeLessThanOrEqual(5);
        expect(report.lastIndex).toBeGreaterThanOrEqual(FRAMES - 3);
        expect(report.distinctMatched).toBeGreaterThan(FRAMES * 0.9);

        // Lead: content starts ~LEAD_MS after the scheduled instant, not at it
        expect(startDeltaMs).toBeGreaterThanOrEqual(LEAD_MS - 1500);
        expect(startDeltaMs).toBeLessThanOrEqual(LEAD_MS + 2000);

        // Trail: the pad must actively blank — a black frame soon after the
        // last content frame, not DDP silence (pixels would hold the frame)
        expect(lastContentAt).toBeDefined();
        expect(blackAfterContentAt).toBeDefined();
        expect(blackAfterContentAt! - lastContentAt!).toBeLessThanOrEqual(1500);

        // Slot runs lead + content + trail before going idle
        const idleDeltaMs = idleAt - start.getTime();
        expect(idleDeltaMs).toBeGreaterThanOrEqual(LEAD_MS + SEQ_MS + TRAIL_MS - 2500);
        expect(idleDeltaMs).toBeLessThanOrEqual(LEAD_MS + SEQ_MS + TRAIL_MS + 3500);
    });

    it('negative lead/trail trims material from both ends', async () => {
        const TRIM_START_MS = 2000;
        const TRIM_END_MS = 2000;
        await setLeadTrail(-TRIM_START_MS / 1000, -TRIM_END_MS / 1000);
        const run = await runScheduled('lt-trim', SEQ_MS);
        if (!run) return;
        const { start, idleAt, report } = run;
        const startDeltaMs = report.firstMatchedAt !== undefined ? report.firstMatchedAt - start.getTime() : undefined;
        console.log(
            '[lead-trail trim]',
            JSON.stringify({ ...report, startDeltaMs, idleDeltaMs: idleAt - start.getTime() }),
        );

        expect(report.unknown).toBe(0);
        expect(report.orderViolations).toBe(0);

        // Content starts at the scheduled instant, but TRIM_START_MS into the
        // material (a few frames of spin-up drop are allowed on top)
        expect(Math.abs(startDeltaMs!)).toBeLessThan(2000);
        const firstExpected = TRIM_START_MS / FRAME_MS;
        expect(report.firstIndex).toBeGreaterThanOrEqual(firstExpected - 2);
        expect(report.firstIndex).toBeLessThanOrEqual(firstExpected + 12);

        // The last TRIM_END_MS of material never plays
        const lastExpected = FRAMES - 1 - TRIM_END_MS / FRAME_MS;
        expect(report.lastIndex).toBeGreaterThanOrEqual(lastExpected - 5);
        expect(report.lastIndex).toBeLessThanOrEqual(lastExpected + 2);

        // Slot is the shortened duration
        const slotMs = SEQ_MS - TRIM_START_MS - TRIM_END_MS;
        const idleDeltaMs = idleAt - start.getTime();
        expect(idleDeltaMs).toBeGreaterThanOrEqual(slotMs - 2500);
        expect(idleDeltaMs).toBeLessThanOrEqual(slotMs + 3500);
    });

    it('background shows through lead/trail pads', async () => {
        const LEAD_MS = 4000;
        const TRAIL_MS = 3000;

        // Background: zeros plus a marker channel, all below the song's values —
        // max-mixing leaves song frames byte-identical, and pad frames carry the
        // marker (visible, non-black, not song content).
        const bgPattern = (ch: Uint8Array) => {
            ch.fill(0);
            ch[2] = 0x3c;
        };
        await fpp.uploadFile(
            'sequences',
            'BG.fseq',
            buildFseq({ channels: CHANNELS, frames: 300, msPerFrame: FRAME_MS, pattern: (_f, ch) => bgPattern(ch) }),
        );
        const plres = await fpp.putPlaylist('BGLoop', {
            name: 'BGLoop',
            mainPlaylist: [{ type: 'sequence', sequenceName: 'BG.fseq' }],
        });
        expect(plres.status).toBe(200);

        const now = new Date();
        const bgStart = new Date(now.getTime() + 1000);
        const bgEnd = new Date(bgStart.getTime() + 3 * 60_000);
        if (bgStart.getDate() !== bgEnd.getDate()) return; // skip near midnight
        const playlists = (await fpp.currentShow()).playlists as Array<{ id: string; title: string }>;
        const bgpl = playlists.find((p) => p.title === 'BGLoop')!;
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        const put = await fetch(`${app.base}/api/ezp/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([
                {
                    id: 'lt-bg',
                    scheduleType: 'background',
                    playlistId: bgpl.id,
                    title: 'lt-bg',
                    playlistTitle: 'BGLoop',
                    date: midnight.getTime(),
                    fromTime: hms(bgStart),
                    toTime: hms(bgEnd),
                    loop: true,
                    duration: 0,
                },
            ]),
        });
        expect(put.status).toBe(200);

        await setLeadTrail(LEAD_MS / 1000, TRAIL_MS / 1000);
        const run = await runScheduled('lt-pad-bg', LEAD_MS + SEQ_MS + TRAIL_MS);
        await fetch(`${app.base}/api/ezp/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ id: 'lt-bg', deleted: true }]),
        });
        if (!run) return;
        const { start, report, summaries } = run;
        const startMs = start.getTime();
        const startDeltaMs = report.firstMatchedAt !== undefined ? report.firstMatchedAt - startMs : undefined;
        console.log('[lead-trail bg]', JSON.stringify({ ...report, startDeltaMs }));

        // Song content is untouched by the mix and complete, starting ~lead late
        expect(report.orderViolations).toBe(0);
        expect(report.firstIndex).toBeLessThanOrEqual(5);
        expect(report.lastIndex).toBeGreaterThanOrEqual(FRAMES - 3);
        expect(report.distinctMatched).toBeGreaterThan(FRAMES * 0.9);
        expect(startDeltaMs).toBeGreaterThanOrEqual(LEAD_MS - 1500);
        expect(startDeltaMs).toBeLessThanOrEqual(LEAD_MS + 2000);

        // Every non-black, non-song frame must be the background — nothing else
        const bgFrame = new Uint8Array(CHANNELS);
        bgPattern(bgFrame);
        const bgCrc = crc32(bgFrame) >>> 0;
        const songCrcs = new Set(expectedCrcs);
        for (const f of summaries) {
            if (!f.black && !songCrcs.has(f.crc)) expect(f.crc).toBe(bgCrc);
        }

        // Pads show the background, not black and not song
        const songTimes = summaries.filter((f) => songCrcs.has(f.crc)).map((f) => f.t);
        const firstSongAt = Math.min(...songTimes);
        const lastSongAt = Math.max(...songTimes);
        const leadWindow = summaries.filter((f) => f.t >= startMs + 700 && f.t <= firstSongAt - 300);
        expect(leadWindow.length).toBeGreaterThanOrEqual(5);
        expect(leadWindow.every((f) => f.crc === bgCrc)).toBe(true);
        const trailWindow = summaries.filter((f) => f.t >= lastSongAt + 300 && f.t <= lastSongAt + TRAIL_MS - 700);
        expect(trailWindow.length).toBeGreaterThanOrEqual(5);
        expect(trailWindow.every((f) => f.crc === bgCrc)).toBe(true);
    });
});
