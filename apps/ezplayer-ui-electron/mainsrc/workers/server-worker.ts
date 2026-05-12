/**
 * Server worker - runs Koa server in a worker thread
 */

import { parentPort } from 'worker_threads';
import Koa from 'koa';
import bodyParser from '@koa/bodyparser';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import * as path from 'path';
import * as fs from 'fs';
import fsp from 'fs/promises';
import Router from '@koa/router';
import { send } from '@koa/send';
import serve from 'koa-static';
import { fileURLToPath } from 'url';
import type { EZPlayerCommand, FullPlayerState, PlaybackSettings, SequenceRecord } from '@ezplayer/ezplayer-core';
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
import { createProxyMiddleware, attachWebSocketProxy } from './proxy-middleware.js';
import { ViewObject, LayoutSettings, type MhFixtureInfo } from './playbacktypes.js';

if (!parentPort) throw new Error('No parentPort in worker');

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

    call<K extends keyof ServerWorkerRPCAPI>(
        method: K,
        ...args: Parameters<ServerWorkerRPCAPI[K]>
    ): Promise<ReturnType<ServerWorkerRPCAPI[K]>> {
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

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`RPC timeout for ${method}`));
                }
            }, 30000);
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
        // Mirror the POST /api/playback-settings flow: persist to disk first
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
    }
});

// Side cache for model coordinates (pushed from main thread on show folder load)
let cachedModelCoordinates3D: unknown = {};
let cachedModelCoordinates2D: unknown = {};
let cachedViewObjects: Array<ViewObject> = [];
let cachedLayoutSettings: LayoutSettings = {};
let cachedMovingHeads: Array<MhFixtureInfo> = [];

