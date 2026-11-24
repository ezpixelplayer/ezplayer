import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AppInstanceState, AppManifest, AppStartupReport } from '@ezplayer/ezplayer-core';
import { AsyncBatchLogger } from '../workers/logger.js';
import { resolveRuntime } from './apps-runtime.js';

/** Restart backoff, capped; past the last entry the instance stays failed until the owner acts. */
const RESTART_DELAYS_MS = [1_000, 5_000, 15_000, 60_000];
const LOG_TAIL_LINES = 50;
const STOP_GRACE_MS = 5_000;

export interface SpawnSpec {
    instance: string;
    manifest: AppManifest;
    appDir: string;
    dataDir: string;
    showFolder: string;
    /** The player's web API port. */
    apiPort: number;
    pythonPath?: string;
    logFile: string;
}

export interface ProcessView {
    state: AppInstanceState;
    pid?: number;
    restarts: number;
    report: AppStartupReport;
    /** The secret the process uses on its own routes; new on every start. */
    token?: string;
    port?: number;
}

/** A free TCP port for an instance that serves its own page. */
async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(port));
        });
    });
}

/**
 * One app process: start, keep up with backoff, stop, and a report of how it went.
 * `onChange` fires on every state change so the owner's card and the server worker follow.
 */
export class AppProcess {
    private child: ChildProcess | undefined;
    private restartTimer: NodeJS.Timeout | undefined;
    private stopping = false;
    private logger: AsyncBatchLogger | undefined;
    private readonly tail: string[] = [];
    view: ProcessView = { state: 'stopped', restarts: 0, report: { logTail: [] } };

    constructor(
        private readonly spec: SpawnSpec,
        private readonly onChange: (view: ProcessView) => void,
    ) {}

    private update(patch: Partial<ProcessView>, report?: Partial<AppStartupReport>): void {
        this.view = {
            ...this.view,
            ...patch,
            report: { ...this.view.report, ...report, logTail: [...this.tail] },
        };
        this.onChange(this.view);
    }

    private note(line: string): void {
        for (const l of line.split(/\r?\n/)) {
            if (l === '') continue;
            this.tail.push(l.length > 400 ? `${l.slice(0, 400)}…` : l);
            if (this.tail.length > LOG_TAIL_LINES) this.tail.shift();
            this.logger?.log(l);
        }
    }

    /** The process published its first status; the report records when. */
    sawStatus(): void {
        if (this.view.report.firstStatusAt === undefined) this.update({}, { firstStatusAt: Date.now() });
    }

    async start(): Promise<void> {
        this.stopping = false;
        if (this.child) return;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = undefined;
        }
        const { manifest, appDir } = this.spec;
        const resolved = resolveRuntime(manifest, appDir, this.spec.pythonPath);
        if ('error' in resolved) {
            this.note(`[player] ${resolved.error}`);
            this.update({ state: 'failed' }, { lastExit: resolved.error });
            return;
        }
        this.logger ??= new AsyncBatchLogger({ filePath: this.spec.logFile, maxBytes: 5 * 1024 * 1024, keep: 2 });
        await fsp.mkdir(path.dirname(this.spec.logFile), { recursive: true });
        await fsp.mkdir(this.spec.dataDir, { recursive: true });

        const token = randomBytes(18).toString('base64url');
        const port = await freePort();
        const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
            ...resolved.runtime.env,
            EZP_API_URL: `http://127.0.0.1:${this.spec.apiPort}`,
            EZP_APP_ID: manifest.id,
            EZP_APP_INSTANCE: this.spec.instance,
            EZP_APP_TOKEN: token,
            EZP_APP_DATA_DIR: this.spec.dataDir,
            EZP_APP_PORT: String(port),
            EZP_SHOW_FOLDER: this.spec.showFolder,
        };
        const args = [...resolved.runtime.argsPrefix, ...resolved.args];
        this.note(`[player] starting ${resolved.runtime.label} ${args.join(' ')}`);
        let child: ChildProcess;
        try {
            child = spawn(resolved.runtime.command, args, {
                cwd: appDir,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (err) {
            const why = `cannot start: ${(err as Error).message}`;
            this.note(`[player] ${why}`);
            this.scheduleRestart(why);
            return;
        }
        this.child = child;
        this.update(
            { state: 'starting', pid: child.pid, token, port },
            {
                runtime: resolved.runtime.label,
                runtimeVersion: resolved.runtime.version,
                port,
                startedAt: Date.now(),
                lastExit: undefined,
                firstStatusAt: undefined,
            },
        );
        child.stdout?.on('data', (d: Buffer) => this.note(d.toString('utf8')));
        child.stderr?.on('data', (d: Buffer) => this.note(d.toString('utf8')));
        child.on('error', (err) => {
            this.note(`[player] process error: ${err.message}`);
        });
        child.on('exit', (code, signal) => {
            const why = signal ? `stopped by ${signal}` : `exited with code ${code}`;
            this.note(`[player] ${why}`);
            this.child = undefined;
            if (this.stopping) {
                this.update({ state: 'stopped', pid: undefined, token: undefined }, { lastExit: why });
                return;
            }
            this.scheduleRestart(why);
        });
        // Alive after a moment counts as running; the first status confirms it later.
        setTimeout(() => {
            if (this.child === child && this.view.state === 'starting') {
                this.view.restarts = 0;
                this.update({ state: 'running' });
            }
        }, 2_000).unref();
    }

    private scheduleRestart(why: string): void {
        const n = this.view.restarts;
        if (n >= RESTART_DELAYS_MS.length) {
            this.note(`[player] giving up after ${n} restarts`);
            this.update({ state: 'failed', pid: undefined, token: undefined }, { lastExit: why });
            return;
        }
        const delay = RESTART_DELAYS_MS[n];
        this.note(`[player] restart ${n + 1} in ${delay / 1000} s`);
        this.update({ state: 'starting', pid: undefined, token: undefined, restarts: n + 1 }, { lastExit: why });
        this.restartTimer = setTimeout(() => {
            this.restartTimer = undefined;
            void this.start();
        }, delay);
        this.restartTimer.unref?.();
    }

    /** Ask nicely, then kill the whole tree; resolves once the process is gone. */
    async stop(): Promise<void> {
        this.stopping = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = undefined;
        }
        const child = this.child;
        if (!child || child.pid === undefined) {
            this.update({ state: 'stopped', pid: undefined, token: undefined });
            return;
        }
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        if (process.platform === 'win32') {
            // No SIGTERM on Windows; taskkill /T takes the children too.
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
                'error',
                () => child.kill(),
            );
        } else {
            try {
                child.kill('SIGTERM');
            } catch {
                /* already gone */
            }
        }
        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {
                /* already gone */
            }
        }, STOP_GRACE_MS);
        await exited;
        clearTimeout(timer);
    }

    /** A fresh start after the owner asks, with the restart count cleared. */
    async restart(): Promise<void> {
        await this.stop();
        this.view.restarts = 0;
        await this.start();
    }

    setState(state: AppInstanceState): void {
        this.update({ state });
    }
}
