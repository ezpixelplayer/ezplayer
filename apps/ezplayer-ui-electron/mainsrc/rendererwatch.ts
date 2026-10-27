/**
 * Main-window health checks that do not depend on the page reporting itself:
 * - renderer-not-ready: a page that loads but never mounts the app (the white
 *   screen with no error).
 * - renderer-hang: a renderer whose main thread stops answering pings.
 *   Electron's 'unresponsive' only fires when input is waiting, so it misses a
 *   hang on an unattended show computer.
 * Also picks up [ezp-report] console lines, which the page uses to report
 * errors when the preload's API is missing.
 */

import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron';
import { reportDiagEvent } from './diagnostics.js';
import { injectRendererFaults } from './faultinject-main.js';

export const READY_TIMEOUT_MS = 45_000;
export const HANG_AFTER_MS = 30_000;
const PING_INTERVAL_MS = 5_000;
/** A tick later than this means the system slept or the clock jumped. */
const MAX_TICK_GAP_MS = PING_INTERVAL_MS * 3;
const PROBE_TIMEOUT_MS = 2_000;
const REPORT_PREFIX = '[ezp-report] ';

const PAGE_PROBE = `(() => ({
    title: document.title,
    readyState: document.readyState,
    rootChildren: document.getElementById('root')?.childElementCount ?? -1,
    bodyTextLength: (document.body?.innerText ?? '').length,
    hasElectronApi: !!window.electronAPI,
}))()`;

export function watchRenderer(win: BrowserWindow, recentErrors: () => string[]): void {
    const wc = win.webContents;
    let ready = false;
    let loadStartedAt = 0;
    let readyTimer: NodeJS.Timeout | undefined;
    let seq = 0;
    let lastPongAt = 0;
    let hangReported = false;

    const probePage = (): Promise<unknown> =>
        Promise.race([
            wc.executeJavaScript(PAGE_PROBE).catch((e: unknown) => ({ probeError: String(e) })),
            new Promise((r) => setTimeout(() => r({ probe: `no answer in ${PROBE_TIMEOUT_MS} ms` }), PROBE_TIMEOUT_MS)),
        ]);

    wc.on('did-start-loading', () => {
        ready = false;
        loadStartedAt = Date.now();
        clearTimeout(readyTimer);
        readyTimer = setTimeout(() => {
            void probePage().then((page) => {
                if (ready || wc.isDestroyed()) return;
                const secs = Math.round((Date.now() - loadStartedAt) / 1000);
                console.warn(`[renderer:main] app not up ${secs}s after load started: ${JSON.stringify(page)}`);
                reportDiagEvent('renderer-not-ready', `main window app not up after ${secs}s`, undefined, {
                    url: wc.getURL(),
                    page,
                    recentErrors: recentErrors(),
                });
            });
        }, READY_TIMEOUT_MS);
    });
    wc.on('render-process-gone', () => {
        ready = false;
        clearTimeout(readyTimer);
    });

    const onReady = (e: IpcMainEvent) => {
        if (e.sender !== wc || ready) return;
        ready = true;
        clearTimeout(readyTimer);
        lastPongAt = Date.now();
        console.log(`[renderer:main] app up ${Date.now() - loadStartedAt} ms after load started`);
        injectRendererFaults(wc);
    };
    const onPong = (e: IpcMainEvent) => {
        if (e.sender !== wc) return;
        const now = Date.now();
        if (hangReported) {
            console.warn(`[renderer:main] answering again after ${Math.round((now - lastPongAt) / 1000)}s`);
            hangReported = false;
        }
        lastPongAt = now;
    };
    ipcMain.on('ezp:renderer-ready', onReady);
    ipcMain.on('ezp:pong', onPong);

    let lastTickAt = Date.now();
    const pinger = setInterval(() => {
        if (wc.isDestroyed()) return;
        const now = Date.now();
        const tickGapMs = now - lastTickAt;
        lastTickAt = now;
        // Skip hidden or minimized windows (may be throttled) and ticks after
        // a sleep or clock jump.
        const clockSkipped = tickGapMs > MAX_TICK_GAP_MS || tickGapMs < 0;
        if (!ready || !win.isVisible() || win.isMinimized() || clockSkipped) {
            lastPongAt = now;
            return;
        }
        wc.send('ezp:ping', ++seq);
        const silentMs = now - lastPongAt;
        if (silentMs > HANG_AFTER_MS && !hangReported) {
            hangReported = true;
            const secs = Math.round(silentMs / 1000);
            console.warn(`[renderer:main] not answering for ${secs}s`);
            reportDiagEvent('renderer-hang', `main window not answering for ${secs}s`, undefined, {
                url: wc.getURL(),
                recentErrors: recentErrors(),
            });
        }
    }, PING_INTERVAL_MS);

    wc.on('console-message', (event) => {
        if (!event.message.startsWith(REPORT_PREFIX)) return;
        try {
            const r = JSON.parse(event.message.slice(REPORT_PREFIX.length)) as { message?: unknown; stack?: unknown };
            reportDiagEvent('renderer-error', String(r.message), typeof r.stack === 'string' ? r.stack : undefined, {
                via: 'console',
            });
        } catch {
            /* not ours */
        }
    });

    win.on('closed', () => {
        clearInterval(pinger);
        clearTimeout(readyTimer);
        ipcMain.removeListener('ezp:renderer-ready', onReady);
        ipcMain.removeListener('ezp:pong', onPong);
    });
}
