/**
 * HTTP/0.9 fallback for the device proxy.
 *
 * HolidayCoro AlphaPix controllers answer with the body alone — no status line,
 * no headers — which Node's HTTP client rejects outright. Both proxy paths (the
 * Koa `/proxy/` route and the cloud HTTP-over-WS bridge) retry through this raw
 * socket client and synthesize the response head a browser needs.
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
    /** Path plus query, as sent on the wire. */
    path: string;
    method?: string;
    /** Content type for `body`; defaults to form encoding. */
    contentType?: string;
    body?: Buffer;
    timeoutMs?: number;
    /** Cap on the response; larger responses reject. */
    maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * True when Node failed to parse the peer's response and consumed nothing —
 * i.e. the reply was not HTTP at all. The request went out intact, so retrying
 * on a fresh socket is safe.
 */
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

        // Data but no close: take what we have. Nothing at all: a real timeout.
        socket.on('timeout', () => {
            if (chunks.length > 0) finish(null, Buffer.concat(chunks));
            else finish(new Error(`HTTP/0.9 request to ${hostname}:${port}${path} timed out`));
        });

        socket.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
    }).then((raw) => toResult(raw, path));
}

/** Headers a complete buffered response must not carry forward. */
const DROP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding']);

/**
 * Split a reply that may or may not carry a status line. A well-formed one is
 * passed through (some paths on these devices do answer properly); a bare body
 * gets a synthesized 200.
 */
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
                // Lowercase, as Node's parser would: callers look names up that way.
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

/**
 * These devices send no content type, so infer one: extension first, then a
 * sniff for markup. HTML is served without a charset so the page's own meta tag
 * still wins (AlphaPix pages declare windows-1250 / iso-8859-1).
 */
function guessContentType(path: string, body: Buffer): string {
    const ext = path.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    if (ext && EXTENSION_TYPES[ext]) return EXTENSION_TYPES[ext];
    const head = body.subarray(0, 256).toString('latin1').toLowerCase();
    if (head.includes('<html') || head.includes('<!doctype html')) return 'text/html';
    return 'application/octet-stream';
}
