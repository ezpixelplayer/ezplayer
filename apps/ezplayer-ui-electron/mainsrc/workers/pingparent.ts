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

worker.on('message', (msg: {type?: string}) => {
    if (msg.type === 'roundResult') {
        const { finishedAt, stats } = msg as RoundResultMessage;
        //console.log(`Ping result: ${JSON.stringify(stats)}`);
        latestStats = stats;
        latestUpdate = finishedAt;
    } else if (msg.type === 'stopped') {
        console.log('Ping worker stopped')
    } else if (msg.type === 'error') {
        console.log(`Ping worker error: ${(msg as {error?: string}).error}`);
    } else {
        console.log('UNEXPECTED worker message:', msg);
    }
});

worker.on('error', (err) => {
    console.error('Worker error:', err);
});

worker.on('exit', (code) => {
    console.log('Worker exited with code', code);
});

export function setPingConfig(cfg: PingConfig) {
    worker.postMessage({
        type: 'config',
        config: cfg,
    } satisfies ParentMessage);
}

export function getLatestPingStats() {
    return {stats: latestStats, latestUpdate};
}