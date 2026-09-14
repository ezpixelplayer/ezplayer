/*
 * Frame-timing sleep for the playback and output threads, plus the per-period
 * aggregate the playback statistics are built from.
 */
import { snapshotAsyncCounts } from './perfmon';

////////
// Sleep utilities
const unsharedSharedBuffer = new SharedArrayBuffer(1024);
const int32USB = new Int32Array(unsharedSharedBuffer);
/**
 * Observed overshoot of a timed `Atomics.wait` (e.g. ~15.6 ms on Windows
 * without a 1 ms multimedia timer). The sleep waits coarsely while it can,
 * then spin-yields the final stretch.
 */
let waitOvershootMs = 0.5;
const WAIT_SPIN_MARGIN_MS = 0.3;
let warnedCoarseTimer = false;

export async function xbusySleep(nextTime: number, emitWarning: ((s: string) => void) | undefined): Promise<void> {
    while (true) {
        const nt = performance.now();
        const remaining = nextTime - nt;
        if (remaining <= 0.05) return;

        if (remaining > waitOvershootMs + WAIT_SPIN_MARGIN_MS) {
            const req = Math.min(1, remaining - waitOvershootMs);
            Atomics.wait(int32USB, 0, 0, req);
            const overshoot = Math.max(0, performance.now() - nt - req);
            // Learn the worst case quickly, forget slowly (timer resolution can change).
            waitOvershootMs = overshoot > waitOvershootMs ? overshoot : waitOvershootMs * 0.999 + overshoot * 0.001;
            if (waitOvershootMs > 5 && !warnedCoarseTimer) {
                warnedCoarseTimer = true;
                emitWarning?.(
                    `Coarse timer resolution: a ${req.toFixed(1)} ms wait took ${(req + overshoot).toFixed(1)} ms; ` +
                        `frame timing will spin-wait the last ${waitOvershootMs.toFixed(1)} ms of each frame`,
                );
            }
        }
        // else: spin-yield; setImmediate keeps the event loop serving I/O completions.

        const lastCPU = process.cpuUsage();
        const ps = performance.now();
        await new Promise((resolve) => setImmediate(resolve));
        const nowCPU = process.cpuUsage(lastCPU);
        const pe = performance.now();
        const ahs = snapshotAsyncCounts();
        if (pe - ps > 10) {
            const cpuUserMs = nowCPU.user / 1000;
            const cpuSysMs = nowCPU.system / 1000;
            const cpuTotalMs = cpuUserMs + cpuSysMs;
            emitWarning?.(
                `Hiccup - long setImmediate: ${pe - ps} - CPU ${cpuTotalMs} (${cpuUserMs}+${cpuSysMs}); async counts:`,
            );
            for (const [type, count] of ahs) {
                emitWarning?.(`  ${type}: ${count}`);
            }
        }
    }
}

export interface OverallFrameSendStats {
    nSends: number;
    intervalStart: number;
    totalSendTime: number;
    totalIdleTime: number;
    totalMixTime: number;
}

export function resetFrameSendStats(stats: OverallFrameSendStats, pn: number) {
    stats.intervalStart = pn;
    stats.nSends = 0;
    stats.totalSendTime = 0;
    stats.totalIdleTime = 0;
    stats.totalMixTime = 0;
}
