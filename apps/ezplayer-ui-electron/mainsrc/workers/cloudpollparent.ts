import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CloudStatus } from '@ezplayer/ezplayer-core';
import type { CloudPollInMessage, CloudPollOutMessage } from './cloudpolltypes';

// cloudpollparent gets bundled into the parent file that imports it (e.g. dist/main.js),
// so __dirname at runtime is the parent's location — not this source file's location.
// The worker output lives at `<distDir>/workers/cloudpoll.js`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.join(__dirname, 'workers', 'cloudpoll.js');
let worker: Worker | null = null;

let currentStatus: CloudStatus = { playerIdIsRegistered: false };
let statusListener: ((s: CloudStatus) => void) | undefined;

function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(workerPath);
    worker.on('error', (err) => {
        console.error('[cloudpoll] worker error:', err);
    });
    worker.on('exit', (code) => {
        console.log('[cloudpoll] worker exited with code', code);
        worker = null;
    });
    worker.on('message', (msg: CloudPollOutMessage) => {
        switch (msg.type) {
            case 'cloudStatus':
                currentStatus = msg.status;
                console.log(
                    `[cloudpoll] status: registered=${msg.status.playerIdIsRegistered} version=${msg.status.cloudVersion ?? '(none)'} lastError=${msg.status.lastError ?? '(none)'}`,
                );
                statusListener?.(currentStatus);
                break;
            case 'log':
                console[msg.level === 'error' ? 'error' : 'log']('[cloudpoll]', msg.msg);
                break;
        }
    });
    return worker;
}

function send(msg: CloudPollInMessage) {
    ensureWorker().postMessage(msg);
}

/** Configure (or reconfigure) the poll loop. Empty cloudUrl or playerIdToken disables polling. */
export function setCloudPollConfig(cloudUrl: string, playerIdToken: string, intervalMs?: number) {
    console.log(
        `[cloudpoll] setCloudPollConfig cloudUrl=${cloudUrl ? '"' + cloudUrl + '"' : '(empty)'} playerIdToken=${playerIdToken ? playerIdToken.slice(0, 8) + '…' : '(empty)'}`,
    );
    // When polling is disabled (no URL or no token), there's no source of truth for
    // registration anymore — reset to "not registered" and notify so stale state doesn't
    // linger from a previous configuration.
    if (!cloudUrl || !playerIdToken) {
        currentStatus = { playerIdIsRegistered: false };
        statusListener?.(currentStatus);
    }
    send({ type: 'setConfig', cloudUrl, playerIdToken, intervalMs });
}

export function pollCloudNow() {
    send({ type: 'pollNow' });
}

export function stopCloudPoll() {
    if (!worker) return;
    send({ type: 'stop' });
}

export function getCurrentCloudStatus(): CloudStatus {
    return currentStatus;
}

/** Set the (single) listener that fires whenever the worker reports a status update. */
export function onCloudStatus(listener: (s: CloudStatus) => void) {
    statusListener = listener;
}
