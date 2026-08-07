/**
 * Server worker - runs Koa server in a worker thread
 */

import { parentPort } from 'worker_threads';
import Koa from 'koa';
import getRawBody from 'raw-body';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import httpMod from 'http';
import httpsMod from 'https';
import * as path from 'path';
import * as fs from 'fs';
import fsp from 'fs/promises';
import Router from '@koa/router';
import { send } from '@koa/send';
import serve from 'koa-static';
import { fileURLToPath } from 'url';
import type {
    ControllerOpsState,
    EZPlayerCommand,
    FullPlayerState,
    PlaybackSettings,
    PlayerPStatusContent,
    PlaylistRecord,
    ScheduledPlaylist,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import { LatestFrameRingBuffer, AudioChunkRingBuffer } from '@ezplayer/ezplayer-core';
import { BufferPool } from '@ezplayer/epp';
import { ZstdCodec, ZstdSimple } from 'zstd-codec';
import type {
    ServerWorkerData,
    ServerWorkerToMainMessage,
    MainToServerWorkerMessage,
    ServerWorkerRPCAPI,
} from './serverworkertypes.js';
import { WebSocketBroadcaster } from '../websocket-broadcaster.js';
import {
    closeActiveTerminal,
    createTerminalWss,
    dispatchShellEvent,
    terminalEndpointEnabled,
} from './terminal-ws.js';
import {
    createFileApiRouter,
    registerSequenceApiRoutes,
    listFileNamesCore,
    chunkUploadCore,
    putSequencesCore,
    autodetectSequenceCore,
    audioMetadataCore,
    type FileApiDeps,
} from './file-api.js';
import { registerFppCompatRoutes } from './fppcompat/fpp-api.js';
import {
    createProxyMiddleware,
    createProxyRefererRescue,
    attachWebSocketProxy,
    parseTargetUrl,
    isLanProxyTarget,
} from './proxy-middleware.js';
import { registerScanApiRoutes } from './scan-api.js';
import { registerControllersApiRoutes } from './controllers-api.js';
import { ViewObject, LayoutSettings, type MhFixtureInfo } from './playbacktypes.js';
import { trustSystemCAs } from '../trustSystemCAs.js';

// Trust the OS cert store before this worker's TLS (cloud WS bridge).
trustSystemCAs();

if (!parentPort) throw new Error('No parentPort in worker');

// `@koa/bodyparser` used to populate this; we now do it ourselves (see `jsonBody`).
declare module 'koa' {
    interface Request {
        body?: unknown;
    }
}

// Minimal JSON body parser, replacing `@koa/bodyparser`. That package pulled in
// `co-body`, which depends on `type-is@1`, while koa itself uses `type-is@2` — the
// two-version split broke electron-builder's asar dependency collection (the v2 copy
// was dropped, so the packaged app crashed with ERR_MODULE_NOT_FOUND 'type-is'). We
// only ever receive JSON on POST routes, so this covers it: `ctx.is('json')` uses
// koa's own type-is, and `raw-body` reads/limits the stream. Non-JSON or proxied
// requests stream through untouched (this stays after the proxy middleware).
const jsonBody = () => async (ctx: Koa.Context, next: Koa.Next) => {
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && ctx.is('json')) {
        const raw = await getRawBody(ctx.req, { encoding: 'utf8', limit: '10mb' });
        try {
            ctx.request.body = raw ? JSON.parse(raw) : {};
        } catch {
            ctx.throw(400, 'Invalid JSON body');
        }
    }
    await next();
};

const ASSET_MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    '.obj': 'text/plain',
    '.mtl': 'text/plain',
};

function inferMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ASSET_MIME_TYPES[ext] ?? 'application/octet-stream';
}

async function exists(path: string): Promise<boolean> {
    try {
        await fsp.access(path, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

/** Resolve thumbnail path from cached sequences (replicates ipcezplayer logic locally) */
function getSequenceThumbnailLocal(sequenceId: string): string | undefined {
    const sequences = wsBroadcaster.get('sequences') as SequenceRecord[] | undefined;
    const seq = sequences?.find((s) => s.id === sequenceId);
    if (seq?.files?.thumb) {
        if (path.isAbsolute(seq.files.thumb)) {
            return seq.files.thumb;
        }
        const sf = wsBroadcaster.get('showFolder');
        if (sf) {
            return path.join(sf, seq.files.thumb);
        }
        return seq.files.thumb;
    }
    return undefined;
}

// RPC client for calling main thread functions
class MainThreadRPC {
    private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

    // Most RPCs are quick (30s). A network scan runs the discovery engine to its
    // own cap (~120s), so it gets a longer leash.
    private static readonly TIMEOUT_MS: Partial<Record<keyof ServerWorkerRPCAPI, number>> = {
        controllerCommand: 130_000,
    };

    call<K extends keyof ServerWorkerRPCAPI>(
        method: K,
        ...args: Parameters<ServerWorkerRPCAPI[K]>
    ): Promise<Awaited<ReturnType<ServerWorkerRPCAPI[K]>>> {
        return new Promise((resolve, reject) => {
            const id = `${Date.now()}-${Math.random()}`;
            // Store resolve with proper type casting
            this.pendingRequests.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
            });

            const message: ServerWorkerToMainMessage = {
                type: 'request',
                id,
                method: method as string,
                args: args as unknown[],
            };

            parentPort!.postMessage(message);

            const timeoutMs = MainThreadRPC.TIMEOUT_MS[method] ?? 30000;
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`RPC timeout for ${method}`));
                }
            }, timeoutMs);
        });
    }

    handleResponse(id: string, result?: unknown, error?: string) {
        const pending = this.pendingRequests.get(id);
        if (!pending) {
            console.warn(`[server-worker] No pending request for id: ${id}`);
            return;
        }
        this.pendingRequests.delete(id);
        if (error) {
            pending.reject(new Error(error));
        } else {
            pending.resolve(result);
        }
    }
}

const rpc = new MainThreadRPC();

const wsBroadcaster = new WebSocketBroadcaster();

/** The port the web server actually bound (after any EADDRINUSE walk-up). Set
 *  once the listener is up; used to dial our own `/terminal` from the cloud
 *  bridge. */
let boundWebPort: number | undefined;

// -- remote shell -------------------------------------------------------------
// The pty itself lives in main (native addon, privileged operation); this
// worker owns the socket and relays bytes. See terminal-ws.ts for the gate.
/** The show folder the player currently has open — where the shell password
 *  lives. Read through the broadcaster so it always reflects the live value. */
const currentShowFolder = (): string | undefined => wsBroadcaster.get('showFolder') as string | undefined;

const terminalWss = createTerminalWss({
    getShowFolder: currentShowFolder,
    shellStart: (sessionId, cols, rows, showFolder) => rpc.call('shellStart', sessionId, cols, rows, showFolder),
    shellInput: (sessionId, data) => {
        void rpc.call('shellInput', sessionId, data).catch((err) => {
            console.error('[terminal] shellInput failed:', err);
        });
    },
    shellResize: (sessionId, cols, rows) => {
        void rpc.call('shellResize', sessionId, cols, rows).catch((err) => {
            console.error('[terminal] shellResize failed:', err);
        });
    },
    shellKill: (sessionId) => {
        void rpc.call('shellKill', sessionId).catch((err) => {
            console.error('[terminal] shellKill failed:', err);
        });
    },
});

/** True only for the actual peer address of a loopback connection. Deliberately
 *  ignores `X-Forwarded-For` and friends — a header a remote caller controls is
 *  no basis for a "local only" decision. */
function isLoopbackAddress(remote: string): boolean {
    const addr = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
    return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('127.');
}

/** Route `/terminal` upgrades, refusing them unless a password is configured.
 *  Checked per-upgrade (not cached) so `EZPlayer shell --clear` shuts the door
 *  immediately, whether or not the CLI managed to nudge us. */
