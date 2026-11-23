/**
 * Virtual matrix outputs: one BrowserWindow per enabled output, showing a
 * model's pixels full-screen on a chosen display or in a floating window at a
 * remembered spot. The window is just the player's own /matrix page, so any
 * browser on any device can show the same picture ('url' outputs open nothing).
 */
import { BrowserWindow, screen, type Display } from 'electron';
import type { PlaybackSettings, VirtualMatrixOutput } from '@ezplayer/ezplayer-core';

interface MatrixWindow {
    win: BrowserWindow;
    cfg: VirtualMatrixOutput;
    url: string;
    floating: boolean;
    /** Full screen: the id of the display it was opened on. */
    displayId?: number;
    /** Floating: the model's grid, once the page has reported it. */
    grid?: { width: number; height: number };
    /** Floating: the position last applied or reported, to tell our own moves from the user's. */
    at?: { x: number; y: number };
    moveTimer?: NodeJS.Timeout;
}

const windows = new Map<string, MatrixWindow>();
let enabled = true;
let webPort: number | undefined;
let lastSettings: PlaybackSettings | undefined;
let watchingDisplays = false;
let onMoved: ((id: string, x: number, y: number) => void) | undefined;

/** Size of a floating window before its model's grid is known. */
const PLACEHOLDER = { width: 320, height: 180 };

/** Headless / CLI runs open no windows. */
export function setMatrixWindowsEnabled(v: boolean) {
    enabled = v;
    if (!v) destroyAllMatrixWindows();
    else resync();
}

/** The page is served by the local web server; outputs open once its port is known. */
export function setMatrixWindowsWebPort(port: number | undefined) {
    if (webPort === port) return;
    webPort = port;
    resync();
}

export function syncMatrixWindowsFromSettings(settings: PlaybackSettings | undefined) {
    lastSettings = settings;
    resync();
}

/** Called when the user has dragged a floating window, so its place can be saved. */
export function setMatrixWindowMovedHandler(fn: (id: string, x: number, y: number) => void) {
    onMoved = fn;
}

export function destroyAllMatrixWindows() {
    for (const key of [...windows.keys()]) close(key);
}

/** Displays as the settings UI lists them: index order matches `display` in VirtualMatrixOutput. */
export function listDisplays() {
    const primary = screen.getPrimaryDisplay();
    return screen.getAllDisplays().map((d, index) => ({
        index,
        id: d.id,
        label: d.label || `Display ${index + 1}`,
        width: d.bounds.width,
        height: d.bounds.height,
        x: d.bounds.x,
        y: d.bounds.y,
        primary: d.id === primary.id,
    }));
}

function close(key: string) {
    const mw = windows.get(key);
    if (!mw) return;
    windows.delete(key);
    clearTimeout(mw.moveTimer);
    if (!mw.win.isDestroyed()) mw.win.destroy();
}

function urlFor(cfg: VirtualMatrixOutput): string {
    const floating = cfg.mode === 'window';
    const q = new URLSearchParams({
        model: cfg.model,
        smooth: cfg.smooth ? '1' : '0',
        // A floating window is sized for its picture, so the picture fills it.
        fit: floating || cfg.fit === 'fill' ? 'fill' : 'contain',
        out: cfg.id,
    });
    if (floating) q.set('drag', '1');
    return `http://127.0.0.1:${webPort}/matrix?${q.toString()}`;
}

/** The display an output asks for: by id while that display exists, else by position in the list. */
function displayFor(cfg: VirtualMatrixOutput): Display {
    const all = screen.getAllDisplays();
    return all.find((d) => d.id === cfg.displayId) ?? all[cfg.display ?? 0] ?? screen.getPrimaryDisplay();
}

const WEB_PREFERENCES = {
    contextIsolation: true,
    sandbox: true,
    // An output must keep painting even when it is not focused.
    backgroundThrottling: false,
};

function openFullScreen(cfg: VirtualMatrixOutput, url: string): MatrixWindow {
    const d = displayFor(cfg);
    const win = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        fullscreen: true,
        kiosk: true,
        autoHideMenuBar: true,
        backgroundColor: '#000000',
        show: true,
        title: `EZPlayer matrix: ${cfg.model}`,
        webPreferences: WEB_PREFERENCES,
    });
    win.setMenuBarVisibility(false);
    console.log(`[matrix] open ${cfg.model} full screen on display ${d.id}: ${url}`);
    return { win, cfg, url, floating: false, displayId: d.id };
}

/** Wanted content size in screen pixels: as configured, else one per model pixel. */
function wantedSize(mw: Pick<MatrixWindow, 'cfg' | 'grid'>): { width: number; height: number } {
    const { windowWidth, windowHeight } = mw.cfg;
    if (windowWidth && windowHeight) return { width: windowWidth, height: windowHeight };
    return mw.grid ?? PLACEHOLDER;
}

