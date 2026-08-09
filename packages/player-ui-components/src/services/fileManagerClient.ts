/**
 * Client for the player's `/filemanager` WebSocket.
 *
 * One socket carries everything — listing, uploads, downloads, renames — so the
 * LAN and cloud paths are identical and there is exactly one password check.
 * Requests are correlated by id, so several can be in flight at once (which is
 * what makes a windowed upload possible over the cloud's slower relay).
 */

export interface FileEntry {
    /** POSIX path relative to the show folder; '' is the root. */
    path: string;
    name: string;
    kind: 'file' | 'directory';
    sizeBytes: number;
    /** Epoch ms. */
    modified: number;
    /** xLights' own files, which must not be renamed, moved or deleted. */
    protected: boolean;
}

export class FileManagerError extends Error {
    constructor(
        message: string,
        readonly code: string,
    ) {
        super(message);
        this.name = 'FileManagerError';
    }
}

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void };

/** Bytes per upload/download frame; the server reports its own value on auth. */
const DEFAULT_CHUNK_BYTES = 512 * 1024;
/** Concurrent chunks in flight — enough to hide the relay round trip without
 *  flooding it. */
const UPLOAD_WINDOW = 4;

export class FileManagerClient {
    private ws?: WebSocket;
    private nextId = 1;
    private pending = new Map<string, Pending>();
    private chunkBytes = DEFAULT_CHUNK_BYTES;
    private closedReason?: string;

    /** Called when the player drops the session out from under us. */
    onClosed?: (reason: string) => void;

    /** Connect and authenticate. Rejects with a readable reason on refusal. */
    connect(url: string, password: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let ws: WebSocket;
            try {
                ws = new WebSocket(url);
            } catch {
                reject(new FileManagerError('Could not open a connection to the player.', 'connect'));
                return;
            }
            this.ws = ws;
            let settled = false;

            ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', password }));

            ws.onmessage = (event) => {
                let msg: Record<string, unknown>;
                try {
                    msg = JSON.parse(event.data as string) as Record<string, unknown>;
                } catch {
                    return;
                }
                if (!settled) {
                    if (msg.type === 'authOk') {
                        settled = true;
                        if (typeof msg.chunkBytes === 'number' && msg.chunkBytes > 0) {
                            this.chunkBytes = msg.chunkBytes;
                        }
                        resolve();
                        return;
                    }
                    if (msg.type === 'authFail') {
                        settled = true;
                        reject(new FileManagerError(String(msg.reason ?? 'Access refused.'), 'auth'));
                        try {
                            ws.close();
                        } catch {
                            /* already closing */
                        }
                        return;
                    }
                }
                this.dispatch(msg);
            };

            ws.onerror = () => {
                if (!settled) {
                    settled = true;
                    reject(new FileManagerError('Could not reach the player.', 'connect'));
                }
            };

            ws.onclose = () => {
                const reason = this.closedReason ?? 'The connection to the player was lost.';
                for (const [, p] of this.pending) p.reject(new FileManagerError(reason, 'closed'));
                this.pending.clear();
                if (settled) this.onClosed?.(reason);
                settled = true;
            };
        });
    }

    disconnect(): void {
        this.pending.clear();
        try {
            this.ws?.close();
        } catch {
            /* already closing */
        }
        this.ws = undefined;
    }

    private dispatch(msg: Record<string, unknown>): void {
        if (msg.type === 'closed') {
            this.closedReason = String(msg.reason ?? 'The player closed this session.');
            return;
        }
        const id = typeof msg.id === 'string' ? msg.id : undefined;
        if (!id) return;
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        if (msg.type === 'error') {
            p.reject(new FileManagerError(String(msg.message ?? 'The operation failed'), String(msg.code ?? 'io')));
            return;
        }
        p.resolve(msg);
    }

    private request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new FileManagerError('Not connected to the player.', 'closed'));
        }
        const id = `r${this.nextId++}`;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            try {
                ws.send(JSON.stringify({ ...payload, id }));
            } catch {
                this.pending.delete(id);
                reject(new FileManagerError('Could not send the request.', 'io'));
            }
        });
    }

    async list(path: string): Promise<FileEntry[]> {
        const res = await this.request({ type: 'list', path });
        return (res.entries as FileEntry[]) ?? [];
    }

    async mkdir(path: string): Promise<void> {
        await this.request({ type: 'mkdir', path });
    }

    async move(from: string, to: string): Promise<void> {
        await this.request({ type: 'move', from, to });
    }

    async remove(path: string, recursive: boolean): Promise<void> {
        await this.request({ type: 'delete', path, recursive });
    }

    /** Download a file, streaming it in chunks and reassembling a Blob. */
    async download(path: string, onProgress?: (loaded: number, total: number) => void): Promise<Blob> {
        const parts: Uint8Array[] = [];
        let offset = 0;
        for (;;) {
            const res = await this.request({ type: 'read', path, offset });
            const bytes = base64ToBytes(String(res.dataBase64 ?? ''));
            parts.push(bytes);
            offset += bytes.length;
            const total = Number(res.total) || offset;
            onProgress?.(offset, total);
            if (res.eof === true || bytes.length === 0 || offset >= total) break;
        }
        return new Blob(parts as BlobPart[]);
    }

    /** Upload a file in chunks, several in flight at once. */
    async upload(path: string, file: Blob, onProgress?: (loaded: number, total: number) => void): Promise<void> {
        const total = file.size;
        if (total === 0) {
            await this.request({ type: 'write', path, offset: 0, dataBase64: '' });
            onProgress?.(0, 0);
            return;
        }

        const offsets: number[] = [];
        for (let o = 0; o < total; o += this.chunkBytes) offsets.push(o);

        let sent = 0;
        const sendAt = async (offset: number) => {
            const slice = file.slice(offset, Math.min(offset + this.chunkBytes, total));
            const buf = new Uint8Array(await slice.arrayBuffer());
            await this.request({ type: 'write', path, offset, dataBase64: bytesToBase64(buf) });
            sent += buf.length;
            onProgress?.(sent, total);
        };

        // Offset 0 lands first: it truncates any existing file, so it must not
        // race a later chunk that has already written past it.
        await sendAt(offsets[0]);
        const rest = offsets.slice(1);
        let cursor = 0;
        await Promise.all(
            Array.from({ length: Math.min(UPLOAD_WINDOW, rest.length) }, async () => {
                for (;;) {
                    const i = cursor++;
                    if (i >= rest.length) return;
                    await sendAt(rest[i]);
                }
            }),
        );
    }
}

function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function bytesToBase64(bytes: Uint8Array): string {
    // Chunked so a large buffer doesn't blow the argument limit of String.fromCharCode.
    let binary = '';
    const STEP = 0x8000;
    for (let i = 0; i < bytes.length; i += STEP) {
        binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
    }
    return btoa(binary);
}
