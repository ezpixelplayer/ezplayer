import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextToPlay, PlaylistSyncItem, RFApiClientConfig, RFWorkerInMessage, RFWorkerOutMessage } from './rfsync';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.resolve(__dirname, 'rfsync.js'); // compiled JS path
const worker = new Worker(workerPath);

worker.on('error', (err) => {
    console.error('Worker error:', err);
});

worker.on('exit', (code) => {
    console.log('Worker exited with code', code);
});

let suggestionCallback: ((n: NextToPlay) => void) | undefined = undefined;
let warningCallback: ((msg: string) => void) | undefined = undefined;

/** Identical failures are collapsed: the first goes out at once, a repeat only
 *  after this long and carrying how many were swallowed meanwhile.  Without it
 *  a list Remote Falcon keeps rejecting would log once a second all evening. */
const WARN_REPEAT_MS = 60_000;
let lastWarn = '';
let lastWarnAt = 0;
let suppressedWarns = 0;

function reportWarning(msg: string) {
    const now = Date.now();
    const same = msg === lastWarn;
    if (same && now - lastWarnAt < WARN_REPEAT_MS) {
        ++suppressedWarns;
        return;
    }
    const alsoSince = same && suppressedWarns > 0 ? ` (${suppressedWarns} more since)` : '';
    lastWarn = msg;
    lastWarnAt = now;
    suppressedWarns = 0;
    if (warningCallback) warningCallback(`${msg}${alsoSince}`);
    else console.error('[RFWorker]', `${msg}${alsoSince}`);
}

/** Where Remote Falcon failures go — the master's log, so they sit with the
 *  rest of the evening.  Without one they only reach the console. */
export function setRFWarningCallback(cb: (msg: string) => void) {
    warningCallback = cb;
}

type ResyncResult = { ok: boolean; message?: string };
const pendingResyncs = new Map<string, (r: ResyncResult) => void>();
let resyncSeq = 0;

// rfParentExample.ts
worker.on('message', (msg: RFWorkerOutMessage) => {
    switch (msg.type) {
        case 'nextSuggestion': {
            if (msg.suggestion) suggestionCallback?.(msg.suggestion);
            break;
        }
        case 'log':
            if (msg.level === 'error') reportWarning(msg.msg);
            else console.log('[RFWorker]', msg.msg);
            break;

        case 'configStatus':
            if (msg.ok) console.log('RF worker configured');
            else console.error('RF worker config error:', msg.error);
            break;

        case 'playbackUpdated':
            console.log('RF playback updated:', msg);
            break;

        case 'controlUpdated':
            console.log('RF control updated:', msg.enabled);
            break;

        case 'playlistsSynced':
            console.log('RF playlists synced');
            break;

        case 'playlistsSyncResult': {
            const resolve = pendingResyncs.get(msg.requestId);
            pendingResyncs.delete(msg.requestId);
            if (!msg.ok && msg.message) reportWarning(msg.message);
            resolve?.({ ok: msg.ok, message: msg.message });
            break;
        }

        case 'heartbeatSent':
            if (msg.error) console.error('heartbeat error:', msg.error);
            break;
    }
});

function send(msg: RFWorkerInMessage) {
    worker.postMessage(msg);
}

export function setRFConfig(cfg: RFApiClientConfig, cb: (arg: NextToPlay) => void) {
    suggestionCallback = cb;
    worker.postMessage({
        type: 'setConfig',
        config: cfg,
    } satisfies RFWorkerInMessage);
}

export function setRFNowPlaying(now?: string, next?: string) {
    send({
        type: 'updatePlayback',
        nowPlaying: now,
        nextScheduled: next,
    });
}

export function setRFControlEnabled(enabled: boolean) {
    send({ type: 'setControlEnabled', enabled });
}

export function setRFPlaylist(pl: PlaylistSyncItem[]) {
    send({
        type: 'syncPlaylists',
        playlists: pl,
    });
}

/** Forget what the worker thinks RF holds; the next update re-pushes all of it. */
export function resyncRF() {
    send({ type: 'forgetRemoteState' });
}

/** Push the list now, past the dedupe, and resolve with Remote Falcon's answer. */
export function resyncRFPlaylist(playlists: PlaylistSyncItem[], timeoutMs = 20_000): Promise<ResyncResult> {
    const requestId = `rs${++resyncSeq}`;
    return new Promise<ResyncResult>((resolve) => {
        const timer = setTimeout(() => {
            pendingResyncs.delete(requestId);
            resolve({ ok: false, message: 'Remote Falcon did not answer in time' });
        }, timeoutMs);
        pendingResyncs.set(requestId, (r) => {
            clearTimeout(timer);
            resolve(r);
        });
        send({ type: 'resyncPlaylists', requestId, playlists });
    });
}

export function sendRFInitiateCheck() {
    send({
        type: 'requestNextSuggestion',
    });
}
