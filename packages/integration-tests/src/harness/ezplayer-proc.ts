/**
 * Spawn a headless EZPlayer against a show folder and wait for its API.
 *
 * Uses the built main process (apps/ezplayer-ui-electron/dist/main.js) with
 * the electron binary resolved from the app's dependencies — build the app
 * first: `pnpm --filter ezplayer-ui-electron build:tsc`.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, mkdtempSync } from 'node:fs';
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
    stop(): Promise<void>;
}

export async function startEzPlayer(showFolder: string, opts?: { port?: number }): Promise<EzPlayerProc> {
    const port = opts?.port ?? (await freePort());
    const udd = mkdtempSync(path.join(os.tmpdir(), 'ezp-udd-'));
    const logFile = path.join(udd, 'ezplayer.log');
    const log = createWriteStream(logFile);

    const child = spawn(
        electronBinary(),
        [
            // The SUID sandbox aborts before main.js's appendSwitch can run.
            ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
            path.join(appDir, 'dist', 'main.js'),
            'headless',
            `--show-folder=${showFolder}`,
            `--web-port=${port}`,
            '--kiosk-port=0',
            `--user-data-dir=${udd}`,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout!.pipe(log);
    child.stderr!.pipe(log);

    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 45_000;
    for (;;) {
        if (child.exitCode !== null) {
            throw new Error(`EZPlayer exited with code ${child.exitCode} during startup (log: ${logFile})`);
        }
        try {
            const res = await fetch(`${base}/api/ezp/hello`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) break;
        } catch {}
        if (Date.now() > deadline) {
            killTree(child);
            throw new Error(`EZPlayer did not answer /api/ezp/hello within 45s (log: ${logFile})`);
        }
        await new Promise((r) => setTimeout(r, 500));
    }

    return {
        port,
        base,
        child,
        logFile,
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

function killTree(child: ChildProcess): void {
    if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
        child.kill('SIGKILL');
    }
}
