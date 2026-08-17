/**
 * The pty that backs the remote shell. Lives in the Electron main process as
 * node-pty is a native addon, and main already owns every other privileged
 * operation. The worker owns the WebSocket and relays bytes here over the
 * existing RPC channel.
 *
 * Exactly ONE session exists at a time, by design. Opening a new terminal
 * supersedes the old one; The previous pty is killed and its viewer told why.
 */

import os from 'os';
import { readRemoteAccessConfig, resolveShellCommand } from './remoteaccess.js';
import type { ShellEvent } from './workers/serverworkertypes.js';

/** Minimal shape we use from node-pty, so the import can stay dynamic. */
interface PtyProcess {
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    pid: number;
}
interface PtyModule {
    spawn(
        file: string,
        args: string[] | string,
        opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string | undefined> },
    ): PtyProcess;
}

type ShellEventSink = (event: ShellEvent) => void;

let emit: ShellEventSink = () => {};

/** Wire the main -> worker relay. Called once during server-worker setup. */
export function setShellEventSink(sink: ShellEventSink): void {
    emit = sink;
}

interface ActiveSession {
    sessionId: string;
    pty: PtyProcess;
}

let active: ActiveSession | undefined;

let ptyModule: PtyModule | undefined;
let ptyLoadFailed = false;

async function loadPty(): Promise<PtyModule | undefined> {
    if (ptyModule) return ptyModule;
    if (ptyLoadFailed) return undefined;
    try {
        ptyModule = (await import('@lydell/node-pty')) as unknown as PtyModule;
        return ptyModule;
    } catch (e) {
        ptyLoadFailed = true;
        console.error('[shell] node-pty failed to load; the remote shell is unavailable on this build:', e);
        return undefined;
    }
}

/** True when a pty could actually be spawned here. The UI gate is the password,
 *  but there is no point advertising a shell we cannot start. */
export async function shellRuntimeAvailable(): Promise<boolean> {
    return (await loadPty()) !== undefined;
}

/**
 * Start a session, superseding whatever was running. Returns an error string
 * on failure, or undefined on success.
 */
export async function startShellSession(
    sessionId: string,
    cols: number,
    rows: number,
    showFolder: string | undefined,
): Promise<string | undefined> {
    const pty = await loadPty();
    if (!pty) return 'the terminal backend is unavailable on this build';

    // Requirement: one at a time. The previous viewer learns it was displaced
    // rather than watching a socket go quiet.
    if (active) {
        const displaced = active.sessionId;
        killShellSession(displaced);
        emit({ type: 'superseded', sessionId: displaced });
    }

    const cfg = await readRemoteAccessConfig(showFolder);
    const file = resolveShellCommand(cfg);
    let proc: PtyProcess;
    try {
        proc = pty.spawn(file, [], {
            name: 'xterm-256color',
            cols: clampDim(cols, 80),
            rows: clampDim(rows, 24),
            cwd: os.homedir(),
            env: process.env,
        });
    } catch (e) {
        console.error('[shell] failed to spawn pty:', e);
        return `could not start ${file}: ${(e as Error).message}`;
    }

    const session: ActiveSession = { sessionId, pty: proc };
    active = session;
    console.log(`[shell] session ${sessionId.slice(0, 8)}... started (${file}, pid ${proc.pid})`);

    proc.onData((data) => {
        if (active === session) emit({ type: 'data', sessionId, data });
    });
    proc.onExit(({ exitCode }) => {
        if (active === session) active = undefined;
        console.log(`[shell] session ${sessionId.slice(0, 8)}... exited (code ${exitCode})`);
        emit({ type: 'exit', sessionId, code: exitCode });
    });
    return undefined;
}

function clampDim(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(500, Math.max(1, Math.floor(value)));
}

export function writeToShellSession(sessionId: string, data: string): void {
    if (active?.sessionId !== sessionId) return;
    try {
        active.pty.write(data);
    } catch (e) {
        console.error('[shell] write failed:', e);
    }
}

export function resizeShellSession(sessionId: string, cols: number, rows: number): void {
    if (active?.sessionId !== sessionId) return;
    try {
        active.pty.resize(clampDim(cols, 80), clampDim(rows, 24));
    } catch (e) {
        console.error('[shell] resize failed:', e);
    }
}

/** Kill a session by id. */
export function killShellSession(sessionId: string): void {
    // Clearing `active` first means the pty's own exit handler sees it is no longer current.
    if (active?.sessionId !== sessionId) return;
    const { pty } = active;
    active = undefined;
    try {
        pty.kill();
    } catch {
        /* already gone */
    }
}

/** Tear down on app shutdown so no orphan shell process outlives the player. */
export function shutdownShellSessions(): void {
    if (!active) return;
    const { pty } = active;
    active = undefined;
    try {
        pty.kill();
    } catch {
        /* ignore */
    }
}
