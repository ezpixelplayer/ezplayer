import { app, dialog, ipcMain, powerMonitor, BrowserWindow } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import Store from 'electron-store';
import { isScheduleActive } from './ipcezplayer.js';
import type { AutoUpdateStatus } from '@ezplayer/ezplayer-core';

const store = new Store<{ skippedUpdateVersions: string[] }>();

let mainWin: BrowserWindow | null = null;
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
let updateDownloaded = false;
let availableVersion: string | null = null;

function sendStatus(status: AutoUpdateStatus) {
    mainWin?.webContents.send('update:autoupdate-status', status);
}

function getSkippedVersions(): string[] {
    return store.get('skippedUpdateVersions', []);
}

function addSkippedVersion(version: string) {
    const skipped = getSkippedVersions();
    if (!skipped.includes(version)) {
        skipped.push(version);
        store.set('skippedUpdateVersions', skipped);
    }
}

function isVersionSkipped(version: string): boolean {
    return getSkippedVersions().includes(version);
}

// ── electron-updater event wiring ──────────────────────────────────

function wireUpdaterEvents() {
    autoUpdater.on('checking-for-update', () => {
        sendStatus({ state: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        availableVersion = info.version;
        sendStatus({
            state: 'available',
            version: info.version,
            releaseDate: info.releaseDate ?? '',
            releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        sendStatus({ state: 'not-available', version: info.version });
    });

    autoUpdater.on('download-progress', (progress) => {
        sendStatus({
            state: 'downloading',
            percent: progress.percent,
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total,
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        updateDownloaded = true;
        autoUpdater.autoInstallOnAppQuit = true;
        sendStatus({ state: 'downloaded', version: info.version });
    });

    autoUpdater.on('error', (err) => {
        sendStatus({ state: 'error', message: err.message });
    });
}

// ── Startup check ──────────────────────────────────────────────────

async function startupCheck() {
    if (app.commandLine.hasSwitch('no-update-check')) return;

    // Delay the check so the UI has time to settle
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    let result;
    try {
        result = await autoUpdater.checkForUpdates();
    } catch {
        return; // Network error, offline, etc. — silently skip
    }

    if (!result?.updateInfo) return;

    const version = result.updateInfo.version;
    if (isVersionSkipped(version)) return;

    if (!mainWin) return;

    const { response } = await dialog.showMessageBox(mainWin, {
        type: 'info',
        buttons: ['Download && Install', 'Remind Me Later', 'Skip This Version'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update Available',
        message: `EZPlayer ${version} is available (you have ${app.getVersion()}).`,
        detail: 'Would you like to download and install this update?',
        noLink: true,
        normalizeAccessKeys: true,
    });

    if (response === 0) {
        // Download & Install
        try {
            await autoUpdater.downloadUpdate();
        } catch {
            return;
        }
        // If a schedule is active, defer to quit-time install
        if (isScheduleActive()) {
            if (mainWin) {
                await dialog.showMessageBox(mainWin, {
                    type: 'info',
                    buttons: ['OK'],
                    title: 'Update Ready',
                    message: 'A schedule is running. The update will install when you quit EZPlayer.',
                });
            }
        } else {
            autoUpdater.quitAndInstall();
        }
    } else if (response === 2) {
        // Skip This Version
        addSkippedVersion(version);
    }
    // response === 1 → Remind Me Later — do nothing
}

// ── Idle auto-download ─────────────────────────────────────────────

function startIdleWatcher() {
    idleCheckInterval = setInterval(async () => {
        // Only act if system idle >5min, no schedule running, update not yet downloaded
        if (updateDownloaded) return;
        if (isScheduleActive()) return;

        const idleSeconds = powerMonitor.getSystemIdleTime();
        if (idleSeconds < 300) return;

        let result;
        try {
            result = await autoUpdater.checkForUpdates();
        } catch {
            return;
        }

        if (!result?.updateInfo) return;
        if (isVersionSkipped(result.updateInfo.version)) return;

        try {
            await autoUpdater.downloadUpdate();
            // updateDownloaded and autoInstallOnAppQuit are set by the 'update-downloaded' event handler
        } catch {
            // Download failed — will retry next interval
        }
    }, 60_000);
}

// ── IPC handlers ───────────────────────────────────────────────────

function registerIPCHandlers() {
    ipcMain.handle('autoupdate:check', async () => {
        try {
            await autoUpdater.checkForUpdates();
        } catch (err: any) {
            sendStatus({ state: 'error', message: err.message });
        }
    });

    ipcMain.handle('autoupdate:download', async () => {
        try {
            await autoUpdater.downloadUpdate();
        } catch (err: any) {
            sendStatus({ state: 'error', message: err.message });
        }
    });

    ipcMain.handle('autoupdate:install-now', async () => {
        if (isScheduleActive()) {
            if (mainWin) {
                await dialog.showMessageBox(mainWin, {
                    type: 'info',
                    buttons: ['OK'],
                    title: 'Update Deferred',
                    message: 'A schedule is running. The update will install when you quit EZPlayer.',
                });
            }
            autoUpdater.autoInstallOnAppQuit = true;
            return;
        }
        autoUpdater.quitAndInstall();
    });

    ipcMain.handle('autoupdate:install-on-quit', () => {
        autoUpdater.autoInstallOnAppQuit = true;
    });
}

// ── Public API ─────────────────────────────────────────────────────

export function registerAutoUpdateHandlers(win: BrowserWindow) {
    mainWin = win;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = true;

    wireUpdaterEvents();
    registerIPCHandlers();
    startIdleWatcher();

    // Fire startup check (non-blocking)
    startupCheck().catch((err) => console.error('Auto-update startup check error:', err));
}

export function cleanupAutoUpdate() {
    if (idleCheckInterval) {
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
    }
}
