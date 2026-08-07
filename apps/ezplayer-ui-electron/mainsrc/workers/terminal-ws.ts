/**
 * The `/terminal` WebSocket: the only way into the remote shell.
 *
 * Security posture, in order of enforcement:
 *   1. If no password is configured, the endpoint does not exist — upgrades are
 *      rejected outright. This is the master switch, and only the CLI can flip
 *      it.
 *   2. A freshly-opened socket may send exactly one kind of message: `auth`.
 *      Anything else, or silence past AUTH_TIMEOUT_MS, closes it.
 *   3. Wrong passwords are throttled process-wide with escalating lockouts, so
 *      the password — not the network — is what an attacker has to beat.
 * Only after all three does main get asked to spawn a pty.
 *
 * Terminal bytes deliberately do NOT go through the state broadcaster: it
 * coalesces per key and kicks slow clients, which is right for snapshots and
 * catastrophic for a byte stream.
 */

import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { AUTH_TIMEOUT_MS, authenticateFeature, featureEndpointEnabled } from './password-gate.js';
import type { ShellEvent } from './serverworkertypes.js';

/** Client → player. */
type TerminalClientMessage =
    | { type: 'auth'; password?: unknown; cols?: unknown; rows?: unknown }
    | { type: 'input'; data?: unknown }
    | { type: 'resize'; cols?: unknown; rows?: unknown };

/** Calls the terminal needs to make into main. Injected so this module stays
 *  testable and doesn't reach for the worker's RPC singleton. */
export interface TerminalHost {
    /** The show folder currently open, since that is where the password lives.
     *  A getter rather than a value: the folder can change while we're running,
     *  and a stale one would check the wrong show's password. */
    getShowFolder(): string | undefined;
    /** `showFolder` is the one the password was actually checked against, so
     *  main spawns against the same show even if the folder changes in
     *  between. */
    shellStart(
        sessionId: string,
        cols: number,
        rows: number,
        showFolder: string | undefined,
    ): Promise<string | undefined>;
    shellInput(sessionId: string, data: string): void;
    shellResize(sessionId: string, cols: number, rows: number): void;
    shellKill(sessionId: string): void;
}

interface Attached {
    ws: WebSocket;
    sessionId: string;
}

/** The single authenticated terminal, if any. One at a time is a product
 *  decision, enforced here and again in main. */
let attached: Attached | undefined;

/** Set by `createTerminalWss`, so revocation paths can reach into main too. */
let activeHost: TerminalHost | undefined;

function send(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify(msg));
    } catch {
        /* socket is going away; the close handler cleans up */
    }
}

function toDim(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(500, Math.max(1, Math.floor(n)));
}

/**
 * Create the `/terminal` WebSocketServer. The caller wires it into the HTTP
 * server's upgrade routing and re-checks the password gate on every upgrade, so
 * clearing the password takes effect immediately.
 */
export function createTerminalWss(host: TerminalHost): WebSocketServer {
    activeHost = host;
    const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

    wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
        let authed = false;
        let sessionId: string | undefined;

        const authTimer = setTimeout(() => {
            if (!authed) {
                send(ws, { type: 'authFail', reason: 'timed out waiting for a password' });
                ws.close(4401, 'auth timeout');
            }
        }, AUTH_TIMEOUT_MS);

        const finish = () => {
            clearTimeout(authTimer);
            if (sessionId && attached?.sessionId === sessionId) {
                attached = undefined;
                host.shellKill(sessionId);
            }
        };

        ws.on('message', (raw, isBinary) => {
            if (isBinary) return; // protocol is JSON text frames only
            let msg: TerminalClientMessage;
            try {
                msg = JSON.parse(raw.toString()) as TerminalClientMessage;
            } catch {
                return;
            }
            if (!msg || typeof msg.type !== 'string') return;

            if (!authed) {
                // Pre-auth, `auth` is the ONLY message that is even looked at.
                if (msg.type !== 'auth') {
                    send(ws, { type: 'authFail', reason: 'authentication required' });
                    ws.close(4401, 'unauthenticated');
                    return;
                }
                void handleAuth(msg);
                return;
            }

            if (!sessionId) return;
            if (msg.type === 'input' && typeof msg.data === 'string') {
                host.shellInput(sessionId, msg.data);
            } else if (msg.type === 'resize') {
                host.shellResize(sessionId, toDim(msg.cols, 80), toDim(msg.rows, 24));
            }
        });

        const handleAuth = async (msg: Extract<TerminalClientMessage, { type: 'auth' }>) => {
            // Read the folder once and reuse it: it must not change between the
            // password check and the spawn. The gate re-reads the config on
            // every attempt, so clearing the password (or switching shows)
            // takes effect even for a socket already mid-handshake.
            const showFolder = host.getShowFolder();
            const auth = await authenticateFeature('shell', showFolder, msg.password);
            if (!auth.ok) {
                send(ws, { type: 'authFail', reason: auth.reason });
                ws.close(auth.code, 'authentication failed');
                return;
            }
            if (ws.readyState !== WebSocket.OPEN) return;

            authed = true;
            clearTimeout(authTimer);

            const id = randomUUID();
            const cols = toDim(msg.cols, 80);
            const rows = toDim(msg.rows, 24);

            // Displace any existing terminal. Do it here too (not just in main)
            // so the old socket is told, rather than just going silent.
            if (attached) {
                const previous = attached;
                attached = undefined;
                send(previous.ws, { type: 'superseded' });
                previous.ws.close(4409, 'superseded by a new terminal');
            }

            // Claim the session BEFORE asking main to spawn. The pty starts
            // producing the shell banner the moment it exists, and those events
            // race the RPC reply back to this thread; if we waited to record
            // `attached`, the first bytes would be dropped on the floor.
            sessionId = id;
            attached = { ws, sessionId: id };

            const error = await host.shellStart(id, cols, rows, showFolder);
            if (error) {
                if (attached?.sessionId === id) attached = undefined;
                sessionId = undefined;
                send(ws, { type: 'authFail', reason: error });
                ws.close(4500, 'shell start failed');
                return;
            }
            send(ws, { type: 'authOk' });
            console.log(`[terminal] shell session opened (${id.slice(0, 8)}…)`);
        };

        ws.on('close', finish);
        ws.on('error', finish);
    });

    return wss;
}

/** Route a pty event from main to the socket that owns it. */
export function dispatchShellEvent(event: ShellEvent): void {
    if (!attached || attached.sessionId !== event.sessionId) return;
    const { ws } = attached;
    if (event.type === 'data') {
        send(ws, { type: 'data', data: event.data });
        return;
    }
    if (event.type === 'exit') {
        attached = undefined;
        send(ws, { type: 'exit', code: event.code });
        ws.close(1000, 'shell exited');
        return;
    }
    // `superseded` is normally delivered by the socket that displaced this one;
    // this covers main superseding a session on its own.
    attached = undefined;
    send(ws, { type: 'superseded' });
    ws.close(4409, 'superseded by a new terminal');
}

/** True when the open show has a password configured — the gate for accepting
 *  an upgrade at all. */
export async function terminalEndpointEnabled(showFolder: string | undefined): Promise<boolean> {
    return featureEndpointEnabled('shell', showFolder);
}

/** Drop the active terminal and its pty — used when the CLI clears the
 *  password, so revoking access takes effect on sessions already in flight. */
export function closeActiveTerminal(reason: string): void {
    if (!attached) return;
    const { ws, sessionId } = attached;
    attached = undefined;
    activeHost?.shellKill(sessionId);
    send(ws, { type: 'closed', reason });
    ws.close(4403, reason);
}
