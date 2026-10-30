/**
 * Persistent app log: everything the main process and its worker threads
 * write to stdout/stderr is also appended to `ezplayer-main.log` in the logs
 * folder, with size rotation. Worker console output is piped through the main
 * thread's stdout, so hooking the streams here catches both.
 *
 * Also keeps a per-process session marker so the next launch can tell that a
 * run ended without a normal exit, and prunes stale log files.
 */

import { app } from 'electron';
import type { WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncBatchLogger } from './workers/logger.js';

const MAIN_LOG = 'ezplayer-main.log';
const MAX_LOG_AGE_MS = 30 * 24 * 3600 * 1000;
const CRASH_LOG_MAX_BYTES = 5 * 1024 * 1024;
const SESSION_PREFIX = 'session-';
/** Renderer console lines kept per window per minute. */
const RENDERER_LINES_PER_MIN = 60;
/** Recent renderer errors kept for crash reports. */
const RECENT_ERRORS_KEPT = 5;

let logger: AsyncBatchLogger | null = null;
let session: SessionMarker | null = null;

export function logsDir(): string {
    return app.getPath('logs');
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * Drop writes to `stream` once it fails or has no console. A pipe whose reader
 * has gone (EPIPE) fails asynchronously; unhandled, each failure is an
 * uncaughtException, whose handler logs, which fails again.
 */
export function guardStream(stream: NodeJS.WriteStream): void {
    const orig = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    let broken = false;
    stream.on('error', () => {
        broken = true;
    });
    stream.write = ((...args: unknown[]) => {
        if (broken) return true;
        try {
            return orig(...args);
        } catch {
            // No console attached (packaged GUI app).
            return true;
        }
    }) as typeof stream.write;
}

/** guardStream for stdout and stderr. */
export function guardStdio(): void {
    guardStream(process.stdout);
    guardStream(process.stderr);
}

export function hookStream(stream: NodeJS.WriteStream, tag: string, log: Pick<AsyncBatchLogger, 'log'>): void {
    guardStream(stream);
    const orig = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    let partial = '';
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        try {
            const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : '';
            const lines = (partial + text).split('\n');
            partial = lines.pop() ?? '';
            for (const line of lines) {
                const clean = line.replace(ANSI, '').replace(/\r$/, '');
                if (clean) log.log(`${tag}${clean}`);
            }
        } catch {
            /* never break the real stream */
        }
        return orig(chunk, ...rest);
    }) as typeof stream.write;
}

/** Start copying stdout/stderr to the app log. Call once, early, after the logs path is final. */
export function installAppLog(): void {
    if (logger) return;
    const dir = logsDir();
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch {
        /* the logger reports write failures itself */
    }
    pruneLogs(dir);
    logger = new AsyncBatchLogger({
        filePath: path.join(dir, MAIN_LOG),
        maxQueue: 2000,
        maxBytes: 10 * 1024 * 1024,
        keep: 5,
    });
    hookStream(process.stdout, '', logger);
    hookStream(process.stderr, 'E ', logger);
    logger.log(`==== start pid=${process.pid} argv=${JSON.stringify(process.argv.slice(1))}`);
}

/** Delete log files untouched for MAX_LOG_AGE_MS; cap main-crash.log, which is appended forever. */
export function pruneLogs(dir: string): void {
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch {
        return;
    }
    const now = Date.now();
    for (const name of names) {
        if (!/\.log(\.\d+)?$/.test(name)) continue;
        const file = path.join(dir, name);
        try {
            const st = fs.statSync(file);
            if (!st.isFile()) continue;
            if (now - st.mtimeMs > MAX_LOG_AGE_MS) {
                fs.rmSync(file, { force: true });
            } else if (name === 'main-crash.log' && st.size > CRASH_LOG_MAX_BYTES) {
                fs.renameSync(file, `${file}.1`);
            }
        } catch {
            /* best-effort */
        }
    }
}

/**
 * Copy a window's renderer warnings and errors into the app log (via stdout).
 * Rate-limited so a render loop cannot flood it. Returns the window's most
 * recent error lines, for attaching to reports.
 */
export function captureRendererConsole(wc: WebContents, tag: string): () => string[] {
    let windowStart = 0;
    let count = 0;
    let suppressed = 0;
    const recentErrors: string[] = [];
    wc.on('console-message', (event) => {
        if (event.level !== 'warning' && event.level !== 'error') return;
        const where = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : '';
        if (event.level === 'error') {
            recentErrors.push(`${event.message.slice(0, 300)}${where}`);
            if (recentErrors.length > RECENT_ERRORS_KEPT) recentErrors.shift();
        }
        const now = Date.now();
        if (now - windowStart > 60_000) {
            if (suppressed > 0) console.log(`[renderer:${tag}] ${suppressed} console lines suppressed`);
            windowStart = now;
            count = 0;
            suppressed = 0;
        }
        if (++count > RENDERER_LINES_PER_MIN) {
            suppressed++;
            return;
        }
        console.log(`[renderer:${tag}] ${event.level === 'error' ? 'E' : 'W'} ${event.message}${where}`);
    });
    return () => [...recentErrors];
}

interface SessionMarker {
    pid: number;
    version: string;
    startedAt: string;
    sessionEnding?: boolean;
}

function markerPath(pid: number): string {
    return path.join(logsDir(), `${SESSION_PREFIX}${pid}.json`);
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // EPERM: exists but not ours to signal
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/**
 * Record this run and return markers left by earlier runs that did not exit
 * normally. The marker is removed on process exit; a native crash or a kill leaves it.
 */
export function beginSession(version: string): SessionMarker[] {
    const dir = logsDir();
    const leftovers: SessionMarker[] = [];
    try {
        for (const name of fs.readdirSync(dir)) {
            if (!name.startsWith(SESSION_PREFIX) || !name.endsWith('.json')) continue;
            const file = path.join(dir, name);
            try {
                const marker = JSON.parse(fs.readFileSync(file, 'utf8')) as SessionMarker;
                if (marker.pid === process.pid || isAlive(marker.pid)) continue;
                leftovers.push(marker);
                fs.rmSync(file, { force: true });
            } catch {
                fs.rmSync(file, { force: true });
            }
        }
    } catch {
        /* no logs dir yet */
    }
    session = { pid: process.pid, version, startedAt: new Date().toISOString() };
    writeSession();
    process.on('exit', () => {
        try {
            fs.rmSync(markerPath(process.pid), { force: true });
        } catch {
            /* best-effort */
        }
    });
    return leftovers;
}

function writeSession(): void {
    if (!session) return;
    try {
        fs.writeFileSync(markerPath(session.pid), JSON.stringify(session));
    } catch {
        /* best-effort */
    }
}

/** The OS is ending the session; if we die now, it is not a fault. */
export function markSessionEnding(): void {
    if (!session) return;
    session.sessionEnding = true;
    writeSession();
}
