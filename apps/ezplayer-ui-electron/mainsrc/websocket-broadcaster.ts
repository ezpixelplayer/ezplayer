/**
 * WebSocket broadcaster utility
 * Manages WebSocket connections and broadcasts updates to all connected clients
 * Takes care to not swamp anything
 */

import { FullPlayerState, PlayerWebSocketMessage, PlayerClientWebSocketMessage } from '@ezplayer/ezplayer-core';

import WebSocket, { WebSocketServer } from 'ws';

function safeParseClientMsg(raw: WebSocket.RawData): PlayerClientWebSocketMessage | null {
    try {
        const obj = JSON.parse(raw.toString());
        if (!obj || typeof obj.t !== 'string') return null;
        return obj as PlayerClientWebSocketMessage;
    } catch {
        return null;
    }
}

class Conn {
    readonly ws: WebSocket;
    subscribed?: Set<keyof FullPlayerState>; // undefined = subscribed to everything
    dirtyKeys: Set<keyof FullPlayerState> = new Set();
    // per-key coalescing buffer: latest value wins
    pending = new Map<keyof FullPlayerState, { ver: number; data: unknown }>();
    sending = false; // round loop running
    wantAnotherRound = false; // set when updates occur mid-round

    lastPongMs = Date.now();
    closed = false;

    constructor(ws: WebSocket) {
        this.ws = ws;
        this.subscribed = undefined; // start "subscribed to everything"
    }
}

const LO_WATER = 256 * 1024;

function waitForDrain(ws: WebSocket, loWater = LO_WATER): Promise<void> {
    return new Promise((resolve) => {
        const buffered = (ws as any).bufferedAmount ?? 0;
        if (buffered <= loWater) return resolve();

        const sock = (ws as any)._socket as import('net').Socket | undefined;
        if (!sock) {
            const t = setInterval(() => {
                const b = (ws as any).bufferedAmount ?? 0;
                if (b <= loWater) {
                    clearInterval(t);
                    resolve();
                }
            }, 10);
            return;
        }

        const onDrain = () => {
            const b = (ws as any).bufferedAmount ?? 0;
            if (b <= loWater) {
                sock.off('drain', onDrain);
                resolve();
            }
        };
        sock.on('drain', onDrain);
    });
}

function wsSendAsync(ws: WebSocket, json: string): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.send(json, (err) => (err ? reject(err) : resolve()));
    });
}

export class WebSocketBroadcaster {
    private state: Partial<FullPlayerState> = {};
    private versions: { [K in keyof FullPlayerState]: number } = {};

    private conns = new Set<Conn>();

    // backpressure thresholds (tune)
    private readonly MAX_BUFFERED_BYTES = 8 * 1024 * 1024; // 8MB
    private readonly HEARTBEAT_MS = 5_000;
    private readonly HEARTBEAT_TIMEOUT_MS = 15_000;

    attach(wss: WebSocketServer) {
        wss.on('connection', (ws) => this.onConnection(ws));
        setInterval(() => this.heartbeatSweep(), this.HEARTBEAT_MS).unref?.();
    }

    /** Set the state */
    set<K extends keyof FullPlayerState>(k: K, value: FullPlayerState[K]) {
        this.state[k] = value;
        if (!Object.hasOwn(this.versions, k)) {
            this.versions[k] = 0;
        }
        const ver = ++this.versions[k]!;

        for (const c of this.conns) {
            if ((c.subscribed && !c.subscribed.has(k)) || c.closed) continue;

            c.dirtyKeys.add(k);
            c.pending.set(k, { ver, data: value });

            // If currently sending, don't start a new round; just mark intent.
            if (c.sending) c.wantAnotherRound = true;
            else queueMicrotask(() => this.runRounds(c));
        }
    }

