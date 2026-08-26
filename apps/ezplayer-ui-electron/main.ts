// earlycli must stay the first import: it applies --user-data-dir before
// showfolder/webport/ipcautoupdate construct their electron-stores.
import { cliUsage, getCliArgs, getUnknownVerb, isHeadless, isToolVerb } from './mainsrc/earlycli.js';
import { app, crashReporter, BrowserWindow, Menu, dialog } from 'electron';
import { Worker } from 'node:worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { trustSystemCAs } from './mainsrc/trustSystemCAs.js';

// Trust the OS cert store for Node-side TLS; must run before any outbound HTTPS.
trustSystemCAs();
import { reportDiagEvent } from './mainsrc/diagnostics.js';
import { registerFileListHandlers } from './mainsrc/ipcmain.js';
import {
    isScheduleActive,
    loadShowFolder,
    registerContentHandlers,
    stopPlayerPlayback,
} from './mainsrc/ipcezplayer.js';
import { registerAutoUpdateHandlers, cleanupAutoUpdate } from './mainsrc/ipcautoupdate.js';
import { registerLoginItemHandlers } from './mainsrc/ipcLoginItem.js';
import {
    clearPersistedShowFolder,
    closeShowFolder,
    ensureExclusiveFolder,
    ensureExclusiveFolderHeadless,
    getWelcomeShowCloud,
    hasValidConfiguredShowFolder,
    setWelcomeShowCloud,
} from './showfolder.js';
import { session, ipcMain } from 'electron';
import { getWebPort, getKioskPort } from './webport.js';
import { PlaybackWorkerData } from './mainsrc/workers/playbacktypes.js';
import { ezpVersions } from './versions.js';
import { setUpServerWorker, shutdownServerWorker } from './mainsrc/server-worker-manager.js';
import { runCli } from './cli/dispatch.js';
import type { Event as ElectronEvent } from 'electron';
import {
    audioWindowDevUrl,
    audioWindowHtmlPath,
    configureAudioWindowPaths,
    destroyAllAudioWindows,
    setAudioWindowsEnabled,
    syncAudioOutputDevices,
} from './mainsrc/audioWindows.js';

import os from 'os';

// Linux: Ubuntu 24.04+ AppArmor blocks unprivileged user namespaces; older distros lack SUID sandbox helper.
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('no-sandbox');
    if (isHeadless()) {
        // --ozone-platform=headless must be on the real command line (the
        // native layer consumes it before this code runs); see cli.md.
        app.commandLine.appendSwitch('disable-gpu');
    }
}

const dumpDir = path.join(os.homedir(), 'ezplay-dumps');

app.setPath('crashDumps', dumpDir);

crashReporter.start({
    uploadToServer: false,
    compress: false,
    submitURL: 'https://invalid.local', // required but unused
});

console.log('Crash dumps directory:', dumpDir);

//import { begin as hirezBegin } from './mainsrc/win-hirez-timer/winhirestimer.js';
//hirezBegin();
//import { setProcessAffinity } from './mainsrc/affinity/affinity.js';
//setProcessAffinity([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);

// Declared before the handlers below reference it — a crash during early
// startup used to hit the TDZ inside the handler and silently lose the log.
const mainCrashLogFile = path.join(app.getPath('logs'), 'main-crash.log');

