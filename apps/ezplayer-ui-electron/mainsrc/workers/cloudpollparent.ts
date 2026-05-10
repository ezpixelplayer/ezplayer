import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    CloudConfig,
    CloudPollScheduleEntry,
    CloudStatus,
    OutOfBandCommand,
    PlayerCStatusContent,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import type {
    CloudPollInMessage,
    CloudPollOutMessage,
    CloudWorkerTuning,
} from './cloudpolltypes';
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
let installListener: ((record: SequenceRecord, superseded: string[]) => void) | undefined;
let layoutInstalledListener:
    | ((layoutMeta: NonNullable<CloudConfig['layoutMeta']>) => void)
    | undefined;

/** Active cloud-bridge session, if any. The cloud re-issues `openCloudWS` on
 *  every checkin while a viewer is attached; we treat that as a TTL refresh,
 *  not a re-dial. A different `sessionId` means the cloud rotated the session,
 *  so we tear the old bridge down and dial the new one. `expiresAt` is the
 *  deadline after which we close on our own (covers the cloud crashing or the
 *  poll silently failing — without TTL, a stale bridge could linger). */
interface ActiveCloudSession {
    sessionId: string;
    wsUrl: string;
    expiresAt: number;
    expiryTimer: NodeJS.Timeout;
}
let activeSession: ActiveCloudSession | undefined;

function clearActiveSession(reason: string) {
    if (!activeSession) return;
    clearTimeout(activeSession.expiryTimer);
    const { sessionId } = activeSession;
    activeSession = undefined;
    cloudBridgeClose(sessionId);
    console.log(`[cloudpoll] cloud bridge closed (${reason}) sessionId=${sessionId.slice(0, 8)}…`);
}

function applyOutOfBandCommand(cmd: OutOfBandCommand) {
    switch (cmd.type) {
        case 'openCloudWS': {
            const expiresAt = Date.now() + cmd.ttlSeconds * 1000;
            if (activeSession?.sessionId === cmd.sessionId) {
                // Same session — refresh the TTL. Bridge already up; no re-dial.
                clearTimeout(activeSession.expiryTimer);
                activeSession.expiresAt = expiresAt;
                activeSession.expiryTimer = setTimeout(
                    () => clearActiveSession('TTL expired'),
                    cmd.ttlSeconds * 1000,
                );
                return;
            }
            // New session — close any existing bridge and dial fresh.
            if (activeSession) clearActiveSession('superseded by new session');
            const expiryTimer = setTimeout(
                () => clearActiveSession('TTL expired'),
                cmd.ttlSeconds * 1000,
            );
            activeSession = {
                sessionId: cmd.sessionId,
                wsUrl: cmd.wsUrl,
                expiresAt,
                expiryTimer,
            };
            console.log(
                `[cloudpoll] cloud bridge open sessionId=${cmd.sessionId.slice(0, 8)}… ttl=${cmd.ttlSeconds}s`,
            );
            cloudBridgeOpen(cmd.wsUrl, cmd.sessionId);
            return;
        }
        case 'closeCloudWS': {
            if (!activeSession) return;
            if (cmd.sessionId && cmd.sessionId !== activeSession.sessionId) {
                // Stale close for a session we already replaced — ignore.
                return;
            }
            clearActiveSession('cloud requested close');
            return;
        }
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
                console.log(
                    `[cloudpoll] installSequence id=${msg.record.id} superseded=${msg.superseded.length}`,
                );
                installListener?.(msg.record, msg.superseded);
                break;
            case 'layoutInstalled':
                console.log('[cloudpoll] layoutInstalled');
                layoutInstalledListener?.(msg.layoutMeta);
                break;
            case 'outOfBandCommands':
                for (const cmd of msg.commands) applyOutOfBandCommand(cmd);
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
    clearActiveSession('config change');
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

export function onInstallSequence(
    listener: (record: SequenceRecord, superseded: string[]) => void,
) {
    installListener = listener;
}

export function onLayoutInstalled(
    listener: (layoutMeta: NonNullable<CloudConfig['layoutMeta']>) => void,
) {
    layoutInstalledListener = listener;
}
