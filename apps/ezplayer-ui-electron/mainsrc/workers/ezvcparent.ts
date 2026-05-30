/**
 * Parent-side handle for the EZPlayer viewer-control worker. Spawns
 * `ezvcsync.js` and exposes a small imperative API driven by
 * `playbackmaster.ts`.
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VcPlayingUpdate, VcScheduleEntry, VcSong } from '@ezplayer/ezplayer-core';
import type {
    EzvcConfig,
    EzvcNextToPlay,
    EzvcWorkerInMessage,
    EzvcWorkerOutMessage,
} from './ezvcsync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workerPath = path.resolve(__dirname, 'ezvcsync.js'); // compiled JS path
const worker = new Worker(workerPath);

worker.on('error', (err) => {
    console.error('[ezvc] worker error:', err);
});
worker.on('exit', (code) => {
    console.log('[ezvc] worker exited with code', code);
});

let suggestionCallback: ((n: EzvcNextToPlay) => void) | undefined = undefined;

worker.on('message', (msg: EzvcWorkerOutMessage) => {
    switch (msg.type) {
        case 'nextSuggestion':
            if (msg.suggestion) suggestionCallback?.(msg.suggestion);
            break;
        case 'log':
            console[msg.level === 'error' ? 'error' : 'log']('[ezvc]', msg.msg);
            break;
        case 'configStatus':
            if (msg.ok) console.log('[ezvc] worker configured');
            else console.error('[ezvc] worker config error:', msg.error);
            break;
        case 'controlUpdated':
            console.log('[ezvc] control updated:', msg.enabled);
            break;
        case 'playbackUpdated':
            console.log(
                '[ezvc] now-playing sent:',
                msg.nowPlaying ?? '(none)',
                msg.nextScheduled ? `next=${msg.nextScheduled}` : '',
            );
            break;
        case 'playlistsSynced':
            console.log('[ezvc] song list synced:', msg.count);
            break;
        case 'scheduleSynced':
            console.log(
                '[ezvc] schedule synced:',
                `${msg.scheduleCount} show window(s),`,
                `${msg.requestWindowCount} request window(s)`,
            );
            break;
        case 'catalogSynced':
            console.log('[ezvc] catalog synced:', msg.count);
            break;
    }
});

function send(msg: EzvcWorkerInMessage) {
    worker.postMessage(msg);
}

export function setEzvcConfig(cfg: EzvcConfig, cb: (arg: EzvcNextToPlay) => void) {
    suggestionCallback = cb;
    send({ type: 'setConfig', config: cfg });
}

export function setEzvcPlaying(update: VcPlayingUpdate) {
    send({ type: 'updatePlayback', update });
}

export function setEzvcControlEnabled(enabled: boolean) {
    send({ type: 'setControlEnabled', enabled });
}

export function setEzvcPlaylist(songs: VcSong[]) {
    send({ type: 'syncPlaylists', songs });
}

export function setEzvcSchedule(schedule: VcScheduleEntry[], requestWindows: VcScheduleEntry[]) {
    send({ type: 'syncSchedule', schedule, requestWindows });
}

export function setEzvcCatalog(catalog: VcSong[]) {
    send({ type: 'syncCatalog', catalog });
}

export function sendEzvcInitiateCheck() {
    send({ type: 'requestNextSuggestion' });
}
