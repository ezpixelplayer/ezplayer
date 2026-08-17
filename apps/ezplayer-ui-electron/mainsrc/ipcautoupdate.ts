import { safeSend } from './safe-send.js';
import { app, ipcMain, powerMonitor, BrowserWindow } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import Store from 'electron-store';
import { isScheduleActive } from './ipcezplayer.js';
import type { AutoUpdateMode, AutoUpdateSettings, AutoUpdateStatus, InstallUpdateResult } from '@ezplayer/ezplayer-core';

const store = new Store<{ skippedUpdateVersions: string[]; autoUpdateMode: AutoUpdateMode }>();

let mainWin: BrowserWindow | null = null;
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
let updateDownloaded = false;

function sendStatus(status: AutoUpdateStatus) {
    safeSend(mainWin, 'update:autoupdate-status', status);
}

function getMode(): AutoUpdateMode {
    return store.get('autoUpdateMode', 'auto-check');
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

function getSettings(): AutoUpdateSettings {
    return {
        mode: getMode(),
        currentVersion: app.getVersion(),
        skippedVersions: getSkippedVersions(),
    };
}

// ── electron-updater event wiring ──────────────────────────────────

function wireUpdaterEvents() {
    autoUpdater.on('checking-for-update', () => {
        sendStatus({ state: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
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

// No dialogs here: the check emits status events and the renderer decides
// whether to surface a reminder (auto-check mode, version not skipped).
async function startupCheck() {
    if (app.commandLine.hasSwitch('no-update-check')) return;
    if (getMode() !== 'auto-check') return;

    // Delay the check so the UI has time to settle
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    try {
        await autoUpdater.checkForUpdates();
    } catch {
        // Network error, offline, etc. — silently skip
    }
}

// ── Idle auto-download ─────────────────────────────────────────────

function startIdleWatcher() {
    if (app.commandLine.hasSwitch('no-update-check')) return;

    idleCheckInterval = setInterval(async () => {
        // Mode is re-read each tick so a settings change applies without restart
        if (getMode() !== 'auto-check') return;
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

        // checkForUpdates() populates `updateInfo` with the feed's latest version even
        // when we're already on it. `isUpdateAvailable` is the only field that means
        // "a newer version exists".
        if (!result?.isUpdateAvailable) return;
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
    ipcMain.handle('autoupdate:get-settings', (): AutoUpdateSettings => getSettings());

    ipcMain.handle('autoupdate:set-mode', (_event, mode: AutoUpdateMode): AutoUpdateSettings => {
        store.set('autoUpdateMode', mode);
        return getSettings();
    });

    ipcMain.handle('autoupdate:skip-version', (_event, version: string): AutoUpdateSettings => {
        addSkippedVersion(version);
        return getSettings();
    });

    ipcMain.handle('autoupdate:clear-skipped', (): AutoUpdateSettings => {
        store.set('skippedUpdateVersions', []);
        return getSettings();
    });

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

    ipcMain.handle('autoupdate:install-now', (_event, force?: boolean): InstallUpdateResult => {
        // The renderer confirms with the user before forcing past an active
        // schedule; this guard is the last line against an unconfirmed restart.
        if (isScheduleActive() && !force) {
            autoUpdater.autoInstallOnAppQuit = true;
            return 'deferred';
        }
        autoUpdater.quitAndInstall();
        return 'installing';
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
    // Auto-update follows the stable channel only — a prerelease never trumps the
    // latest full release. Prereleases stay opt-in via a manual download from the
    // GitHub releases page.
    autoUpdater.allowPrerelease = false;

    // Quiet one-line logger.  electron-updater's default emits full stack
    // traces for routine 404s (missing latest.yml on disabled platforms,
    // etc.); collapse those to a single line and drop debug noise.
    autoUpdater.logger = {
        debug: () => {},
        info: (msg: unknown) =>
            console.log(`[AutoUpdate] ${typeof msg === 'string' ? msg : ((msg as Error)?.message ?? msg)}`),
        warn: (msg: unknown) =>
            console.warn(`[AutoUpdate] ${typeof msg === 'string' ? msg : ((msg as Error)?.message ?? msg)}`),
        error: (msg: unknown) => {
            const text = msg instanceof Error ? msg.message : typeof msg === 'string' ? msg : String(msg);
            console.error(`[AutoUpdate] ${text}`);
        },
    };

    wireUpdaterEvents();
    registerIPCHandlers();
    startIdleWatcher();

    // Fire startup check (non-blocking)
    startupCheck().catch((err) => console.error(`[AutoUpdate] startup check error: ${err?.message ?? err}`));
}

export function cleanupAutoUpdate() {
    if (idleCheckInterval) {
        clearInterval(idleCheckInterval);
        idleCheckInterval = null;
    }
}
