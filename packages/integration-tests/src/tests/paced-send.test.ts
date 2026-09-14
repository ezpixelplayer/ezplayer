/** Paced send: by default a frame's packets are stretched across the send
 *  slot instead of leaving as one microburst — without costing frames. With
 *  pacing forced off (EZP_SEND_SLOT_FRACTION=0) the microburst comes back.
 *  Measured at the wire with a raw packet-timestamp listener (the mock
 *  controller only records whole frames). */

import dgram from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

const CHANNELS = 90_000; // ~63 DDP packets/frame at 1440 bytes
const MS_PER_FRAME = 50;

interface FrameSpread {
    packets: number;
    /** ms from first to last packet of the frame (push-terminated). */
    spreadMs: number;
}

/** Listen on the DDP port and time every datagram; a PUSH flag ends a frame. */
function startPacketTimer(port: number) {
    const sock = dgram.createSocket('udp4');
    const frames: FrameSpread[] = [];
    let first: number | undefined;
    let count = 0;
    sock.on('message', (msg) => {
        const now = performance.now();
        if (first === undefined) first = now;
        ++count;
        if (msg.length >= 1 && (msg[0] & 0x01) !== 0) {
            frames.push({ packets: count, spreadMs: now - first });
            first = undefined;
            count = 0;
        }
    });
    return new Promise<{ frames: FrameSpread[]; close: () => Promise<void> }>((resolve, reject) => {
        sock.once('error', reject);
        sock.bind(port, '127.0.0.1', () =>
            resolve({
                frames,
                close: () => new Promise((r) => sock.close(() => r())),
            }),
        );
    });
}

async function runCase(slotFraction: string | undefined): Promise<{
    frames: FrameSpread[];
    sent: number;
    skipped: number;
    missed: number;
}> {
    const timer = await startPacketTimer(4048);
    const show: FixtureShow = await createFixtureShow({ channels: CHANNELS });
    const prevEnv = process.env.EZP_SEND_SLOT_FRACTION;
    if (slotFraction === undefined) delete process.env.EZP_SEND_SLOT_FRACTION;
    else process.env.EZP_SEND_SLOT_FRACTION = slotFraction;
    let app: EzPlayerProc | undefined;
    try {
        app = await startEzPlayer(show.dir);
        const fpp = new FppClient(app.base);
        await fpp.uploadFile(
            'sequences',
            'Spread.fseq',
            buildFseq({ channels: CHANNELS, frames: 240, msPerFrame: MS_PER_FRAME, value: 42 }), // 12s
        );
        expect(
            (
                await fpp.putPlaylist('Spread Show', {
                    name: 'Spread Show',
                    mainPlaylist: [{ type: 'sequence', sequenceName: 'Spread.fseq' }],
                })
            ).status,
        ).toBe(200);
        await fpp.ezpCommand({ command: 'resetstats' });
        expect((await fpp.command('Start Playlist', 'Spread Show', 0, 0, 0)).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: `playing sf=${slotFraction}` });
        const getStats = async () => {
            const res = await fetch(`${app!.base}/api/ezp/playback-stats`);
            expect(res.status).toBe(200);
            return ((await res.json()) as { stats: Record<string, number> }).stats;
        };
        // Skip the warm-up (cache fill / first-frames transients), then measure
        // a steady window; frame counters are deltas over that window only.
        await new Promise((r) => setTimeout(r, 3000));
        const base = await getStats();
        timer.frames.length = 0;
        await new Promise((r) => setTimeout(r, 5000));
        const frames = timer.frames.slice();
        const stats = await getStats();
        expect((await fpp.command('Stop Now')).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'idle' });
        return {
            frames,
            sent: stats.sentFramesCumulative - base.sentFramesCumulative,
            skipped: stats.skippedFramesCumulative - base.skippedFramesCumulative,
            missed: stats.missedFramesCumulative - base.missedFramesCumulative,
        };
    } finally {
        if (prevEnv === undefined) delete process.env.EZP_SEND_SLOT_FRACTION;
        else process.env.EZP_SEND_SLOT_FRACTION = prevEnv;
        await app?.stop();
        await timer.close();
        await show.cleanup();
    }
}

const median = (xs: number[]) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

describe('paced send', () => {
    // The DDP port is fixed; the two boots must run one at a time.
    afterEach(async () => new Promise((r) => setTimeout(r, 500)));

    it('spreads a frame across the slot by default, without costing frames', async () => {
        const off = await runCase('0');
        const paced = await runCase(undefined); // the built-in default

        // Only consider full data frames (idle black frames are tiny).
        const full = (fs: FrameSpread[]) => fs.filter((f) => f.packets >= 50);
        const offSpread = median(full(off.frames).map((f) => f.spreadMs));
        const pacedSpread = median(full(paced.frames).map((f) => f.spreadMs));
        if (process.env.PACED_SEND_REPORT) {
            const { appendFileSync } = await import('node:fs');
            const line = JSON.stringify({
                offSpread,
                pacedSpread,
                off: { sent: off.sent, skipped: off.skipped, missed: off.missed, fullFrames: full(off.frames).length },
                paced: {
                    sent: paced.sent,
                    skipped: paced.skipped,
                    missed: paced.missed,
                    fullFrames: full(paced.frames).length,
                },
            });
            appendFileSync(process.env.PACED_SEND_REPORT, line + String.fromCharCode(10));
        }
        console.log(
            `paced-send: off median spread ${offSpread.toFixed(2)}ms over ${full(off.frames).length} frames; ` +
                `paced ${pacedSpread.toFixed(2)}ms over ${full(paced.frames).length} frames; ` +
                `frames off ${off.sent}/${off.skipped}/${off.missed} paced ${paced.sent}/${paced.skipped}/${paced.missed} (sent/skip/miss)`,
        );

        expect(full(off.frames).length).toBeGreaterThan(50);
        expect(full(paced.frames).length).toBeGreaterThan(50);

        // Unpaced: one microburst, single-digit ms at worst. Paced: most of the
        // slot (>=10 ms is unambiguous spreading; the plan aims for ~30+ ms).
        expect(offSpread).toBeLessThan(10);
        expect(pacedSpread).toBeGreaterThan(10);
        expect(pacedSpread).toBeGreaterThan(offSpread * 3);
        // Pacing must still fit inside the frame interval.
        expect(pacedSpread).toBeLessThan(MS_PER_FRAME);

        // And it must not cost delivery over the steady window: both runs clean.
        for (const r of [off, paced]) {
            expect(r.missed).toBe(0);
            expect(r.skipped).toBeLessThanOrEqual(Math.ceil(r.sent * 0.02));
        }
    }, 180_000);
});
