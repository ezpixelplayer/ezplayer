import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParentMessage, PingConfig, PingStat, RoundResultMessage } from './pingworker';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.resolve(__dirname, 'pingworker.js'); // compiled JS path
const worker = new Worker(workerPath);

let latestStats: { [address: string]: PingStat } | undefined = undefined;
let latestUpdate: number | undefined = undefined;
let workerExited = false;

worker.on('message', (msg: { type?: string }) => {
    if (msg.type === 'roundResult') {
        const { finishedAt, stats } = msg as RoundResultMessage;
        latestStats = stats;
        latestUpdate = finishedAt;
    } else if (msg.type === 'stopped') {
        console.log('Ping worker stopped');
    } else if (msg.type === 'error') {
        console.log(`Ping worker error: ${(msg as { error?: string }).error}`);
    } else {
        console.log('UNEXPECTED worker message:', msg);
    }
});

worker.on('error', (err) => {
    console.error('Worker error:', err);
});

worker.on('exit', (code) => {
    workerExited = true;
    console.log('Worker exited with code', code);
});

export function setPingConfig(cfg: PingConfig) {
    if (workerExited) return;
    worker.postMessage({
        type: 'config',
        config: cfg,
    } satisfies ParentMessage);
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
    if (workerExited) return;

    const waitForStop = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        const handler = (msg: { type?: string }) => {
            if (msg.type === 'stopped') {
                clearTimeout(timer);
                worker.off('message', handler);
                resolve();
            }
        };
        worker.on('message', handler);
    });

    worker.postMessage({ type: 'stop' } satisfies ParentMessage);
    await waitForStop;

    if (!workerExited) {
        await worker.terminate();
    }
}
