import { app, BrowserWindow, Menu } from 'electron';
import { Worker, workerData } from 'node:worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { registerFileListHandlers } from './mainsrc/ipcmain.js';
import { registerContentHandlers } from './mainsrc/ipcezplayer.js';
import { ClockConverter } from './sharedsrc/ClockConverter.js';
import { closeShowFolder, ensureExclusiveFolder } from './showfolder.js';
import { getWebPort } from './webport.js';
import { PlaybackWorkerData } from './mainsrc/workers/playbacktypes.js';
import { ezpVersions } from './versions.js';
import Koa from 'koa';
import serve from 'koa-static';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { wsBroadcaster } from './mainsrc/websocket-broadcaster.js';

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
    await registerContentHandlers(mainWindow, dateNowConverter, playWorker);

    // 🧩 Start Koa web server with WebSocket support
    const webApp = new Koa();
    const portInfo = getWebPort(true);
    const PORT = typeof portInfo === 'number' ? portInfo : portInfo.port;
    const source = typeof portInfo === 'number' ? 'Default' : portInfo.source;
    console.log(`🌐 Starting Koa web server on port ${PORT} (source: ${source})`);

    const staticPath = path.resolve(__dirname, '../../ezplayer-ui-react/dist');
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

        ws.on('close', () => {
            wsBroadcaster.removeClient(ws);
        });

        ws.on('error', (error: Error) => {
            console.error('❌ WebSocket error:', error);
            wsBroadcaster.removeClient(ws);
        });
    });

    webApp.use(async (ctx: any, next: () => Promise<any>) => {
        if (ctx.path.startsWith('/api/')) {
            if (ctx.path === '/api/hello') {
                ctx.body = { message: 'Hello from Koa + Electron!' };
            } else {
                ctx.status = 404;
                ctx.body = { error: 'API endpoint not found' };
            }
        } else {
            await next();
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
