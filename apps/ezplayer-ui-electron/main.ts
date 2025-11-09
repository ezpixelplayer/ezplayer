import { app, BrowserWindow, Menu } from 'electron';
import { Worker, workerData } from 'node:worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { registerFileListHandlers } from './mainsrc/ipcmain.js';
import { registerContentHandlers } from './mainsrc/ipcezplayer.js';
import { ClockConverter } from './sharedsrc/ClockConverter.js';
import { closeShowFolder, ensureExclusiveFolder } from './showfolder.js';
import { PlaybackWorkerData } from './mainsrc/workers/playbacktypes.js';
import { ezpVersions } from './versions.js';

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
    // Splash screen
    const splash = new BrowserWindow({
        width: 500,
        height: 500,
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
