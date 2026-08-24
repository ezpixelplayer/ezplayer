/** Playback statistics API + output suppression + the `play` CLI verb:
 *  GET /api/ezp/playback-stats reports the worker's counters; `suppressoutput`
 *  keeps playback (and stats) going while nothing reaches the controller;
 *  `EZPlayer play --no-output --json` drives the whole thing headlessly. */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliJs = path.resolve(here, '../../../../apps/ezplayer-ui-electron/dist/cli.js');

interface StatsBody {
    stats: {
        sentFramesCumulative: number;
        missedFramesCumulative: number;
        skippedFramesCumulative: number;
        lastError?: string | null;
        loopDelay?: { p50: number; p99: number; max: number };
        fseqPrefetch?: { chunkCache: { completedRequestsCumulative: number } };
    };
    pStatus?: { status?: string; now_playing?: { sequence_id?: string } };
    serverNow: number;
}

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;
let songId: string;

async function getStats(): Promise<StatsBody> {
    const res = await fetch(`${app.base}/api/ezp/playback-stats`);
    expect(res.status).toBe(200);
    return (await res.json()) as StatsBody;
}

async function playSong(requestId: string) {
    const res = await fpp.ezpCommand({ command: 'playsong', songId, immediate: true, priority: 5, requestId });
    expect(res.status).toBe(200);
    await fpp.waitForStatus((s) => s.status_name === 'playing', { label: requestId });
}

async function stopAll() {
    expect((await fpp.command('Stop Now')).status).toBe(200);
    await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle' });
}

