import { parentPort } from 'worker_threads';
import { CLOUD_API_ENDPOINTS } from '@ezplayer/ezplayer-core';
import type { CloudPollInMessage, CloudPollOutMessage } from './cloudpolltypes';

const DEFAULT_INTERVAL_MS = 30_000;

let cloudUrl = '';
let playerIdToken = '';
let intervalMs = DEFAULT_INTERVAL_MS;
let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let stopped = false;

function post(msg: CloudPollOutMessage) {
    parentPort?.postMessage(msg);
}

function log(level: 'info' | 'warn' | 'error', msg: string) {
    post({ type: 'log', level, msg });
}

function clearTimer() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

function canPoll() {
    return !stopped && cloudUrl.length > 0 && playerIdToken.length > 0;
}

function rescheduleTimer() {
    clearTimer();
    if (!canPoll()) return;
    timer = setInterval(() => {
        void poll();
    }, intervalMs);
    if (timer.unref) timer.unref();
}

async function poll() {
    if (inFlight) {
        log('info', 'poll skipped: already in flight');
        return;
    }
    if (!canPoll()) {
        log(
            'info',
            `poll skipped: cloudUrl=${cloudUrl ? 'set' : 'empty'} playerIdToken=${playerIdToken ? 'set' : 'empty'} stopped=${stopped}`,
        );
        return;
    }

    inFlight = true;
    // Player-side endpoints live under <host>/api/. The user-facing landing URL in
    // CLOUD_API_ENDPOINTS.REGISTER_PLAYER is the exception — it lives under <host>/enduser/.
    const url = `${cloudUrl}api/${CLOUD_API_ENDPOINTS.IS_PLAYER_REGISTERED}${playerIdToken}`;
    log('info', `polling ${url}`);
    try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            log('warn', `poll non-OK: HTTP ${res.status}`);
            post({
                type: 'cloudStatus',
                status: {
                    playerIdIsRegistered: false,
                    lastCheckedAt: Date.now(),
                    lastError: `HTTP ${res.status}`,
                },
            });
            return;
        }
        const body = (await res.json()) as { registered?: boolean; version?: string };
        log(
            'info',
            `poll ok: registered=${!!body.registered} version=${body.version ?? '(none)'}`,
        );
        post({
            type: 'cloudStatus',
            status: {
                playerIdIsRegistered: !!body.registered,
                cloudVersion: body.version,
                lastCheckedAt: Date.now(),
                lastError: undefined,
            },
        });
    } catch (e) {
        const err = e as Error;
        log('warn', `cloud poll error: ${err.message}`);
        post({
            type: 'cloudStatus',
            status: {
                playerIdIsRegistered: false,
                lastCheckedAt: Date.now(),
                lastError: err.message,
            },
        });
    } finally {
        inFlight = false;
    }
}

parentPort?.on('message', (msg: CloudPollInMessage) => {
    switch (msg.type) {
        case 'setConfig': {
            cloudUrl = msg.cloudUrl ?? '';
            playerIdToken = msg.playerIdToken ?? '';
            intervalMs = msg.intervalMs ?? DEFAULT_INTERVAL_MS;
            stopped = false;
            log(
                'info',
                `setConfig cloudUrl=${cloudUrl ? '"' + cloudUrl + '"' : '(empty)'} playerIdToken=${playerIdToken ? playerIdToken.slice(0, 8) + '…' : '(empty)'} intervalMs=${intervalMs}`,
            );
            rescheduleTimer();
            // Kick an immediate poll so the renderer sees fresh state quickly.
            void poll();
            break;
        }
        case 'pollNow': {
            log('info', 'pollNow requested');
            void poll();
            break;
        }
        case 'stop': {
            log('info', 'stop requested');
            stopped = true;
            clearTimer();
            break;
        }
    }
});

log('info', 'cloud poll worker started');
