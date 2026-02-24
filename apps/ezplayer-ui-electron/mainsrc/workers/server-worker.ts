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
import type { EZPlayerCommand, FullPlayerState, PlaybackSettings, SequenceRecord } from '@ezplayer/ezplayer-core';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { BufferPool } from '@ezplayer/epp';
import { ZstdCodec, ZstdSimple } from 'zstd-codec';
import type {
    ServerWorkerData,
    ServerWorkerToMainMessage,
    MainToServerWorkerMessage,
    ServerWorkerRPCAPI,
} from './serverworkertypes.js';
import { WebSocketBroadcaster } from '../websocket-broadcaster.js';

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
let cachedViewObjects: Array<{
    name: string;
    displayAs: string;
    objFile?: string;
    worldPosX: number;
    worldPosY: number;
    worldPosZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    rotateX: number;
    rotateY: number;
    rotateZ: number;
    brightness?: number;
    active?: boolean;
}> = [];

let curFrameBuffer: SharedArrayBuffer | undefined = undefined;
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
    } else if (msg.type === 'broadcast') {
        // Forward broadcast from main thread to WebSocket clients
        wsBroadcaster.set(msg.key as keyof FullPlayerState, msg.value as any);
    } else if (msg.type === 'pushModelCoordinates') {
        cachedModelCoordinates3D = msg.coords3D;
        cachedModelCoordinates2D = msg.coords2D;
        if (msg.viewObjects) {
            cachedViewObjects = msg.viewObjects;
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
    // API: GET /api/test-show-file - test if new code is running
    // ----------------------------------------------
    router.get('/api/test-show-file', async (ctx) => {
        ctx.body = {
            version: 'v2-fixed',
            message: 'New server-worker code is running! Absolute paths for .obj files are allowed.',
            timestamp: Date.now()
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
    // API: GET /api/show-file - serve files for OBJ/MTL/textures used by 3D viewer
    // ----------------------------------------------
    router.get('/api/show-file', async (ctx) => {
        // Koa automatically decodes query parameters.
        const filePath = ctx.query.path as string;
        const showFolder = wsBroadcaster.get('showFolder') as string | undefined;

        // Version marker to verify new code is running
        console.log('[server-worker] /api/show-file handler v2 - absolute paths allowed for 3D files');

        if (!filePath) {
            ctx.status = 400;
            ctx.body = { error: 'File path is required' };
            return;
        }

        // Security: only serve a limited set of file types used by the 3D viewer.
        // This endpoint is used locally by the Electron renderer to load OBJ/MTL (+ textures).
        const allowedExt = new Set([
            '.obj',
            '.mtl',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.webp',
            '.bmp',
            '.tga',
            '.dds',
        ]);

        try {
            // Resolve file path
            // `path.isAbsolute()` should work on Windows, but we also guard for common drive-letter formats
            // in case the value is slightly malformed by upstream encoding/decoding.
            const looksLikeWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(filePath);
            const isAbsolute = path.isAbsolute(filePath) || looksLikeWindowsAbsolute;
            let resolvedPath = isAbsolute
                ? path.resolve(filePath)
                : showFolder
                  ? path.resolve(showFolder, filePath)
                  : '';

            if (!resolvedPath) {
                ctx.status = 404;
                ctx.body = { error: 'Show folder not set (required for relative paths)' };
                return;
            }

            const ext = path.extname(resolvedPath).toLowerCase();
            if (!allowedExt.has(ext)) {
                ctx.status = 403;
                ctx.body = { error: `File type not allowed: ${ext || '<none>'}` };
                return;
            }

            // If the request is relative, enforce it stays within the show folder.
            if (!isAbsolute && showFolder) {
                const cleanShowFolder = path.resolve(showFolder);
                const resolvedShowFolder = cleanShowFolder.replace(/[/\\]+$/, '');

                const normalizeForComparison = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
                const normalizedShowFolder = normalizeForComparison(resolvedShowFolder);
                const normalizedResolvedPath = normalizeForComparison(resolvedPath);
                const showFolderWithSep = normalizedShowFolder.endsWith('/') ? normalizedShowFolder : normalizedShowFolder + '/';

                const isWithin = normalizedResolvedPath.startsWith(showFolderWithSep) || normalizedResolvedPath === normalizedShowFolder;
                if (!isWithin) {
                    ctx.status = 403;
                    ctx.body = { error: 'File path outside show folder' };
                    return;
                }
            }

            // Check if file exists
            let fileExists = await exists(resolvedPath);
            const triedPaths: string[] = [resolvedPath];
            
            console.log('[server-worker] /api/show-file - Initial check:', {
                filePath,
                isAbsolute,
                resolvedPath,
                fileExists,
                showFolder
            });
            
            // If absolute path doesn't exist and we have a show folder, try as relative path
            // This handles cases where XML has wrong absolute paths but file is actually in show folder
            if (!fileExists && isAbsolute && showFolder) {
                const fileName = path.basename(filePath);
                const dirName = path.dirname(filePath);
                const lastDirName = path.basename(dirName); // e.g., "HouseModel" from "C:\Work\...\HouseModel"
                
                console.log('[server-worker] /api/show-file - Trying fallback paths:', {
                    fileName,
                    lastDirName,
                    showFolder
                });
                
                // Try 1: Just the filename in show folder root
                let tryPath = path.join(showFolder, fileName);
                triedPaths.push(tryPath);
                const exists1 = await exists(tryPath);
                console.log('[server-worker] /api/show-file - Fallback 1:', { tryPath, exists: exists1 });
                
                if (exists1) {
                    resolvedPath = tryPath;
                    fileExists = true;
                } else {
                    // Try 2: Last directory + filename (e.g., HouseModel/KR.obj)
                    tryPath = path.join(showFolder, lastDirName, fileName);
                    triedPaths.push(tryPath);
                    const exists2 = await exists(tryPath);
                    console.log('[server-worker] /api/show-file - Fallback 2:', { tryPath, exists: exists2 });
                    
                    if (exists2) {
                        resolvedPath = tryPath;
                        fileExists = true;
                    }
                }
            }
            
            if (!fileExists) {
                console.error('[server-worker] /api/show-file - File not found after all attempts:', {
                    originalPath: filePath,
                    triedPaths,
                    showFolder,
                    isAbsolute
                });
                ctx.status = 404;
                ctx.body = { 
                    error: 'File not found',
                    tried: triedPaths,
                    showFolder: showFolder,
                    originalPath: filePath
                };
                return;
            }
            
            console.log('[server-worker] /api/show-file - File found!', {
                resolvedPath,
                originalPath: filePath
            });

            // Set appropriate MIME type
            ctx.type = inferMimeType(resolvedPath);
            await send(ctx, path.basename(resolvedPath), { root: path.dirname(resolvedPath) });
        } catch (error) {
            console.error('[server-worker] Error serving show file:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    });

    // ----------------------------------------------
    // API: GET /api/:filename - fallback for texture requests (e.g., /api/texture_1001.png)
    // This handles cases where MTLLoader constructs URLs like /api/texture.png
    // ----------------------------------------------
    router.get('/api/:filename', async (ctx) => {
        const filename = ctx.params.filename as string;
        const showFolder = wsBroadcaster.get('showFolder') as string | undefined;
        
        // Only handle image/texture files
        const imageExt = /\.(png|jpg|jpeg|gif|webp|bmp|tga|dds)$/i;
        if (!imageExt.test(filename)) {
            ctx.status = 404;
            return;
        }
        
        if (!showFolder) {
            ctx.status = 404;
            ctx.body = { error: 'Show folder not set' };
            return;
        }
        
        // Try to find the texture file in common locations
        const possiblePaths = [
            path.join(showFolder, 'HouseModel', filename),
            path.join(showFolder, filename),
            // Also try in any subdirectory
        ];
        
        // Search in show folder and common subdirectories
        let foundPath: string | null = null;
        for (const tryPath of possiblePaths) {
            if (await exists(tryPath)) {
                foundPath = tryPath;
                break;
            }
        }
        
        // If not found in common locations, search recursively (limited depth)
        if (!foundPath) {
            const searchDir = path.join(showFolder, 'HouseModel');
            if (await exists(searchDir)) {
                const searchPath = path.join(searchDir, filename);
                if (await exists(searchPath)) {
                    foundPath = searchPath;
                }
            }
        }
        
        if (!foundPath) {
            ctx.status = 404;
            ctx.body = { error: 'Texture not found', filename, showFolder };
            return;
        }
        
        ctx.type = inferMimeType(foundPath);
        await send(ctx, path.basename(foundPath), { root: path.dirname(foundPath) });
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
