import { app, BrowserWindow, Menu } from 'electron';
import { Worker, workerData } from 'node:worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { registerFileListHandlers } from './mainsrc/ipcmain.js';
import { registerContentHandlers, getCurrentShowData } from './mainsrc/ipcezplayer.js';
import { ClockConverter } from './sharedsrc/ClockConverter.js';
import { closeShowFolder, ensureExclusiveFolder } from './showfolder.js';
import { getWebPort } from './webport.js';
import { PlaybackWorkerData } from './mainsrc/workers/playbacktypes.js';
import { ezpVersions } from './versions.js';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import serve from 'koa-static';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { wsBroadcaster } from './mainsrc/websocket-broadcaster.js';
import { getCurrentShowFolder } from './showfolder.js';
import type { EZPlayerCommand } from '@ezplayer/ezplayer-core';

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

function inferMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return ASSET_MIME_TYPES[ext] ?? 'application/octet-stream';
}

//import { begin as hirezBegin } from './mainsrc/win-hirez-timer/winhirestimer.js';
//hirezBegin();
//import { setProcessAffinity } from './mainsrc/affinity/affinity.js';
//setProcessAffinity([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);

// catch as early as possible
process.on('uncaughtException', (err) => {
    const msg = `[uncaughtException] ${err.stack || err.message}\n`;
    try {
        fs.appendFileSync(mainCrashLogFile, msg);
    } catch {}
    console.error(msg);
});
process.on('unhandledRejection', (reason: any) => {
    const msg = `[unhandledRejection] ${reason?.stack || String(reason)}\n`;
    try {
        fs.appendFileSync(mainCrashLogFile, msg);
    } catch {}
    console.error(msg);
});

const mainCrashLogFile = path.join(app.getPath('logs'), 'main-crash.log');
// optional: also force console logging
app.commandLine.appendSwitch('enable-logging', 'js-flags');

let mainWindow: BrowserWindow | null = null;
export function getMainWindow() {
    return mainWindow;
}

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

Menu.setApplicationMenu(null);

