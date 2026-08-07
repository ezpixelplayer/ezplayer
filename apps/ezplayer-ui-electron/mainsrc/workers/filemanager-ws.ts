/**
 * The `/filemanager` WebSocket: browse and edit the show folder remotely.
 *
 * Gated exactly like `/terminal`, by its own password — a file-manager password
 * does not open a shell, and vice versa. With no password configured the
 * endpoint refuses every upgrade, so the feature has no presence on the
 * network at all.
 *
 * WHY ONE WEBSOCKET RATHER THAN HTTP ROUTES: the cloud relays browser
 * WebSockets straight through, so LAN and cloud take byte-for-byte the same
 * route with one password check, instead of a second HTTP surface needing its
 * own auth. The cloud's HTTP path also caps body size and cannot express a
 * delete.
 *
 * Every path in every message is relative to the show folder. The
 * path-resolution layer is the only thing that turns one into a real location,
 * and the only thing keeping this feature inside the show folder.
 */

import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { AUTH_TIMEOUT_MS, authenticateFeature, featureEndpointEnabled } from './password-gate.js';
import {
    createDirectory,
    deletePath,
    listDirectory,
    movePath,
    readChunk,
    ShowFolderError,
    statEntry,
    writeChunk,
} from './showfolder-fs.js';

/** Binary payload per frame, sized so base64 (×4/3) plus the JSON envelope
 *  stays under the cloud relay's per-frame cap. */
export const CHUNK_BYTES = 512 * 1024;

/** Refuse to buffer an unbounded download into a browser tab. Large media can
 *  still be managed here — moved, renamed, deleted — just not downloaded. */
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

interface Session {
    ws: WebSocket;
    showFolder: string | undefined;
}

/** Live authenticated sessions. Several file-manager windows may coexist —
 *  they hold no exclusive resource. */
const sessions = new Set<Session>();

function send(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify(msg));
    } catch {
        /* socket going away; the close handler cleans up */
    }
}

/** Turn any failure into a reply the UI can show, without leaking host paths. */
function fail(ws: WebSocket, id: unknown, err: unknown): void {
    const known = err instanceof ShowFolderError;
    if (!known) console.error('[filemanager] operation failed:', err);
    send(ws, {
        type: 'error',
        id,
        code: known ? (err as ShowFolderError).code : 'io',
        message: known ? (err as ShowFolderError).message : 'The operation failed',
    });
}

function asString(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

export interface FileManagerHost {
    /** The show folder currently open — where everything is rooted. */
    getShowFolder(): string | undefined;
}

export function createFileManagerWss(host: FileManagerHost): WebSocketServer {
    // maxPayload covers a base64 chunk plus envelope.
    const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

    wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
        let session: Session | undefined;

        const authTimer = setTimeout(() => {
            if (!session) {
                send(ws, { type: 'authFail', reason: 'timed out waiting for a password' });
                ws.close(4401, 'auth timeout');
            }
        }, AUTH_TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(authTimer);
            if (session) sessions.delete(session);
            session = undefined;
        };

        ws.on('message', (raw, isBinary) => {
            if (isBinary) return; // protocol is JSON text frames only
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(raw.toString()) as Record<string, unknown>;
            } catch {
                return;
            }
            if (!msg || typeof msg.type !== 'string') return;

            if (!session) {
                // Pre-auth, `auth` is the ONLY message that is even looked at.
                if (msg.type !== 'auth') {
                    send(ws, { type: 'authFail', reason: 'authentication required' });
                    ws.close(4401, 'unauthenticated');
                    return;
                }
                void handleAuth(msg);
                return;
            }
            void handleCommand(session, msg);
        });

        const handleAuth = async (msg: Record<string, unknown>) => {
            const showFolder = host.getShowFolder();
            const auth = await authenticateFeature('files', showFolder, msg.password);
            if (!auth.ok) {
                send(ws, { type: 'authFail', reason: auth.reason });
                ws.close(auth.code, 'authentication failed');
                return;
            }
            if (ws.readyState !== WebSocket.OPEN) return;
            clearTimeout(authTimer);
            // Pin the folder the password was checked against, so a show change
            // mid-session cannot silently redirect operations at another show.
            session = { ws, showFolder: auth.showFolder };
            sessions.add(session);
            send(ws, { type: 'authOk', root: 'Show folder', chunkBytes: CHUNK_BYTES });
            console.log('[filemanager] session opened');
        };

        ws.on('close', cleanup);
        ws.on('error', cleanup);
    });

    return wss;
}

async function handleCommand(session: Session, msg: Record<string, unknown>): Promise<void> {
    const { ws, showFolder } = session;
    const id = msg.id;
    try {
        switch (msg.type) {
            case 'list': {
                const entries = await listDirectory(showFolder, asString(msg.path));
                send(ws, { type: 'list', id, path: asString(msg.path), entries });
                return;
            }
            case 'stat': {
                send(ws, { type: 'stat', id, entry: await statEntry(showFolder, asString(msg.path)) });
                return;
            }
            case 'mkdir': {
                await createDirectory(showFolder, asString(msg.path));
                send(ws, { type: 'ok', id });
                return;
            }
            case 'move': {
                await movePath(showFolder, asString(msg.from), asString(msg.to));
                send(ws, { type: 'ok', id });
                return;
            }
            case 'delete': {
                await deletePath(showFolder, asString(msg.path), { recursive: msg.recursive === true });
                send(ws, { type: 'ok', id });
                return;
            }
            case 'read': {
                const offset = Number(msg.offset) || 0;
                const stat = await statEntry(showFolder, asString(msg.path));
                if (stat.kind === 'directory') throw new ShowFolderError('That is a folder', 'not-a-directory');
                if (stat.sizeBytes > MAX_DOWNLOAD_BYTES) {
                    throw new ShowFolderError(
                        `That file is too large to download here (${Math.round(stat.sizeBytes / 1024 / 1024)} MB); ` +
                            `the limit is ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB`,
                        'too-large',
                    );
                }
                const { bytes, total } = await readChunk(showFolder, asString(msg.path), offset, CHUNK_BYTES);
                send(ws, {
                    type: 'read',
                    id,
                    path: asString(msg.path),
                    offset,
                    total,
                    eof: offset + bytes.length >= total,
                    dataBase64: bytes.toString('base64'),
                });
                return;
            }
            case 'write': {
                const offset = Number(msg.offset) || 0;
                const bytes = Buffer.from(asString(msg.dataBase64), 'base64');
                const size = await writeChunk(showFolder, asString(msg.path), offset, bytes);
                send(ws, { type: 'write', id, path: asString(msg.path), offset, size });
                return;
            }
            default:
                send(ws, { type: 'error', id, code: 'invalid-path', message: 'Unknown command' });
        }
    } catch (err) {
        fail(ws, id, err);
    }
}

/** True when the open show has a file-manager password configured. */
export async function fileManagerEndpointEnabled(showFolder: string | undefined): Promise<boolean> {
    return featureEndpointEnabled('files', showFolder);
}

/** Drop every session — used when the password is cleared or the show changes,
 *  so revoking access takes effect on windows already open. */
export function closeFileManagerSessions(reason: string): void {
    for (const session of [...sessions]) {
        sessions.delete(session);
        send(session.ws, { type: 'closed', reason });
        session.ws.close(4403, reason);
    }
}
