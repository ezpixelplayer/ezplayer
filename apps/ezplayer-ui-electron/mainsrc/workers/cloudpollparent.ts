import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    CloudConfig,
    CloudPlayerSettings,
    CloudPollScheduleEntry,
    CloudStatus,
    OutOfBandCommand,
    PlayerCStatusContent,
    PlaylistRecord,
    ScheduledPlaylist,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import type { CloudPollInMessage, CloudPollOutMessage, CloudWorkerTuning } from './cloudpolltypes';
import { cloudBridgeOpen, cloudBridgeClose } from '../server-worker-manager.js';

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
let installListener: ((record: SequenceRecord) => void) | undefined;
let layoutInstalledListener: ((layoutMeta: NonNullable<CloudConfig['layoutMeta']>) => void) | undefined;
let playlistsListener: ((playlists: PlaylistRecord[]) => void) | undefined;
let scheduleListener: ((schedule: ScheduledPlaylist[]) => void) | undefined;
let settingsListener: ((settings: CloudPlayerSettings) => void) | undefined;
let homeServerUrlListener: ((url: string) => void) | undefined;
let vcResyncListener: (() => void) | undefined;

/** Forward an out-of-band command from the cloud to the server worker, which
 *  owns the actual WebSocket session (including TTL/redial state). The parent
 *  doesn't track session lifecycle — that would split the source of truth and
 *  let the parent short-circuit a re-dial after a transient WS drop. The
 *  worker is in the best position to know whether its socket is alive. */
function applyOutOfBandCommand(cmd: OutOfBandCommand) {
    switch (cmd.type) {
        case 'openCloudWS':
            // wsUrl/proxyWsUrl are optional on the wire (cloud-side host
            // detection is unreliable behind ingress/load-balancers); the
            // worker fills them in from its own cloudUrl before posting to
            // us. If we get here with no wsUrl, something upstream is broken.
            if (!cmd.wsUrl) {
                console.warn('[cloudpoll] openCloudWS missing wsUrl; ignoring command');
                return;
            }
            cloudBridgeOpen(cmd.wsUrl, cmd.proxyWsUrl, cmd.audioWsUrl, cmd.sessionId, cmd.ttlSeconds);
            return;
        case 'closeCloudWS':
            // sessionId may be omitted by the cloud → "close any current bridge".
            cloudBridgeClose(cmd.sessionId);
            return;
        case 'vcResync':
            // Cloud lost our viewer-control state — kick the playback worker
            // (via the registered listener) to re-push a full vc snapshot.
            vcResyncListener?.();
            return;
    }
}

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
                console.log(`[cloudpoll] installSequence id=${msg.record.id}`);
                installListener?.(msg.record);
                break;
            case 'layoutInstalled':
                console.log('[cloudpoll] layoutInstalled');
                layoutInstalledListener?.(msg.layoutMeta);
                break;
            case 'cloudPlaylists':
                console.log(`[cloudpoll] cloudPlaylists count=${msg.playlists.length}`);
                playlistsListener?.(msg.playlists);
                break;
            case 'cloudSchedule':
                console.log(`[cloudpoll] cloudSchedule count=${msg.schedule.length}`);
                scheduleListener?.(msg.schedule);
                break;
            case 'cloudSettings':
                console.log('[cloudpoll] cloudSettings');
                settingsListener?.(msg.settings);
                break;
            case 'outOfBandCommands':
                for (const cmd of msg.commands) applyOutOfBandCommand(cmd);
                break;
            case 'homeServerUrl':
                console.log(`[cloudpoll] homeServerUrl ${msg.url}`);
                homeServerUrlListener?.(msg.url);
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
    layoutMeta?: CloudConfig['layoutMeta'],
    layoutSource?: 'xlights' | 'cloud',
    tuning?: CloudWorkerTuning,
    pollMode?: 'always' | 'scheduled',
    pollSchedule?: CloudPollScheduleEntry[],
) {
    console.log(
        `[cloudpoll] setCloudWorkerConfig cloudUrl=${cloudUrl ? '"' + cloudUrl + '"' : '(empty)'} playerIdToken=${playerIdToken ? playerIdToken.slice(0, 8) + '…' : '(empty)'} showFolder="${showFolder}" layoutSource=${layoutSource ?? '(absent)'} pollMode=${pollMode ?? '(absent)'} schedule=${pollSchedule?.length ?? 0}`,
    );
    // Every reconfigure is a session change (folder switch, token rotation,
    // disable). Reset registration + content state so the renderer never sees
    // the previous session's snapshot bridging the gap until the worker's
    // first poll completes. Also tear down any cloud bridge — viewers tied to
    // the previous player_token shouldn't see traffic from the new one.
    currentStatus = { playerIdIsRegistered: false };
    statusListener?.(currentStatus);
    currentCStatus = {};
    cStatusListener?.(currentCStatus);
    cloudBridgeClose(); // unconditional close; player_token may have changed
    send({
        type: 'setConfig',
        cloudUrl,
        playerIdToken,
        showFolder,
        existingSequences,
        layoutMeta,
        layoutSource,
        pollMode,
        pollSchedule,
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

export function fetchLayoutNow() {
    send({ type: 'fetchLayoutNow' });
}

export function uploadLayoutNow() {
    send({ type: 'uploadLayoutNow' });
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

export function onInstallSequence(listener: (record: SequenceRecord) => void) {
    installListener = listener;
}

export function onLayoutInstalled(listener: (layoutMeta: NonNullable<CloudConfig['layoutMeta']>) => void) {
    layoutInstalledListener = listener;
}

export function onCloudPlaylists(listener: (playlists: PlaylistRecord[]) => void) {
    playlistsListener = listener;
}

export function onCloudSchedule(listener: (schedule: ScheduledPlaylist[]) => void) {
    scheduleListener = listener;
}

export function onCloudSettings(listener: (settings: CloudPlayerSettings) => void) {
    settingsListener = listener;
}

/** Register a handler for the cloud's `vcResync` out-of-band command — fired
 *  when the cloud has lost this player's viewer-control state (e.g. restart). */
export function onVcResync(listener: () => void) {
    vcResyncListener = listener;
}

export function onHomeServerUrl(listener: (url: string) => void) {
    homeServerUrlListener = listener;
}