// catch as early as possible
process.on('uncaughtException', (err) => {
    const msg = `[uncaughtException] ${err.stack || err.message}\n`;
    try {
        fs.appendFileSync(mainCrashLogFile, msg);
    } catch {
        /* best-effort crash log */
    }
    console.error(msg);
    reportDiagEvent('uncaughtException', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    const r = reason as Error | undefined;
    const msg = `[unhandledRejection] ${r?.stack || String(reason)}\n`;
    try {
        fs.appendFileSync(mainCrashLogFile, msg);
    } catch {
        /* best-effort crash log */
    }
    console.error(msg);
    reportDiagEvent('unhandledRejection', String(r?.message ?? reason), r?.stack);
});

// optional: also force console logging
app.commandLine.appendSwitch('enable-logging', 'js-flags');

app.on('render-process-gone', (_event, _webContents, details) => {
    console.error('app render-process-gone', details);
    reportDiagEvent('render-process-gone', details.reason, undefined, details);
});

app.on('child-process-gone', (_event, details) => {
    console.error('app child-process-gone', details);
    reportDiagEvent('child-process-gone', details.reason, undefined, details);
});

let mainWindow: BrowserWindow | null = null;
export function getMainWindow() {
    return mainWindow;
}

export { getAudioWindows as getAudioWindow } from './mainsrc/audioWindows.js';

let isQuitting = false;

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

Menu.setApplicationMenu(null);

const createWindow = (showFolder?: string, showWelcomeOnLaunch?: boolean) => {
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
    const splashShownAt = Date.now();

    configureAudioWindowPaths({
        preloadPath: path.join(__dirname, 'preload-audio.js'),
        htmlFilePath: audioWindowHtmlPath(__dirname),
        // Dev must use Vite — dist/audio-window.html is only refreshed on build:react
        // and a stale bundle ignores sinkId (every window plays the system default).
        htmlBaseUrl: audioWindowDevUrl(),
    });
    // Default sink until show-folder settings load (may expand to N devices).
    syncAudioOutputDevices(undefined);

    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        icon: iconPath,
        show: false, // don't show until ready

        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            webSecurity: false,
            additionalArguments: [
                showFolder ? `--show-folder=${showFolder}` : undefined,
                `--show-welcome=${showWelcomeOnLaunch ? 'true' : 'false'}`,
            ].filter(Boolean) as string[],
            // enableWebGL: true,
            offscreen: false,
        },
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('wc render-process-gone', details);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
        console.error('did-fail-load', { code, desc, url });
        reportDiagEvent('did-fail-load', desc, undefined, { code, url });
    });
    // The "white screen" signal: the renderer's event loop stopped servicing
    // input. render-process-gone catches crashes; this catches hangs.
    mainWindow.webContents.on('unresponsive', () => {
        console.error('main window unresponsive');
        reportDiagEvent('unresponsive', 'main window unresponsive');
    });
    mainWindow.webContents.on('responsive', () => {
        console.error('main window responsive again');
    });

    const url = !app.isPackaged
        ? 'http://localhost:5173' // Vite dev server
        : `file://${path.join(__dirname, '../dist/index.html')}`;

    console.log('Loading URL:', url);
    mainWindow.loadURL(url);

    if (/*true ||*/ !app.isPackaged || process.env.EZP_OPEN_DEVTOOLS) {
        mainWindow.webContents.openDevTools(); // Open dev tools in development (or prod, be smart)
    }

    // Tear down the splash and reveal the main window. Idempotent: the
    // alwaysOnTop (TOPMOST) splash must never outlive startup, or it sits on top
    // of and hides modal dialogs like the auto-update prompt (~10s in). We run
    // this on ready-to-show and, as a safety net, on a hard fallback timer in
    // case ready-to-show never fires (e.g. the renderer failed to load).
    const SPLASH_MIN_MS = 1000;
    let startupFinished = false;
    const finishStartup = () => {
        if (startupFinished) return;
        // Hold the splash up for a minimum time so a fast startup doesn't flash it.
        const remaining = SPLASH_MIN_MS - (Date.now() - splashShownAt);
        if (remaining > 0) {
            setTimeout(finishStartup, remaining);
            return;
        }
        startupFinished = true;
        clearTimeout(splashFallback);
        if (!splash.isDestroyed()) splash.destroy();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.setAlwaysOnTop(false);
        }
    };
    mainWindow.once('ready-to-show', finishStartup);
    // Fire well before the auto-update prompt's ~10s delay so a stuck splash
    // cannot cover it.
    const splashFallback = setTimeout(finishStartup, 8000);
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
        destroyAllAudioWindows();
        mainWindow = null;
        // app quit?
    });
};

let playWorker: Worker | null = null;

async function startPlaybackWorker(): Promise<Worker> {
    const worker = new Worker(path.join(__dirname, 'workers/playbackmaster.js'), {
        workerData: {
            name: 'main',
            logFile: path.join(app.getPath('logs'), 'playbackmain.log'),
        } satisfies PlaybackWorkerData,
    });
    await new Promise<void>((resolve) => {
        const onMessage = (msg: { type?: string }) => {
            if (msg.type === 'ready') {
                worker.off('message', onMessage);
                resolve();
            }
        };
        worker.on('message', onMessage);
    });
    return worker;
}

/** The `headless` verb: full player, zero BrowserWindows, dialogs become
 *  fail-fast exit codes. */
async function startHeadless() {
    const resolved = await ensureExclusiveFolderHeadless();
    if ('error' in resolved) {
        console.error(`EZPlayer headless: ${resolved.error}`);
        // app.quit() always exits 0; nothing needs before-quit cleanup yet
        app.exit(resolved.exitCode);
        return;
    }
    console.log(`EZPlayer headless: using show folder ${resolved.folder}`);

    // No local speakers in headless — keep decoding/streaming for web/cloud only.
    setAudioWindowsEnabled(false);

    // persist:false — never write headless CLI values into stored preferences
    const portInfo = getWebPort({ persist: false });
    const kioskPortInfo = getKioskPort({ persist: false });

    playWorker = await startPlaybackWorker();

    registerFileListHandlers();
    registerLoginItemHandlers();
    await registerContentHandlers(null, playWorker);

    // Stop playback, then app.quit() so 'before-quit' releases the folder lock.
    const shutdown = (signal: NodeJS.Signals) => {
        if (isQuitting) return;
        isQuitting = true;
        console.log(`EZPlayer headless: ${signal} received, shutting down`);
        void stopPlayerPlayback()
            .catch((err) => console.error(`Failed to stop player playback: ${err}`))
            .finally(() => app.quit());
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await setUpServerWorker({
            port: portInfo.port,
            portSource: portInfo.source,
            playWorker,
            mainWindow: null,
            getMainWindow,
            distDir: __dirname,
            kioskPort: kioskPortInfo?.port,
            kioskPortSource: kioskPortInfo?.source,
        });
    } catch (e) {
        console.error(e);
    }

    // No renderer to send ipcUIConnect — load the show content ourselves.
    await loadShowFolder();
    console.log(`EZPlayer headless: ready on web port ${portInfo.port}`);
}

