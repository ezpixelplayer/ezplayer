/** Thin typed helpers for the endpoints under test. */

export class FppClient {
    constructor(readonly base: string) {}

    async status(): Promise<Record<string, any>> {
        return (await fetch(`${this.base}/api/system/status`)).json() as Promise<Record<string, any>>;
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

    async getPlaylist(name: string): Promise<Record<string, any>> {
        return (await fetch(`${this.base}/api/playlist/${encodeURIComponent(name)}`)).json() as Promise<
            Record<string, any>
        >;
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

    async getSchedule(): Promise<Record<string, any>[]> {
        return (await fetch(`${this.base}/api/schedule`)).json() as Promise<Record<string, any>[]>;
    }

    async ezpCommand(cmd: Record<string, unknown>): Promise<Response> {
        return fetch(`${this.base}/api/player-command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cmd),
        });
    }

    async currentShow(): Promise<Record<string, any>> {
        return (await fetch(`${this.base}/api/current-show`)).json() as Promise<Record<string, any>>;
    }

    /** Poll status until pred passes (or throw at timeout). Returns the status. */
    async waitForStatus(
        pred: (s: Record<string, any>) => boolean,
        opts?: { timeoutMs?: number; label?: string },
    ): Promise<Record<string, any>> {
        const timeoutMs = opts?.timeoutMs ?? 30_000;
        const deadline = Date.now() + timeoutMs;
        let last: Record<string, any> = {};
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