function attachTerminalUpgrade(server: ReturnType<typeof createServer>): void {
    server.on('upgrade', (req, socket, head) => {
        const pathname = (req.url ?? '').split('?')[0];
        if (pathname !== '/terminal') return; // leave for the other upgrade handlers
        void terminalEndpointEnabled(currentShowFolder()).then((enabled) => {
            if (!enabled) {
                socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            terminalWss.handleUpgrade(req, socket, head, (ws) => terminalWss.emit('connection', ws, req));
        });
    });
}

// Forward client → server WebSocket commands to main via RPC. Main pushes
// resulting state back to all clients via the broadcast channel. These three
// branches let the cloud bridge drive everything the LAN HTTP endpoints can
// (cloud config, player commands, playback settings) without round-tripping
// through HTTP — important since cloud viewers only have the WS path.
wsBroadcaster.setClientMessageHandler((msg) => {
    if (msg.type === 'cloudCommand') {
        void rpc.call('cloudCommand', msg.cmd).catch((err) => {
            console.error('[server-worker] cloudCommand failed:', err);
        });
    } else if (msg.type === 'playerCommand') {
        void rpc.call('sendPlayerCommand', msg.cmd).catch((err) => {
            console.error('[server-worker] playerCommand failed:', err);
        });
    } else if (msg.type === 'settings') {
        // Mirror the POST /api/ezp/playback-settings flow: persist to disk first
        // (so changes survive restart), then push to the live player, then
        // re-broadcast so other clients update.
        void (async () => {
            try {
                const showFolder = wsBroadcaster.get('showFolder') as string | undefined;
                if (showFolder) {
                    const settingsPath = path.join(showFolder, '.ezplayer', 'playbackSettings.json');
                    await rpc.call('applySettingsFromRenderer', settingsPath, msg.settings);
                }
                await rpc.call('sendPlaybackSettings', msg.settings);
                wsBroadcaster.set('playbackSettings', msg.settings);
            } catch (err) {
                console.error('[server-worker] settings failed:', err);
            }
        })();
    } else if (msg.type === 'updatePlaylists') {
        void rpc.call('updatePlaylistsHandler', msg.data).catch((err) => {
            console.error('[server-worker] updatePlaylists failed:', err);
        });
    } else if (msg.type === 'updateSchedule') {
        void rpc.call('updateScheduleHandler', msg.data).catch((err) => {
            console.error('[server-worker] updateSchedule failed:', err);
        });
    } else if (msg.type === 'controllerCommand') {
        // LAN WS trigger for a controller op. Fire-and-forget: results flow
        // back via the broadcast `controllerops` state.
        void rpc.call('controllerCommand', msg.command, 'lan').catch((err) => {
            console.error('[server-worker] controllerCommand failed:', err);
        });
    }
});

// Side cache for model coordinates (pushed from main thread on show folder load)
let cachedModelCoordinates3D: unknown = {};
let cachedModelCoordinates2D: unknown = {};
let cachedViewObjects: Array<ViewObject> = [];
let cachedLayoutSettings: LayoutSettings = {};
let cachedMovingHeads: Array<MhFixtureInfo> = [];

let curFrameBuffer: SharedArrayBuffer | undefined = undefined;
let curAudioRing: AudioChunkRingBuffer | undefined = undefined;
let serverStarted = false;

// ZSTD codec handle for frame compression (initialized in startServer)
let zstdSimple: ZstdSimple | undefined = undefined;

// Handle messages from main thread
parentPort.on('message', async (msg: MainToServerWorkerMessage) => {
    if (msg.type === 'init') {
        if (!serverStarted) {
            serverStarted = true;
            await startServer(msg.data);
        }
    } else if (msg.type === 'response') {
        rpc.handleResponse(msg.id, msg.result, msg.error);
    } else if (msg.type === 'updateFrameBuffer') {
        curFrameBuffer = msg.buffer;
    } else if (msg.type === 'updateAudioBuffer') {
        curAudioRing = new AudioChunkRingBuffer(msg.buffer, false);
    } else if (msg.type === 'broadcast') {
        // A terminal belongs to the show it was opened against — its password
        // lives in that show's folder. Switching shows revokes it rather than
        // silently carrying it over to a show that may not permit one at all.
        if (msg.key === 'showFolder' && msg.value !== wsBroadcaster.get('showFolder')) {
            closeActiveTerminal('the player switched to a different show folder');
        }
        // Forward broadcast from main thread to WebSocket clients
        wsBroadcaster.set(msg.key as keyof FullPlayerState, msg.value as any);
    } else if (msg.type === 'clearShowData') {
        // Show folder changed — clear all cached data so stale data is never served
        cachedModelCoordinates3D = {};
        cachedModelCoordinates2D = {};
        cachedViewObjects = [];
        cachedLayoutSettings = {};
        cachedMovingHeads = [];
        curFrameBuffer = undefined;
    } else if (msg.type === 'pushModelCoordinates') {
        cachedModelCoordinates3D = msg.coords3D;
        cachedModelCoordinates2D = msg.coords2D;
        if (msg.viewObjects) {
            cachedViewObjects = msg.viewObjects;
        }
        if (msg.layoutSettings) {
            cachedLayoutSettings = msg.layoutSettings;
        }
        if (msg.movingHeads) {
            cachedMovingHeads = msg.movingHeads;
        }
    } else if (msg.type === 'shellEvent') {
        dispatchShellEvent(msg.event);
    } else if (msg.type === 'cloudBridgeOpen') {
        openCloudBridge(msg.wsUrl, msg.proxyWsUrl, msg.audioWsUrl, msg.sessionId, msg.ttlSeconds);
    } else if (msg.type === 'cloudBridgeClose') {
        closeCloudBridge(msg.sessionId);
        closeCloudProxyBridge(msg.sessionId);
        closeCloudAudioBridge(msg.sessionId);
    } else if (msg.type === 'shutdown') {
        process.exit(0);
    }
});

// -- cloud bridge -------------------------------------------------------------
//
// The cloud emits `openCloudWS` in a checkin response when a remote viewer is
// attached on the cloud side. We dial that URL and hand the resulting socket
// to the broadcaster as if it were a freshly-connected LAN client. The
// existing per-key coalescing + backpressure + heartbeat machinery already
// handles WAN latency; nothing here needs to know it's "the cloud."
//
// Session lifecycle is owned here (not in cloudpollparent) so a transient WS
// drop can be self-healed: the cloud will keep re-emitting `openCloudWS` with
// the same sessionId on every checkin while a viewer is attached, and we use
// each one to (a) refresh TTL, (b) redial if our socket has died.

interface CloudBridge {
    sessionId: string;
    /** WS URL we dialed. Compared on re-entry so a routing change forces a
     *  redial even when sessionId is unchanged. */
    url: string;
    ws: WebSocket;
    /** Live = handshake completed; we don't redial during the dial itself. */
    open: boolean;
    ttlTimer: NodeJS.Timeout;
}
let cloudBridge: CloudBridge | undefined;

function openCloudBridge(
    wsUrl: string,
    proxyWsUrl: string | undefined,
    audioWsUrl: string | undefined,
    sessionId: string,
    ttlSeconds: number,
) {
    if (proxyWsUrl) openCloudProxyBridge(proxyWsUrl, sessionId, ttlSeconds);
    if (audioWsUrl) openCloudAudioBridge(audioWsUrl, sessionId, ttlSeconds);

    if (cloudBridge && cloudBridge.sessionId === sessionId && cloudBridge.url === wsUrl && cloudBridge.open) {
        clearTimeout(cloudBridge.ttlTimer);
        cloudBridge.ttlTimer = setTimeout(() => closeCloudBridge(sessionId), ttlSeconds * 1000);
        return;
    }
    // Same session + dead socket (close fired but cloud still wants the bridge),
    // or different session: tear down any existing bridge and dial.
    if (cloudBridge) {
        clearTimeout(cloudBridge.ttlTimer);
        try {
            cloudBridge.ws.close();
        } catch {
            /* ignore */
        }
        cloudBridge = undefined;
    }
    let ws: WebSocket;
    try {
        ws = new WebSocket(wsUrl);
    } catch (err) {
        console.error('[server-worker] cloud bridge dial failed:', err);
        return;
    }
    const ttlTimer = setTimeout(() => closeCloudBridge(sessionId), ttlSeconds * 1000);
    cloudBridge = { sessionId, url: wsUrl, ws, open: false, ttlTimer };

    ws.on('open', () => {
        if (cloudBridge?.ws === ws) cloudBridge.open = true;
        console.log(`[server-worker] cloud bridge open sessionId=${sessionId.slice(0, 8)}… ttl=${ttlSeconds}s`);
        // Hand the live socket to the broadcaster. From here it's just another
        // Conn — first round dumps a snapshot of every cached key, subsequent
        // updates fan out via the existing set() path. The cloud relay
        // forwards each frame to whatever browser viewer is attached.
        wsBroadcaster.attachClient(ws);
    });
    ws.on('error', (err) => {
        console.error('[server-worker] cloud bridge error:', err);
    });
    ws.on('close', () => {
        if (cloudBridge?.ws === ws) {
            console.log('[server-worker] cloud bridge socket closed');
            clearTimeout(cloudBridge.ttlTimer);
            cloudBridge = undefined;
        }
    });
}

function closeCloudBridge(sessionId?: string) {
    if (!cloudBridge) return;
    if (sessionId !== undefined && cloudBridge.sessionId !== sessionId) return;
    clearTimeout(cloudBridge.ttlTimer);
    try {
        cloudBridge.ws.close();
    } catch {
        /* ignore */
    }
    cloudBridge = undefined;
}

// -- cloud proxy bridge (HTTP-over-WS) ----------------------------------------
// Cloud sends `httpProxyRequest` envelopes; we dispatch via `dispatchHttpProxy`
// and reply with `httpProxyResponse` (single-shot) or `httpProxyChunk` frames.

interface CloudProxyBridge {
    sessionId: string;
    url: string;
    ws: WebSocket;
    open: boolean;
    ttlTimer: NodeJS.Timeout;
}
let cloudProxyBridge: CloudProxyBridge | undefined;

function openCloudProxyBridge(wsUrl: string, sessionId: string, ttlSeconds: number) {
    if (
        cloudProxyBridge &&
        cloudProxyBridge.sessionId === sessionId &&
        cloudProxyBridge.url === wsUrl &&
        cloudProxyBridge.open
    ) {
        clearTimeout(cloudProxyBridge.ttlTimer);
        cloudProxyBridge.ttlTimer = setTimeout(() => closeCloudProxyBridge(sessionId), ttlSeconds * 1000);
        return;
    }
    if (cloudProxyBridge) {
        clearTimeout(cloudProxyBridge.ttlTimer);
        try {
            cloudProxyBridge.ws.close();
        } catch {
            /* ignore */
        }
        cloudProxyBridge = undefined;
    }
    let ws: WebSocket;
    try {
        ws = new WebSocket(wsUrl);
    } catch (err) {
        console.error('[server-worker] cloud proxy bridge dial failed:', err);
        return;
    }
    const ttlTimer = setTimeout(() => closeCloudProxyBridge(sessionId), ttlSeconds * 1000);
    cloudProxyBridge = { sessionId, url: wsUrl, ws, open: false, ttlTimer };

    // Device WebSocket relays for this bridge (cloud wsProxy* envelopes ↔ a
    // real WS to the device). Keyed by the cloud-assigned wsId.
    const deviceWs = new Map<string, WebSocket>();
    const MAX_DEVICE_WS = 8;
    const wsSend = (obj: Record<string, unknown>) => {
        try {
            ws.send(JSON.stringify(obj));
        } catch {
            /* bridge gone; close handler cleans up */
        }
    };
    const closeDeviceWs = (wsId: string, code?: number, reason?: string) => {
        const t = deviceWs.get(wsId);
        if (!t) return;
        deviceWs.delete(wsId);
        try {
            if (code === 1000 || (code !== undefined && code >= 3000 && code <= 4999)) t.close(code, reason);
            else t.close();
        } catch {
            /* already closing */
        }
    };
    /** Wire an outbound socket into the cloud relay under `wsId`. Shared by the
     *  LAN-device path and the loopback `/terminal` path. */
    const relayWs = (wsId: string, t: WebSocket) => {
        deviceWs.set(wsId, t);
        t.on('open', () => wsSend({ type: 'wsProxyOpened', wsId }));
        t.on('message', (data, isBinary) => {
            const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer);
            wsSend({ type: 'wsProxyData', wsId, dataBase64: buf.toString('base64'), binary: isBinary });
        });
        t.on('close', (code, reason) => {
            if (!deviceWs.delete(wsId)) return;
            wsSend({ type: 'wsProxyClose', wsId, code, reason: reason.toString() });
        });
        t.on('error', () => {
            if (deviceWs.delete(wsId)) wsSend({ type: 'wsProxyClose', wsId, reason: 'device socket error' });
            try {
                t.close();
            } catch {
                /* ignore */
            }
        });
    };

    const openDeviceWs = (wsId: string, pathStr: string) => {
        const fail = (reason: string) => wsSend({ type: 'wsProxyClose', wsId, reason });
        if (deviceWs.size >= MAX_DEVICE_WS) return fail('too many device sockets');

        // `/terminal` is us, not a LAN device: loop back to our own server so a
        // cloud viewer lands on exactly the same endpoint, and the same password
        // check, as a LAN viewer. Nothing is relaxed by routing here — every
        // guard that protects the shell lives behind that socket.
        if (pathStr === '/terminal') {
            if (boundWebPort === undefined) return fail('server not listening yet');
            let t: WebSocket;
            try {
                t = new WebSocket(`ws://127.0.0.1:${boundWebPort}/terminal`, { handshakeTimeout: 15_000 });
            } catch (e) {
                return fail(`terminal dial failed: ${(e as Error).message}`);
            }
            return relayWs(wsId, t);
        }

        if (!pathStr.startsWith('/proxy/')) return fail('not a device path');
        const target = parseTargetUrl(pathStr);
        if (!target) return fail('bad target');
        if (!isLanProxyTarget(target.hostname)) return fail('target not on a LAN');
        if (!proxyTargetAllowed(target.hostname)) return fail('network disallowed by policy');
        const wsProto = target.protocol === 'https:' ? 'wss:' : 'ws:';
        let t: WebSocket;
        try {
            t = new WebSocket(`${wsProto}//${target.host}${target.pathname}${target.search}`, {
                rejectUnauthorized: false,
                handshakeTimeout: 15_000,
            });
        } catch (e) {
            return fail(`dial failed: ${(e as Error).message}`);
        }
        relayWs(wsId, t);
    };

    ws.on('open', () => {
        if (cloudProxyBridge?.ws === ws) cloudProxyBridge.open = true;
        console.log(`[server-worker] cloud proxy bridge open sessionId=${sessionId.slice(0, 8)}…`);
    });
    ws.on('message', (raw) => {
        // Errors at any layer become a 500 with the same reqId so the cloud's
        // pending promise resolves instead of timing out.
        let reqId: string | undefined;
        try {
            const msg = JSON.parse(raw.toString()) as {
                type?: string;
                reqId?: string;
                path?: string;
                query?: Record<string, string>;
                method?: string;
                headers?: Record<string, string>;
                bodyBase64?: string;
                wsId?: string;
                dataBase64?: string;
                binary?: boolean;
                code?: number;
                reason?: string;
            };
            if (msg?.type === 'wsProxyOpen' && typeof msg.wsId === 'string') {
                openDeviceWs(msg.wsId, msg.path ?? '');
                return;
            }
            if (msg?.type === 'wsProxyData' && typeof msg.wsId === 'string') {
                const t = deviceWs.get(msg.wsId);
                if (t && t.readyState === WebSocket.OPEN && typeof msg.dataBase64 === 'string') {
                    t.send(Buffer.from(msg.dataBase64, 'base64'), { binary: !!msg.binary });
                }
                return;
            }
            if (msg?.type === 'wsProxyClose' && typeof msg.wsId === 'string') {
                closeDeviceWs(msg.wsId, msg.code, msg.reason);
                return;
            }
            if (msg?.type !== 'httpProxyRequest' || typeof msg.reqId !== 'string') return;
            reqId = msg.reqId;
            void dispatchHttpProxy(msg.path ?? '', msg.query, {
                method: msg.method,
                headers: msg.headers,
                bodyBase64: msg.bodyBase64,
            }).then((res) => {
                sendProxyResponse(ws, reqId!, res);
            });
        } catch (err) {
            console.error('[server-worker] proxy message handling failed:', err);
            if (reqId) {
                try {
                    ws.send(JSON.stringify({ type: 'httpProxyResponse', reqId, status: 500 }));
                } catch {
                    /* ignore */
                }
            }
        }
    });
    ws.on('error', (err) => {
        console.error('[server-worker] cloud proxy bridge error:', err);
    });
    ws.on('close', () => {
        for (const wsId of [...deviceWs.keys()]) closeDeviceWs(wsId);
        if (cloudProxyBridge?.ws === ws) {
            console.log('[server-worker] cloud proxy bridge socket closed');
            clearTimeout(cloudProxyBridge.ttlTimer);
            cloudProxyBridge = undefined;
        }
    });
}

