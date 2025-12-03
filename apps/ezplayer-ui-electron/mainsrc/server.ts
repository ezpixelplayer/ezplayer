import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import serve from 'koa-static';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { app, BrowserWindow } from 'electron';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'url';
import { wsBroadcaster } from './websocket-broadcaster.js';
import { getCurrentShowFolder } from '../showfolder.js';
import { getCurrentShowData, updatePlaylistsHandler, updateScheduleHandler } from './ipcezplayer.js';
import type { EZPlayerCommand } from '@ezplayer/ezplayer-core';
import Router from '@koa/router';
import send from 'koa-send';

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

const USER_IMAGE_ROUTE = '/user-images';

const router = new Router();

function inferMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ASSET_MIME_TYPES[ext] ?? 'application/octet-stream';
}

function safePath(requestPath: string): string | null {
    const platformPath = requestPath.replace(/\//g, path.sep);
    const normalized = path
        .normalize(platformPath)
        .replace(/^[\\/]+/, '')
        .replace(/(\.\.(\/|\\|$))+/g, '');

    return normalized || null;
}

export interface ServerConfig {
    port: number;
    portSource: string;
    resolvedUserImageDir: string;
    playWorker: Worker | null;
    mainWindow: BrowserWindow | null;
}

/**
 * Sets up and starts the Koa web server with WebSocket support
 * @param config Server configuration
 * @returns The HTTP server instance
 */
export function setupServer(config: ServerConfig): Server {
    const { port, portSource, resolvedUserImageDir, playWorker, mainWindow } = config;

    const webApp = new Koa();
    console.log(`🌐 Starting Koa web server on port ${port} (source: ${portSource})`);

    // ----------------------------------------------
    // ⭐ New API: GET /api/getimage/:sequenceid
    // ----------------------------------------------
    router.get('/api/getimage/:sequenceid', async (ctx) => {
        const { sequenceid } = ctx.params;

        // Build a path inside the user-images folder
        const filePath = path.join(config.resolvedUserImageDir, `${sequenceid}.jpg`);

        if (!fs.existsSync(filePath)) {
            ctx.status = 404;
            ctx.body = { error: 'Image not found' };
            return;
        }

        // koa-send requires { root } + filename
        const root = path.dirname(filePath);
        const filename = path.basename(filePath);

        await send(ctx, filename, { root });
    });

    // ----------------------------
    // /show-assets/* route
    // ----------------------------
    router.get('/show-assets/(.*)', async (ctx) => {
        const relative = ctx.params[0];
        const sanitized = safePath(relative);

        if (!sanitized) {
            ctx.status = 404;
            return;
        }

        const showFolder = getCurrentShowFolder();
        if (!showFolder) {
            ctx.status = 404;
            ctx.body = 'Show folder not selected';
            return;
        }

        await send(ctx, sanitized, { root: showFolder });
    });

    // ----------------------------
    // /user-images/* route
    // ----------------------------
    router.get(`${USER_IMAGE_ROUTE}/(.*)`, async (ctx) => {
        const relative = ctx.params[0];
        const sanitized = safePath(relative);

        if (!sanitized) {
            ctx.status = 404;
            return;
        }

        await send(ctx, sanitized, { root: resolvedUserImageDir });
    });

    webApp.use(router.routes());
    webApp.use(router.allowedMethods());

    // Add body parser middleware for JSON requests
    webApp.use(bodyParser());

    // ----------------------------
    // Local mode uses /assets and optional frontend dev-server proxy
    // ----------------------------
    if (process.env.APP_MODE === 'local') {
        console.log('🧩 Local mode enabled. Serving /assets from local assets folder.');
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
    if (app.isPackaged) {
        staticPath = path.join(process.resourcesPath, 'webapp');
    } else {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const possiblePaths = [
            path.join(process.cwd(), 'apps/ezplayer-ui-react/dist'),
            path.join(__dirname, '../../ezplayer-ui-react/dist'),
            path.join(__dirname, '../ezplayer-ui-react/dist'),
        ];

        staticPath = '';
        for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
                staticPath = possiblePath;
                break;
            }
        }

        if (!staticPath) {
            console.warn(`⚠️ React build not found! Please run: pnpm --filter @ezplayer/ui-react build:web`);
            staticPath = possiblePaths[0];
        }
    }

    const indexPath = path.join(staticPath, 'index.html');

    // Create HTTP server
    const httpServer = createServer(webApp.callback());

    // Create WebSocket server
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
    });

    // Initialize WebSocket broadcaster with the WebSocket server
    wsBroadcaster.initialize(wss);

    // Handle WebSocket connections
    wss.on('connection', (ws) => {
        wsBroadcaster.addClient(ws);
        sendInitialDataToClient(ws);

        ws.on('close', () => {
            wsBroadcaster.removeClient(ws);
        });

        ws.on('error', (error: Error) => {
            console.error('❌ WebSocket error:', error);
            wsBroadcaster.removeClient(ws);
        });
    });

    function sendInitialDataToClient(ws: WebSocket) {
        const snapshot = getCurrentShowData();

        const safeSend = (type: string, data: any) => {
            if (data === undefined) {
                return;
            }
            try {
                ws.send(
                    JSON.stringify({
                        type,
                        data,
                        timestamp: Date.now(),
                    }),
                );
            } catch (error) {
                console.warn(`Failed to send initial "${type}" payload to WebSocket client:`, error);
            }
        };

        if (snapshot.showFolder) {
            safeSend('update:showFolder', snapshot.showFolder);
        }
        safeSend('update:sequences', snapshot.sequences ?? []);
        safeSend('update:playlist', snapshot.playlists ?? []);
        safeSend('update:schedule', snapshot.schedule ?? []);
        if (snapshot.user) {
            safeSend('update:user', snapshot.user);
        }
        if (snapshot.show) {
            safeSend('update:show', snapshot.show);
        }
        safeSend('update:combinedstatus', snapshot.status ?? {});
    }

    // API routes middleware
    webApp.use(async (ctx: any, next: () => Promise<any>) => {
        if (ctx.path.startsWith('/api/')) {
            switch (ctx.path) {
                case '/api/hello':
                    ctx.body = { message: 'Hello from Koa + Electron!' };
                    return;
                case '/api/current-show':
                    ctx.body = getCurrentShowData();
                    return;
                case '/api/player-command':
                    if (ctx.method !== 'POST') {
                        ctx.status = 405;
                        ctx.body = { error: 'Method not allowed. Use POST.' };
                        return;
                    }
                    try {
                        const command = ctx.request.body as EZPlayerCommand;
                        if (!command || !command.command) {
                            ctx.status = 400;
                            ctx.body = { error: 'Invalid command format' };
                            return;
                        }
                        // Send command to the playback worker
                        if (playWorker) {
                            playWorker.postMessage({
                                type: 'frontendcmd',
                                cmd: command,
                            });
                            ctx.body = { success: true, message: 'Command sent' };
                        } else {
                            ctx.status = 503;
                            ctx.body = { error: 'Playback worker not available' };
                        }
                    } catch (error) {
                        console.error('Error processing player command:', error);
                        ctx.status = 500;
                        ctx.body = { error: 'Internal server error' };
                    }
                    return;
                case '/api/playlists':
                    if (ctx.method !== 'POST') {
                        ctx.status = 405;
                        ctx.body = { error: 'Method not allowed. Use POST.' };
                        return;
                    }
                    try {
                        const playlists = ctx.request.body;
                        if (!Array.isArray(playlists)) {
                            ctx.status = 400;
                            ctx.body = { error: 'Invalid playlists format. Expected array.' };
                            return;
                        }
                        const result = await updatePlaylistsHandler(playlists);
                        ctx.body = { success: true, playlists: result };
                    } catch (error) {
                        console.error('Error processing playlists update:', error);
                        ctx.status = 500;
                        ctx.body = { error: 'Internal server error' };
                    }
                    return;
                case '/api/schedules':
                    if (ctx.method !== 'POST') {
                        ctx.status = 405;
                        ctx.body = { error: 'Method not allowed. Use POST.' };
                        return;
                    }
                    try {
                        const schedules = ctx.request.body;
                        if (!Array.isArray(schedules)) {
                            ctx.status = 400;
                            ctx.body = { error: 'Invalid schedules format. Expected array.' };
                            return;
                        }
                        const result = await updateScheduleHandler(schedules);
                        ctx.body = { success: true, schedules: result };
                    } catch (error) {
                        console.error('Error processing schedules update:', error);
                        ctx.status = 500;
                        ctx.body = { error: 'Internal server error' };
                    }
                    return;
                case '/api/playback-settings':
                    if (ctx.method !== 'POST') {
                        ctx.status = 405;
                        ctx.body = { error: 'Method not allowed. Use POST.' };
                        return;
                    }
                    try {
                        const settings = ctx.request.body;
                        if (!settings || typeof settings !== 'object') {
                            ctx.status = 400;
                            ctx.body = { error: 'Invalid playback settings format. Expected object.' };
                            return;
                        }
                        // Import the settings handler
                        const { applySettingsFromRenderer } = await import('./data/SettingsStorage.js');
                        const showFolder = getCurrentShowFolder();
                        if (showFolder) {
                            await applySettingsFromRenderer(path.join(showFolder, 'playbackSettings.json'), settings);
                        }
                        // Send settings to playback worker
                        if (playWorker) {
                            playWorker.postMessage({
                                type: 'settings',
                                settings,
                            });
                        }
                        // Broadcast to Electron renderer and web clients
                        mainWindow?.webContents?.send('update:playbacksettings', settings);
                        wsBroadcaster.broadcast('update:playbacksettings', settings);

                        ctx.body = { success: true };
                    } catch (error) {
                        console.error('Error processing playback settings update:', error);
                        ctx.status = 500;
                        ctx.body = { error: 'Internal server error' };
                    }
                    return;
                default:
                    ctx.status = 404;
                    ctx.body = { error: 'API endpoint not found' };
                    return;
            }
        }
        await next();
    });

    // Show assets route middleware
    // const userImageRoutePrefix = `${USER_IMAGE_ROUTE}/`;
    // webApp.use(async (ctx: any, next: () => Promise<any>) => {
    //     if (!ctx.path.startsWith('/show-assets/')) {
    //         return next();
    //     }

    //     // Set CORS headers
    //     ctx.set('Access-Control-Allow-Origin', '*');
    //     ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    //     ctx.set('Access-Control-Allow-Headers', 'Content-Type');

    //     if (ctx.method === 'OPTIONS') {
    //         ctx.status = 204;
    //         return;
    //     }

    //     const showFolder = getCurrentShowFolder();
    //     if (!showFolder) {
    //         ctx.status = 404;
    //         ctx.body = 'Show folder not selected';
    //         return;
    //     }
    //     const requestedPath = ctx.path.slice('/show-assets/'.length);
    //     // Convert forward slashes to platform-specific separators
    //     const platformPath = requestedPath.replace(/\//g, path.sep);
    //     const normalized = path
    //         .normalize(platformPath)
    //         .replace(/^[\\/]+/, '')
    //         .replace(/(\.\.(\/|\\|$))+/g, '');
    //     if (!normalized) {
    //         ctx.status = 404;
    //         return;
    //     }
    //     const targetPath = path.join(showFolder, normalized);
    //     const resolvedTarget = path.resolve(targetPath);
    //     const resolvedBase = path.resolve(showFolder);
    //     if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    //         ctx.status = 403;
    //         ctx.body = 'Forbidden';
    //         return;
    //     }
    //     try {
    //         const stats = await fs.promises.stat(resolvedTarget);
    //         if (!stats.isFile()) {
    //             ctx.status = 404;
    //             return;
    //         }
    //         ctx.type = inferMimeType(resolvedTarget);
    //         ctx.body = fs.createReadStream(resolvedTarget);
    //     } catch (_err) {
    //         ctx.status = 404;
    //         ctx.body = 'Asset not found';
    //     }
    // });

    // // User images route middleware
    // webApp.use(async (ctx: any, next: () => Promise<any>) => {
    //     if (ctx.path !== USER_IMAGE_ROUTE && !ctx.path.startsWith(userImageRoutePrefix)) {
    //         return next();
    //     }

    //     ctx.set('Access-Control-Allow-Origin', '*');
    //     ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    //     ctx.set('Access-Control-Allow-Headers', 'Content-Type');

    //     if (ctx.method === 'OPTIONS') {
    //         ctx.status = 204;
    //         return;
    //     }

    //     const requestedPath = ctx.path === USER_IMAGE_ROUTE ? '' : ctx.path.slice(userImageRoutePrefix.length);
    //     if (!requestedPath) {
    //         ctx.status = 404;
    //         ctx.body = 'Asset not found';
    //         return;
    //     }
    //     const platformPath = requestedPath.replace(/\//g, path.sep);
    //     const normalized = path
    //         .normalize(platformPath)
    //         .replace(/^[\\/]+/, '')
    //         .replace(/(\.\.(\/|\\|$))+/g, '');
    //     if (!normalized) {
    //         ctx.status = 404;
    //         return;
    //     }
    //     const targetPath = path.join(resolvedUserImageDir, normalized);
    //     const resolvedTarget = path.resolve(targetPath);
    //     const resolvedBase = path.resolve(resolvedUserImageDir);
    //     if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    //         ctx.status = 403;
    //         ctx.body = 'Forbidden';
    //         return;
    //     }
    //     try {
    //         const stats = await fs.promises.stat(resolvedTarget);
    //         if (!stats.isFile()) {
    //             ctx.status = 404;
    //             return;
    //         }
    //         ctx.type = inferMimeType(resolvedTarget);
    //         ctx.body = fs.createReadStream(resolvedTarget);
    //     } catch (_err) {
    //         ctx.status = 404;
    //         ctx.body = 'Asset not found';
    //     }
    // });

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

        if (fs.existsSync(indexPath)) {
            ctx.type = 'text/html';
            ctx.body = fs.readFileSync(indexPath, 'utf-8');
        } else {
            ctx.status = 404;
            ctx.body = 'React app not built. Please run: cd apps/ezplayer-ui-react && pnpm build:web';
        }
    });

    // Start the server
    httpServer.listen(port, () => {
        console.log(`🌐 Koa server running at http://localhost:${port}`);
        console.log(`🔌 WebSocket server available at ws://localhost:${port}/ws`);
    });

    return httpServer;
}
