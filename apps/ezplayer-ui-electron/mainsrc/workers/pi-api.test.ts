import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPiApiRoutes, trustedPiOrigin } from './pi-api';
import { requestPi } from '../pi-client';
import fs from 'node:fs';
import os from 'node:os';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import Router from '@koa/router';

vi.mock('../pi-client', () => ({ requestPi: vi.fn(async () => ({ ok: true })) }));

describe('Pi browser administration origin checks', () => {
    const hosts = ['192.168.4.1', '192.168.99.107', 'ezplayer.local'];
    it('allows the setup page and the normal local player page', () => {
        expect(trustedPiOrigin('http://192.168.4.1', 'http://192.168.4.1', '192.168.4.1', hosts)).toBe(true);
        expect(
            trustedPiOrigin('http://192.168.99.107:3000', 'http://192.168.99.107:3000', '192.168.99.107', hosts),
        ).toBe(true);
    });
    it('rejects cross-origin posts, missing origins and DNS rebinding hosts', () => {
        expect(trustedPiOrigin('https://evil.example', 'http://192.168.4.1', '192.168.4.1', hosts)).toBe(false);
        expect(trustedPiOrigin('', 'http://192.168.4.1', '192.168.4.1', hosts)).toBe(false);
        expect(trustedPiOrigin('http://evil.example', 'http://evil.example', 'evil.example', hosts)).toBe(false);
    });
});

describe('Pi HTTP control routes', () => {
    let server: Server;
    let origin: string;
    beforeEach(async () => {
        vi.stubEnv('EZPLAYER_PI_APPLIANCE', '1');
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(os, 'networkInterfaces').mockReturnValue({
            lo: [
                {
                    address: '127.0.0.1',
                    netmask: '255.0.0.0',
                    family: 'IPv4',
                    mac: '',
                    internal: true,
                    cidr: '127.0.0.1/8',
                },
            ],
        });
        const app = new Koa();
        app.use(async (ctx, next) => {
            if (ctx.method === 'POST') {
                let body = '';
                for await (const chunk of ctx.req) body += chunk.toString();
                ctx.request.body = JSON.parse(body);
            }
            await next();
        });
        const router = new Router();
        registerPiApiRoutes(router);
        app.use(router.routes());
        server = app.listen(0, '127.0.0.1');
        await new Promise<void>((resolve) => server.once('listening', resolve));
        origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.mocked(requestPi).mockClear();
    });
    const headers = (origin: string) => ({ Origin: origin, 'Content-Type': 'application/json', 'X-EZPlayer-Pi': '1' });
    it('forwards same-origin Wi-Fi setup to the Unix bridge', async () => {
        const request = {
            action: 'wifi',
            interface: 'wlan0',
            ssid: 'Home',
            security: 'personal',
            password: 'testpassword',
        };
        const response = await fetch(origin + '/api/ezp/pi', {
            method: 'POST',
            headers: headers(origin),
            body: JSON.stringify(request),
        });
        expect(response.status).toBe(200);
        expect(requestPi).toHaveBeenCalledWith(request);
    });
    it('rejects cross-origin and unsupported privileged requests', async () => {
        for (const [requestOrigin, action, code] of [
            ['https://evil.example', 'wifi', 403],
            [origin, 'registerWeb', 400],
        ]) {
            const response = await fetch(origin + '/api/ezp/pi', {
                method: 'POST',
                headers: headers(String(requestOrigin)),
                body: JSON.stringify({ action }),
            });
            expect(response.status).toBe(code);
        }
        expect(requestPi).not.toHaveBeenCalled();
    });
    it('does not enable Pi administration on an ordinary desktop install', async () => {
        vi.stubEnv('EZPLAYER_PI_APPLIANCE', '');
        const response = await fetch(origin + '/api/ezp/pi', {
            method: 'POST',
            headers: headers(origin),
            body: JSON.stringify({ action: 'status' }),
        });
        expect(response.status).toBe(404);
        expect(requestPi).not.toHaveBeenCalled();
    });
});