/** Size the window so its content covers the wanted screen pixels on the display it is on. */
function applySize(mw: MatrixWindow) {
    const b = mw.win.getBounds();
    const scale = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).scaleFactor || 1;
    const want = wantedSize(mw);
    const width = Math.max(1, Math.round(want.width / scale));
    const height = Math.max(1, Math.round(want.height / scale));
    const [w, h] = mw.win.getContentSize();
    if (w !== width || h !== height) mw.win.setContentSize(width, height);
    // The system may refuse a window this small; the page then draws the picture at its own size.
    const exact = mw.cfg.windowWidth && mw.cfg.windowHeight ? want : mw.grid;
    mw.win.webContents
        .executeJavaScript(
            `window.setPictureSize && window.setPictureSize(${exact?.width ?? 0}, ${exact?.height ?? 0})`,
        )
        .catch(() => {});
}

function openFloating(cfg: VirtualMatrixOutput, url: string): MatrixWindow {
    const size = wantedSize({ cfg });
    // A saved spot that is no longer on any display would leave the window unreachable.
    const saved =
        cfg.windowX !== undefined && cfg.windowY !== undefined ? { x: cfg.windowX, y: cfg.windowY } : undefined;
    const onScreen =
        saved &&
        screen.getAllDisplays().some((d) => {
            const a = d.bounds;
            return saved.x >= a.x - 8 && saved.x < a.x + a.width && saved.y >= a.y - 8 && saved.y < a.y + a.height;
        });
    const win = new BrowserWindow({
        ...(onScreen ? saved : {}),
        width: size.width,
        height: size.height,
        minWidth: 1,
        minHeight: 1,
        useContentSize: true,
        frame: false,
        // Without this Windows keeps a sizing border that makes the window a pixel off.
        thickFrame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        hasShadow: false,
        alwaysOnTop: true,
        backgroundColor: '#000000',
        show: true,
        title: `EZPlayer matrix: ${cfg.model}`,
        webPreferences: WEB_PREFERENCES,
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenuBarVisibility(false);
    const mw: MatrixWindow = { win, cfg, url, floating: true };
    const [x, y] = win.getPosition();
    mw.at = { x, y };
    applySize(mw);

    win.webContents.on('did-finish-load', () => applySize(mw));
    // The page puts the model's grid at the end of its title.
    win.on('page-title-updated', (_e, title) => {
        const m = /(\d+)x(\d+)$/.exec(title);
        if (!m) return;
        mw.grid = { width: Number(m[1]), height: Number(m[2]) };
        applySize(mw);
    });
    const moved = () => {
        clearTimeout(mw.moveTimer);
        mw.moveTimer = setTimeout(() => {
            if (win.isDestroyed()) return;
            const [nx, ny] = win.getPosition();
            // Another display may scale differently.
            applySize(mw);
            if (mw.at?.x === nx && mw.at?.y === ny) return;
            mw.at = { x: nx, y: ny };
            onMoved?.(mw.cfg.id, nx, ny);
        }, 400);
    };
    // 'moved' fires once at the end of a drag where it exists; 'move' covers Linux.
    win.on('moved', moved);
    win.on('move', moved);
    console.log(`[matrix] open ${cfg.model} in a window at ${x},${y}: ${url}`);
    return mw;
}

function open(cfg: VirtualMatrixOutput, url: string): MatrixWindow {
    const mw = cfg.mode === 'window' ? openFloating(cfg, url) : openFullScreen(cfg, url);
    mw.win.loadURL(url);
    mw.win.on('closed', () => {
        if (windows.get(cfg.id)?.win === mw.win) windows.delete(cfg.id);
        clearTimeout(mw.moveTimer);
    });
    return mw;
}

function resync() {
    if (!enabled || !webPort) return;
    if (!watchingDisplays) {
        watchingDisplays = true;
        // A display that comes back gets its output back.
        screen.on('display-added', resync);
        screen.on('display-removed', resync);
    }
    const wanted = new Map<string, VirtualMatrixOutput>();
    for (const o of lastSettings?.virtualMatrixOutputs ?? []) {
        if (o.enabled && o.model && o.id && o.mode !== 'url') wanted.set(o.id, o);
    }
    for (const [key, mw] of windows) {
        const cfg = wanted.get(key);
        const same =
            cfg &&
            mw.url === urlFor(cfg) &&
            mw.floating === (cfg.mode === 'window') &&
            (mw.floating || mw.displayId === displayFor(cfg).id);
        if (!cfg || !same) {
            close(key);
            continue;
        }
        mw.cfg = cfg;
        if (!mw.floating) continue;
        // Size and place change without reopening the window.
        applySize(mw);
        if (cfg.windowX !== undefined && cfg.windowY !== undefined) {
            if (mw.at?.x !== cfg.windowX || mw.at?.y !== cfg.windowY) {
                mw.at = { x: cfg.windowX, y: cfg.windowY };
                mw.win.setPosition(cfg.windowX, cfg.windowY);
            }
        }
    }
    for (const [key, cfg] of wanted) {
        if (windows.has(key)) continue;
        try {
            windows.set(key, open(cfg, urlFor(cfg)));
        } catch (e) {
            console.error(`[matrix] could not open ${cfg.model}: ${(e as Error).message}`);
        }
    }
}