function closeCloudProxyBridge(sessionId?: string) {
    if (!cloudProxyBridge) return;
    if (sessionId !== undefined && cloudProxyBridge.sessionId !== sessionId) return;
    clearTimeout(cloudProxyBridge.ttlTimer);
    try {
        cloudProxyBridge.ws.close();
    } catch {
        /* ignore */
    }
    cloudProxyBridge = undefined;
}

// -- cloud audio bridge (push) ------------------------------------------------
// Push each new audio chunk as a binary WS frame: per-chunk wire format from
// /api/ezp/audio, prefixed with `serverNow` for browser-side clockOffset refinement.

interface CloudAudioBridge {
    sessionId: string;
    url: string;
    ws: WebSocket;
    open: boolean;
    ttlTimer: NodeJS.Timeout;
    /** Interval handle for the chunk-polling pump. Cleared on close. */
    pumpTimer?: NodeJS.Timeout;
    /** Last audio chunk seq we forwarded. Drives `readAfter` on each pump tick. */
    afterSeq: number;
}
let cloudAudioBridge: CloudAudioBridge | undefined;
/** How often the push loop checks for new audio chunks. Chunks are typically
 *  produced every 20–50ms; 20ms gives us at most ~one tick of latency. */
const AUDIO_PUSH_INTERVAL_MS = 20;

function openCloudAudioBridge(wsUrl: string, sessionId: string, ttlSeconds: number) {
    if (
        cloudAudioBridge &&
        cloudAudioBridge.sessionId === sessionId &&
        cloudAudioBridge.url === wsUrl &&
        cloudAudioBridge.open
    ) {
        clearTimeout(cloudAudioBridge.ttlTimer);
        cloudAudioBridge.ttlTimer = setTimeout(() => closeCloudAudioBridge(sessionId), ttlSeconds * 1000);
        return;
    }
    if (cloudAudioBridge) {
        clearTimeout(cloudAudioBridge.ttlTimer);
        if (cloudAudioBridge.pumpTimer) clearInterval(cloudAudioBridge.pumpTimer);
        try {
            cloudAudioBridge.ws.close();
        } catch {
            /* ignore */
        }
        cloudAudioBridge = undefined;
    }
    let ws: WebSocket;
    try {
        ws = new WebSocket(wsUrl);
    } catch (err) {
        console.error('[server-worker] cloud audio bridge dial failed:', err);
        return;
    }
    const ttlTimer = setTimeout(() => closeCloudAudioBridge(sessionId), ttlSeconds * 1000);
    cloudAudioBridge = { sessionId, url: wsUrl, ws, open: false, ttlTimer, afterSeq: 0 };

    ws.on('open', () => {
        if (cloudAudioBridge?.ws !== ws) return;
        cloudAudioBridge.open = true;
        // Start clean — the listener can't replay history anyway; the next
        // chunks we read are what they'll hear first.
        cloudAudioBridge.afterSeq = curAudioRing?.latestSeq ?? 0;
        console.log(`[server-worker] cloud audio bridge open sessionId=${sessionId.slice(0, 8)}…`);

        cloudAudioBridge.pumpTimer = setInterval(() => {
            const slot = cloudAudioBridge;
            if (!slot || !slot.open || !curAudioRing) return;
            const chunks = curAudioRing.readAfter(slot.afterSeq);
            if (chunks.length === 0) return;
            const serverNow = Date.now();
            for (const chunk of chunks) {
                slot.afterSeq = chunk.seq;
                // 8 (serverNow) + 8 (playAt) + 4*5 (incarnation/sampleRate/channels/sampleCount/
                // advanceSamples) + sampleCount*4 (Float32 payload).
                const totalSize = 8 + 8 + 4 + 4 + 4 + 4 + 4 + chunk.samples.length * 4;
                const buf = Buffer.allocUnsafe(totalSize);
                let off = 0;
                buf.writeDoubleLE(serverNow, off);
                off += 8;
                buf.writeDoubleLE(chunk.playAtRealTime, off);
                off += 8;
                buf.writeUInt32LE(chunk.incarnation, off);
                off += 4;
                buf.writeUInt32LE(chunk.sampleRate, off);
                off += 4;
                buf.writeUInt32LE(chunk.channels, off);
                off += 4;
                buf.writeUInt32LE(chunk.samples.length, off);
                off += 4;
                buf.writeUInt32LE(chunk.advanceSamples, off);
                off += 4;
                const src = Buffer.from(chunk.samples.buffer, chunk.samples.byteOffset, chunk.samples.byteLength);
                src.copy(buf, off);
                try {
                    slot.ws.send(buf, { binary: true });
                } catch (err) {
                    console.error('[server-worker] audio bridge send failed:', err);
                    return;
                }
            }
        }, AUDIO_PUSH_INTERVAL_MS);
    });
    ws.on('error', (err) => {
        console.error('[server-worker] cloud audio bridge error:', err);
    });
    ws.on('close', () => {
        if (cloudAudioBridge?.ws === ws) {
            console.log('[server-worker] cloud audio bridge socket closed');
            clearTimeout(cloudAudioBridge.ttlTimer);
            if (cloudAudioBridge.pumpTimer) clearInterval(cloudAudioBridge.pumpTimer);
            cloudAudioBridge = undefined;
        }
    });
}

