import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'http';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WebSocket, type WebSocketServer } from 'ws';
import { setFeaturePassword } from '../remoteaccess.js';

const PASSWORD = 'correct horse battery';

type TerminalModule = typeof import('./terminal-ws.js');

let showFolder: string;
let server: Server;
let port: number;
let mod: TerminalModule;
let wss: WebSocketServer;
let host: {
    getShowFolder: ReturnType<typeof vi.fn>;
    shellStart: ReturnType<typeof vi.fn>;
    shellInput: ReturnType<typeof vi.fn>;
    shellResize: ReturnType<typeof vi.fn>;
    shellKill: ReturnType<typeof vi.fn>;
};

/** Fresh module per test: terminal-ws intentionally keeps process-wide state
 *  (the single session, the lockout counter), so tests must not share it. */
async function startHarness(): Promise<void> {
    vi.resetModules();
    mod = await import('./terminal-ws.js');
    host = {
        getShowFolder: vi.fn().mockReturnValue(showFolder),
        shellStart: vi.fn().mockResolvedValue(undefined),
        shellInput: vi.fn(),
        shellResize: vi.fn(),
        shellKill: vi.fn(),
    };
    wss = mod.createTerminalWss(host);
    server = createServer();
    server.on('upgrade', (req, socket, head) => {
        void mod.terminalEndpointEnabled(showFolder).then((enabled) => {
            if (!enabled) {
                socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
                socket.destroy();
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
}

function connect(): WebSocket {
    return new WebSocket(`ws://127.0.0.1:${port}/terminal`);
}

/** Resolve with the first JSON message, or reject if the socket dies first. */
function firstMessage(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
        ws.once('error', reject);
        ws.once('close', () => reject(new Error('closed before any message')));
    });
}

function opened(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
    });
}

async function authenticate(password: string): Promise<{ ws: WebSocket; reply: Record<string, unknown> }> {
    const ws = connect();
    await opened(ws);
    const reply = firstMessage(ws);
    ws.send(JSON.stringify({ type: 'auth', password, cols: 100, rows: 30 }));
    return { ws, reply: await reply };
}

beforeEach(async () => {
    showFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-term-'));
});

afterEach(async () => {
    wss?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await fs.rm(showFolder, { recursive: true, force: true });
});

describe('/terminal endpoint', () => {
    it('refuses the upgrade entirely when no password is configured', async () => {
        await startHarness();
        const ws = connect();
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        expect(err.message).toMatch(/403/);
        expect(host.shellStart).not.toHaveBeenCalled();
    });

    it('starts a pty after the correct password', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const { ws, reply } = await authenticate(PASSWORD);
        expect(reply.type).toBe('authOk');
        expect(host.shellStart).toHaveBeenCalledTimes(1);
        // Terminal size from the auth message is honored at spawn, and the pty
        // is told which show folder the password was checked against.
        expect(host.shellStart.mock.calls[0].slice(1)).toEqual([100, 30, showFolder]);
        ws.close();
    });

    it('rejects a wrong password and never starts a pty', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const { reply } = await authenticate('not the password');
        expect(reply.type).toBe('authFail');
        expect(host.shellStart).not.toHaveBeenCalled();
    });

    it('ignores input sent before authenticating', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const ws = connect();
        await opened(ws);
        const reply = firstMessage(ws);
        ws.send(JSON.stringify({ type: 'input', data: 'rm -rf /\n' }));
        expect((await reply).type).toBe('authFail');
        expect(host.shellInput).not.toHaveBeenCalled();
        expect(host.shellStart).not.toHaveBeenCalled();
    });

    it('relays input and resize only after auth', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const { ws } = await authenticate(PASSWORD);
        ws.send(JSON.stringify({ type: 'input', data: 'whoami\n' }));
        ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
        await vi.waitFor(() => {
            expect(host.shellInput).toHaveBeenCalledWith(expect.any(String), 'whoami\n');
            expect(host.shellResize).toHaveBeenCalledWith(expect.any(String), 120, 40);
        });
        ws.close();
    });

    it('locks out after repeated failures, even with the right password', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        for (let i = 0; i < 4; i++) {
            const { reply } = await authenticate('wrong');
            expect(reply.type).toBe('authFail');
        }
        const { reply } = await authenticate(PASSWORD);
        expect(reply.type).toBe('authFail');
        expect(String(reply.reason)).toMatch(/too many failed attempts/);
        expect(host.shellStart).not.toHaveBeenCalled();
    });

    it('supersedes an existing terminal when a second one authenticates', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const first = await authenticate(PASSWORD);
        expect(first.reply.type).toBe('authOk');
        const displaced = firstMessage(first.ws);

        const second = await authenticate(PASSWORD);
        expect(second.reply.type).toBe('authOk');
        expect((await displaced).type).toBe('superseded');
        expect(host.shellStart).toHaveBeenCalledTimes(2);
        second.ws.close();
    });

    it('kills the pty when the viewer disconnects', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const { ws } = await authenticate(PASSWORD);
        const sessionId = host.shellStart.mock.calls[0][0];
        ws.close();
        await vi.waitFor(() => expect(host.shellKill).toHaveBeenCalledWith(sessionId));
    });

    it('forwards pty output only to the session that owns it', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const { ws } = await authenticate(PASSWORD);
        const sessionId = host.shellStart.mock.calls[0][0] as string;

        const out = firstMessage(ws);
        mod.dispatchShellEvent({ type: 'data', sessionId: 'someone-elses-session', data: 'LEAKED' });
        mod.dispatchShellEvent({ type: 'data', sessionId, data: 'mine' });
        const msg = await out;
        expect(msg).toEqual({ type: 'data', data: 'mine' });
        ws.close();
    });

    it('closeActiveTerminal drops a live session and its pty', async () => {
        await setFeaturePassword(showFolder, 'shell', PASSWORD);
        await startHarness();
        const { ws } = await authenticate(PASSWORD);
        const sessionId = host.shellStart.mock.calls[0][0];
        const closing = firstMessage(ws);
        mod.closeActiveTerminal('the remote shell was disabled');
        expect((await closing).type).toBe('closed');
        expect(host.shellKill).toHaveBeenCalledWith(sessionId);
    });
});
