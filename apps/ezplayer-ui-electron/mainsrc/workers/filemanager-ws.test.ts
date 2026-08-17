import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'http';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { WebSocket, type WebSocketServer } from 'ws';
import { setFeaturePassword } from '../remoteaccess.js';

const PASSWORD = 'files password here';
const SHELL_PASSWORD = 'shell password here';

type Mod = typeof import('./filemanager-ws.js');

let showFolder: string;
let server: Server;
let wss: WebSocketServer;
let port: number;
let mod: Mod;

/** Fresh module per test: the endpoint keeps process-wide session and lockout
 *  state, so tests must not share it. */
async function startHarness(): Promise<void> {
    vi.resetModules();
    mod = await import('./filemanager-ws.js');
    wss = mod.createFileManagerWss({ getShowFolder: () => showFolder });
    server = createServer();
    server.on('upgrade', (req, socket, head) => {
        void mod.fileManagerEndpointEnabled(showFolder).then((enabled) => {
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

/** A connected, authenticated client with request/response correlation. */
class TestClient {
    private ws!: WebSocket;
    private id = 0;
    private waiting = new Map<string, (m: Record<string, unknown>) => void>();

    async connect(password: string): Promise<Record<string, unknown>> {
        this.ws = new WebSocket(`ws://127.0.0.1:${port}/filemanager`);
        await new Promise<void>((resolve, reject) => {
            this.ws.once('open', () => resolve());
            this.ws.once('error', reject);
        });
        const first = new Promise<Record<string, unknown>>((resolve) => {
            this.ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
        });
        this.ws.send(JSON.stringify({ type: 'auth', password }));
        const reply = await first;
        this.ws.on('message', (raw) => {
            const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
            const id = typeof msg.id === 'string' ? msg.id : undefined;
            if (id && this.waiting.has(id)) {
                this.waiting.get(id)!(msg);
                this.waiting.delete(id);
            }
        });
        return reply;
    }

    send(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        const id = `t${++this.id}`;
        return new Promise((resolve) => {
            this.waiting.set(id, resolve);
            this.ws.send(JSON.stringify({ ...payload, id }));
        });
    }

    /** Send without auth, to prove pre-auth messages are refused. */
    raw(payload: Record<string, unknown>): void {
        this.ws.send(JSON.stringify(payload));
    }

    close(): void {
        try {
            this.ws.close();
        } catch {
            /* already closing */
        }
    }
}

beforeEach(async () => {
    showFolder = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-fm-'));
    await fsp.mkdir(path.join(showFolder, '.ezplayer'));
    await fsp.writeFile(path.join(showFolder, '.ezplayer', 'remote-access.json'), '{}');
    await fsp.writeFile(path.join(showFolder, 'notes.txt'), 'hello world');
    await fsp.mkdir(path.join(showFolder, 'music'));
});

afterEach(async () => {
    wss?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await fsp.rm(showFolder, { recursive: true, force: true });
});

describe('/filemanager endpoint', () => {
    it('refuses the upgrade entirely when no files password is configured', async () => {
        await startHarness();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/filemanager`);
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        expect(err.message).toMatch(/403/);
    });

    it('is not unlocked by the shell password', async () => {
        // Shell configured, files not: the endpoint must stay shut.
        await setFeaturePassword(showFolder, 'shell', SHELL_PASSWORD);
        await startHarness();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/filemanager`);
        const err = await new Promise<Error>((resolve) => ws.once('error', resolve));
        expect(err.message).toMatch(/403/);
    });

    it('rejects the shell password once the file manager is enabled', async () => {
        await setFeaturePassword(showFolder, 'shell', SHELL_PASSWORD);
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const client = new TestClient();
        expect((await client.connect(SHELL_PASSWORD)).type).toBe('authFail');
    });

    it('accepts the files password and lists the show folder', async () => {
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const client = new TestClient();
        expect((await client.connect(PASSWORD)).type).toBe('authOk');

        const res = await client.send({ type: 'list', path: '' });
        const names = (res.entries as Array<{ name: string }>).map((e) => e.name);
        expect(names).toEqual(['music', 'notes.txt']);
        client.close();
    });

    it('never exposes the .ezplayer settings folder', async () => {
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const client = new TestClient();
        await client.connect(PASSWORD);

        const listed = await client.send({ type: 'list', path: '' });
        expect((listed.entries as Array<{ name: string }>).map((e) => e.name)).not.toContain('.ezplayer');

        // And it cannot be reached by asking for it directly — which would
        // otherwise hand over the very password records gating this feature.
        const direct = await client.send({ type: 'list', path: '.ezplayer' });
        expect(direct.type).toBe('error');
        expect(direct.code).toBe('forbidden');

        const read = await client.send({ type: 'read', path: '.ezplayer/remote-access.json', offset: 0 });
        expect(read.type).toBe('error');
        client.close();
    });

    it('refuses to escape the show folder', async () => {
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const client = new TestClient();
        await client.connect(PASSWORD);

        for (const bad of ['../outside.txt', '/etc/passwd', 'music/../../escape.txt']) {
            const res = await client.send({ type: 'read', path: bad, offset: 0 });
            expect(res.type, `expected ${bad} to be refused`).toBe('error');
        }
        client.close();
    });

    it('ignores commands sent before authenticating', async () => {
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/filemanager`);
        await new Promise<void>((resolve, reject) => {
            ws.once('open', () => resolve());
            ws.once('error', reject);
        });
        const reply = new Promise<Record<string, unknown>>((resolve) => {
            ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
        });
        ws.send(JSON.stringify({ type: 'delete', path: 'notes.txt', id: 'x' }));
        expect((await reply).type).toBe('authFail');
        // The file must still be there.
        await expect(fsp.readFile(path.join(showFolder, 'notes.txt'), 'utf8')).resolves.toBe('hello world');
    });

    it('round-trips an upload and a download', async () => {
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const client = new TestClient();
        await client.connect(PASSWORD);

        const payload = Buffer.from('uploaded contents');
        const wrote = await client.send({
            type: 'write',
            path: 'music/new.txt',
            offset: 0,
            dataBase64: payload.toString('base64'),
        });
        expect(wrote.type).toBe('write');
        await expect(fsp.readFile(path.join(showFolder, 'music', 'new.txt'), 'utf8')).resolves.toBe(payload.toString());

        const read = await client.send({ type: 'read', path: 'music/new.txt', offset: 0 });
        expect(Buffer.from(String(read.dataBase64), 'base64').toString()).toBe(payload.toString());
        expect(read.eof).toBe(true);
        client.close();
    });

    it('renames, moves, makes folders and deletes', async () => {
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const client = new TestClient();
        await client.connect(PASSWORD);

        expect((await client.send({ type: 'mkdir', path: 'images' })).type).toBe('ok');
        expect((await client.send({ type: 'move', from: 'notes.txt', to: 'images/notes.txt' })).type).toBe('ok');
        expect((await client.send({ type: 'move', from: 'images/notes.txt', to: 'images/readme.txt' })).type).toBe(
            'ok',
        );

        const listed = await client.send({ type: 'list', path: 'images' });
        expect((listed.entries as Array<{ name: string }>).map((e) => e.name)).toEqual(['readme.txt']);

        expect((await client.send({ type: 'delete', path: 'images', recursive: true })).type).toBe('ok');
        const after = await client.send({ type: 'list', path: '' });
        expect((after.entries as Array<{ name: string }>).map((e) => e.name)).toEqual(['music']);
        client.close();
    });

    it('closeFileManagerSessions drops a live session', async () => {
        await setFeaturePassword(showFolder, 'files', PASSWORD);
        await startHarness();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/filemanager`);
        await new Promise<void>((resolve, reject) => {
            ws.once('open', () => resolve());
            ws.once('error', reject);
        });
        await new Promise<void>((resolve) => {
            ws.once('message', () => resolve());
            ws.send(JSON.stringify({ type: 'auth', password: PASSWORD }));
        });

        const closed = new Promise<Record<string, unknown>>((resolve) => {
            ws.once('message', (raw) => resolve(JSON.parse(raw.toString())));
        });
        mod.closeFileManagerSessions('the file manager was disabled');
        expect((await closed).type).toBe('closed');
    });
});
