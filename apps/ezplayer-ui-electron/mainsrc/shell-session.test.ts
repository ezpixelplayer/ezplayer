/**
 * End-to-end over the real seam: a genuine pty driven through the genuine
 * /terminal WebSocket. Only Electron's process boundary is absent — main and
 * the worker are one process here, and the RPC hop is a direct call.
 *
 * Spawns a real shell, so it is slower than the other suites and is skipped if
 * the platform has no usable pty.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WebSocket, type WebSocketServer } from 'ws';
import { setFeaturePassword } from './remoteaccess.js';
import {
    killShellSession,
    resizeShellSession,
    setShellEventSink,
    shellRuntimeAvailable,
    shutdownShellSessions,
    startShellSession,
    writeToShellSession,
} from './shell-session.js';
import { createTerminalWss, dispatchShellEvent, terminalEndpointEnabled } from './workers/terminal-ws.js';

const PASSWORD = 'correct horse battery';
/** cmd.exe echoes and paints a prompt; give it room to get going. */
const OUTPUT_TIMEOUT_MS = 20_000;

let showFolder: string;
let server: Server;
let wss: WebSocketServer;
let port: number;

beforeEach(async () => {
    showFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-shell-e2e-'));
    await setFeaturePassword(showFolder, 'shell', PASSWORD);

    // Wire the two halves together exactly as the app does, minus the thread
    // boundary: pty events flow into the terminal module, terminal calls flow
    // back into the pty manager.
    setShellEventSink((event) => dispatchShellEvent(event));
    wss = createTerminalWss({
        getShowFolder: () => showFolder,
        shellStart: (sessionId, cols, rows, folder) => startShellSession(sessionId, cols, rows, folder),
        shellInput: (sessionId, data) => writeToShellSession(sessionId, data),
        shellResize: (sessionId, cols, rows) => resizeShellSession(sessionId, cols, rows),
        shellKill: (sessionId) => killShellSession(sessionId),
    });

    server = createServer();
    server.on('upgrade', (req, socket, head) => {
        void terminalEndpointEnabled(showFolder).then((enabled) => {
            if (!enabled) return socket.destroy();
            wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
});

afterEach(async () => {
    // Capture the folder now: if this hook is ever abandoned by a timeout and
    // resumes later, the module-level variable already points at the NEXT
    // test's folder.
    const folder = showFolder;
    shutdownShellSessions();
    setShellEventSink(() => {});
    // A failed test can leave client sockets open, and server.close() waits
    // for every connection to drain. Terminate server-side so cleanup cannot
    // hang into the hook timeout.
    for (const ws of wss.clients) ws.terminate();
    wss?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await fs.rm(folder, { recursive: true, force: true });
});

/** Open a terminal, authenticate, and collect everything the shell prints. */
async function openTerminal(): Promise<{ ws: WebSocket; output: () => string; waitFor: (s: string) => Promise<void> }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });

    let text = '';
    const waiters: Array<{ needle: string; resolve: () => void }> = [];
    let authResolve: ((ok: boolean) => void) | undefined;
    const authed = new Promise<boolean>((resolve) => (authResolve = resolve));

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { type?: string; data?: string };
        if (msg.type === 'authOk') authResolve?.(true);
        if (msg.type === 'authFail') authResolve?.(false);
        if (msg.type === 'data' && typeof msg.data === 'string') {
            text += msg.data;
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (text.includes(waiters[i].needle)) waiters.splice(i, 1)[0].resolve();
            }
        }
    });

    ws.send(JSON.stringify({ type: 'auth', password: PASSWORD, cols: 100, rows: 30 }));
    expect(await authed).toBe(true);

    return {
        ws,
        output: () => text,
        waitFor: (needle: string) =>
            new Promise<void>((resolve, reject) => {
                if (text.includes(needle)) return resolve();
                waiters.push({ needle, resolve });
                setTimeout(
                    () => reject(new Error(`timed out waiting for ${needle}; saw: ${text.slice(-400)}`)),
                    OUTPUT_TIMEOUT_MS,
                );
            }),
    };
}

/**
 * An `echo` command whose typed form never contains `marker` assembled, so
 * waiting for `marker` can only be satisfied by the shell's own output. The
 * tty echoes typed input immediately — on Linux even before the shell has
 * printed its first prompt — so waiting for an echoed marker is a race.
 */
function echoCommand(marker: string): string {
    const gap = process.platform === 'win32' ? '^' : '""'; // cmd.exe caret / POSIX empty quotes
    return `echo ${marker.slice(0, 4)}${gap}${marker.slice(4)}\r\n`;
}

const hasPty = await shellRuntimeAvailable();

describe.skipIf(!hasPty)('remote shell end to end', () => {
    it('runs a command in a real shell and streams the output back', async () => {
        const term = await openTerminal();
        term.ws.send(JSON.stringify({ type: 'input', data: echoCommand('EZP_E2E_MARKER') }));
        // Only the command's output can contain the assembled marker.
        await term.waitFor('EZP_E2E_MARKER');
        term.ws.close();
    }, 30_000);

    it('opening a second terminal displaces the first', async () => {
        const first = await openTerminal();
        const displaced = new Promise<string>((resolve) => {
            first.ws.on('message', (raw) => {
                const msg = JSON.parse(raw.toString()) as { type?: string };
                if (msg.type === 'superseded') resolve('superseded');
            });
        });

        const second = await openTerminal();
        expect(await displaced).toBe('superseded');

        // The survivor is still a working shell.
        second.ws.send(JSON.stringify({ type: 'input', data: echoCommand('EZP_SECOND') }));
        await second.waitFor('EZP_SECOND');
        second.ws.close();
    }, 40_000);

    it('closing the socket kills the pty', async () => {
        const term = await openTerminal();
        term.ws.send(JSON.stringify({ type: 'input', data: echoCommand('EZP_ALIVE') }));
        await term.waitFor('EZP_ALIVE');
        term.ws.close();

        // A fresh terminal must get a brand-new shell, not the old one's state.
        const next = await openTerminal();
        expect(next.output()).not.toContain('EZP_ALIVE');
        next.ws.close();
    }, 40_000);
});
