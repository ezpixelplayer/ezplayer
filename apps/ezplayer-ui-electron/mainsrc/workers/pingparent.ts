import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParentMessage, PingConfig, PingStat, RoundResultMessage } from './pingworker';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.resolve(__dirname, 'pingworker.js'); // compiled JS path

/** Restart backoff, capped; past the last entry we stop retrying. */
const RESTART_DELAYS_MS = [1_000, 5_000, 15_000, 60_000];

let worker: Worker | undefined;
let latestStats: { [address: string]: PingStat } | undefined = undefined;
let latestUpdate: number | undefined = undefined;
let lastConfig: PingConfig | undefined = undefined;
let lastError: string | undefined = undefined;
let restarts = 0;
let stopping = false;
let restartTimer: NodeJS.Timeout | undefined;

/**
 * Health of the pinger itself, as opposed to of any controller.  A dead worker
 * used to be invisible: stats froze at their last value and every controller
 * kept whatever dot it had.  Callers can now say so.
 */
export function getPingerHealth(): { running: boolean; error?: string; restarts: number } {
    return { running: worker !== undefined, error: lastError, restarts };
}

function scheduleRestart(why: string) {
    lastError = why;
    worker = undefined;
    if (stopping) return;

    if (restarts >= RESTART_DELAYS_MS.length) {
        console.error(`Ping worker gave up after ${restarts} restarts; last error: ${why}`);
        return;
    }
    const delay = RESTART_DELAYS_MS[restarts];
    restarts += 1;
    console.error(`Ping worker down (${why}); restart ${restarts} in ${delay}ms`);
    restartTimer = setTimeout(() => {
        restartTimer = undefined;
        startWorker();
    }, delay);
    restartTimer.unref?.();
}

function startWorker() {
    if (stopping || worker) return;

    let w: Worker;
    try {
        w = new Worker(workerPath);
    } catch (err) {
        // Typically the compiled worker or its native addon is missing from the
        // install — worth saying out loud rather than pinging nothing forever.
        scheduleRestart(`cannot start ${workerPath}: ${String(err)}`);
        return;
    }
    worker = w;

    w.on('message', (msg: { type?: string }) => {
        if (msg.type === 'roundResult') {
            const { finishedAt, stats } = msg as RoundResultMessage;
            latestStats = stats;
            latestUpdate = finishedAt;
            lastError = undefined;
            restarts = 0; // a completed round means it is healthy again
        } else if (msg.type === 'stopped') {
            console.log('Ping worker stopped');
        } else if (msg.type === 'error') {
            lastError = (msg as { error?: string }).error;
            console.error(`Ping worker error: ${lastError}`);
        } else {
            console.log('UNEXPECTED worker message:', msg);
        }
    });

    w.on('error', (err) => {
        console.error('Ping worker error:', err);
        scheduleRestart(String(err));
    });

    w.on('exit', (code) => {
        if (stopping) return;
        scheduleRestart(`exited with code ${code}`);
    });

    // A restarted worker starts with no hosts, so re-apply what we were told.
    if (lastConfig) {
        w.postMessage({ type: 'config', config: lastConfig } satisfies ParentMessage);
    }
}

startWorker();

export function setPingConfig(cfg: PingConfig) {
    lastConfig = cfg;
    worker?.postMessage({ type: 'config', config: cfg } satisfies ParentMessage);
}

export function getLatestPingStats() {
    return { stats: latestStats, latestUpdate };
}

/**
 * Gracefully stop the ping worker:
 *  1. Send 'stop' → worker calls native shutdown() (aborts TSFN)
 *  2. Wait for 'stopped' ack (with 2 s safety timeout)
 *  3. Terminate the worker thread
 */
export async function stopPing(): Promise<void> {
    stopping = true;
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = undefined;
    }

    const w = worker;
    if (!w) return;

    const waitForStop = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        const handler = (msg: { type?: string }) => {
            if (msg.type === 'stopped') {
                clearTimeout(timer);
                w.off('message', handler);
                resolve();
            }
        };
        w.on('message', handler);
    });

    w.postMessage({ type: 'stop' } satisfies ParentMessage);
    await waitForStop;

    worker = undefined;
    await w.terminate();
}
