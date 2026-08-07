/**
 * HTTP/WebSocket proxy middleware for multi-NIC bridging.
 *
 * URL pattern: /proxy/<full-target-URL>
 * Example:     /proxy/http://192.168.1.50:8080/api/status
 * Example:     /proxy/192.168.1.50/api/status
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import type Koa from 'koa';
import { WebSocketServer, WebSocket } from 'ws';
import { http09Request, isHeaderlessResponse } from './http09-fallback';

const PROXY_PREFIX = '/proxy/';
const REQUEST_TIMEOUT_MS = 30_000;
/** Largest request body held in memory so an HTTP/0.9 retry can resend it. */
const RETRY_BODY_MAX_BYTES = 1024 * 1024;

/** Hop-by-hop headers that must not be forwarded. */
const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

/** Strip hop-by-hop headers from an incoming header object. */
function filterHeaders(raw: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!HOP_BY_HOP.has(key.toLowerCase())) {
            out[key] = value;
        }
    }
    return out;
}

/**
 * Build forwarded request headers preserving original header-name case.
 * `req.headers` lowercases names, breaking case-sensitive devices (e.g. HinksPix
 * only honors `BLK`, not `blk`); `rawHeaders` keeps the wire case. `host` is
 * dropped — the caller sets it from the target.
 */
function filterRawHeaders(rawHeaders: string[]): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = {};
    for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
        const key = rawHeaders[i];
        const value = rawHeaders[i + 1];
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower) || lower === 'host') continue;
        const existing = out[key];
        if (existing === undefined) {
            out[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            out[key] = [existing as string, value];
        }
    }
    return out;
}

/** Whether a proxy target is on a LAN we'd bridge to: a private/link-local
 *  IPv4 literal or an mDNS `.local` name. Used by the cloud HTTP-over-WS
 *  bridge, which must not become an open proxy to the wider internet —
 *  controllers only ever live on these ranges. */
export function isLanProxyTarget(hostname: string): boolean {
    if (hostname.endsWith('.local')) return true;
    const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
}

/** Parse and validate the target URL from the proxy path. */
export function parseTargetUrl(originalUrl: string): URL | null {
    let raw = originalUrl.slice(PROXY_PREFIX.length);
    if (!raw) return null;
    // Default to http:// when no protocol is specified
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        raw = 'http://' + raw;
    }
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

// ─── HTTP Proxy Middleware ───────────────────────────────────────────

/** Rescue root-absolute asset requests made by proxied device pages (e.g. a
 *  controller page loading "/turnip_ota/ota.js"): those escape the /proxy/
 *  prefix, and the SPA history-fallback would otherwise swallow them with a
 *  200 index.html. When the Referer is a proxied device page, 307-redirect
 *  back under that device's proxy root. Mount BEFORE static/SPA middlewares. */
export function createProxyRefererRescue(): Koa.Middleware {
    return async (ctx, next) => {
        if (!ctx.path.startsWith(PROXY_PREFIX) && !ctx.path.startsWith('/api/') && ctx.path !== '/ws') {
            const m = ctx.get('referer').match(/^https?:\/\/[^/]+(\/proxy\/[^/?#]+)/);
            if (m) {
                ctx.status = 307;
                ctx.redirect(m[1] + ctx.originalUrl);
                return;
            }
        }
        return next();
    };
}

/** `isAllowed` (optional) lets the host enforce per-network policy — return
 *  false to refuse bridging to that hostname (403). */
export function createProxyMiddleware(isAllowed?: (hostname: string) => boolean): Koa.Middleware {
    return async (ctx, next) => {
        if (!ctx.originalUrl.startsWith(PROXY_PREFIX)) {
            return next();
        }

        const target = parseTargetUrl(ctx.originalUrl);
        if (!target) {
            ctx.status = 400;
            ctx.body = { error: 'Invalid or unsupported proxy target URL' };
            return;
        }
        if (isAllowed && !isAllowed(target.hostname)) {
            ctx.status = 403;
            ctx.body = { error: `Proxying to ${target.hostname} is disallowed by network policy` };
            return;
        }

        const transport = target.protocol === 'https:' ? https : http;

        const outHeaders = filterRawHeaders(ctx.req.rawHeaders);
        outHeaders['host'] = target.host;

        // The proxied prefix as it appears in the request URL
        // (handles both `/proxy/<host>` and `/proxy/http://host`).
        const suffix = target.pathname + target.search;
        const proxiedPrefix = ctx.originalUrl.endsWith(suffix)
            ? ctx.originalUrl.slice(0, ctx.originalUrl.length - suffix.length)
            : ctx.originalUrl;

        const retryBody = await readRetryableBody(ctx.req, ctx.get('content-length'));

        await new Promise<void>((resolve) => {
            const proxyReq = transport.request(
                {
                    hostname: target.hostname,
                    port: target.port || (target.protocol === 'https:' ? 443 : 80),
                    path: target.pathname + target.search,
                    method: ctx.method,
                    headers: outHeaders,
                    timeout: REQUEST_TIMEOUT_MS,
                    // Don't validate self-signed certs on LAN devices
                    rejectUnauthorized: false,
                },
                (proxyRes) => {
                    ctx.status = proxyRes.statusCode ?? 502;
                    setProxiedHeaders(ctx, filterHeaders(proxyRes.headers), proxiedPrefix);
                    ctx.body = proxyRes;
                    resolve();
                },
            );

            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                ctx.status = 504;
                ctx.body = { error: 'Proxy request timed out' };
                resolve();
            });

            proxyReq.on('error', (err: NodeJS.ErrnoException) => {
                // Header-less device (AlphaPix): redo the request on a raw socket.
                if (retryBody && isHeaderlessResponse(err)) {
                    void http09Request({
                        hostname: target.hostname,
                        port: Number(target.port) || (target.protocol === 'https:' ? 443 : 80),
                        path: target.pathname + target.search,
                        method: ctx.method,
                        contentType: ctx.get('content-type') || undefined,
                        body: retryBody.length > 0 ? retryBody : undefined,
                        timeoutMs: REQUEST_TIMEOUT_MS,
                    }).then(
                        (res) => {
                            ctx.status = res.status;
                            setProxiedHeaders(ctx, res.headers, proxiedPrefix);
                            ctx.body = res.body;
                            resolve();
                        },
                        (fallbackErr: Error) => {
                            ctx.status = 502;
                            ctx.body = { error: `Proxy error: ${fallbackErr.message}` };
                            resolve();
                        },
                    );
                    return;
                }
                if (err.code === 'ECONNREFUSED') {
                    ctx.status = 502;
                    ctx.body = { error: `Connection refused: ${target.host}` };
                } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
                    ctx.status = 504;
                    ctx.body = { error: `Connection failed: ${err.code}` };
                } else {
                    ctx.status = 502;
                    ctx.body = { error: `Proxy error: ${err.message}` };
                }
                resolve();
            });

            if (retryBody) proxyReq.end(retryBody.length > 0 ? retryBody : undefined);
            else ctx.req.pipe(proxyReq);
        });
    };
}