if (isToolVerb()) {
    // Text-only verbs (discover/interfaces) run and exit without ever creating a
    // window or starting workers — unlike `headless`, which is a full player with
    // no windows. app.exit() tears down abruptly, so flush stdout first (the empty
    // write's callback fires after buffered output drains) to avoid truncating.
    const exitFlushed = (code: number) => process.stdout.write('', () => app.exit(code));
    runCli(getCliArgs()).then(exitFlushed, (e) => {
        console.error(e);
        exitFlushed(1);
    });
} else
    app.whenReady().then(async () => {
        console.log(`Starting EZPlayer Version: ${JSON.stringify(ezpVersions, undefined, 4)}`);

        // Chromium gates non-default AudioContext.setSinkId behind speaker-selection.
        // Without this, every audio window falls back to the system default sink —
        // so multi-output looks like "only one device plays". Desktop player: allow.
        session.defaultSession.setPermissionCheckHandler(() => true);
        session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
            callback(true);
        });

        // Reset CLI flags — wipe persisted state and quit. Variants differ in what
        // welcome-screen cloud-CTA value they leave persisted for the next launch.
        //   --reset          : clear state, cloud-CTA enabled afterwards (current default)
        //   --reset-cloud    : clear state, cloud-CTA enabled afterwards (explicit alias of --reset)
        //   --reset-nocloud  : clear state, cloud-CTA disabled (pin for local-only first run)
        const wantResetCloud = process.argv.includes('--reset-cloud');
        const wantResetNoCloud = process.argv.includes('--reset-nocloud');
        const wantReset = process.argv.includes('--reset') || wantResetCloud || wantResetNoCloud;
        if (wantReset) {
            try {
                clearPersistedShowFolder();
                await session.defaultSession.clearStorageData({ storages: ['localstorage'] });
                // Write the cloud-CTA flag AFTER clearing storage. (The flag is in
                // electron-store, separate from localStorage, but order doesn't hurt.)
                // Cloud is the default now; only --reset-nocloud pins local-only.
                const showCloudAfterReset = !wantResetNoCloud;
                setWelcomeShowCloud(showCloudAfterReset);
                console.log(
                    `[reset] cleared show-folder + localStorage; welcomeShowCloud=${showCloudAfterReset} (mode=${
                        wantResetCloud ? 'reset-cloud' : wantResetNoCloud ? 'reset-nocloud' : 'reset'
                    })`,
                );
            } catch (e) {
                console.warn('[reset] failed:', (e as Error).message);
            }
            app.quit();
            return;
        }

        const unknownVerb = getUnknownVerb();
        if (unknownVerb) {
            console.error(`EZPlayer: unknown command '${unknownVerb}'\n\n${cliUsage()}`);
            app.exit(64);
            return;
        }

        if (isHeadless()) {
            await startHeadless();
            return;
        }

        const shouldShowWelcome = !(await hasValidConfiguredShowFolder());
        let showFolderSpec: string | null = null;
        if (!shouldShowWelcome) {
            // Allow multiple Electron instances (do NOT call requestSingleInstanceLock)
            showFolderSpec = await ensureExclusiveFolder();
            if (!showFolderSpec) {
                app.quit();
                return;
            }
        }

        const portInfo = getWebPort();
        const port = portInfo.port;
        const portSource = portInfo.source;

        const kioskPortInfo = getKioskPort();
        const kioskPort = kioskPortInfo?.port;
        const kioskPortSource = kioskPortInfo?.source;

        playWorker = await startPlaybackWorker();

        registerFileListHandlers();
        registerLoginItemHandlers();
        createWindow(showFolderSpec ?? undefined, shouldShowWelcome);

        // Renderer reads this on Welcome mount via electronAPI.getWelcomeShowCloud.
        ipcMain.handle('ipcGetWelcomeShowCloud', async () => getWelcomeShowCloud());

        await registerContentHandlers(mainWindow, playWorker);

        if (app.isPackaged) {
            registerAutoUpdateHandlers(mainWindow!);
        }

        // Start web server / WebSocket in worker thread
        try {
            await setUpServerWorker({
                port,
                portSource,
                playWorker,
                mainWindow,
                getMainWindow,
                distDir: __dirname, // Pass __dirname from main.ts to ensure correct path resolution
                kioskPort,
                kioskPortSource,
            });
        } catch (e) {
            console.error(e);
        }
    });

app.on('before-quit', async () => {
    cleanupAutoUpdate();
    await shutdownServerWorker();
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