    private async runRounds(c: Conn) {
        if (c.sending || c.closed) return;
        c.sending = true;

        try {
            while (!c.closed) {
                if (c.dirtyKeys.size === 0) break;

                // If we're heavily buffered, wait before sending the next round.
                // if it's *persistently* bad, you may choose to kick here
                await waitForDrain(c.ws);

                // Build this round: include ALL currently-dirty keys (fairness)
                const keys = Array.from(c.dirtyKeys);
                c.dirtyKeys.clear();
                c.wantAnotherRound = false;

                const data: Partial<FullPlayerState> = {};
                for (const k of keys) {
                    // latest state wins; this is the drop semantics
                    (data as any)[k] = this.state[k];
                }

                const msg = {
                    type: 'snapshot',
                    v: { ...this.versions },
                    data,
                } as PlayerWebSocketMessage;

                // Send one message for the whole round
                await wsSendAsync(c.ws, JSON.stringify(msg));

                // Bound latency: don't start another round until buffers drain down
                await waitForDrain(c.ws);

                // If updates happened mid-round, loop will pick them up via dirtyKeys
                // (dirtyKeys may already be non-empty)
                if (!c.wantAnotherRound && c.dirtyKeys.size === 0) break;
            }
        } catch {
            this.closeConn(c, 'send failed');
        } finally {
            c.sending = false;
            // If something arrived right as we ended, restart.
            if (!c.closed && c.dirtyKeys.size > 0) queueMicrotask(() => this.runRounds(c));
        }
    }

    /*
    // Snd snapshot for selected keys to a conn
    private sendSnapshot<K extends keyof FullPlayerState>(
        c: Conn,
        keys: readonly K[],
    ) {
        const data: Partial<Pick<FullPlayerState, K>> = {};

        for (const k of keys) {
            const value = this.state[k];
            if (value !== undefined) {
                data[k] = value;
            }
        }

        this.send(c, {
            type: "snapshot",
            v: { ...this.versions },
            data,
        } satisfies PlayerWebSocketMessage);
    }
    */

    private onConnection(ws: WebSocket) {
        const c = new Conn(ws);

        ws.on('message', (raw) => this.onMessage(c, raw));
        ws.on('close', () => this.closeConn(c, 'socket closed'));
        ws.on('error', () => this.closeConn(c, 'socket error'));

        // mark all keys dirty so first round is effectively a snapshot
        for (const k of Object.keys(this.state)) c.dirtyKeys.add(k as keyof FullPlayerState);
        queueMicrotask(() => this.runRounds(c));

        this.conns.add(c);
    }

    private onMessage(c: Conn, raw: WebSocket.RawData) {
        const msg = safeParseClientMsg(raw);
        if (!msg) return;

        if (msg.type === 'pong') {
            c.lastPongMs = Date.now();
            return;
        }
    }

    private heartbeatSweep() {
        const now = Date.now();
        for (const c of this.conns) {
            if (c.closed) continue;

            // kill dead conns
            if (now - c.lastPongMs > this.HEARTBEAT_TIMEOUT_MS) {
                this.kick(c, 'heartbeat timeout');
                continue;
            }

            // ping
            this.send(c, { type: 'ping', now });
        }
    }

    private kick(c: Conn, reason: string) {
        this.send(c, { type: 'kick', reason });
        this.closeConn(c, reason);
    }

    private closeConn(c: Conn, _reason: string) {
        if (c.closed) return;
        c.closed = true;
        this.conns.delete(c);
        try {
            c.ws.close();
        } catch {}
    }

    private send(c: Conn, msg: PlayerWebSocketMessage) {
        if (c.closed) return;

        // backpressure guard
        const buffered = (c.ws as any).bufferedAmount ?? 0;
        if (buffered > this.MAX_BUFFERED_BYTES) {
            // for state-convergence systems: best is to kick and let reconnect/resync
            this.kick(c, `backpressure: buffered=${buffered}`);
            return;
        }

        try {
            c.ws.send(JSON.stringify(msg));
        } catch {
            this.closeConn(c, 'send failed');
        }
    }
}

// Singleton instance
export const wsBroadcaster = new WebSocketBroadcaster();
