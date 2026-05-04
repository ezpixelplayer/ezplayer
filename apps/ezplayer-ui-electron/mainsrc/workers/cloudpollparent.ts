import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    CloudStatus,
    PlayerCStatusContent,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import type {
    CloudPollInMessage,
    CloudPollOutMessage,
    CloudWorkerTuning,
} from './cloudpolltypes';

// cloudpollparent gets bundled into the parent file that imports it (e.g. dist/main.js),
// so __dirname at runtime is the parent's location — not this source file's location.
// The worker output lives at `<distDir>/workers/cloudpoll.js`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.join(__dirname, 'workers', 'cloudpoll.js');
let worker: Worker | null = null;

let currentStatus: CloudStatus = { playerIdIsRegistered: false };
let currentCStatus: PlayerCStatusContent = {};

let statusListener: ((s: CloudStatus) => void) | undefined;
let cStatusListener: ((s: PlayerCStatusContent) => void) | undefined;
let installListener: ((record: SequenceRecord, superseded: string[]) => void) | undefined;

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
            case 'cStatus':
                currentCStatus = msg.status;
                cStatusListener?.(currentCStatus);
                break;
            case 'installSequence':
                console.log(
                    `[cloudpoll] installSequence id=${msg.record.id} superseded=${msg.superseded.length}`,
                );
                installListener?.(msg.record, msg.superseded);
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

/** Configure (or reconfigure) the cloud worker. Empty cloudUrl or playerIdToken disables it. */
export function setCloudWorkerConfig(
    cloudUrl: string,
    playerIdToken: string,
    showFolder: string,
    existingSequences: SequenceRecord[],
    tuning?: CloudWorkerTuning,
) {
    console.log(
        `[cloudpoll] setCloudWorkerConfig cloudUrl=${cloudUrl ? '"' + cloudUrl + '"' : '(empty)'} playerIdToken=${playerIdToken ? playerIdToken.slice(0, 8) + '…' : '(empty)'} showFolder="${showFolder}"`,
    );
    if (!cloudUrl || !playerIdToken) {
        currentStatus = { playerIdIsRegistered: false };
        statusListener?.(currentStatus);
        currentCStatus = {};
        cStatusListener?.(currentCStatus);
    }
    send({
        type: 'setConfig',
        cloudUrl,
        playerIdToken,
        showFolder,
        existingSequences,
        tuning,
    });
}

/** Refresh the worker's cached snapshot of local sequences (used to diff against
 *  the cloud manifest). Call after each install or after the renderer adds/removes one. */
export function updateCloudWorkerSequences(existingSequences: SequenceRecord[]) {
    if (!worker) return;
    send({ type: 'updateSequences', existingSequences });
}

export function pollCloudNow() {
    send({ type: 'pollNow' });
}

export function manifestPollNow() {
    send({ type: 'manifestNow' });
}

export function stopCloudPoll() {
    if (!worker) return;
    send({ type: 'stop' });
}

export function getCurrentCloudStatus(): CloudStatus {
    return currentStatus;
}

export function getCurrentCStatus(): PlayerCStatusContent {
    return currentCStatus;
}

export function onCloudStatus(listener: (s: CloudStatus) => void) {
    statusListener = listener;
}

export function onCStatus(listener: (s: PlayerCStatusContent) => void) {
    cStatusListener = listener;
}

export function onInstallSequence(
    listener: (record: SequenceRecord, superseded: string[]) => void,
) {
    installListener = listener;
}
