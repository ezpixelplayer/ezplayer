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
import {
    createWriteStream,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
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

/**
 * Where a running harness player leaves a note about itself.
 *
 * A spawned player can outlive the run that started it: nothing ties the two
 * together on Windows, so a runner that is killed rather than returning takes
 * its `finally` with it and leaves the electron tree behind. Without a record,
 * finding that stray means guessing from process names and start times, which
 * is how a wrong process gets killed.
 */
const REGISTRY_DIR = path.join(os.tmpdir(), 'ezp-harness');

/** Where the notes live. Exported so a test can point a sweep somewhere else
 *  and never touch a run that is actually in progress. */
export function harnessRegistryDir(): string {
    return REGISTRY_DIR;
}

interface ProcNote {
    pid: number;
    port: number;
    userDataDir: string;
    startedAt: string;
    /** The argument unique to this instance, used to prove a pid is ours. */
    marker: string;
}

function noteFile(pid: number): string {
    return path.join(REGISTRY_DIR, `${pid}.json`);
}

function recordProc(note: ProcNote): void {
    try {
        mkdirSync(REGISTRY_DIR, { recursive: true });
        writeFileSync(noteFile(note.pid), JSON.stringify(note, null, 2));
    } catch {
        // A registry we cannot write is not worth failing a run over; the
        // stray sweep simply has less to go on.
    }
}

function forgetProc(pid: number | undefined): void {
    if (pid === undefined) return;
    try {
        rmSync(noteFile(pid), { force: true });
    } catch {
        /* nothing to forget */
    }
}

/**
 * The command line of a live process, or undefined if it is not running (or
 * cannot be read). This is what makes a kill safe: a pid alone is reusable, so
 * nothing is killed until its command line proves it is the process the note
 * was written for.
 */
function commandLineOf(pid: number): string | undefined {
    if (process.platform === 'win32') {
        const r = spawnSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
            ],
            { encoding: 'utf8', timeout: 15_000 },
        );
        const out = (r.stdout ?? '').trim();
        return out.length ? out : undefined;
    }
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8', timeout: 15_000 });
    const out = (r.stdout ?? '').trim();
    return out.length ? out : undefined;
}

export interface StraySweep {
    /** Pids that were proved ours and killed. */
    killed: number[];
    /** Notes whose process is gone; the note was removed. */
    stale: number[];
    /** Pids left alone, with why — a sweep never kills what it cannot prove. */
    spared: { pid: number; reason: string }[];
}

/**
 * Kill players left behind by earlier runs, and only those.
 *
 * Each note names the `--user-data-dir` its player was spawned with, which is
 * a fresh temp path per instance. A pid is killed only when the live process's
 * command line still contains that exact marker; anything else is left alone
 * and reported. That is the whole point -- a sweep that guesses is worse than
 * no sweep, because the thing it guesses wrong about is someone's work.
 */
export function stopStrayEzPlayers(opts: { skipPid?: number; dir?: string } = {}): StraySweep {
    const dir = opts.dir ?? REGISTRY_DIR;
    const sweep: StraySweep = { killed: [], stale: [], spared: [] };
    let notes: string[];
    try {
        notes = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
        return sweep; // no registry yet, so nothing was ever recorded
    }
    for (const file of notes) {
        const full = path.join(dir, file);
        let note: ProcNote;
        try {
            note = JSON.parse(readFileSync(full, 'utf8')) as ProcNote;
        } catch {
            rmSync(full, { force: true });
            continue;
        }
        if (note.pid === opts.skipPid || note.pid === process.pid) continue;
        const cmd = commandLineOf(note.pid);
        if (!cmd) {
            rmSync(full, { force: true });
            sweep.stale.push(note.pid);
            continue;
        }
        if (!note.marker || !cmd.includes(note.marker)) {
            // The pid has been reused, or we cannot read enough to be sure.
            sweep.spared.push({ pid: note.pid, reason: 'running process is not the one this note was written for' });
            rmSync(full, { force: true });
            continue;
        }
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(note.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            try {
                process.kill(note.pid, 'SIGKILL');
            } catch {
                /* already gone */
            }
        }
        rmSync(full, { force: true });
        sweep.killed.push(note.pid);
    }
    return sweep;
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
    /** Play audio on this machine's speakers, and list its output devices in
     *  Settings. Headless does neither without it. */
    localAudio?: boolean;
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
            ...(opts.localAudio ? ['--local-audio'] : []),
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
    if (child.pid !== undefined) {
        recordProc({
            pid: child.pid,
            port,
            userDataDir: udd,
            startedAt: new Date().toISOString(),
            marker: `--user-data-dir=${udd}`,
        });
    }
    // A player that exits on its own leaves no stray to sweep.
    child.once('exit', () => forgetProc(child.pid));

    const base = `http://127.0.0.1:${port}`;
    // A windowed run loads its show only once the page is up, which some faults prevent.
    if (!opts.noApiWait) await waitForApi(child, base, logFile, !opts.windowed);

    return {
        port,
        base,
        child,
        logFile,
        userDataDir: udd,
        stop: async () => {
            if (child.exitCode !== null) {
                forgetProc(child.pid);
                return;
            }
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
            forgetProc(child.pid);
            await new Promise((r) => setTimeout(r, 500));
        },
    };
}

async function waitForApi(child: ChildProcess, base: string, logFile: string, waitForShow: boolean): Promise<void> {
    const deadline = Date.now() + 45_000;
    for (;;) {
        if (child.exitCode !== null) {
            throw new Error(`EZPlayer exited with code ${child.exitCode} during startup (log: ${logFile})`);
        }
        try {
            const res = await fetch(`${base}/api/ezp/hello`, { signal: AbortSignal.timeout(2000) });
            if (res.ok && (!waitForShow || ((await res.json()) as { showLoaded?: boolean }).showLoaded)) break;
        } catch {
            /* not up yet; keep polling */
        }
        if (Date.now() > deadline) {
            killTree(child);
            forgetProc(child.pid);
            throw new Error(
                `EZPlayer did not answer /api/ezp/hello${waitForShow ? ' with its show loaded' : ''} within 45s (log: ${logFile})`,
            );
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