/** A device-absolute redirect would escape the proxy prefix; remap it under
 *  the proxied root. */
function setProxiedHeaders(
    ctx: Koa.Context,
    headers: http.OutgoingHttpHeaders | Record<string, string>,
    proxiedPrefix: string,
): void {
    for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        if (key.toLowerCase() === 'location' && typeof value === 'string' && value.startsWith('/')) {
            ctx.set(key, proxiedPrefix + value);
            continue;
        }
        ctx.set(key, value as string);
    }
}

/** Buffer a request body so an HTTP/0.9 retry can resend it. Null means too
 *  large or of unknown length: stream it through and forgo the retry. */
async function readRetryableBody(req: http.IncomingMessage, contentLength: string): Promise<Buffer | null> {
    if (req.method === 'GET' || req.method === 'HEAD') return Buffer.alloc(0);
    if (!contentLength) return null;
    const declared = Number(contentLength);
    if (!Number.isFinite(declared) || declared > RETRY_BODY_MAX_BYTES) return null;
    return new Promise<Buffer | null>((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
            size += c.length;
            // Only reachable if Content-Length lied; the partly consumed stream
            // can't be handed to the pipe path, so drop it.
            if (size > RETRY_BODY_MAX_BYTES) {
                req.destroy();
                resolve(null);
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', () => resolve(null));
    });
}

// ─── WebSocket Proxy ────────────────────────────────────────────────

export function attachWebSocketProxy(httpServer: http.Server, isAllowed?: (hostname: string) => boolean): void {
    const proxyWss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '';
        if (!url.startsWith(PROXY_PREFIX)) {
            // Not a proxy path — let other upgrade handlers (e.g. /ws) handle it
            return;
        }

        // Reuse the HTTP target parser so the WS path accepts the same target
        // forms, including a bare host (`/proxy/<host>`).
        const target = parseTargetUrl(url);
        if (!target) {
            socket.destroy();
            return;
        }
        // Same per-network policy gate as the HTTP proxy.
        if (isAllowed && !isAllowed(target.hostname)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }

        // Map http(s) to ws(s) for the target
        const wsProtocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${target.host}${target.pathname}${target.search}`;

        // Connect to the target WebSocket first
        const targetWs = new WebSocket(wsUrl, {
            rejectUnauthorized: false,
            handshakeTimeout: REQUEST_TIMEOUT_MS,
        });

        targetWs.on('open', () => {
            // Target connected — now complete the client upgrade
            proxyWss.handleUpgrade(req, socket, head, (clientWs) => {
                // Bidirectional message piping
                clientWs.on('message', (data, isBinary) => {
                    if (targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(data, { binary: isBinary });
                    }
                });

                targetWs.on('message', (data, isBinary) => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(data, { binary: isBinary });
                    }
                });

                // ws.close() only accepts application close codes (1000, or
                // 3000–4999); reserved codes like 1005/1006 throw, so fall back
                // to a plain close.
                const closeSafely = (ws: WebSocket, code: number, reason: Buffer) => {
                    if (ws.readyState !== WebSocket.OPEN) return;
                    if (code === 1000 || (code >= 3000 && code <= 4999)) {
                        ws.close(code, reason);
                    } else {
                        ws.close();
                    }
                };

                clientWs.on('close', (code, reason) => closeSafely(targetWs, code, reason));
                targetWs.on('close', (code, reason) => closeSafely(clientWs, code, reason));

                // Error propagation
                clientWs.on('error', () => {
                    targetWs.close();
                });

                targetWs.on('error', () => {
                    clientWs.close();
                });
            });
        });

        targetWs.on('error', () => {
            socket.destroy();
        });
    });
}
