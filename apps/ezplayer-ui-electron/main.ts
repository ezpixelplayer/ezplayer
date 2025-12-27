import { app, BrowserWindow, Menu, dialog } from 'electron';
import { Worker } from 'node:worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { registerFileListHandlers } from './mainsrc/ipcmain.js';
import { isScheduleActive, registerContentHandlers, stopPlayerPlayback } from './mainsrc/ipcezplayer.js';
import { closeShowFolder, ensureExclusiveFolder } from './showfolder.js';
import { getWebPort } from './webport.js';
import { PlaybackWorkerData } from './mainsrc/workers/playbacktypes.js';
import { ezpVersions } from './versions.js';
import { setUpServer } from './mainsrc/server.js';
import type { Event as ElectronEvent } from 'electron';

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

let audioWindow: BrowserWindow | null = null;
export function getAudioWindow() {
    return audioWindow;
}

let isQuitting = false;

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

    audioWindow = new BrowserWindow({
        show: false,

        webPreferences: {
            preload: path.join(__dirname, 'preload-audio.js'),
            contextIsolation: true,
            webSecurity: false,
        },
    });

    // Light-weight HTML/JS just for audio
    audioWindow.loadURL(`file://${path.join(__dirname, '../dist/audio-window.html')}`);
    //audioWindow.webContents.openDevTools(); // Open dev tools in development (or prod, be smart)

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
    });
    const handleCloseRequest = async (event: ElectronEvent) => {
        if (!mainWindow) return;
        if (!isScheduleActive()) {
            // Preserve macOS behavior
            if (process.platform === 'darwin') {
                app.quit();
            }
            return;
        }

        event.preventDefault();
        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Exit', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            title: 'Exit EZPlayer?',
            message: 'A schedule is currently running. Do you want to exit?',
            detail: 'Exiting will turn off all pixels and stop the active schedule.',
            noLink: true,
            normalizeAccessKeys: true,
        });

        if (response === 0) {
            isQuitting = true;
            try {
                await stopPlayerPlayback();
            } catch (err) {
                console.error(`Failed to stop player playback: ${err}`);
            }
            app.quit();
        }
    };

    mainWindow.on('close', (event) => {
        if (isQuitting) {
            return;
        }
        void handleCloseRequest(event);
    });
    mainWindow.on('closed', () => {
        audioWindow?.destroy();
        audioWindow = null;
        mainWindow = null;
        // app quit?
    });
};

let playWorker: Worker | null = null;

app.whenReady().then(async () => {
    console.log(`Starting EZPlayer Version: ${JSON.stringify(ezpVersions, undefined, 4)}`);
    // Allow multiple Electron instances (do NOT call requestSingleInstanceLock)
    const showFolderSpec = await ensureExclusiveFolder();
    if (!showFolderSpec) {
        app.quit();
        return;
    }

    const portInfo = getWebPort();
    const port = portInfo.port;
    const portSource = portInfo.source;

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

    await registerContentHandlers(mainWindow, audioWindow, playWorker);

    // Start web server / WebSocket
    try {
        await setUpServer({
            port,
            portSource,
            playWorker,
            mainWindow,
        });
    } catch (e) {
        console.error(e);
    }
});

app.on('before-quit', async () => {
    await closeShowFolder();
});

app.on('window-all-closed', () => {
    // Quit on all platforms, including macOS
    app.quit();
});

// Note: 'activate' handler removed since we now quit on window close on macOS
// If we want to support reopening windows via dock click, we can restore this
// app.on('activate', async () => {
//     // This is for MacOS - for relaunching.  Use prev folder if we can get it.
//     if (BrowserWindow.getAllWindows().length === 0) {
//         const sf = await ensureExclusiveFolder();
//         if (sf) {
//             createWindow(sf);
//         }
//     }
// });
