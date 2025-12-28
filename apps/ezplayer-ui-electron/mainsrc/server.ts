import Koa from 'koa';
import bodyParser from '@koa/bodyparser';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server } from 'http';
import * as path from 'path';
import * as fs from 'fs';
import fsp from 'fs/promises';
import { app, BrowserWindow } from 'electron';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'url';
import { wsBroadcaster } from './websocket-broadcaster.js';
import { getCurrentShowFolder } from '../showfolder.js';
import {
    getCurrentShowData,
    getSequenceThumbnail,
    updatePlaylistsHandler,
    updateScheduleHandler,
} from './ipcezplayer.js';
import type { EZPlayerCommand } from '@ezplayer/ezplayer-core';
import Router from '@koa/router';
import { send } from '@koa/send';
import serve from 'koa-static';
import { applySettingsFromRenderer } from './data/SettingsStorage.js';

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

export interface ServerConfig {
    port: number;
    portSource: string;
    playWorker: Worker | null;
    mainWindow: BrowserWindow | null;
}

async function exists(path: string): Promise<boolean> {
    try {
        await fsp.access(path, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}
/**
 * Sets up and starts the Koa web server with WebSocket support
 * @param config Server configuration
 * @returns The HTTP server instance
 */
export async function setUpServer(config: ServerConfig): Promise<Server> {
    const { port, portSource, playWorker, mainWindow } = config;

    console.log(`🌐 Starting Koa web server on port ${port} (source: ${portSource})`);
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

        const seqfile = getSequenceThumbnail(sequenceId);

        if (!seqfile) {
            ctx.status = 404;
            ctx.body = { error: 'Image not found for sequence ID' };
            return;
        }

        // Set appropriate MIME type
        ctx.type = inferMimeType(seqfile);
        await send(ctx, path.basename(seqfile), { root: path.dirname(seqfile) });
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
        ctx.body = getCurrentShowData();
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
            const result = await updatePlaylistsHandler(playlists);
            ctx.body = { success: true, playlists: result };
        } catch (error) {
            console.error('Error processing playlists update:', error);
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
            const result = await updateScheduleHandler(schedules);
            ctx.body = { success: true, schedules: result };
        } catch (error) {
            console.error('Error processing schedules update:', error);
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
            const showFolder = getCurrentShowFolder();
            if (showFolder) {
                applySettingsFromRenderer(path.join(showFolder, 'playbackSettings.json'), settings);
            }
            if (playWorker) {
                playWorker.postMessage({
                    type: 'settings',
                    settings,
                });
            }
            mainWindow?.webContents?.send('update:playbacksettings', settings);
            wsBroadcaster.set('playbackSettings', settings);

            ctx.body = { success: true };
        } catch (error) {
            console.error('Error processing playback settings update:', error);
            ctx.status = 500;
            ctx.body = { error: 'Internal server error' };
        }
    });

    webApp.use(router.routes());
    webApp.use(router.allowedMethods());

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
            console.warn(`⚠️ React build not found! Please run: pnpm --filter @ezplayer/ui-embedded build:web`);
            staticPath = possiblePaths[0];
        }
    }

    const indexPath = path.join(staticPath, 'index.html');

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
        console.log(`🌐 Koa server running at http://localhost:${port}`);
        console.log(`🔌 WebSocket server available at ws://localhost:${port}/ws`);
    });

    // Create WebSocket server
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
    });

    // Initialize WebSocket broadcaster with the WebSocket server
    wsBroadcaster.attach(wss);

    return httpServer;
}
