/**
 * HTTP/0.9 fallback for the device proxy. AlphaPix controllers answer with the
 * body alone — no status line, no headers — which Node's HTTP client rejects,
 * so both proxy paths retry here and synthesize a response head.
 */

import net from 'node:net';

export interface Http09Result {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
}

export interface Http09RequestOptions {
    hostname: string;
    port: number;
    path: string;
    method?: string;
    contentType?: string;
    body?: Buffer;
    timeoutMs?: number;
    maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Node parsed nothing at all, so the reply was not HTTP and the request went
 *  out intact — safe to retry on a fresh socket. */
export function isHeaderlessResponse(err: NodeJS.ErrnoException & { bytesParsed?: number }): boolean {
    return typeof err.code === 'string' && err.code.startsWith('HPE_') && (err.bytesParsed ?? 0) === 0;
}

/** Send a request over a raw socket and read until the peer closes. */
export function http09Request(opts: Http09RequestOptions): Promise<Http09Result> {
    const { hostname, port, path, method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes } = opts;

    return new Promise<Buffer>((resolve, reject) => {
        const socket = net.connect(port, hostname);
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;

        const finish = (err: Error | null, data?: Buffer): void => {
            if (settled) return;
            settled = true;
            socket.destroy();
            if (err) reject(err);
            else resolve(data ?? Buffer.alloc(0));
        };

        socket.setTimeout(timeoutMs);

        socket.on('connect', () => {
            let head = `${method} ${path} HTTP/1.0\r\nHost: ${hostname}\r\n`;
            if (body && body.length > 0) {
                head += `Content-Type: ${opts.contentType ?? 'application/x-www-form-urlencoded'}\r\n`;
                head += `Content-Length: ${body.length}\r\n`;
            }
            head += 'Connection: close\r\n\r\n';
            socket.write(Buffer.from(head, 'latin1'));
            if (body && body.length > 0) socket.write(body);
        });

        socket.on('data', (d: Buffer) => {
            size += d.length;
            if (maxBytes !== undefined && size > maxBytes) {
                finish(new Error(`HTTP/0.9 response from ${hostname}:${port} exceeded ${maxBytes} bytes`));
                return;
            }
            chunks.push(d);
        });

        // A header-less server signals end-of-body by closing.
        socket.on('close', () => finish(null, Buffer.concat(chunks)));

        socket.on('timeout', () => {
            if (chunks.length > 0) finish(null, Buffer.concat(chunks));
            else finish(new Error(`HTTP/0.9 request to ${hostname}:${port}${path} timed out`));
        });

        socket.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
    }).then((raw) => toResult(raw, path));
}

const DROP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding']);

/** Pass a well-formed reply through; give a bare body a synthesized 200. */
function toResult(raw: Buffer, path: string): Http09Result {
    if (raw.subarray(0, 5).toString('latin1') === 'HTTP/') {
        const sep = raw.indexOf('\r\n\r\n');
        if (sep >= 0) {
            const lines = raw.subarray(0, sep).toString('latin1').split('\r\n');
            const status = Number(lines[0].split(' ')[1]);
            const headers: Record<string, string> = {};
            for (const line of lines.slice(1)) {
                const colon = line.indexOf(':');
                if (colon <= 0) continue;
                // Lowercased, as Node's parser would: callers look names up that way.
                const name = line.slice(0, colon).trim().toLowerCase();
                if (DROP_HEADERS.has(name)) continue;
                headers[name] = line.slice(colon + 1).trim();
            }
            const body = raw.subarray(sep + 4);
            headers['content-length'] = String(body.length);
            return { status: Number.isFinite(status) ? status : 200, headers, body };
        }
    }
    return {
        status: 200,
        headers: { 'content-type': guessContentType(path, raw), 'content-length': String(raw.length) },
        body: raw,
    };
}

const EXTENSION_TYPES: Record<string, string> = {
    htm: 'text/html',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    xml: 'text/xml',
    txt: 'text/plain',
    png: 'image/png',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
};

/** No charset on HTML: the page's own meta tag must still win (AlphaPix pages
 *  declare windows-1250 / iso-8859-1). */
function guessContentType(path: string, body: Buffer): string {
    const ext = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    if (ext && EXTENSION_TYPES[ext]) return EXTENSION_TYPES[ext];
    const head = body.subarray(0, 256).toString('latin1').toLowerCase();
    if (head.includes('<html') || head.includes('<!doctype html')) return 'text/html';
    return 'application/octet-stream';
}
