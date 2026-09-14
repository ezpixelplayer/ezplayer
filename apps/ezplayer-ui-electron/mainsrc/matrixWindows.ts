/**
 * Virtual matrix outputs: one full-screen BrowserWindow per configured output,
 * each showing a model's canonical grid on a chosen display (HDMI to a
 * projector, a panel, a TV). The window is just the player's own /matrix page
 * in kiosk mode, so any browser on any device can be an output too.
 */
import { BrowserWindow, screen } from 'electron';
import type { PlaybackSettings, VirtualMatrixOutput } from '@ezplayer/ezplayer-core';

interface MatrixWindow {
    win: BrowserWindow;
    url: string;
    display: number;
}

const windows = new Map<string, MatrixWindow>();
let enabled = true;
let webPort: number | undefined;
let lastSettings: PlaybackSettings | undefined;

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

export function destroyAllMatrixWindows() {
    for (const [key, mw] of windows) {
        windows.delete(key);
        if (!mw.win.isDestroyed()) mw.win.destroy();
    }
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

function urlFor(cfg: VirtualMatrixOutput): string {
    const q = new URLSearchParams({
        model: cfg.model,
        fps: String(cfg.fps && cfg.fps > 0 ? cfg.fps : 30),
        smooth: cfg.smooth ? '1' : '0',
    });
    return `http://127.0.0.1:${webPort}/matrix?${q.toString()}`;
}

function createWindow(cfg: VirtualMatrixOutput, url: string, displayIndex: number): BrowserWindow {
    const displays = screen.getAllDisplays();
    const d = displays[displayIndex] ?? screen.getPrimaryDisplay();
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
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            // A full-screen output must keep painting even when it is not focused.
            backgroundThrottling: false,
        },
    });
    win.setMenuBarVisibility(false);
    console.log(`[matrix] open ${cfg.model} on display ${displayIndex}: ${url}`);
    win.loadURL(url);
    win.on('closed', () => {
        const cur = windows.get(cfg.id);
        if (cur?.win === win) windows.delete(cfg.id);
    });
    return win;
}

function resync() {
    if (!enabled || !webPort) return;
    const wanted = new Map<string, VirtualMatrixOutput>();
    for (const o of lastSettings?.virtualMatrixOutputs ?? []) {
        if (o.enabled && o.model && o.id) wanted.set(o.id, o);
    }
    for (const [key, mw] of windows) {
        const cfg = wanted.get(key);
        const display = cfg?.display ?? 0;
        if (!cfg || mw.url !== urlFor(cfg) || mw.display !== display) {
            windows.delete(key);
            if (!mw.win.isDestroyed()) mw.win.destroy();
        }
    }
    for (const [key, cfg] of wanted) {
        if (windows.has(key)) continue;
        const url = urlFor(cfg);
        const display = cfg.display ?? 0;
        try {
            windows.set(key, { win: createWindow(cfg, url, display), url, display });
        } catch (e) {
            console.error(`[matrix] could not open ${cfg.model}: ${(e as Error).message}`);
        }
    }
}
