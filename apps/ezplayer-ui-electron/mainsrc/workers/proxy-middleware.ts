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

const PROXY_PREFIX = '/proxy/';
const REQUEST_TIMEOUT_MS = 30_000;

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

/** Parse and validate the target URL from the proxy path. */
function parseTargetUrl(originalUrl: string): URL | null {
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

export function createProxyMiddleware(): Koa.Middleware {
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

        const transport = target.protocol === 'https:' ? https : http;

        const outHeaders = filterHeaders(ctx.req.headers);
        outHeaders['host'] = target.host;

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

                    const responseHeaders = filterHeaders(proxyRes.headers);
                    for (const [key, value] of Object.entries(responseHeaders)) {
                        if (value !== undefined) {
                            ctx.set(key, value as string);
                        }
                    }

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

            // Pipe the incoming request body to the proxy request
            ctx.req.pipe(proxyReq);
        });
    };
}

// ─── WebSocket Proxy ────────────────────────────────────────────────

export function attachWebSocketProxy(httpServer: http.Server): void {
    const proxyWss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '';
        if (!url.startsWith(PROXY_PREFIX)) {
            // Not a proxy path — let other upgrade handlers (e.g. /ws) handle it
            return;
        }

        const raw = url.slice(PROXY_PREFIX.length);
        if (!raw) {
            socket.destroy();
            return;
        }

        let target: URL;
        try {
            target = new URL(raw);
        } catch {
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

                // Close propagation
                clientWs.on('close', (code, reason) => {
                    if (targetWs.readyState === WebSocket.OPEN) {
                        targetWs.close(code, reason);
                    }
                });

                targetWs.on('close', (code, reason) => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.close(code, reason);
                    }
                });

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
