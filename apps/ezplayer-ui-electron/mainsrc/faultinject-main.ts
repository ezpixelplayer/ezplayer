/**
 * Main-process side of EZP_FAULT (see faultinject.ts): faults in the main
 * process itself and in the main window's renderer.
 */

import { app, BrowserWindow, net, protocol, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { anyFaults, hasFault, throwLater } from './faultinject.js';

const FAULT_DELAY_MS = 1500;

export function injectMainFaults(): void {
    throwLater('main-throw', FAULT_DELAY_MS);
    if (hasFault('main-reject')) {
        setTimeout(() => void Promise.reject(new Error('ezp-fault: main-reject')), FAULT_DELAY_MS);
    }
}

/** The preload to use: a throwing one for preload-throw. */
export function faultPreloadPath(preloadPath: string): string {
    if (!hasFault('preload-throw')) return preloadPath;
    const file = path.join(app.getPath('temp'), `ezp-fault-preload-${process.pid}.js`);
    fs.writeFileSync(file, "throw new Error('ezp-fault: preload-throw');\n");
    return file;
}

/** The main window URL to load, after the bad-url and bundle-* faults. */
export function faultPageUrl(url: string): string {
    if (hasFault('bad-url')) return url.replace(/index\.html$/, 'missing.html');
    if (hasFault('bundle-throw') || hasFault('bundle-empty')) {
        // The app's entry chunk; everything else loads normally.
        const body = hasFault('bundle-throw') ? "throw new Error('ezp-fault: bundle-throw');\n" : '';
        protocol.handle('file', (req) =>
            /\/assets\/main-[^/]+\.js$/.test(new URL(req.url).pathname)
                ? new Response(body, { headers: { 'content-type': 'text/javascript' } })
                : net.fetch(req, { bypassCustomProtocolHandlers: true }),
        );
    }
    return url;
}

/** How long a crashed renderer may take to be reported gone before we log it. */
const CRASH_REPORT_WAIT_MS = 10_000;

function crashRenderer(wc: WebContents): void {
    const pid = wc.getOSProcessId();
    // On Linux forcefullyCrashRenderer() only asks the renderer to crash itself;
    // signal it instead so it dies the way a real crash does.
    if (process.platform === 'linux') process.kill(pid, 'SIGSEGV');
    else wc.forcefullyCrashRenderer();
    setTimeout(() => {
        // Crashed, or already reloaded into a new process.
        if (wc.isDestroyed() || wc.isCrashed() || wc.getOSProcessId() !== pid) return;
        console.warn(
            `[fault] renderer ${pid} not reported gone ${CRASH_REPORT_WAIT_MS} ms after crashing: ${describeProcess(pid)}`,
        );
    }, CRASH_REPORT_WAIT_MS);
}

function readOr(file: string, fallback: string): string {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return fallback;
    }
}

/** Whether `pid` still exists and, on Linux, its state, tracer and wait channel. */
function describeProcess(pid: number): string {
    try {
        process.kill(pid, 0);
    } catch {
        return 'process exited';
    }
    if (process.platform !== 'linux') return 'process still running';
    try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, 'm').exec(status)?.[1] ?? '?';
        const wchan = fs.readFileSync(`/proc/${pid}/wchan`, 'utf8');
        const tracer = field('TracerPid');
        const tracerName = tracer === '0' ? '' : ` (${readOr(`/proc/${tracer}/comm`, '?').trim()})`;
        return `State ${field('State')}, TracerPid ${tracer}${tracerName}, wchan ${wchan || '-'}`;
    } catch (e) {
        return `process still running (${(e as Error).message})`;
    }
}

let rendererFaultsInjected = false;

/** Called once the main window's app is up. Only the first time, so a reload cannot loop. */
export function injectRendererFaults(wc: WebContents): void {
    if (!anyFaults() || rendererFaultsInjected) return;
    rendererFaultsInjected = true;
    const later = (fn: () => void) => setTimeout(() => !wc.isDestroyed() && fn(), FAULT_DELAY_MS);
    // Thrown from a page timer so it is uncaught, not returned to executeJavaScript.
    if (hasFault('renderer-throw')) {
        later(() => void wc.executeJavaScript("setTimeout(() => { throw new Error('ezp-fault: renderer-throw'); })"));
    }
    if (hasFault('renderer-reject')) {
        later(
            () =>
                void wc.executeJavaScript(
                    "setTimeout(() => { void Promise.reject(new Error('ezp-fault: renderer-reject')); })",
                ),
        );
    }
    if (hasFault('renderer-hang')) later(() => void wc.executeJavaScript('setTimeout(() => { for (;;) {} })'));
    if (hasFault('renderer-crash')) later(() => crashRenderer(wc));
    if (hasFault('gpu-crash')) {
        later(() => {
            const w = new BrowserWindow({ show: false });
            w.loadURL('chrome://gpucrash').catch(() => {});
            setTimeout(() => !w.isDestroyed() && w.destroy(), 5000);
        });
    }
}