let curFrameBuffer: SharedArrayBuffer | undefined = undefined;
let curAudioBuffer: SharedArrayBuffer | undefined = undefined;
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
        curAudioBuffer = msg.buffer;
        curAudioRing = new AudioChunkRingBuffer(msg.buffer, false);
    } else if (msg.type === 'broadcast') {
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
    // Dial the proxy + audio bridges in parallel — separate WSes so big
    // HTTP-over-WS payloads and audio push don't head-of-line block status
    // snapshots/pings on the main bridge.
    if (proxyWsUrl) openCloudProxyBridge(proxyWsUrl, sessionId, ttlSeconds);
    if (audioWsUrl) openCloudAudioBridge(audioWsUrl, sessionId, ttlSeconds);

    // Same session + live socket: just refresh TTL (cheap path, fires on every checkin).
    if (cloudBridge && cloudBridge.sessionId === sessionId && cloudBridge.open) {
        clearTimeout(cloudBridge.ttlTimer);
        cloudBridge.ttlTimer = setTimeout(() => closeCloudBridge(sessionId), ttlSeconds * 1000);
        return;
    }
    // Same session + dead socket (close fired but cloud still wants the bridge),
    // or different session: tear down any existing bridge and dial.
    if (cloudBridge) {
        clearTimeout(cloudBridge.ttlTimer);
        try { cloudBridge.ws.close(); } catch { /* ignore */ }
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
    cloudBridge = { sessionId, ws, open: false, ttlTimer };

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
    try { cloudBridge.ws.close(); } catch { /* ignore */ }
    cloudBridge = undefined;
}

// -- cloud proxy bridge (HTTP-over-WS) ----------------------------------------
//
// Parallel to the status bridge. Cloud sends `httpProxyRequest` envelopes
// (browser HTTP requests for thumbnails / 3D / layout XML, translated by the
// cloud-endpoint), we dispatch via `dispatchHttpProxy` to the same handlers
// our Koa routes use, and reply with `httpProxyResponse` envelopes. Body
// goes as base64; permessage-deflate (default in `ws`) recovers most of the
// 33% overhead for text/JSON, neutral on PNG/JPG.

interface CloudProxyBridge {
    sessionId: string;
    ws: WebSocket;
    open: boolean;
    ttlTimer: NodeJS.Timeout;
}
let cloudProxyBridge: CloudProxyBridge | undefined;

function openCloudProxyBridge(wsUrl: string, sessionId: string, ttlSeconds: number) {
    if (cloudProxyBridge && cloudProxyBridge.sessionId === sessionId && cloudProxyBridge.open) {
        clearTimeout(cloudProxyBridge.ttlTimer);
        cloudProxyBridge.ttlTimer = setTimeout(() => closeCloudProxyBridge(sessionId), ttlSeconds * 1000);
        return;
    }
    if (cloudProxyBridge) {
        clearTimeout(cloudProxyBridge.ttlTimer);
        try { cloudProxyBridge.ws.close(); } catch { /* ignore */ }
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
    cloudProxyBridge = { sessionId, ws, open: false, ttlTimer };

    ws.on('open', () => {
        if (cloudProxyBridge?.ws === ws) cloudProxyBridge.open = true;
        console.log(`[server-worker] cloud proxy bridge open sessionId=${sessionId.slice(0, 8)}…`);
    });
    ws.on('message', (raw) => {
        // Best-effort: parse, dispatch, reply. Errors at any layer turn into
        // a 500 response with the same reqId so the cloud's pending-promise
        // resolves and the browser sees a clear failure instead of timing out.
        let reqId: string | undefined;
        try {
            const msg = JSON.parse(raw.toString()) as { type?: string; reqId?: string; path?: string; query?: Record<string, string> };
            if (msg?.type !== 'httpProxyRequest' || typeof msg.reqId !== 'string') return;
            reqId = msg.reqId;
            void dispatchHttpProxy(msg.path ?? '', msg.query).then((res) => {
                sendProxyResponse(ws, reqId!, res);
            });
        } catch (err) {
            console.error('[server-worker] proxy message handling failed:', err);
            if (reqId) {
                try {
                    ws.send(JSON.stringify({ type: 'httpProxyResponse', reqId, status: 500 }));
                } catch { /* ignore */ }
            }
        }
    });
    ws.on('error', (err) => {
        console.error('[server-worker] cloud proxy bridge error:', err);
    });
    ws.on('close', () => {
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
    try { cloudProxyBridge.ws.close(); } catch { /* ignore */ }
    cloudProxyBridge = undefined;
}

// -- cloud audio bridge (push) ------------------------------------------------
//
// Pushes new audio chunks to the cloud as soon as they appear in the player's
// audio ring. The cloud fans them out to attached listener WS sessions; the
// player doesn't know or care how many listeners exist. Each chunk goes as a
// single binary WS frame in the per-chunk wire format used by the HTTP /api/audio
// route, prefixed with `serverNow` so the browser can refine clockOffset from
// arrival timing across many chunks (not just a one-shot RTT at startup).

interface CloudAudioBridge {
    sessionId: string;
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
    if (cloudAudioBridge && cloudAudioBridge.sessionId === sessionId && cloudAudioBridge.open) {
        clearTimeout(cloudAudioBridge.ttlTimer);
        cloudAudioBridge.ttlTimer = setTimeout(() => closeCloudAudioBridge(sessionId), ttlSeconds * 1000);
        return;
    }
    if (cloudAudioBridge) {
        clearTimeout(cloudAudioBridge.ttlTimer);
        if (cloudAudioBridge.pumpTimer) clearInterval(cloudAudioBridge.pumpTimer);
        try { cloudAudioBridge.ws.close(); } catch { /* ignore */ }
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
    cloudAudioBridge = { sessionId, ws, open: false, ttlTimer, afterSeq: 0 };

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
                // 8 (serverNow) + 8 (playAt) + 4*4 (incarnation/sampleRate/channels/sampleCount)
                // + sampleCount*4 (Float32 payload).
                const totalSize = 8 + 8 + 4 + 4 + 4 + 4 + chunk.samples.length * 4;
                const buf = Buffer.allocUnsafe(totalSize);
                let off = 0;
                buf.writeDoubleLE(serverNow, off); off += 8;
                buf.writeDoubleLE(chunk.playAtRealTime, off); off += 8;
                buf.writeUInt32LE(chunk.incarnation, off); off += 4;
                buf.writeUInt32LE(chunk.sampleRate, off); off += 4;
                buf.writeUInt32LE(chunk.channels, off); off += 4;
                buf.writeUInt32LE(chunk.samples.length, off); off += 4;
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
    try { cloudAudioBridge.ws.close(); } catch { /* ignore */ }
    cloudAudioBridge = undefined;
}

/** Wire a dispatch result onto the proxy WS. Bodies up to PROXY_CHUNK_SIZE
 *  ship as a single `httpProxyResponse`; larger ones lead with `chunked: true`
 *  and stream the body in `httpProxyChunk` frames, last marked `end: true`.
 *  Base64 encoding makes the envelope JSON-clean; permessage-deflate on the
 *  WS recovers the 33% overhead for compressible payloads. */
const PROXY_CHUNK_SIZE = 512 * 1024;

function sendProxyResponse(
    ws: WebSocket,
    reqId: string,
    res: { status: number; headers?: Record<string, string>; body?: Buffer },
): void {
    const body = res.body;
    try {
        if (!body || body.length <= PROXY_CHUNK_SIZE) {
            ws.send(JSON.stringify({
                type: 'httpProxyResponse',
                reqId,
                status: res.status,
                headers: res.headers,
                bodyBase64: body && body.length > 0 ? body.toString('base64') : undefined,
            }));
            return;
        }
        // Chunked path: status+headers first, then body in PROXY_CHUNK_SIZE pieces.
        ws.send(JSON.stringify({
            type: 'httpProxyResponse',
            reqId,
            status: res.status,
            headers: res.headers,
            chunked: true,
        }));
        let seq = 0;
        for (let off = 0; off < body.length; off += PROXY_CHUNK_SIZE) {
            const end = off + PROXY_CHUNK_SIZE >= body.length;
            const slice = body.subarray(off, off + PROXY_CHUNK_SIZE);
            ws.send(JSON.stringify({
                type: 'httpProxyChunk',
                reqId,
                seq,
                bodyBase64: slice.toString('base64'),
                ...(end ? { end: true } : {}),
            }));
            seq += 1;
        }
    } catch (err) {
        console.error('[server-worker] proxy response send failed:', err);
    }
}

/** Dispatch HTTP-over-WS proxy requests. Mirrors the corresponding Koa route
 *  for each path so consumers can use the same URL shape on LAN and cloud.
 *  Returns body as a Buffer; the WS message handler decides single-shot vs
 *  chunked based on size. */
async function dispatchHttpProxy(
    pathStr: string,
    query: Record<string, string> | undefined,
): Promise<{ status: number; headers?: Record<string, string>; body?: Buffer }> {
    // /api/getimage — id in path or query. Query form is preferred for cloud
    // because DBOS Cloud's edge rejects `%7C` (composite-id pipe) in paths.
    const getimagePath = pathStr.match(/^\/api\/getimage\/([^/?]+)$/);
    const getimageQuery = pathStr === '/api/getimage' ? query?.id : undefined;
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
    if (pathStr === '/api/model-coordinates') return jsonResult(cachedModelCoordinates3D);
    if (pathStr === '/api/model-coordinates-2d') return jsonResult(cachedModelCoordinates2D);
    if (pathStr === '/api/view-objects') return jsonResult(cachedViewObjects);
    if (pathStr === '/api/layout-settings') return jsonResult(cachedLayoutSettings);
    if (pathStr === '/api/moving-heads') return jsonResult(cachedMovingHeads);

    // /api/show-file?path=… — OBJ/MTL/textures for the 3D viewer.
    // Same validation as the Koa route; deviations would create a path the
    // LAN-only consumer can hit but cloud can't (or vice versa).
    if (pathStr === '/api/show-file') {
        return dispatchShowFile(query?.path);
    }

    // /api/frames-zstd — live channel-data frames, zstd-compressed. Owner-
    // only diagnostic over WAN; the LAN path serves uncompressed frames too
    // but for WAN the bandwidth saving is meaningful. Mirrors the Koa route's
    // wire format: [frameSize u32 LE][seq u32 LE][zstd payload].
    if (pathStr === '/api/frames-zstd') {
        return dispatchFramesZstd();
    }

    // /api/audio?afterSeq=N — incremental audio chunks for the WAN-side
    // browser. Mirrors the Koa route's binary chunk-pack wire format; the
    // browser uses `useAudioStream` to schedule via Web Audio with drift
    // correction against the player's clock (sync'd via /api/time).
    if (pathStr === '/api/audio') {
        const afterSeq = parseInt(query?.afterSeq ?? '0', 10) || 0;
        return dispatchAudio(afterSeq);
    }

    // /api/time — server-clock sample for client RTT/offset estimation.
    if (pathStr === '/api/time') {
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
        totalSize += 8 + 4 + 4 + 4 + 4 + chunk.samples.length * 4;
    }
    const buf = Buffer.allocUnsafe(totalSize);
    let off = 0;
    buf.writeUInt32LE(chunks.length, off); off += 4;
    buf.writeUInt32LE(chunks[chunks.length - 1].seq, off); off += 4;
    for (const chunk of chunks) {
        buf.writeDoubleLE(chunk.playAtRealTime, off); off += 8;
        buf.writeUInt32LE(chunk.incarnation, off); off += 4;
        buf.writeUInt32LE(chunk.sampleRate, off); off += 4;
        buf.writeUInt32LE(chunk.channels, off); off += 4;
        buf.writeUInt32LE(chunk.samples.length, off); off += 4;
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

async function dispatchShowFile(filePath: string | undefined): Promise<{ status: number; headers?: Record<string, string>; body?: Buffer }> {
    const showFolder = wsBroadcaster.get('showFolder') as string | undefined;
    if (!showFolder) return { status: 400 };
    if (!filePath) return { status: 400 };
    if (path.isAbsolute(filePath) || /^[a-zA-Z]:[\\/]/.test(filePath)) return { status: 400 };
    const segments = filePath.replace(/\\/g, '/').split('/');
    if (segments.some((s) => s === '..')) return { status: 403 };
    const allowedExt = new Set([
        '.obj', '.mtl',
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga', '.dds',
    ]);
    const ext = path.extname(filePath).toLowerCase();
    if (!allowedExt.has(ext)) return { status: 403 };
    try {
        const resolvedShowFolder = path.resolve(showFolder);
        const resolvedPath = path.resolve(resolvedShowFolder, filePath);
        const inFolder =
            resolvedPath.toLowerCase().startsWith(resolvedShowFolder.toLowerCase() + path.sep)
            || resolvedPath.toLowerCase() === resolvedShowFolder.toLowerCase();
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

async function startServer(config: ServerWorkerData) {
    const { port, portSource, kioskPort, kioskPortSource } = config;

    // Initialize ZSTD codec for frame compression (non-blocking, best-effort)
    try {
        ZstdCodec.run((zstd) => {
            zstdSimple = new zstd.Simple();
            console.log('[server-worker] ZSTD codec initialized');
        });
    } catch (err) {
        console.warn('[server-worker] ZSTD codec failed to initialize, /api/frames-zstd will be unavailable:', err);
    }

    console.log(`[server-worker] Starting Koa web server on port ${port} (source: ${portSource})`);
    const router = new Router();
    const webApp = new Koa();

    // Proxy middleware must be before bodyParser so it can stream raw request bodies
    webApp.use(createProxyMiddleware());

    // Add body parser middleware for JSON requests
    webApp.use(bodyParser());

    // ----------------------------------------------
    // API: GET /api/getimage?id=… (preferred) or /api/getimage/:sequenceId
    // (legacy). Cloud-sourced ids are `<user>|<vseq>`; DBOS Cloud's edge
    // rejects `%7C` in URL paths, so the preferred caller-side form is the
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

    router.get('/api/getimage', async (ctx) => {
        await serveGetImage(ctx, ctx.query.id as string | undefined);
    });
    router.get('/api/getimage/:sequenceId', async (ctx) => {
        await serveGetImage(ctx, ctx.params.sequenceId);
    });

    // ----------------------------------------------
    // API: GET /api/hello
    // ----------------------------------------------
    router.get('/api/hello', async (ctx) => {
        ctx.body = { message: 'Hello from Koa + Electron!' };
    });

    // ----------------------------------------------
    // API: GET /api/current-show (local cache read)
    // ----------------------------------------------
    router.get('/api/current-show', async (ctx) => {
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
    // API: GET /api/debug-show-folder - diagnostic endpoint
    // ----------------------------------------------
    router.get('/api/debug-show-folder', async (ctx) => {
        const showFolder = wsBroadcaster.get('showFolder');
        const state = wsBroadcaster.getState();
        ctx.body = {
            showFolder,
            hasShowFolder: !!showFolder,
            allStateKeys: Object.keys(state),
            state: state
        };
    });

    // ----------------------------------------------
    // API: POST /api/player-command
    // ----------------------------------------------
    router.post('/api/player-command', async (ctx) => {
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
    router.post('/api/playlists', async (ctx) => {
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
    router.post('/api/schedules', async (ctx) => {
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
    // API: POST /api/playback-settings
    // ----------------------------------------------
    router.post('/api/playback-settings', async (ctx) => {
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
    // API: GET /api/model-coordinates - get model coordinates for 3D preview (local cache)
    // ----------------------------------------------
    router.get('/api/model-coordinates', async (ctx) => {
        ctx.body = cachedModelCoordinates3D;
    });

    // ----------------------------------------------
    // API: GET /api/model-coordinates-2d - get 2D model coordinates for 2D preview (local cache)
    // ----------------------------------------------
    router.get('/api/model-coordinates-2d', async (ctx) => {
        ctx.body = cachedModelCoordinates2D;
    });

    // ----------------------------------------------
    // API: GET /api/view-objects - get view objects (meshes) from XML (local cache)
    // ----------------------------------------------
    router.get('/api/view-objects', async (ctx) => {
        ctx.body = cachedViewObjects;
    });

    // ----------------------------------------------
    // API: GET /api/layout-settings - get layout settings (background image, preview size) from XML
    // ----------------------------------------------
    router.get('/api/layout-settings', async (ctx) => {
        ctx.body = cachedLayoutSettings;
    });

    // ----------------------------------------------
    // API: GET /api/moving-heads - get DMX moving head fixture definitions from XML
    // ----------------------------------------------
    router.get('/api/moving-heads', async (ctx) => {
        ctx.body = cachedMovingHeads;
    });

    // ----------------------------------------------
    // API: GET /api/show-file - serve files for OBJ/MTL/textures used by 3D viewer
    // Only accepts show-folder-relative paths (no absolute paths).
    // ----------------------------------------------
    router.get('/api/show-file', async (ctx) => {
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
        if (segments.some(s => s === '..')) {
            ctx.status = 403;
            ctx.body = { error: 'Path traversal not allowed' };
            return;
        }

        // Security: only serve a limited set of file types used by the 3D viewer.
        const allowedExt = new Set([
            '.obj', '.mtl',
            '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tga', '.dds',
        ]);
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
            if (!resolvedPath.toLowerCase().startsWith(resolvedShowFolder.toLowerCase() + path.sep)
                && resolvedPath.toLowerCase() !== resolvedShowFolder.toLowerCase()) {
                ctx.status = 403;
                ctx.body = { error: 'Resolved path outside show folder' };
                return;
            }

            if (!await exists(resolvedPath)) {
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
    // API: GET /api/frames - binary frame data for 3D viewer
    // ----------------------------------------------
    const frameBufferPool = new BufferPool();

    router.get('/api/frames', async (ctx) => {
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
    // API: GET /api/frames-zstd - ZSTD-compressed binary frame data for 3D viewer
    // Wire format: [frameSize u32 LE][seq u32 LE][zstd-compressed frame bytes]
    // ----------------------------------------------
    router.get('/api/frames-zstd', async (ctx) => {
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
    // API: GET /api/time - server Date.now() for client clock-offset estimation
    // Client measures RTT and computes offset = serverTime - clientTime + RTT/2
    // ----------------------------------------------
    router.get('/api/time', async (ctx) => {
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        ctx.set('Cache-Control', 'no-store');
        ctx.body = { now: Date.now() };
    });

    // ----------------------------------------------
    // API: GET /api/audio?afterSeq=N - binary audio chunk data for web client
    // Wire format: [u32 chunkCount][u32 latestSeq]
    //   per chunk: [f64 playAtRealTime][u32 incarnation][u32 sampleRate]
    //              [u32 channels][u32 sampleCount][Float32 × sampleCount]
    // ----------------------------------------------
    router.get('/api/audio', async (ctx) => {
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
        //          + 4 (channels) + 4 (sampleCount) + sampleCount*4 (Float32 data)
        let totalSize = 8;
        for (const chunk of chunks) {
            totalSize += 8 + 4 + 4 + 4 + 4 + chunk.samples.length * 4;
        }

        const buf = Buffer.allocUnsafe(totalSize);
        let offset = 0;

        // Write header
        buf.writeUInt32LE(chunks.length, offset); offset += 4;
        buf.writeUInt32LE(chunks[chunks.length - 1].seq, offset); offset += 4;

        // Write each chunk
        for (const chunk of chunks) {
            buf.writeDoubleLE(chunk.playAtRealTime, offset); offset += 8;
            buf.writeUInt32LE(chunk.incarnation, offset); offset += 4;
            buf.writeUInt32LE(chunk.sampleRate, offset); offset += 4;
            buf.writeUInt32LE(chunk.channels, offset); offset += 4;
            buf.writeUInt32LE(chunk.samples.length, offset); offset += 4;

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

    // Start the server
    httpServer.listen(port, () => {
        console.log(`[server-worker] Koa server running at http://localhost:${port}`);
        console.log(`[server-worker] WebSocket server available at ws://localhost:${port}/ws`);
        parentPort!.postMessage({
            type: 'status',
            status: 'listening',
            port,
            portSource,
        } satisfies ServerWorkerToMainMessage);
    });

    httpServer.on('error', (err) => {
        console.error('[server-worker] HTTP server error:', err);
        parentPort!.postMessage({
            type: 'status',
            status: 'error',
            port,
            portSource,
        } satisfies ServerWorkerToMainMessage);
    });

    httpServer.on('close', () => {
        parentPort!.postMessage({
            type: 'status',
            status: 'stopped',
            port,
            portSource,
        } satisfies ServerWorkerToMainMessage);
    });

    // Attach WebSocket proxy for /proxy/ paths (before main WSS)
    attachWebSocketProxy(httpServer);

    // Create WebSocket server
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
    });

    // Initialize WebSocket broadcaster with the WebSocket server
    wsBroadcaster.attach(wss);

    // ----------------------------
    // Kiosk server — second port, same API, limited sidebar
    // ----------------------------
    if (kioskPort) {
        console.log(`[server-worker] Starting kiosk server on port ${kioskPort} (source: ${kioskPortSource})`);

        const kioskApp = new Koa();

        // Proxy middleware
        kioskApp.use(createProxyMiddleware());

        // Body parser
        kioskApp.use(bodyParser());

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

        kioskHttpServer.listen(kioskPort, () => {
            console.log(`[server-worker] Kiosk server running at http://localhost:${kioskPort}`);
            console.log(`[server-worker] Kiosk WebSocket available at ws://localhost:${kioskPort}/ws`);
        });

        kioskHttpServer.on('error', (err) => {
            console.error('[server-worker] Kiosk HTTP server error:', err);
        });

        // Attach WebSocket proxy for /proxy/ paths on kiosk server too
        attachWebSocketProxy(kioskHttpServer);

        // Create WebSocket server for kiosk (shares the same broadcaster)
        const kioskWss = new WebSocketServer({
            server: kioskHttpServer,
            path: '/ws',
        });
        wsBroadcaster.attach(kioskWss);
    }
}

// Signal that we're ready to receive init message (sent immediately when worker starts)
parentPort.postMessage({ type: 'ready' } satisfies ServerWorkerToMainMessage);