function closeCloudAudioBridge(sessionId?: string) {
    if (!cloudAudioBridge) return;
    if (sessionId !== undefined && cloudAudioBridge.sessionId !== sessionId) return;
    clearTimeout(cloudAudioBridge.ttlTimer);
    if (cloudAudioBridge.pumpTimer) clearInterval(cloudAudioBridge.pumpTimer);
    try {
        cloudAudioBridge.ws.close();
    } catch {
        /* ignore */
    }
    cloudAudioBridge = undefined;
}

/** Single-shot under PROXY_CHUNK_SIZE; larger bodies stream via httpProxyChunk
 *  frames (last marked `end: true`). */
const PROXY_CHUNK_SIZE = 512 * 1024;

function sendProxyResponse(
    ws: WebSocket,
    reqId: string,
    res: { status: number; headers?: Record<string, string>; body?: Buffer },
): void {
    const body = res.body;
    try {
        if (!body || body.length <= PROXY_CHUNK_SIZE) {
            ws.send(
                JSON.stringify({
                    type: 'httpProxyResponse',
                    reqId,
                    status: res.status,
                    headers: res.headers,
                    bodyBase64: body && body.length > 0 ? body.toString('base64') : undefined,
                }),
            );
            return;
        }
        // Chunked path: status+headers first, then body in PROXY_CHUNK_SIZE pieces.
        ws.send(
            JSON.stringify({
                type: 'httpProxyResponse',
                reqId,
                status: res.status,
                headers: res.headers,
                chunked: true,
            }),
        );
        let seq = 0;
        for (let off = 0; off < body.length; off += PROXY_CHUNK_SIZE) {
            const end = off + PROXY_CHUNK_SIZE >= body.length;
            const slice = body.subarray(off, off + PROXY_CHUNK_SIZE);
            ws.send(
                JSON.stringify({
                    type: 'httpProxyChunk',
                    reqId,
                    seq,
                    bodyBase64: slice.toString('base64'),
                    ...(end ? { end: true } : {}),
                }),
            );
            seq += 1;
        }
    } catch (err) {
        console.error('[server-worker] proxy response send failed:', err);
    }
}

/** Non-GET proxied bodies are chunk-sized by the client (≤1MB); anything
 *  bigger than this is a protocol violation, not a big upload. */
const PROXY_MAX_BODY_BYTES = 2 * 1024 * 1024;

function proxyJson(res: { status: number; body: unknown }): {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
} {
    return {
        status: res.status,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(res.body ?? null), 'utf8'),
    };
}

/** Cloud-side writes: chunked file upload plus the EZP-native sequence
 *  endpoints. Same validation cores as the Koa routes in file-api.ts. */
async function dispatchProxyWrite(
    pathStr: string,
    method: string,
    req: { headers?: Record<string, string>; bodyBase64?: string } | undefined,
): Promise<{ status: number; headers?: Record<string, string>; body?: Buffer }> {
    const showFolder = wsBroadcaster.get('showFolder') as string | undefined;
    const body = req?.bodyBase64 ? Buffer.from(req.bodyBase64, 'base64') : Buffer.alloc(0);
    if (body.length > PROXY_MAX_BODY_BYTES) return { status: 413 };

    if (method === 'PATCH') {
        const m = pathStr.match(/^\/api\/file\/([^/?]+)$/);
        if (!m) return { status: 404 };
        return proxyJson(await chunkUploadCore(showFolder, decodeURIComponent(m[1]), req?.headers ?? {}, body));
    }

    if (method === 'POST') {
        let parsed: unknown;
        try {
            parsed = body.length > 0 ? JSON.parse(body.toString('utf8')) : undefined;
        } catch {
            return { status: 400 };
        }
        if (pathStr === '/api/ezp/sequences') {
            const deps: FileApiDeps = {
                getShowFolder: () => showFolder,
                getSequences: () => wsBroadcaster.get('sequences') as SequenceRecord[] | undefined,
                putSequences: async (recs) => await rpc.call('putSequences', recs),
            };
            return proxyJson(await putSequencesCore(deps, parsed));
        }
        if (pathStr === '/api/ezp/sequences/autodetect') {
            return proxyJson(await autodetectSequenceCore(showFolder, (parsed as any)?.fseq));
        }
        if (pathStr === '/api/ezp/sequences/audio-metadata') {
            return proxyJson(await audioMetadataCore(showFolder, (parsed as any)?.audio));
        }
    }
    return { status: 404 };
}

/** Response-size cap for device pages bridged over the WS proxy. Controller
 *  web UIs are small; anything bigger is a misdirected request. */
const DEVICE_PROXY_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Per-network policy check for proxy targets: an IP inside a CIDR whose
 *  persisted policy says `allow: false` is refused. Policies ride the broadcast
 *  `controllerops` state; non-IP hostnames (`.local`) pass — policy is CIDR-based. */
function proxyTargetAllowed(hostname: string): boolean {
    const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return true;
    const ops = wsBroadcaster.get('controllerops') as
        | { networkPolicies?: { cidr: string; allow?: boolean }[] }
        | undefined;
    const policies = ops?.networkPolicies;
    if (!policies?.length) return true;
    const ipNum = hostname.split('.').reduce((a, o) => ((a << 8) + (Number(o) & 0xff)) >>> 0, 0);
    let verdict = true;
    let bestBits = -1;
    for (const p of policies) {
        const pm = p.cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
        if (!pm) continue;
        const bits = Number(pm[2]);
        const net = pm[1].split('.').reduce((a, o) => ((a << 8) + (Number(o) & 0xff)) >>> 0, 0);
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if ((ipNum & mask) === (net & mask) && bits > bestBits) {
            bestBits = bits;
            verdict = p.allow !== false;
        }
    }
    return verdict;
}

/** Bridge a `/proxy/<target>/…` request to a LAN device — the cloud analogue of
 *  the Koa `createProxyMiddleware` route. Targets are limited to LAN addresses
 *  (isLanProxyTarget) so the player token cannot open-proxy the internet; nested
 *  FPP hops (`/proxy/<fpp>/proxy/<ip>/…`) terminate one hop at a time. */
async function dispatchDeviceProxy(
    pathStr: string,
    query: Record<string, string> | undefined,
    req?: { method?: string; headers?: Record<string, string>; bodyBase64?: string },
): Promise<{ status: number; headers?: Record<string, string>; body?: Buffer }> {
    const qs = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : '';
    const target = parseTargetUrl(pathStr + qs);
    if (!target) return { status: 400 };
    if (!isLanProxyTarget(target.hostname)) return { status: 403 };
    if (!proxyTargetAllowed(target.hostname)) return { status: 403 };

    const method = (req?.method ?? 'GET').toUpperCase();
    const body = req?.bodyBase64 ? Buffer.from(req.bodyBase64, 'base64') : undefined;
    if (body && body.length > PROXY_MAX_BODY_BYTES) return { status: 413 };

    const transport = target.protocol === 'https:' ? httpsMod : httpMod;
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req?.headers ?? {})) {
        const lower = k.toLowerCase();
        if (lower === 'host' || lower === 'connection' || lower === 'transfer-encoding' || lower === 'upgrade') continue;
        outHeaders[k] = v;
    }
    outHeaders['host'] = target.host;

    return new Promise((resolve) => {
        const proxyReq = transport.request(
            {
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.pathname + target.search,
                method,
                headers: outHeaders,
                timeout: 30_000,
                rejectUnauthorized: false,
            },
            (proxyRes) => {
                const chunks: Buffer[] = [];
                let size = 0;
                let aborted = false;
                proxyRes.on('data', (c: Buffer) => {
                    size += c.length;
                    if (size > DEVICE_PROXY_MAX_RESPONSE_BYTES) {
                        aborted = true;
                        proxyReq.destroy();
                        resolve({ status: 502 });
                        return;
                    }
                    chunks.push(c);
                });
                proxyRes.on('end', () => {
                    if (aborted) return;
                    const headers: Record<string, string> = {};
                    for (const [k, v] of Object.entries(proxyRes.headers)) {
                        if (v === undefined) continue;
                        const lower = k.toLowerCase();
                        if (lower === 'connection' || lower === 'transfer-encoding' || lower === 'keep-alive') continue;
                        headers[k] = Array.isArray(v) ? v.join(', ') : v;
                    }
                    resolve({ status: proxyRes.statusCode ?? 502, headers, body: Buffer.concat(chunks) });
                });
                proxyRes.on('error', () => {
                    if (!aborted) resolve({ status: 502 });
                });
            },
        );
        proxyReq.on('timeout', () => {
            proxyReq.destroy();
            resolve({ status: 504 });
        });
        proxyReq.on('error', () => resolve({ status: 502 }));
        if (body) proxyReq.write(body);
        proxyReq.end();
    });
}

