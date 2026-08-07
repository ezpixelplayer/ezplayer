/** Proxying a header-less (HTTP/0.9) device — an AlphaPix stand-in that answers
 *  with the body alone and closes. */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import Koa from 'koa';
import { createProxyMiddleware } from './proxy-middleware';
import { http09Request } from './http09-fallback';

const PAGE = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">\r\n<html><body>AlphaPix</body></html>';

/** Writes the body with no status line or headers, then closes — the
 *  firmware's end-of-body signal. */
function startHeaderlessDevice(): Promise<{ port: number; close: () => void; lastRequest: () => string }> {
    let lastRequest = '';
    const server = net.createServer((socket) => {
        let received = '';
        socket.on('data', (d) => {
            received += d.toString('latin1');
            const headEnd = received.indexOf('\r\n\r\n');
            if (headEnd < 0) return;
            const declared = /content-length:\s*(\d+)/i.exec(received);
            const need = headEnd + 4 + (declared ? Number(declared[1]) : 0);
            if (received.length < need) return;
            lastRequest = received;
            // POSTs echo the body back, to prove it was resent on the retry.
            socket.end(received.startsWith('POST') ? `<html>echo:${received.slice(headEnd + 4)}</html>` : PAGE);
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            resolve({ port, close: () => server.close(), lastRequest: () => lastRequest });
        });
    });
}

/** Ordinary HTTP/1.1 device: the normal path must be undisturbed. */
function startNormalDevice(): Promise<{ port: number; close: () => void }> {
    const server = http.createServer((req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.end(`ok:${req.method}`);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            resolve({ port, close: () => server.close() });
        });
    });
}

describe('device proxy: HTTP/0.9 fallback', () => {
    let proxyPort = 0;
    let proxy: http.Server;
    let device: Awaited<ReturnType<typeof startHeaderlessDevice>>;
    let normal: Awaited<ReturnType<typeof startNormalDevice>>;

    beforeAll(async () => {
        device = await startHeaderlessDevice();
        normal = await startNormalDevice();
        const app = new Koa();
        app.use(createProxyMiddleware());
        proxy = await new Promise<http.Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        proxyPort = (proxy.address() as net.AddressInfo).port;
    });

    afterAll(() => {
        proxy.close();
        device.close();
        normal.close();
    });

    const proxied = (path: string) => `http://127.0.0.1:${proxyPort}/proxy/127.0.0.1:${device.port}${path}`;

    it('serves a header-less page as HTML', async () => {
        const res = await fetch(proxied('/index.htm'));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/html');
        expect(await res.text()).toBe(PAGE);
    });

    it('sniffs markup when the path has no useful extension', async () => {
        const res = await fetch(proxied('/'));
        expect(res.headers.get('content-type')).toBe('text/html');
    });

    it('resends the body on a form POST', async () => {
        const body = 'universe=1&pixels=50';
        const res = await fetch(proxied('/SetSPI'), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body,
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toContain(`echo:${body}`);
        expect(device.lastRequest()).toMatch(/^POST \/SetSPI /);
        expect(device.lastRequest()).toContain('application/x-www-form-urlencoded');
    });

    it('passes the query string through', async () => {
        await fetch(proxied('/PixelIC?port=3'));
        expect(device.lastRequest()).toContain('GET /PixelIC?port=3 ');
    });

    it('leaves well-formed devices on the normal path', async () => {
        const res = await fetch(`http://127.0.0.1:${proxyPort}/proxy/127.0.0.1:${normal.port}/api`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/plain');
        expect(await res.text()).toBe('ok:GET');
    });

    it('reports a dead target as a gateway error', async () => {
        const res = await fetch(`http://127.0.0.1:${proxyPort}/proxy/127.0.0.1:1/x`);
        expect(res.status).toBe(502);
    });

    it('passes a well-formed reply through with lowercased headers', async () => {
        const res = await http09Request({ hostname: '127.0.0.1', port: normal.port, path: '/api' });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('text/plain');
        expect(res.headers['transfer-encoding']).toBeUndefined();
        expect(res.body.toString()).toBe('ok:GET');
    });
});
