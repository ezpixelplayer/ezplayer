import { safeSend } from './safe-send.js';
import { app, ipcMain, powerMonitor, BrowserWindow } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import Store from 'electron-store';
import { isScheduleActive } from './ipcezplayer.js';
import type {
    AutoUpdateMode,
    AutoUpdateOpsState,
    AutoUpdateSettings,
    AutoUpdateStatus,
    ReleaseInfo,
    UpdateCommand,
} from '@ezplayer/ezplayer-core';

const store = new Store<{ skippedUpdateVersions: string[]; autoUpdateMode: AutoUpdateMode }>();

// Matches the electron-builder publish target (root package.json `repository`).
const GH_OWNER = 'ezpixelplayer';
const GH_REPO = 'ezplayer';

let mainWin: BrowserWindow | null = null;
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
let updateDownloaded = false;

// Auto updater atomic status snapshot
let curStatus: AutoUpdateStatus | null = null;
let curReleases: ReleaseInfo[] | undefined = undefined;
let curReleasesError: string | undefined = undefined;
let installArmedOnQuit = false;

let opsBroadcaster: ((state: AutoUpdateOpsState) => void) | null = null;

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

export function getAutoUpdateOpsState(): AutoUpdateOpsState {
    return {
        settings: getSettings(),
        status: curStatus,
        releases: curReleases,
        releasesError: curReleasesError,
        installArmedOnQuit,
    };
}

export function publishAutoUpdateOps() {
    const state = getAutoUpdateOpsState();
    safeSend(mainWin, 'update:autoupdate-ops', state);
    opsBroadcaster?.(state);
}

/** Injected by server-worker-manager so ops state reaches LAN/cloud WS
 *  clients without a module cycle. Publishes current state on injection. */
export function setAutoUpdateOpsBroadcaster(fn: (state: AutoUpdateOpsState) => void) {
    opsBroadcaster = fn;
    publishAutoUpdateOps();
}

function setStatus(status: AutoUpdateStatus) {
    curStatus = status;
    publishAutoUpdateOps();
}

// ── electron-updater event wiring ──────────────────────────────────

