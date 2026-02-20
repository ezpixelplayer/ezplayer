/**
 * Server worker - runs Koa server in a worker thread
 */

import { parentPort, workerData } from 'worker_threads';
import Koa from 'koa';
import bodyParser from '@koa/bodyparser';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import * as path from 'path';
import * as fs from 'fs';
import fsp from 'fs/promises';
import Router from '@koa/router';
import { send } from '@koa/send';
import serve from 'koa-static';
import { fileURLToPath } from 'url';
import type { EZPlayerCommand, PlaybackSettings } from '@ezplayer/ezplayer-core';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { BufferPool } from '@ezplayer/epp';
import type { ServerWorkerData, ServerWorkerToMainMessage, MainToServerWorkerMessage, ServerWorkerRPCAPI } from './serverworkertypes.js';

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

// RPC client for calling main thread functions
class MainThreadRPC {
    private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

    call<K extends keyof ServerWorkerRPCAPI>(method: K, ...args: Parameters<ServerWorkerRPCAPI[K]>): Promise<ReturnType<ServerWorkerRPCAPI[K]>> {
        return new Promise((resolve, reject) => {
            const id = `${Date.now()}-${Math.random()}`;
            // Store resolve with proper type casting
            this.pendingRequests.set(id, { 
                resolve: resolve as (value: unknown) => void, 
                reject 
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

// WebSocket broadcaster (simplified version for worker)
// Note: This is a simplified version that matches the expected message format
// but doesn't include all features like heartbeat, backpressure management, etc.
class WorkerWebSocketBroadcaster {
    private state: Record<string, unknown> = {};
    private versions: Record<string, number> = {};
    private conns = new Set<WebSocket>();

    attach(wss: WebSocketServer) {
        wss.on('connection', (ws) => {
            this.conns.add(ws);
            ws.on('close', () => this.conns.delete(ws));
            ws.on('error', () => this.conns.delete(ws));
            
            // Send initial state snapshot with proper format
            if (Object.keys(this.state).length > 0) {
                const snapshot = {
                    type: 'snapshot',
                    v: { ...this.versions },
                    data: { ...this.state },
                };
                try {
                    ws.send(JSON.stringify(snapshot));
                } catch (err) {
                    console.error(`[server-worker] Error sending initial snapshot:`, err);
                }
            }
        });
    }

    set(key: string, value: unknown) {
        this.state[key] = value;
        // Increment version for this key
        if (!Object.hasOwnProperty.call(this.versions, key)) {
            this.versions[key] = 0;
        }
        this.versions[key] = (this.versions[key] || 0) + 1;

        // Send snapshot message with proper format (matching expected client format)
        const snapshot = {
            type: 'snapshot',
            v: { [key]: this.versions[key] },
            data: { [key]: value },
        };
        const message = JSON.stringify(snapshot);
        
        for (const ws of this.conns) {
            if (ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(message);
                } catch (err) {
                    console.error(`[server-worker] Error broadcasting to WebSocket:`, err);
                }
            }
        }
        // Note: We don't send a message back to main thread here because
        // the main thread is the one that initiated this broadcast via the 'broadcast' message
    }
}

const wsBroadcaster = new WorkerWebSocketBroadcaster();

let curFrameBuffer: SharedArrayBuffer | undefined = undefined;
let serverStarted = false;

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
    } else if (msg.type === 'broadcast') {
        // Forward broadcast from main thread to WebSocket clients
        wsBroadcaster.set(msg.key, msg.value);
    } else if (msg.type === 'shutdown') {
        process.exit(0);
    }
});

async function startServer(config: ServerWorkerData) {
    const { port, portSource } = config;

    console.log(`[server-worker] 🌐 Starting Koa web server on port ${port} (source: ${portSource})`);
    const router = new Router();
    const webApp = new Koa();

    // Add body parser middleware for JSON requests
    webApp.use(bodyParser());

    // ----------------------------------------------
    // ⭐ API: GET /api/getimage/:sequenceId - serves images by sequence ID
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
            const seqfile = await rpc.call('getSequenceThumbnail', sequenceId);

            if (!seqfile) {
                ctx.status = 404;
                ctx.body = { error: 'Image not found for sequence ID' };
                return;
            }

            // Set appropriate MIME type
            ctx.type = inferMimeType(seqfile as string);
            await send(ctx, path.basename(seqfile as string), { root: path.dirname(seqfile as string) });
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
    // API: GET /api/current-show
    // ----------------------------------------------
    router.get('/api/current-show', async (ctx) => {
        try {
            const data = await rpc.call('getCurrentShowData');
            ctx.body = data;
        } catch (error) {
            console.error('[server-worker] Error getting current show data:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
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
            const showFolder = await rpc.call('getCurrentShowFolder');
            if (showFolder) {
                const settingsPath = path.join(showFolder as string, 'playbackSettings.json');
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
    // API: GET /api/model-coordinates - get model coordinates for 3D preview
    // ----------------------------------------------
    router.get('/api/model-coordinates', async (ctx) => {
        try {
            const coords = await rpc.call('getModelCoordinatesForAPI', false);
            ctx.body = coords;
        } catch (error) {
            console.error('[server-worker] Error getting model coordinates:', error);
            ctx.status = 500;
            ctx.body = { error: 'Failed to get model coordinates' };
        }
    });

    // ----------------------------------------------
    // API: GET /api/model-coordinates-2d - get 2D model coordinates for 2D preview
    // ----------------------------------------------
    router.get('/api/model-coordinates-2d', async (ctx) => {
        try {
            const coords = await rpc.call('getModelCoordinatesForAPI', true);
            ctx.body = coords;
        } catch (error) {
            console.error('[server-worker] Error getting 2D model coordinates:', error);
            ctx.status = 500;
            ctx.body = { error: 'Failed to get 2D model coordinates' };
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

    webApp.use(router.routes());
    webApp.use(router.allowedMethods());

    // ----------------------------
    // Local mode uses /assets and optional frontend dev-server proxy
    // ----------------------------
    if (process.env.APP_MODE === 'local') {
        console.log('[server-worker] 🧩 Local mode enabled. Serving /assets from local assets folder.');
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
            console.warn(`[server-worker] ⚠️ React build not found! Please run: pnpm --filter @ezplayer/ui-embedded build:web`);
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
        console.log(`[server-worker] 🌐 Koa server running at http://localhost:${port}`);
        console.log(`[server-worker] 🔌 WebSocket server available at ws://localhost:${port}/ws`);
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

    // Create WebSocket server
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
    });

    // Initialize WebSocket broadcaster with the WebSocket server
    wsBroadcaster.attach(wss);

    // Server is now fully started - no need to send ready again as it was already sent at module level
}

// Signal that we're ready to receive init message (sent immediately when worker starts)
parentPort.postMessage({ type: 'ready' } satisfies ServerWorkerToMainMessage);