const createWindow = (showFolder: string) => {
    let iconFile = 'EZPlayerLogoTransparent.png';
    if (process.platform === 'win32') {
        iconFile = 'EZPlayerLogoTransparent.ico';
    } else if (process.platform === 'darwin') {
        iconFile = 'EZPlayerLogoTransparent.icns';
    }
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, `images/${iconFile}`)
        : path.join(__dirname, `images/${iconFile}`);

    // Splash screen
    const splash = new BrowserWindow({
        width: 500,
        height: 500,
        icon: iconPath,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        skipTaskbar: true,
        roundedCorners: true,
        hasShadow: true,
        resizable: false,
        show: true,
    });

    if (!app.isPackaged) {
        splash.loadURL('http://localhost:5173/splash.html');
    } else {
        splash.loadURL(`file://${path.join(__dirname, '../dist/splash.html')}`);
    }

    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: iconPath,
        show: false, // don't show until ready

        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            webSecurity: false,
            additionalArguments: [`--show-folder=${showFolder}`].filter(Boolean),
        },
    });

    const url = !app.isPackaged
        ? 'http://localhost:5173' // Vite dev server
        : `file://${path.join(__dirname, '../dist/index.html')}`;

    console.log('Loading URL:', url);
    mainWindow.loadURL(url);

    if (/*true || */ !app.isPackaged || process.env.EZP_OPEN_DEVTOOLS) {
        mainWindow.webContents.openDevTools(); // Open dev tools in development (or prod, be smart)
    }

    // When main window is ready, show it and destroy splash
    mainWindow.once('ready-to-show', () => {
        splash.destroy();
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.setAlwaysOnTop(true);
        mainWindow?.setAlwaysOnTop(false);

        //setTimeout(async ()=>console.log(JSON.stringify(await getAudioOutputDevices(mainWindow!), undefined, 4)), 3000);
        //setTimeout(async ()=>console.log(JSON.stringify(await getAudioSyncTime(mainWindow!), undefined, 4)), 3000);
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
};

const dateNowConverter = new ClockConverter('rtc', Date.now(), performance.now());

let dateRateTimeout: NodeJS.Timeout | undefined = undefined;
let playWorker: Worker | null = null;

app.whenReady().then(async () => {
    console.log(`Starting EZPlayer Version: ${JSON.stringify(ezpVersions, undefined, 4)}`);
    // Allow multiple Electron instances (do NOT call requestSingleInstanceLock)
    const showFolderSpec = await ensureExclusiveFolder();
    if (!showFolderSpec) {
        app.quit();
        return;
    }

    const userImageDir = path.join(app.getPath('userData'), 'user_data', 'images');
    const resolvedUserImageDir = path.resolve(userImageDir);
    await fs.promises.mkdir(resolvedUserImageDir, { recursive: true });

    const portInfo = getWebPort(true);
    const PORT = typeof portInfo === 'number' ? portInfo : portInfo.port;
    const source = typeof portInfo === 'number' ? 'Default' : portInfo.source;
    const hostEnv = process.env.EZP_WEB_HOST?.trim();
    const protocolEnv = process.env.EZP_WEB_PROTOCOL?.trim();
    const baseEnv = process.env.EZP_WEB_BASE_URL?.trim();
    const webHost = hostEnv && hostEnv.length > 0 ? hostEnv : 'localhost';
    const webProtocol = protocolEnv && protocolEnv.length > 0 ? protocolEnv : 'http';
    const defaultBaseUrl = `${webProtocol}://${webHost}:${PORT}`;
    const webBaseUrl = baseEnv && baseEnv.length > 0 ? baseEnv.replace(/\/+$/, '') : defaultBaseUrl;

    playWorker = new Worker(path.join(__dirname, 'workers/playbackmaster.js'), {
        workerData: {
            name: 'main',
            logFile: path.join(app.getPath('logs'), 'playbackmain.log'),
        } satisfies PlaybackWorkerData,
    });
    await new Promise<void>((resolve) => {
        const onMessage = (msg: any) => {
            if (msg.type === 'ready') {
                playWorker!.off('message', onMessage);
                resolve();
            }
        };
        playWorker!.on('message', onMessage);
    });

    registerFileListHandlers();
    createWindow(showFolderSpec);
    await registerContentHandlers(mainWindow, dateNowConverter, playWorker, {
        sequenceAssets: {
            imageStorageRoot: resolvedUserImageDir,
            imagePublicRoute: USER_IMAGE_ROUTE,
            imagePublicBaseUrl: webBaseUrl,
        },
    });

    // 🧩 Start Koa web server with WebSocket support
    const webApp = new Koa();
    console.log(`🌐 Starting Koa web server on port ${PORT} (source: ${source})`);

    // Add body parser middleware for JSON requests
    webApp.use(bodyParser());

    // Determine static path for React web app
    let staticPath: string;
    if (app.isPackaged) {
        staticPath = path.join(process.resourcesPath, 'webapp');
    } else {
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
                default:
                    ctx.status = 404;
                    ctx.body = { error: 'API endpoint not found' };
                    return;
            }
        }
        await next();
    });

    const userImageRoutePrefix = `${USER_IMAGE_ROUTE}/`;

    webApp.use(async (ctx: any, next: () => Promise<any>) => {
        if (!ctx.path.startsWith('/show-assets/')) {
            return next();
        }

        // Set CORS headers
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        ctx.set('Access-Control-Allow-Headers', 'Content-Type');

        if (ctx.method === 'OPTIONS') {
            ctx.status = 204;
            return;
        }

        const showFolder = getCurrentShowFolder();
        if (!showFolder) {
            ctx.status = 404;
            ctx.body = 'Show folder not selected';
            return;
        }
        const requestedPath = ctx.path.slice('/show-assets/'.length);
        // Convert forward slashes to platform-specific separators
        const platformPath = requestedPath.replace(/\//g, path.sep);
        const normalized = path
            .normalize(platformPath)
            .replace(/^[\\/]+/, '')
            .replace(/(\.\.(\/|\\|$))+/g, '');
        if (!normalized) {
            ctx.status = 404;
            return;
        }
        const targetPath = path.join(showFolder, normalized);
        const resolvedTarget = path.resolve(targetPath);
        const resolvedBase = path.resolve(showFolder);
        if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
            ctx.status = 403;
            ctx.body = 'Forbidden';
            return;
        }
        try {
            const stats = await fs.promises.stat(resolvedTarget);
            if (!stats.isFile()) {
                ctx.status = 404;
                return;
            }
            ctx.type = inferMimeType(resolvedTarget);
            ctx.body = fs.createReadStream(resolvedTarget);
        } catch (_err) {
            ctx.status = 404;
            ctx.body = 'Asset not found';
        }
    });

    webApp.use(async (ctx: any, next: () => Promise<any>) => {
        if (ctx.path !== USER_IMAGE_ROUTE && !ctx.path.startsWith(userImageRoutePrefix)) {
            return next();
        }

        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        ctx.set('Access-Control-Allow-Headers', 'Content-Type');

        if (ctx.method === 'OPTIONS') {
            ctx.status = 204;
            return;
        }

        const requestedPath = ctx.path === USER_IMAGE_ROUTE ? '' : ctx.path.slice(userImageRoutePrefix.length);
        if (!requestedPath) {
            ctx.status = 404;
            ctx.body = 'Asset not found';
            return;
        }
        const platformPath = requestedPath.replace(/\//g, path.sep);
        const normalized = path
            .normalize(platformPath)
            .replace(/^[\\/]+/, '')
            .replace(/(\.\.(\/|\\|$))+/g, '');
        if (!normalized) {
            ctx.status = 404;
            return;
        }
        const targetPath = path.join(resolvedUserImageDir, normalized);
        const resolvedTarget = path.resolve(targetPath);
        const resolvedBase = path.resolve(resolvedUserImageDir);
        if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
            ctx.status = 403;
            ctx.body = 'Forbidden';
            return;
        }
        try {
            const stats = await fs.promises.stat(resolvedTarget);
            if (!stats.isFile()) {
                ctx.status = 404;
                return;
            }
            ctx.type = inferMimeType(resolvedTarget);
            ctx.body = fs.createReadStream(resolvedTarget);
        } catch (_err) {
            ctx.status = 404;
            ctx.body = 'Asset not found';
        }
    });

    webApp.use(
        serve(staticPath, {
            index: false,
        }),
    );

    webApp.use(async (ctx: any, next: () => Promise<any>) => {
        await next();
        if ((ctx.path.endsWith('.js') || ctx.path.endsWith('.mjs')) && ctx.status === 200) {
            ctx.type = 'application/javascript; charset=utf-8';
        }
    });

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

    httpServer.listen(PORT, () => {
        console.log(`🌐 Koa server running at http://localhost:${PORT}`);
        console.log(`🔌 WebSocket server available at ws://localhost:${PORT}/ws`);
    });

    dateRateTimeout = setInterval(async () => {
        const mperfNow = performance.now();
        const mdateNow = Date.now();
        dateNowConverter.addSample(mdateNow, mperfNow);
    }, dateNowConverter.getSampleInterval());
});

app.on('before-quit', async () => {
    await closeShowFolder();
});

app.on('window-all-closed', () => {
    clearTimeout(dateRateTimeout);
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
    // This is for MacOS - for relaunching.  Use prev folder if we can get it.
    if (BrowserWindow.getAllWindows().length === 0) {
        const sf = await ensureExclusiveFolder();
        if (sf) {
            createWindow(sf);
        }
    }
});