beforeAll(async () => {
    mock = await startMockController({ channels: 150, ddpPort: 4048 });
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);

    await fpp.uploadFile('sequences', 'SongA.fseq', buildFseq({ channels: 150, frames: 600, value: 42 })); // 30s
    // Register it as a sequence record (EZP-native API; duration comes from the header).
    const reg = await fetch(`${app.base}/api/ezp/sequences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ files: { fseq: 'SongA.fseq' }, work: { title: 'Song A', artist: '', length: 0 } }]),
    });
    expect(reg.status).toBe(200);
    // …and wait for the player to pick the record up.
    const deadline = Date.now() + 30_000;
    for (;;) {
        const sequences = (await fpp.currentShow()).sequences;
        const seq = sequences.find((s) => s.files?.fseq?.replace(/\\/g, '/').endsWith('SongA.fseq'));
        if (seq) {
            songId = seq.id;
            break;
        }
        if (Date.now() > deadline) throw new Error('SongA.fseq never appeared in the sequence list');
        await new Promise((r) => setTimeout(r, 500));
    }
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('playback statistics', () => {
    it('GET /api/ezp/playback-stats reports advancing counters while playing', async () => {
        await playSong('it-stats-1');
        const a = await getStats();
        expect(a.pStatus?.status).toBe('Playing');
        expect(typeof a.serverNow).toBe('number');
        await new Promise((r) => setTimeout(r, 2500));
        const b = await getStats();
        // ~20 fps fixture: a couple of seconds is dozens of frames
        expect(b.stats.sentFramesCumulative - a.stats.sentFramesCumulative).toBeGreaterThanOrEqual(20);
        expect(b.stats.loopDelay).toBeTruthy();
        expect(b.stats.loopDelay!.max).toBeGreaterThanOrEqual(b.stats.loopDelay!.p99);
        expect(b.stats.fseqPrefetch?.chunkCache.completedRequestsCumulative).toBeGreaterThan(0);
        await stopAll();
    });

    /** Wait for the worker's next stats publish (about once a second) to show
     *  the cumulative counters back below a previous reading. */
    async function waitForCountersReset(before: StatsBody, label: string) {
        const deadline = Date.now() + 8000;
        for (;;) {
            const s = await getStats();
            if (s.stats.sentFramesCumulative < before.stats.sentFramesCumulative) return s;
            if (Date.now() > deadline) throw new Error(`stats were not reset (${label})`);
            await new Promise((r) => setTimeout(r, 250));
        }
    }

    it('resetstats zeroes the cumulative counters', async () => {
        const before = await getStats();
        expect(before.stats.sentFramesCumulative).toBeGreaterThan(0);
        expect((await fpp.ezpCommand({ command: 'resetstats' })).status).toBe(200);
        await waitForCountersReset(before, 'resetstats');
    });

    it('resetplayback (player-page Reset / show reload) starts a fresh measurement run', async () => {
        // Accumulate some counters, then reset the show the way the player page does.
        await playSong('it-stats-reset-playback');
        await new Promise((r) => setTimeout(r, 1500));
        await stopAll();
        const before = await getStats();
        expect(before.stats.sentFramesCumulative).toBeGreaterThan(0);
        expect((await fpp.ezpCommand({ command: 'resetplayback' })).status).toBe(200);
        const after = await waitForCountersReset(before, 'resetplayback');
        expect(after.stats.lastError).toBeFalsy();
        // The player is back up and idle afterwards.
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle after resetplayback' });
    });

    it('suppressoutput keeps playing (stats advance) with nothing on the wire; activateoutput resumes', async () => {
        expect((await fpp.ezpCommand({ command: 'suppressoutput' })).status).toBe(200);
        await playSong('it-stats-suppressed');
        // Let any frame already in flight land, then watch the wire go quiet.
        await new Promise((r) => setTimeout(r, 500));
        mock.ddp.reset();
        const a = await getStats();
        await new Promise((r) => setTimeout(r, 2000));
        const b = await getStats();
        expect(b.pStatus?.status).toBe('Playing');
        expect(b.stats.sentFramesCumulative - a.stats.sentFramesCumulative).toBeGreaterThanOrEqual(20);
        expect(mock.ddp.frameSummaries().length).toBe(0);

        expect((await fpp.ezpCommand({ command: 'activateoutput' })).status).toBe(200);
        await mock.ddp.waitForFrames(10, { timeoutMs: 10_000 });
        expect(Array.from(mock.ddp.channelRange(0, 3))).toEqual([42, 42, 42]);
        await stopAll();
    });

    it('`play --no-output --json` drives a run and reports a summary', async () => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await new Promise<number>((resolve, reject) => {
            const child = spawn(
                process.execPath,
                [
                    cliJs,
                    'play',
                    'song a',
                    '--host',
                    `127.0.0.1:${app.port}`,
                    '--no-output',
                    '--json',
                    '--duration',
                    '6',
                ],
                { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            child.stdout.on('data', (d) => out.push(String(d)));
            child.stderr.on('data', (d) => err.push(String(d)));
            child.on('error', reject);
            child.on('exit', (c) => resolve(c ?? -1));
        });
        expect(code, err.join('')).toBe(0);
        const report = JSON.parse(out.join('')) as {
            sequence: { id: string };
            outputSuppressed: boolean;
            summary: { frames: { sent: number; deliveryRatio: number }; samples: number; fseq: { refHits: number } };
            samples: unknown[];
        };
        expect(report.sequence.id).toBe(songId);
        expect(report.outputSuppressed).toBe(true);
        expect(report.summary.samples).toBeGreaterThanOrEqual(4);
        expect(report.summary.frames.sent).toBeGreaterThanOrEqual(60);
        expect(report.summary.frames.deliveryRatio).toBeGreaterThan(0.9);
        // The one-block fixture is already cached, so fetches may be 0; every frame is a hit.
        expect(report.summary.fseq.refHits).toBeGreaterThanOrEqual(60);
        expect(err.join('')).toContain('sent=+');

        // The CLI ends the song and restores output when it is done.
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle after cli play' });
        mock.ddp.reset();
        await mock.ddp.waitForFrames(2, { timeoutMs: 10_000 }); // idle black frames are back on the wire
    });
});
