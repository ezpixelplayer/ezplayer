/** Thin typed helpers for the endpoints under test. */

/** Subset of the FPP /api/system/status payload the tests consume. */
export interface FppStatus {
    status_name: string;
    current_sequence: string;
    current_playlist: { playlist: string; index: string; count: string };
    seconds_elapsed: string;
    milliseconds_elapsed: number;
    time_elapsed: string;
    [key: string]: unknown;
}

/** Subset of an FPP playlist GET payload. */
export interface FppPlaylist {
    name?: string;
    mainPlaylist: Array<{ type?: string; sequenceName?: string; [key: string]: unknown }>;
    playlistInfo: { total_items: number; total_duration: number };
    [key: string]: unknown;
}

/** Raw pushed player status carried in /api/ezp/current-show. */
export interface EzpPStatus {
    status?: string;
    now_playing?: unknown;
    [key: string]: unknown;
}

/** Subset of the native /api/ezp/current-show payload the tests consume. */
export interface EzpCurrentShow {
    playlists: Array<{ id: string; title: string; [key: string]: unknown }>;
    sequences: Array<{
        id: string;
        files?: { fseq?: string };
        settings?: Record<string, unknown>;
        [key: string]: unknown;
    }>;
    schedule: Array<Record<string, unknown>>;
    pStatus?: EzpPStatus;
    [key: string]: unknown;
}

export class FppClient {
    constructor(readonly base: string) {}

    async status(): Promise<FppStatus> {
        return (await fetch(`${this.base}/api/system/status`)).json() as Promise<FppStatus>;
    }

    async command(name: string, ...args: (string | number)[]): Promise<Response> {
        const parts = [name, ...args.map(String)].map((s) => encodeURIComponent(s)).join('/');
        return fetch(`${this.base}/api/command/${parts}`);
    }

    async uploadFile(dir: string, name: string, bytes: Uint8Array): Promise<Response> {
        return fetch(`${this.base}/api/file/${dir}/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: bytes,
        });
    }

    async uploadFileChunked(dir: string, name: string, bytes: Uint8Array, chunkSize: number): Promise<void> {
        for (let off = 0; off < bytes.length; off += chunkSize) {
            const chunk = bytes.subarray(off, Math.min(off + chunkSize, bytes.length));
            const res = await fetch(`${this.base}/api/file/${dir}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/offset+octet-stream',
                    'Upload-Name': name,
                    'Upload-Offset': String(off),
                    'Upload-Length': String(bytes.length),
                },
                body: chunk,
            });
            if (!res.ok) throw new Error(`chunk upload failed: ${res.status}`);
        }
    }

    async listFiles(dir: string): Promise<string[]> {
        return (await fetch(`${this.base}/api/files/${dir}?nameOnly=1`)).json() as Promise<string[]>;
    }

    async download(dir: string, name: string): Promise<Uint8Array> {
        const res = await fetch(`${this.base}/api/file/${dir}/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error(`download failed: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    }

    async putPlaylist(name: string, fpp: unknown): Promise<Response> {
        return fetch(`${this.base}/api/playlist/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fpp),
        });
    }

    async getPlaylist(name: string): Promise<FppPlaylist> {
        return (await fetch(`${this.base}/api/playlist/${encodeURIComponent(name)}`)).json() as Promise<FppPlaylist>;
    }

    async playlistNames(): Promise<string[]> {
        return (await fetch(`${this.base}/api/playlists`)).json() as Promise<string[]>;
    }

    async putSchedule(entries: unknown[]): Promise<Response> {
        return fetch(`${this.base}/api/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entries),
        });
    }

    async getSchedule(): Promise<Record<string, unknown>[]> {
        return (await fetch(`${this.base}/api/schedule`)).json() as Promise<Record<string, unknown>[]>;
    }

    async ezpCommand(cmd: Record<string, unknown>): Promise<Response> {
        return fetch(`${this.base}/api/ezp/player-command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cmd),
        });
    }

    async currentShow(): Promise<EzpCurrentShow> {
        return (await fetch(`${this.base}/api/ezp/current-show`)).json() as Promise<EzpCurrentShow>;
    }

    /** Poll status until pred passes (or throw at timeout). Returns the status. */
    async waitForStatus(
        pred: (s: FppStatus) => boolean,
        opts?: { timeoutMs?: number; label?: string },
    ): Promise<FppStatus> {
        const timeoutMs = opts?.timeoutMs ?? 30_000;
        const deadline = Date.now() + timeoutMs;
        let last: FppStatus | undefined;
        for (;;) {
            last = await this.status();
            if (pred(last)) return last;
            if (Date.now() > deadline) {
                throw new Error(
                    `waitForStatus${opts?.label ? ` (${opts.label})` : ''} timed out; last=${JSON.stringify(last).slice(0, 400)}`,
                );
            }
            await new Promise((r) => setTimeout(r, 500));
        }
    }
}
