/**
 * Spawn EZPlayer against a show folder and wait for its API. Headless by
 * default; `windowed` runs the full app with its main window.
 *
 * Uses the built main process (apps/ezplayer-ui-electron/dist/main.js) with
 * the electron binary resolved from the app's dependencies — build the app
 * first: `pnpm --filter ezplayer-ui-electron build:tsc`, plus `build:preload`
 * and `build:react` for windowed runs.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../../../apps/ezplayer-ui-electron');

function electronBinary(): string {
    const require = createRequire(path.join(appDir, 'package.json'));
    // Requiring 'electron' from plain Node returns the executable path.
    return require('electron') as unknown as string;
}

export async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(port));
        });
    });
}

export interface EzPlayerProc {
    port: number;
    base: string;
    child: ChildProcess;
    logFile: string;
    userDataDir: string;
    stop(): Promise<void>;
}

export interface StartOptions {
    port?: number;
    userDataDir?: string;
    /** Full app with its main window, opened on `showFolder`. */
    windowed?: boolean;
    /** Crash-report endpoint base URL; turns uploads on. Without it uploads are off. */
    diagUrl?: string;
    /** EZP_FAULT names (see the app's mainsrc/faultinject.ts). */
    faults?: string[];
    /** Return once the process is spawned, for faults that take the web server down. */
    noApiWait?: boolean;
}

export async function startEzPlayer(showFolder: string, opts: StartOptions = {}): Promise<EzPlayerProc> {
    const port = opts.port ?? (await freePort());
    const udd = opts.userDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'ezp-udd-'));
    // Test runs must not upload crash reports to the real cloud.
    const consent = path.join(udd, 'diagnostics.json');
    if (opts.diagUrl) {
        writeFileSync(consent, JSON.stringify({ diagnostics: { uploadEnabled: true } }));
    } else if (!existsSync(consent)) {
        writeFileSync(consent, JSON.stringify({ diagnostics: { uploadEnabled: false } }));
    }
    // A windowed run opens the remembered show folder; without one it shows the welcome screen.
    const showStore = path.join(udd, 'config.json');
    if (opts.windowed && !existsSync(showStore)) writeFileSync(showStore, JSON.stringify({ showFolder }));
    const logFile = path.join(udd, 'ezplayer.log');
    const log = createWriteStream(logFile, { flags: 'a' });

    const child = spawn(
        electronBinary(),
        [
            // Both switches are consumed by the native layer before main.js
            // runs, so they must be on the command line.
            ...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless'] : []),
            path.join(appDir, 'dist', 'main.js'),
            ...(opts.windowed ? [] : ['headless']),
            `--show-folder=${showFolder}`,
            `--web-port=${port}`,
            '--kiosk-port=0',
            `--user-data-dir=${udd}`,
        ],
        {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                // Built pages, not the Vite dev server.
                EZP_RENDERER_DIST: '1',
                EZP_DIAG_URL: opts.diagUrl ?? '',
                EZP_FAULT: (opts.faults ?? []).join(','),
            },
        },
    );
    child.stdout!.pipe(log);
    child.stderr!.pipe(log);

    const base = `http://127.0.0.1:${port}`;
    if (!opts.noApiWait) await waitForApi(child, base, logFile);

    return {
        port,
        base,
        child,
        logFile,
        userDataDir: udd,
        stop: async () => {
            if (child.exitCode !== null) return;
            if (process.platform === 'win32') {
                // No deliverable SIGTERM on Windows; take the whole tree down.
                killTree(child);
            } else {
                child.kill('SIGTERM');
                const gone = await Promise.race([
                    new Promise<boolean>((r) => child.once('exit', () => r(true))),
                    new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
                ]);
                if (!gone) child.kill('SIGKILL');
            }
            await new Promise((r) => setTimeout(r, 500));
        },
    };
}

async function waitForApi(child: ChildProcess, base: string, logFile: string): Promise<void> {
    const deadline = Date.now() + 45_000;
    for (;;) {
        if (child.exitCode !== null) {
            throw new Error(`EZPlayer exited with code ${child.exitCode} during startup (log: ${logFile})`);
        }
        try {
            const res = await fetch(`${base}/api/ezp/hello`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) break;
        } catch {
            /* not up yet; keep polling */
        }
        if (Date.now() > deadline) {
            killTree(child);
            throw new Error(`EZPlayer did not answer /api/ezp/hello within 45s (log: ${logFile})`);
        }
        await new Promise((r) => setTimeout(r, 500));
    }
}

function killTree(child: ChildProcess): void {
    if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        child.kill('SIGKILL');
    }
}