/** Dispatch HTTP-over-WS proxy requests; mirrors the Koa route per path. */
async function dispatchHttpProxy(
    pathStr: string,
    query: Record<string, string> | undefined,
    req?: { method?: string; headers?: Record<string, string>; bodyBase64?: string },
): Promise<{ status: number; headers?: Record<string, string>; body?: Buffer }> {
    const method = (req?.method ?? 'GET').toUpperCase();
    // Device web-UI bridge — must run before the method split so device POSTs
    // (login forms, config writes) work too.
    if (pathStr.startsWith('/proxy/')) return dispatchDeviceProxy(pathStr, query, req);
    if (method !== 'GET') return dispatchProxyWrite(pathStr, method, req);

    // GET /api/files/:dirName — show-folder name listing for the cloud file
    // picker (FPP-shaped path, so match it before the legacy-alias rewrite).
    const filesMatch = pathStr.match(/^\/api\/files\/([^/?]+)$/);
    if (filesMatch) {
        const showFolder = wsBroadcaster.get('showFolder') as string | undefined;
        return proxyJson(await listFileNamesCore(showFolder, decodeURIComponent(filesMatch[1])));
    }

    // Cloud endpoints deployed before the /api/ezp move still forward bare
    // /api/* read paths; accept both until that fleet is updated.
    if (!pathStr.startsWith('/api/ezp/') && pathStr.startsWith('/api/')) {
        pathStr = '/api/ezp/' + pathStr.slice('/api/'.length);
    }

    // /api/ezp/getimage — id in path or query. Query form is preferred for cloud
    // because some hosting providers' edge proxies reject `%7C` (composite-id
    // pipe) in URL paths.
    const getimagePath = pathStr.match(/^\/api\/ezp\/getimage\/([^/?]+)$/);
    const getimageQuery = pathStr === '/api/ezp/getimage' ? query?.id : undefined;
    if (getimagePath || getimageQuery) {
        const raw = getimagePath ? getimagePath[1] : getimageQuery!;
        const sequenceId = decodeURIComponent(raw);
        const sanitized = sequenceId.replace(/[^a-zA-Z0-9\-_|]/g, '');
        if (sanitized !== sequenceId) return { status: 400 };
        const file = getSequenceThumbnailLocal(sequenceId);
        if (!file) return { status: 404 };
        try {
            const buf = await fsp.readFile(file);
            return {
                status: 200,
                headers: { 'content-type': inferMimeType(file) },
                body: buf,
            };
        } catch (err) {
            console.error('[server-worker] proxy getimage read failed:', err);
            return { status: 500 };
        }
    }

    // Layout caches — read directly from the module-level vars the Koa
    // routes also serve. JSON-stringified and returned as a Buffer for
    // uniform chunking behavior on the wire.
    if (pathStr === '/api/ezp/model-coordinates') return jsonResult(cachedModelCoordinates3D);
    if (pathStr === '/api/ezp/model-coordinates-2d') return jsonResult(cachedModelCoordinates2D);
    if (pathStr === '/api/ezp/view-objects') return jsonResult(cachedViewObjects);
    if (pathStr === '/api/ezp/layout-settings') return jsonResult(cachedLayoutSettings);
    if (pathStr === '/api/ezp/moving-heads') return jsonResult(cachedMovingHeads);

    // /api/ezp/show-file?path=… — OBJ/MTL/textures for the 3D viewer.
    // Same validation as the Koa route; deviations would create a path the
    // LAN-only consumer can hit but cloud can't (or vice versa).
    if (pathStr === '/api/ezp/show-file') {
        return dispatchShowFile(query?.path);
    }

    // /api/ezp/frames-zstd — live channel-data frames, zstd-compressed. Owner-
    // only diagnostic over WAN; the LAN path serves uncompressed frames too
    // but for WAN the bandwidth saving is meaningful. Mirrors the Koa route's
    // wire format: [frameSize u32 LE][seq u32 LE][zstd payload].
    if (pathStr === '/api/ezp/frames-zstd') {
        return dispatchFramesZstd();
    }

    // /api/ezp/audio?afterSeq=N — incremental audio chunks for the WAN-side
    // browser. Mirrors the Koa route's binary chunk-pack wire format; the
    // browser uses `useAudioStream` to schedule via Web Audio with drift
    // correction against the player's clock (sync'd via /api/ezp/time).
    if (pathStr === '/api/ezp/audio') {
        const afterSeq = parseInt(query?.afterSeq ?? '0', 10) || 0;
        return dispatchAudio(afterSeq);
    }

    // /api/ezp/time — server-clock sample for client RTT/offset estimation.
    if (pathStr === '/api/ezp/time') {
        return jsonResult({ now: Date.now() });
    }

    return { status: 404 };
}

function dispatchAudio(afterSeq: number): { status: number; headers?: Record<string, string>; body?: Buffer } {
    if (!curAudioRing) return { status: 204 };
    const chunks = curAudioRing.readAfter(afterSeq);
    if (chunks.length === 0) return { status: 204 };

    // Wire format mirrors the LAN Koa route: 8-byte header (chunkCount,
    // latestSeq) then per-chunk metadata + Float32 samples.
    let totalSize = 8;
    for (const chunk of chunks) {
        totalSize += 8 + 4 + 4 + 4 + 4 + 4 + chunk.samples.length * 4;
    }
    const buf = Buffer.allocUnsafe(totalSize);
    let off = 0;
    buf.writeUInt32LE(chunks.length, off);
    off += 4;
    buf.writeUInt32LE(chunks[chunks.length - 1].seq, off);
    off += 4;
    for (const chunk of chunks) {
        buf.writeDoubleLE(chunk.playAtRealTime, off);
        off += 8;
        buf.writeUInt32LE(chunk.incarnation, off);
        off += 4;
        buf.writeUInt32LE(chunk.sampleRate, off);
        off += 4;
        buf.writeUInt32LE(chunk.channels, off);
        off += 4;
        buf.writeUInt32LE(chunk.samples.length, off);
        off += 4;
        buf.writeUInt32LE(chunk.advanceSamples, off);
        off += 4;
        const src = Buffer.from(chunk.samples.buffer, chunk.samples.byteOffset, chunk.samples.byteLength);
        src.copy(buf, off);
        off += chunk.samples.byteLength;
    }
    return {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: buf,
    };
}

function dispatchFramesZstd(): { status: number; headers?: Record<string, string>; body?: Buffer } {
    if (!curFrameBuffer) return { status: 204 };
    if (!zstdSimple) return { status: 503 };
    const frameReader = new LatestFrameRingBuffer({
        buffer: curFrameBuffer,
        frameSize: 0,
        slotCount: 0,
        isWriter: false,
    });
    const result = frameReader.tryReadLatest();
    if (!result) return { status: 204 };
    if (!result.bytes) return { status: 500 };
    const compressed = zstdSimple.compress(result.bytes, 1) as Uint8Array;
    const totalSize = 8 + compressed.byteLength;
    const buf = Buffer.allocUnsafe(totalSize);
    buf.writeUInt32LE(result.frameSizeBytes, 0);
    buf.writeUInt32LE(result.seq, 4);
    buf.set(compressed, 8);
    return {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: buf,
    };
}

function jsonResult(value: unknown): { status: number; headers: Record<string, string>; body: Buffer } {
    return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(value ?? null), 'utf8'),
    };
}

async function dispatchShowFile(
    filePath: string | undefined,
): Promise<{ status: number; headers?: Record<string, string>; body?: Buffer }> {
    const showFolder = wsBroadcaster.get('showFolder') as string | undefined;
    if (!showFolder) return { status: 400 };
    if (!filePath) return { status: 400 };
    if (path.isAbsolute(filePath) || /^[a-zA-Z]:[\\/]/.test(filePath)) return { status: 400 };
    const segments = filePath.replace(/\\/g, '/').split('/');
    if (segments.some((s) => s === '..')) return { status: 403 };
    const allowedExt = new Set(['.obj', '.mtl', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga', '.dds']);
    const ext = path.extname(filePath).toLowerCase();
    if (!allowedExt.has(ext)) return { status: 403 };
    try {
        const resolvedShowFolder = path.resolve(showFolder);
        const resolvedPath = path.resolve(resolvedShowFolder, filePath);
        const inFolder =
            resolvedPath.toLowerCase().startsWith(resolvedShowFolder.toLowerCase() + path.sep) ||
            resolvedPath.toLowerCase() === resolvedShowFolder.toLowerCase();
        if (!inFolder) return { status: 403 };
        if (!(await exists(resolvedPath))) return { status: 404 };
        const buf = await fsp.readFile(resolvedPath);
        return {
            status: 200,
            headers: { 'content-type': inferMimeType(resolvedPath) },
            body: buf,
        };
    } catch (err) {
        console.error('[server-worker] proxy show-file read failed:', err);
        return { status: 500 };
    }
}

/** Bind `server` to `preferredPort`; on EADDRINUSE, walk up to
 *  `preferredPort + maxAttempts - 1`. Reports actual bound port. The Server
 *  instance is reusable after a failed listen — we don't recreate it. */
async function listenWithFallback(
    server: ReturnType<typeof createServer>,
    preferredPort: number,
    maxAttempts: number,
    label: string,
): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = preferredPort + i;
        try {
            await new Promise<void>((resolve, reject) => {
                const onError = (err: NodeJS.ErrnoException) => {
                    server.removeListener('listening', onListening);
                    reject(err);
                };
                const onListening = () => {
                    server.removeListener('error', onError);
                    resolve();
                };
                server.once('error', onError);
                server.once('listening', onListening);
                server.listen(candidate);
            });
            if (candidate !== preferredPort) {
                console.warn(
                    `[server-worker] ${label}: preferred port ${preferredPort} unavailable, bound ${candidate}`,
                );
            }
            return candidate;
        } catch (err) {
            const e = err as NodeJS.ErrnoException;
            if (e.code !== 'EADDRINUSE') throw e;
        }
    }
    throw new Error(`[server-worker] ${label}: no free port in ${preferredPort}..${preferredPort + maxAttempts - 1}`);
}

