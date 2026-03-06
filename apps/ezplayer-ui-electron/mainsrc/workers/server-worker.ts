/**
 * Server worker - runs Koa server in a worker thread
 */

import { parentPort } from 'worker_threads';
import Koa from 'koa';
import bodyParser from '@koa/bodyparser';
import { WebSocketServer } from 'ws';
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
    } else if (msg.type === 'shutdown') {
        process.exit(0);
    }
});

async function startServer(config: ServerWorkerData) {
    const { port, portSource } = config;

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
    // API: GET /api/getimage/:sequenceId - serves images by sequence ID
    // ----------------------------------------------
    router.get('/api/getimage/:sequenceId', async (ctx) => {
        const sequenceId = ctx.params.sequenceId;

        if (!sequenceId) {
            ctx.status = 400;
            ctx.body = { error: 'Sequence ID is required' };
            return;
        }

        // Sanitize sequence ID to prevent path traversal
        const sanitizedId = sequenceId.replace(/[^a-zA-Z0-9-_]/g, '');
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

            // Set appropriate MIME type
            ctx.type = inferMimeType(seqfile);
            await send(ctx, path.basename(seqfile), { root: path.dirname(seqfile) });
        } catch (error) {
            console.error('[server-worker] Error getting sequence thumbnail:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
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
            user: wsBroadcaster.get('user'),
            show: wsBroadcaster.get('show'),
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
                const settingsPath = path.join(showFolder, 'playbackSettings.json');
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
}

// Signal that we're ready to receive init message (sent immediately when worker starts)
parentPort.postMessage({ type: 'ready' } satisfies ServerWorkerToMainMessage);