function wireUpdaterEvents() {
    autoUpdater.on('checking-for-update', () => {
        setStatus({ state: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
        setStatus({
            state: 'available',
            version: info.version,
            releaseDate: info.releaseDate ?? '',
            releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        setStatus({ state: 'not-available', version: info.version });
    });

    autoUpdater.on('download-progress', (progress) => {
        setStatus({
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
        setStatus({ state: 'downloaded', version: info.version });
    });

    autoUpdater.on('error', (err) => {
        setStatus({ state: 'error', message: err.message });
    });
}

// ── Version picker (manual mode) ───────────────────────────────────

// While pinned, the feed points at one specific release instead of "latest".
let pinnedTag: string | null = null;

function restoreDefaultFeed() {
    if (!pinnedTag) return;
    pinnedTag = null;
    autoUpdater.allowDowngrade = false;
    autoUpdater.setFeedURL({ provider: 'github', owner: GH_OWNER, repo: GH_REPO });
}

async function listReleases() {
    try {
        const resp = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=30`, {
            headers: { Accept: 'application/vnd.github+json' },
        });
        if (!resp.ok) throw new Error(`GitHub releases request failed: ${resp.status}`);
        const releases = (await resp.json()) as {
            tag_name: string;
            draft: boolean;
            prerelease: boolean;
            published_at: string | null;
            body: string | null;
            assets: { name: string }[];
        }[];
        curReleases = releases
            .filter((r) => !r.draft && r.assets.some((a) => /^latest.*\.yml$/.test(a.name)))
            .map((r) => ({
                version: r.tag_name.replace(/^v/, ''),
                tag: r.tag_name,
                publishedAt: r.published_at ?? '',
                prerelease: r.prerelease,
                releaseNotes: r.body ?? undefined,
            }));
        curReleasesError = undefined;
    } catch (err) {
        curReleasesError = (err as Error).message;
    }
    publishAutoUpdateOps();
}

// Point the updater at one release's own latest*.yml and download it. Any
// version is fair game — downgrades and prereleases included — because this
// only runs on an explicit user pick in manual mode.
async function updateToVersion(tag: string) {
    if (getMode() !== 'manual') {
        setStatus({ state: 'error', message: 'Installing a specific version requires manual update mode.' });
        return;
    }
    pinnedTag = tag;
    autoUpdater.allowDowngrade = true;
    autoUpdater.setFeedURL({
        provider: 'generic',
        url: `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/${tag}`,
    });
    installArmedOnQuit = false;
    try {
        const result = await autoUpdater.checkForUpdates();
        // Same-version picks report 'not-available'; nothing to download.
        if (!result?.isUpdateAvailable) return;
        await autoUpdater.downloadUpdate();
    } catch (err) {
        setStatus({ state: 'error', message: (err as Error).message });
    }
}

// ── Command dispatch ───────────────────────────────────────────────

/** Single entry point for every transport: Electron IPC, LAN WS, cloud bridge.
 *  Fire and forget — outcomes flow back through the published ops state. */
export function dispatchUpdateCommand(cmd: UpdateCommand): void | Promise<void> {
    switch (cmd.type) {
        case 'setUpdateMode':
            store.set('autoUpdateMode', cmd.mode);
            // Leaving manual mode ends any version pin — auto checks track latest.
            if (cmd.mode !== 'manual') restoreDefaultFeed();
            publishAutoUpdateOps();
            break;
        case 'skipVersion':
            addSkippedVersion(cmd.version);
            publishAutoUpdateOps();
            break;
        case 'clearSkippedVersions':
            store.set('skippedUpdateVersions', []);
            publishAutoUpdateOps();
            break;
        case 'checkNow':
            // An explicit check always means "latest", never the pin.
            restoreDefaultFeed();
            return autoUpdater.checkForUpdates().then(
                () => undefined,
                (err) => setStatus({ state: 'error', message: (err as Error).message }),
            );
        case 'downloadNow':
            return autoUpdater.downloadUpdate().then(
                () => undefined,
                (err) => setStatus({ state: 'error', message: (err as Error).message }),
            );
        case 'installNow':
            // The UI confirms with the user before forcing past an active
            // schedule; this guard is the last line against an unconfirmed
            // restart. The deferral is visible as installArmedOnQuit.
            if (isScheduleActive() && !cmd.force) {
                autoUpdater.autoInstallOnAppQuit = true;
                installArmedOnQuit = true;
                publishAutoUpdateOps();
                break;
            }
            autoUpdater.quitAndInstall();
            break;
        case 'installOnQuit':
            autoUpdater.autoInstallOnAppQuit = true;
            installArmedOnQuit = true;
            publishAutoUpdateOps();
            break;
        case 'listReleases':
            return listReleases();
        case 'updateToVersion':
            return updateToVersion(cmd.tag);
        default: {
            const _exhaustive: never = cmd;
            console.warn('[AutoUpdate] unknown update command', _exhaustive);
        }
    }
}

// ── Startup check ──────────────────────────────────────────────────

// No dialogs here: the check publishes ops state and the renderer decides
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
    // Initial load: the invoke reply cannot be lost, unlike a push racing
    // the renderer's listener registration.
    ipcMain.handle('autoupdate:get-ops', (): AutoUpdateOpsState => getAutoUpdateOpsState());

    ipcMain.handle('autoupdate:command', (_event, cmd: UpdateCommand) => dispatchUpdateCommand(cmd));
}

// ── Public API ─────────────────────────────────────────────────────

export function registerAutoUpdateHandlers(win: BrowserWindow) {
    mainWin = win;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    // Auto-update follows the stable channel only — a prerelease never trumps the
    // latest full release. Prereleases stay opt-in via the manual-mode version picker.
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