async function startServer(config: ServerWorkerData) {
    const { port, portSource, kioskPort, kioskPortSource } = config;

    // Initialize ZSTD codec for frame compression (non-blocking, best-effort)
    try {
        ZstdCodec.run((zstd) => {
            zstdSimple = new zstd.Simple();
            console.log('[server-worker] ZSTD codec initialized');
        });
    } catch (err) {
        console.warn('[server-worker] ZSTD codec failed to initialize, /api/ezp/frames-zstd will be unavailable:', err);
    }

    console.log(`[server-worker] Starting Koa web server on port ${port} (source: ${portSource})`);
    const router = new Router();
    const webApp = new Koa();

    // Proxy middleware must be before bodyParser so it can stream raw request bodies
    webApp.use(createProxyRefererRescue());
    webApp.use(createProxyMiddleware(proxyTargetAllowed));

    // File-transfer routes stream raw bodies, so they also sit before jsonBody().
    // Deliberately NOT mounted on the kiosk app: the public jukebox port gets no
    // file upload/download/delete surface.
    const fileApiDeps: FileApiDeps = {
        getShowFolder: () => wsBroadcaster.get('showFolder') as string | undefined,
        getSequences: () => wsBroadcaster.get('sequences') as SequenceRecord[] | undefined,
        putSequences: async (recs) => await rpc.call('putSequences', recs),
    };
    const fileApiRouter = createFileApiRouter(fileApiDeps);
    webApp.use(fileApiRouter.routes());
    webApp.use(fileApiRouter.allowedMethods());

    // Add body parser middleware for JSON requests
    webApp.use(jsonBody());

    // EZP-native sequence registration/autodetect (JSON bodies, shared router).
    registerSequenceApiRoutes(router, fileApiDeps);

    // FPP-compat surface (status/info/version/commands/volume) — same paths a
    // real FPP serves, translated onto the cached state + command bridge.
    registerFppCompatRoutes(router, {
        getShowFolder: () => wsBroadcaster.get('showFolder') as string | undefined,
        getPStatus: () => wsBroadcaster.get('pStatus') as PlayerPStatusContent | undefined,
        getSequences: () => wsBroadcaster.get('sequences') as SequenceRecord[] | undefined,
        getPlaylists: () => wsBroadcaster.get('playlists') as PlaylistRecord[] | undefined,
        getSchedule: () => wsBroadcaster.get('schedule') as ScheduledPlaylist[] | undefined,
        sendPlayerCommand: async (cmd) => {
            await rpc.call('sendPlayerCommand', cmd);
        },
        updatePlaylists: async (recs) => await rpc.call('updatePlaylistsHandler', recs),
        updateSchedule: async (recs) => await rpc.call('updateScheduleHandler', recs),
        putSequences: async (recs) => await rpc.call('putSequences', recs),
        getControllerOps: () => wsBroadcaster.get('controllerops') as ControllerOpsState | undefined,
        appVersion: config.appVersion ?? '0.0.0',
    });

    // ----------------------------------------------
    // API: GET /api/ezp/getimage?id=… (preferred) or /api/ezp/getimage/:sequenceId
    // (legacy). Cloud-sourced ids are `<user>|<vseq>`; some hosting edges
    // reject `%7C` in URL paths, so the preferred caller-side form is the
    // query-string variant. Both shapes are accepted so a new browser
    // bundle against an old player still resolves, and vice versa.
    // ----------------------------------------------
    const serveGetImage = async (ctx: any, sequenceId: string | undefined) => {
        if (!sequenceId) {
            ctx.status = 400;
            ctx.body = { error: 'Sequence ID is required' };
            return;
        }

        // Sanitize sequence ID to prevent path traversal. The id is only used
        // as a cache key — the actual file path is read from the cached
        // SequenceRecord, not constructed from the id — so the rule just has
        // to keep `/`, `\`, and `.` out.
        const sanitizedId = sequenceId.replace(/[^a-zA-Z0-9\-_|]/g, '');
        if (sanitizedId !== sequenceId) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid sequence ID' };
            return;
        }

        try {
            const seqfile = getSequenceThumbnailLocal(sequenceId);

            if (!seqfile) {
                ctx.status = 404;
                ctx.body = { error: 'Image not found for sequence ID' };
                return;
            }

            ctx.type = inferMimeType(seqfile);
            await send(ctx, path.basename(seqfile), { root: path.dirname(seqfile) });
        } catch (error) {
            console.error('[server-worker] Error getting sequence thumbnail:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    };

    router.get('/api/ezp/getimage', async (ctx) => {
        await serveGetImage(ctx, ctx.query.id as string | undefined);
    });
    router.get('/api/ezp/getimage/:sequenceId', async (ctx) => {
        await serveGetImage(ctx, ctx.params.sequenceId);
    });

    // ----------------------------------------------
    // API: GET /api/ezp/hello
    // ----------------------------------------------
    router.get('/api/ezp/hello', async (ctx) => {
        ctx.body = { message: 'Hello from Koa + Electron!' };
    });

    // ----------------------------------------------
    // API: POST /api/ezp/shell/reload — LOOPBACK ONLY
    //
    // The `EZPlayer shell` CLI calls this after changing the password so a
    // running player picks it up without a restart. It must never be reachable
    // from the LAN or the cloud: being able to call it is not itself dangerous
    // (it only re-reads a file), but "who may arm the shell" is the whole
    // security model, so we keep the surface to callers who are already on the
    // box. Note this route is deliberately absent from `dispatchHttpProxy`,
    // which is what the cloud bridge can reach.
    // ----------------------------------------------
    router.post('/api/ezp/shell/reload', async (ctx) => {
        const remote = ctx.socket.remoteAddress ?? '';
        if (!isLoopbackAddress(remote)) {
            ctx.status = 403;
            ctx.body = { error: 'this endpoint is loopback-only' };
            return;
        }
        const enabled = await rpc.call('shellReloadConfig');
        // Revoking should take effect on sessions already in flight, not just
        // on the next login.
        if (!enabled) closeActiveTerminal('the remote shell was disabled');
        ctx.body = { shellAvailable: enabled };
    });

    // ----------------------------------------------
    // API: GET /api/ezp/current-show (local cache read)
    // ----------------------------------------------
    router.get('/api/ezp/current-show', async (ctx) => {
        ctx.body = {
            showFolder: wsBroadcaster.get('showFolder'),
            sequences: wsBroadcaster.get('sequences') ?? [],
            playlists: wsBroadcaster.get('playlists') ?? [],
            schedule: wsBroadcaster.get('schedule') ?? [],
            pStatus: wsBroadcaster.get('pStatus'),
            cStatus: wsBroadcaster.get('cStatus'),
            nStatus: wsBroadcaster.get('nStatus'),
        };
    });

    // ----------------------------------------------
    // API: GET /api/ezp/debug-show-folder - diagnostic endpoint
    // ----------------------------------------------
    router.get('/api/ezp/debug-show-folder', async (ctx) => {
        const showFolder = wsBroadcaster.get('showFolder');
        const state = wsBroadcaster.getState();
        ctx.body = {
            showFolder,
            hasShowFolder: !!showFolder,
            allStateKeys: Object.keys(state),
            state: state,
        };
    });

    // ----------------------------------------------
    // API: POST /api/ezp/player-command
    // ----------------------------------------------
    router.post('/api/ezp/player-command', async (ctx) => {
        try {
            const command = ctx.request.body as EZPlayerCommand;
            if (!command || !command.command) {
                ctx.status = 400;
                ctx.body = { error: 'Invalid command format' };
                return;
            }
            await rpc.call('sendPlayerCommand', command);
            ctx.body = { success: true, message: 'Command sent' };
        } catch (error) {
            console.error('[server-worker] Error processing player command:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    });

    // ----------------------------------------------
    // API: POST /api/playlists
    // ----------------------------------------------
    router.post('/api/ezp/playlists', async (ctx) => {
        try {
            const playlists = ctx.request.body;
            if (!Array.isArray(playlists)) {
                ctx.status = 400;
                ctx.body = { error: 'Invalid playlists format. Expected array.' };
                return;
            }
            const result = await rpc.call('updatePlaylistsHandler', playlists);
            ctx.body = { success: true, playlists: result };
        } catch (error) {
            console.error('[server-worker] Error processing playlists update:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    });

    // ----------------------------------------------
    // API: POST /api/schedules
    // ----------------------------------------------
    router.post('/api/ezp/schedules', async (ctx) => {
        try {
            const schedules = ctx.request.body;
            if (!Array.isArray(schedules)) {
                ctx.status = 400;
                ctx.body = { error: 'Invalid schedules format. Expected array.' };
                return;
            }
            const result = await rpc.call('updateScheduleHandler', schedules);
            ctx.body = { success: true, schedules: result };
        } catch (error) {
            console.error('[server-worker] Error processing schedules update:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    });

    // ----------------------------------------------
    // API: POST /api/ezp/playback-settings
    // ----------------------------------------------
    router.post('/api/ezp/playback-settings', async (ctx) => {
        try {
            const settings = ctx.request.body;
            if (!settings || typeof settings !== 'object') {
                ctx.status = 400;
                ctx.body = { error: 'Invalid playback settings format. Expected object.' };
                return;
            }
            const showFolder = wsBroadcaster.get('showFolder');
            if (showFolder) {
                const settingsPath = path.join(showFolder, '.ezplayer', 'playbackSettings.json');
                await rpc.call('applySettingsFromRenderer', settingsPath, settings);
            }
            await rpc.call('sendPlaybackSettings', settings);
            wsBroadcaster.set('playbackSettings', settings as PlaybackSettings);

            ctx.body = { success: true };
        } catch (error) {
            console.error('[server-worker] Error processing playback settings update:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    });

    // ----------------------------------------------
    // API: GET /api/ezp/model-coordinates - get model coordinates for 3D preview (local cache)
    // ----------------------------------------------
    router.get('/api/ezp/model-coordinates', async (ctx) => {
        ctx.body = cachedModelCoordinates3D;
    });

    // ----------------------------------------------
    // API: GET /api/ezp/model-coordinates-2d - get 2D model coordinates for 2D preview (local cache)
    // ----------------------------------------------
    router.get('/api/ezp/model-coordinates-2d', async (ctx) => {
        ctx.body = cachedModelCoordinates2D;
    });

    // ----------------------------------------------
    // API: GET /api/ezp/view-objects - get view objects (meshes) from XML (local cache)
    // ----------------------------------------------
    router.get('/api/ezp/view-objects', async (ctx) => {
        ctx.body = cachedViewObjects;
    });

    // ----------------------------------------------
    // API: GET /api/ezp/layout-settings - get layout settings (background image, preview size) from XML
    // ----------------------------------------------
    router.get('/api/ezp/layout-settings', async (ctx) => {
        ctx.body = cachedLayoutSettings;
    });

    // ----------------------------------------------
    // API: GET /api/ezp/moving-heads - get DMX moving head fixture definitions from XML
    // ----------------------------------------------
    router.get('/api/ezp/moving-heads', async (ctx) => {
        ctx.body = cachedMovingHeads;
    });

    // ----------------------------------------------
    // API: GET /api/ezp/show-file - serve files for OBJ/MTL/textures used by 3D viewer
    // Only accepts show-folder-relative paths (no absolute paths).
    // ----------------------------------------------
    router.get('/api/ezp/show-file', async (ctx) => {
        const filePath = ctx.query.path as string;
        const showFolder = wsBroadcaster.get('showFolder') as string | undefined;

        if (!showFolder) {
            ctx.status = 400;
            ctx.body = { error: 'Show folder not set' };
            return;
        }

        if (!filePath) {
            ctx.status = 400;
            ctx.body = { error: 'File path is required' };
            return;
        }

        // Reject absolute paths (drive letters or leading slash)
        if (path.isAbsolute(filePath) || /^[a-zA-Z]:[\\/]/.test(filePath)) {
            ctx.status = 400;
            ctx.body = { error: 'Absolute paths are not allowed — use show-folder-relative paths' };
            return;
        }

        // Reject path-traversal attempts
        const segments = filePath.replace(/\\/g, '/').split('/');
        if (segments.some((s) => s === '..')) {
            ctx.status = 403;
            ctx.body = { error: 'Path traversal not allowed' };
            return;
        }

        // Security: only serve a limited set of file types used by the 3D viewer.
        const allowedExt = new Set(['.obj', '.mtl', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga', '.dds']);
        const ext = path.extname(filePath).toLowerCase();
        if (!allowedExt.has(ext)) {
            ctx.status = 403;
            ctx.body = { error: `File type not allowed: ${ext || '<none>'}` };
            return;
        }

        try {
            const resolvedShowFolder = path.resolve(showFolder);
            const resolvedPath = path.resolve(resolvedShowFolder, filePath);

            // Defense-in-depth: verify resolved path is still within show folder
            if (
                !resolvedPath.toLowerCase().startsWith(resolvedShowFolder.toLowerCase() + path.sep) &&
                resolvedPath.toLowerCase() !== resolvedShowFolder.toLowerCase()
            ) {
                ctx.status = 403;
                ctx.body = { error: 'Resolved path outside show folder' };
                return;
            }

            if (!(await exists(resolvedPath))) {
                ctx.status = 404;
                ctx.body = { error: 'File not found' };
                return;
            }

            ctx.type = inferMimeType(resolvedPath);
            await send(ctx, path.basename(resolvedPath), { root: path.dirname(resolvedPath) });
        } catch (error) {
            console.error('[server-worker] Error serving show file:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    });

    // ----------------------------------------------
    // API: GET /api/ezp/frames - binary frame data for 3D viewer
    // ----------------------------------------------
    const frameBufferPool = new BufferPool();

    router.get('/api/ezp/frames', async (ctx) => {
        // CORS headers for Electron renderer (file:// origin)
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

        // No buffer available yet
        if (!curFrameBuffer) {
            ctx.status = 204;
            return;
        }

        // Recreate reader, for now
        const frameReader = new LatestFrameRingBuffer({
            buffer: curFrameBuffer,
            frameSize: 0, // Will be read from header
            slotCount: 0, // Will be read from header
            isWriter: false,
        });

        // Read latest frame
        const result = frameReader?.tryReadLatest();
        if (!result) {
            ctx.status = 204;
            return;
        }

        if (!result.bytes) {
            console.error('[server-worker] WFT HAPPENED TO THE ADTA BYTES');
            ctx.status = 500;
            return;
        }

        // Get a recycled buffer for header + frame data
        const totalSize = 8 + result.frameSizeBytes;
        const responseBuffer = frameBufferPool.get(totalSize);

        // Write header: frameSize (uint32 LE) + seq (uint32 LE)
        responseBuffer.writeUInt32LE(result.frameSizeBytes, 0);
        responseBuffer.writeUInt32LE(result.seq, 4);

        // Copy frame data from SharedArrayBuffer into response buffer
        responseBuffer.set(result.bytes, 8);

        // Release buffer back to pool when response finishes
        ctx.res.on('finish', () => {
            frameBufferPool.release(responseBuffer);
        });

        ctx.set('Cache-Control', 'no-store');
        ctx.type = 'application/octet-stream';
        // Use subarray to return only the used portion (pool may give larger buffer)
        ctx.body = responseBuffer.subarray(0, totalSize);
    });

    // ----------------------------------------------
    // API: GET /api/ezp/frames-zstd - ZSTD-compressed binary frame data for 3D viewer
    // Wire format: [frameSize u32 LE][seq u32 LE][zstd-compressed frame bytes]
    // ----------------------------------------------
    router.get('/api/ezp/frames-zstd', async (ctx) => {
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

        if (!curFrameBuffer) {
            ctx.status = 204;
            return;
        }

        // Fall back to uncompressed if codec not yet initialized
        if (!zstdSimple) {
            ctx.status = 503;
            ctx.body = 'ZSTD codec not yet initialized';
            return;
        }

        const frameReader = new LatestFrameRingBuffer({
            buffer: curFrameBuffer,
            frameSize: 0,
            slotCount: 0,
            isWriter: false,
        });

        const result = frameReader?.tryReadLatest();
        if (!result) {
            ctx.status = 204;
            return;
        }

        if (!result.bytes) {
            ctx.status = 500;
            return;
        }

        // Compress frame data at level 1 (fastest)
        const compressed = zstdSimple.compress(result.bytes, 1) as Uint8Array;

        // Build response: 8-byte header (uncompressed frameSize + seq) + compressed payload
        const totalSize = 8 + compressed.byteLength;
        const responseBuffer = frameBufferPool.get(totalSize);

        // Write header: frameSize (uint32 LE) = uncompressed size, seq (uint32 LE)
        responseBuffer.writeUInt32LE(result.frameSizeBytes, 0);
        responseBuffer.writeUInt32LE(result.seq, 4);

        // Copy compressed data after header
        responseBuffer.set(compressed, 8);

        ctx.res.on('finish', () => {
            frameBufferPool.release(responseBuffer);
        });

        ctx.set('Cache-Control', 'no-store');
        ctx.type = 'application/octet-stream';
        ctx.body = responseBuffer.subarray(0, totalSize);
    });

    // ----------------------------------------------
    // API: GET /api/ezp/time - server Date.now() for client clock-offset estimation
    // Client measures RTT and computes offset = serverTime - clientTime + RTT/2
    // ----------------------------------------------
    router.get('/api/ezp/time', async (ctx) => {
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        ctx.set('Cache-Control', 'no-store');
        ctx.body = { now: Date.now() };
    });

    // ----------------------------------------------
    // API: GET /api/ezp/audio?afterSeq=N - binary audio chunk data for web client
    // Wire format: [u32 chunkCount][u32 latestSeq]
    //   per chunk: [f64 playAtRealTime][u32 incarnation][u32 sampleRate]
    //              [u32 channels][u32 sampleCount][u32 advanceSamples][Float32 × sampleCount]
    // ----------------------------------------------
    router.get('/api/ezp/audio', async (ctx) => {
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

        if (!curAudioRing) {
            ctx.status = 204;
            return;
        }

        const afterSeq = parseInt(ctx.query.afterSeq as string) || 0;
        const chunks = curAudioRing.readAfter(afterSeq);

        if (chunks.length === 0) {
            ctx.status = 204;
            return;
        }

        // Calculate total response size
        // Header: 4 (chunkCount) + 4 (latestSeq) = 8 bytes
        // Per chunk: 8 (playAtRealTime f64) + 4 (incarnation) + 4 (sampleRate)
        //          + 4 (channels) + 4 (sampleCount) + 4 (advanceSamples) + sampleCount*4 (Float32 data)
        let totalSize = 8;
        for (const chunk of chunks) {
            totalSize += 8 + 4 + 4 + 4 + 4 + 4 + chunk.samples.length * 4;
        }

        const buf = Buffer.allocUnsafe(totalSize);
        let offset = 0;

        // Write header
        buf.writeUInt32LE(chunks.length, offset);
        offset += 4;
        buf.writeUInt32LE(chunks[chunks.length - 1].seq, offset);
        offset += 4;

        // Write each chunk
        for (const chunk of chunks) {
            buf.writeDoubleLE(chunk.playAtRealTime, offset);
            offset += 8;
            buf.writeUInt32LE(chunk.incarnation, offset);
            offset += 4;
            buf.writeUInt32LE(chunk.sampleRate, offset);
            offset += 4;
            buf.writeUInt32LE(chunk.channels, offset);
            offset += 4;
            buf.writeUInt32LE(chunk.samples.length, offset);
            offset += 4;
            buf.writeUInt32LE(chunk.advanceSamples, offset);
            offset += 4;

            // Copy Float32 audio data from SAB view into response buffer
            const src = Buffer.from(chunk.samples.buffer, chunk.samples.byteOffset, chunk.samples.byteLength);
            src.copy(buf, offset);
            offset += chunk.samples.byteLength;
        }

        ctx.set('Cache-Control', 'no-store');
        ctx.type = 'application/octet-stream';
        ctx.body = buf;
    });

    webApp.use(router.routes());
    webApp.use(router.allowedMethods());

    // Scan + controllers APIs (and FPP-compat GET /api/proxies) — their OWN
    // router, mounted on the web app ONLY, never the kiosk: scans probe the
    // LAN, controller commands mutate state/devices, and /api/proxies pairs
    // with the web-only /proxy/ bridge.
    const scanRouter = new Router();
    const controllerCommandRpc = (command: Parameters<ServerWorkerRPCAPI['controllerCommand']>[0], origin: Parameters<ServerWorkerRPCAPI['controllerCommand']>[1]) =>
        rpc.call('controllerCommand', command, origin);
    registerScanApiRoutes(scanRouter, {
        controllerCommand: controllerCommandRpc,
    });
    registerControllersApiRoutes(scanRouter, {
        controllerCommand: controllerCommandRpc,
        // State reads come from the worker's cached `controllerops` broadcast.
        getControllerOpsState: () =>
            (wsBroadcaster.get('controllerops') as ControllerOpsState | undefined) ?? {
                interfaces: [],
                devices: {},
                operations: {},
                known: [],
                networkPolicies: [],
            },
        isIpAllowed: proxyTargetAllowed,
    });
    webApp.use(scanRouter.routes());
    webApp.use(scanRouter.allowedMethods());

    // ----------------------------
    // Local mode uses /assets and optional frontend dev-server proxy
    // ----------------------------
    if (process.env.APP_MODE === 'local') {
        console.log('[server-worker] Local mode enabled. Serving /assets from local assets folder.');
        webApp.use(async (ctx, next) => {
            ctx.set('Access-Control-Allow-Origin', '*');
            ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            ctx.set('Access-Control-Allow-Headers', 'Content-Type');
            if (ctx.method === 'OPTIONS') {
                ctx.status = 204;
                return;
            }
            await next();
        });
    }

    // Determine static path for React web app
    let staticPath: string;
    if (config.staticPath) {
        staticPath = config.staticPath;
    } else {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const possiblePaths = [
            path.join(process.cwd(), 'apps/ezplayer-ui-embedded/dist'),
            path.join(__dirname, '../../ezplayer-ui-embedded/dist'),
            path.join(__dirname, '../ezplayer-ui-embedded/dist'),
        ];

        staticPath = '';
        for (const possiblePath of possiblePaths) {
            if (await exists(possiblePath)) {
                staticPath = possiblePath;
                break;
            }
        }

        if (!staticPath) {
            console.warn(
                `[server-worker] React build not found! Please run: pnpm --filter @ezplayer/ui-embedded build:web`,
            );
            staticPath = possiblePaths[0];
        }
    }

    const indexPath = config.indexPath || path.join(staticPath, 'index.html');

    // Create HTTP server
    const httpServer = createServer(webApp.callback());

    // Static file serving middleware
    webApp.use(
        serve(staticPath, {
            index: false,
        }),
    );

    // JavaScript MIME type middleware
    webApp.use(async (ctx: any, next: () => Promise<any>) => {
        await next();
        if ((ctx.path.endsWith('.js') || ctx.path.endsWith('.mjs')) && ctx.status === 200) {
            ctx.type = 'application/javascript; charset=utf-8';
        }
    });

    // Fallback to index.html for SPA routing
    webApp.use(async (ctx: any) => {
        if (ctx.path.startsWith('/api/') || ctx.path.startsWith('/assets/')) {
            return;
        }

        if (await exists(indexPath)) {
            ctx.type = 'text/html';
            ctx.body = fs.readFileSync(indexPath, 'utf-8');
        } else {
            ctx.status = 404;
            ctx.body = 'React app not built. Please run: cd apps/ezplayer-ui-embedded && pnpm build:web';
        }
    });

    let boundPort: number;
    try {
        boundPort = await listenWithFallback(httpServer, port, 10, 'Koa');
    } catch (err) {
        console.error('[server-worker] HTTP server bind failed:', err);
        parentPort!.postMessage({
            type: 'status',
            status: 'error',
            port,
            portSource,
        } satisfies ServerWorkerToMainMessage);
        return;
    }
    boundWebPort = boundPort;
    console.log(`[server-worker] Koa server running at http://localhost:${boundPort}`);
    console.log(`[server-worker] WebSocket server available at ws://localhost:${boundPort}/ws`);
    // Reused below so the post-kiosk status re-asserts the actual web port + source.
    const webPortSource = boundPort === port ? portSource : `${portSource} (fallback from ${port})`;
    parentPort!.postMessage({
        type: 'status',
        status: 'listening',
        port: boundPort,
        portSource: webPortSource,
    } satisfies ServerWorkerToMainMessage);

    httpServer.on('error', (err) => {
        console.error('[server-worker] HTTP server error:', err);
        parentPort!.postMessage({
            type: 'status',
            status: 'error',
            port: boundPort,
            portSource,
        } satisfies ServerWorkerToMainMessage);
    });

    httpServer.on('close', () => {
        parentPort!.postMessage({
            type: 'status',
            status: 'stopped',
            port: boundPort,
            portSource,
        } satisfies ServerWorkerToMainMessage);
    });

    // Attach WebSocket proxy for /proxy/ paths (before main WSS)
    attachWebSocketProxy(httpServer, proxyTargetAllowed);

    // Route `/ws` upgrades ourselves: ws's `{ server, path }` option 400s
    // every non-`/ws` upgrade, killing the `/proxy/<ip>/…` WebSockets that
    // attachWebSocketProxy handles. Ignoring non-`/ws` upgrades here lets
    // both upgrade handlers coexist.
    const attachWsPath = (server: ReturnType<typeof createServer>, target: WebSocketServer): void => {
        server.on('upgrade', (req, socket, head) => {
            const pathname = (req.url ?? '').split('?')[0];
            if (pathname !== '/ws') return; // leave for attachWebSocketProxy / others
            target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
        });
    };

    // Create WebSocket server
    const wss = new WebSocketServer({ noServer: true });
    attachWsPath(httpServer, wss);

    // Initialize WebSocket broadcaster with the WebSocket server
    wsBroadcaster.attach(wss);

    // `/terminal` — the remote shell. Its own socket rather than a channel on
    // `/ws`, because the broadcaster there is lossy by design. The upgrade is
    // refused outright unless a password has been configured via the CLI, so
    // with the feature off there is nothing on the network to attack.
    attachTerminalUpgrade(httpServer);

    // ----------------------------
    // Kiosk server — second port, same API, limited sidebar
    // ----------------------------
    if (kioskPort) {
        console.log(`[server-worker] Starting kiosk server on port ${kioskPort} (source: ${kioskPortSource})`);

        const kioskApp = new Koa();

        // No proxy middleware on the kiosk: the `/proxy/<host>/…` bridge reaches
        // arbitrary LAN/show-net hosts (controllers), which must never be exposed
        // on the anonymous jukebox surface. Proxying is web-app-only.

        // Body parser
        kioskApp.use(jsonBody());

        // Reuse the same API router
        kioskApp.use(router.routes());
        kioskApp.use(router.allowedMethods());

        // Local mode CORS
        if (process.env.APP_MODE === 'local') {
            kioskApp.use(async (ctx, next) => {
                ctx.set('Access-Control-Allow-Origin', '*');
                ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
                ctx.set('Access-Control-Allow-Headers', 'Content-Type');
                if (ctx.method === 'OPTIONS') {
                    ctx.status = 204;
                    return;
                }
                await next();
            });
        }

        // Static file serving (same assets)
        kioskApp.use(serve(staticPath, { index: false }));

        // JavaScript MIME type middleware
        kioskApp.use(async (ctx: any, next: () => Promise<any>) => {
            await next();
            if ((ctx.path.endsWith('.js') || ctx.path.endsWith('.mjs')) && ctx.status === 200) {
                ctx.type = 'application/javascript; charset=utf-8';
            }
        });

        // SPA fallback — inject kiosk mode flag into index.html
        kioskApp.use(async (ctx: any) => {
            if (ctx.path.startsWith('/api/') || ctx.path.startsWith('/assets/')) {
                return;
            }

            if (await exists(indexPath)) {
                const html = fs.readFileSync(indexPath, 'utf-8');
                ctx.type = 'text/html';
                ctx.body = html.replace('<head>', '<head><script>window.__EZPLAYER_MODE__="kiosk"</script>');
            } else {
                ctx.status = 404;
                ctx.body = 'React app not built. Please run: cd apps/ezplayer-ui-embedded && pnpm build:web';
            }
        });

        const kioskHttpServer = createServer(kioskApp.callback());

        let kioskBoundPort: number;
        try {
            kioskBoundPort = await listenWithFallback(kioskHttpServer, kioskPort, 10, 'Kiosk');
        } catch (err) {
            console.error('[server-worker] Kiosk HTTP server bind failed:', err);
            return;
        }
        console.log(`[server-worker] Kiosk server running at http://localhost:${kioskBoundPort}`);
        console.log(`[server-worker] Kiosk WebSocket available at ws://localhost:${kioskBoundPort}/ws`);

        // Re-report status now that the kiosk port is known, including the actual web port
        // so the renderer's Show Status page can list both bound ports.
        parentPort!.postMessage({
            type: 'status',
            status: 'listening',
            port: boundPort,
            portSource: webPortSource,
            kioskPort: kioskBoundPort,
            kioskPortSource:
                kioskBoundPort === kioskPort ? kioskPortSource : `${kioskPortSource} (fallback from ${kioskPort})`,
        } satisfies ServerWorkerToMainMessage);

        kioskHttpServer.on('error', (err) => {
            console.error('[server-worker] Kiosk HTTP server error:', err);
        });

        // No `/proxy/` WebSocket bridge on the kiosk either (see above) — only the
        // app's own `/ws` is served here.

        // Create WebSocket server for kiosk (shares the same broadcaster)
        const kioskWss = new WebSocketServer({ noServer: true });
        attachWsPath(kioskHttpServer, kioskWss);
        wsBroadcaster.attach(kioskWss);
    }
}

// Signal that we're ready to receive init message (sent immediately when worker starts)
parentPort.postMessage({ type: 'ready' } satisfies ServerWorkerToMainMessage);
