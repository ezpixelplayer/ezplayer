/**
 * The HTTP face of controller ops — the surface a script drives: what the
 * command funnel accepts, and what the read routes expose.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import Koa from 'koa';
import Router from '@koa/router';
import getRawBody from 'raw-body';
import type { ControllerCommand, ControllerOpsState } from '@ezplayer/ezplayer-core';
import { dispatchErrorStatus, registerControllersApiRoutes } from './controllers-api';

const DEVICE_ID = '10.0.0.5|direct';

/** State with one FPP that has been distributed to, as the player would hold it. */
function stateWithContent(): ControllerOpsState {
    return {
        interfaces: [],
        known: [],
        operations: {},
        devices: {
            [DEVICE_ID]: {
                id: DEVICE_ID,
                ip: '10.0.0.5',
                source: { via: 'direct' },
                driverType: 'FPP',
                hostname: 'fpp-a',
                firmwareVersion: '8.4.2',
                mode: 'remote',
                channelRanges: '0-509',
                seenAt: '2026-10-28T01:00:00.000Z',
                contentStatus: {
                    checkedAt: '2026-10-28T01:00:05.000Z',
                    current: 3,
                    missing: 1,
                    missingBytes: 4096,
                    failed: 0,
                    uploadMethod: 'patch',
                },
            },
        },
        contentDist: {
            lastReport: {
                startedAt: '2026-10-28T01:00:00.000Z',
                finishedAt: '2026-10-28T01:00:05.000Z',
                checkOnly: false,
                cancelled: false,
                trigger: 'manual',
                targets: [],
                totals: { targets: 1, targetsFailed: 0, uploaded: 2, skipped: 1, failed: 0, planned: 0, bytes: 1024 },
            },
        },
    };
}

describe('controllers API', () => {
    let server: Server;
    let base: string;
    let issued: ControllerCommand[] = [];
    let fail: string | undefined;

    beforeAll(async () => {
        const router = new Router();
        registerControllersApiRoutes(router, {
            controllerCommand: async (command) => {
                if (fail) throw new Error(fail);
                issued.push(command);
                return undefined;
            },
            getControllerOpsState: () => stateWithContent(),
            isIpAllowed: () => true,
        });
        const app = new Koa();
        // The same minimal JSON parsing the server worker does.
        app.use(async (ctx, next) => {
            if (ctx.method !== 'GET' && ctx.is('json')) {
                const raw = await getRawBody(ctx.req, { encoding: 'utf8', limit: '1mb' });
                ctx.request.body = raw ? JSON.parse(raw) : {};
            }
            await next();
        });
        app.use(router.routes());
        server = app.listen(0, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise((r) => server.close(r));
    });

    const post = async (body: unknown) => {
        issued = [];
        const res = await fetch(`${base}/api/ezp/controllers/command`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    const get = async (p: string) => {
        const res = await fetch(`${base}${p}`);
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };

    describe('distribute', () => {
        it('takes a bare distribute: everything, everywhere', async () => {
            const res = await post({ cmd: 'distribute' });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ ok: true });
            expect(issued).toEqual([{ cmd: 'distribute' }]);
        });

        it('takes chosen devices, chosen sequences, and a check', async () => {
            const command = { cmd: 'distribute', ids: [DEVICE_ID], sequences: ['Song.fseq'], checkOnly: true };
            expect((await post(command)).status).toBe(200);
            expect(issued).toEqual([command]);
        });

        it('refuses shapes the dispatcher would then have to guess at', async () => {
            for (const bad of [
                { cmd: 'distribute', ids: 'fpp-a' },
                { cmd: 'distribute', ids: [1, 2] },
                { cmd: 'distribute', ids: [''] },
                { cmd: 'distribute', sequences: {} },
                { cmd: 'distribute', checkOnly: 'yes' },
            ]) {
                const res = await post(bad);
                expect(res.status, JSON.stringify(bad)).toBe(400);
                expect(String(res.body.error)).toMatch(/distribute/);
            }
        });

        it('reports a dispatcher failure with a status that fits', async () => {
            fail = 'no FPP targets known — scan for controllers first';
            try {
                const res = await post({ cmd: 'distribute' });
                expect(res.status).toBe(500);
                expect(res.body.error).toMatch(/no FPP targets/);
            } finally {
                fail = undefined;
            }
        });
    });

    it('rejects an unknown verb, naming the ones it has', async () => {
        const res = await post({ cmd: 'teleport' });
        expect(res.status).toBe(400);
        expect(String(res.body.error)).toContain('distribute');
    });

    describe('reads', () => {
        it('serves the distribution summary with the rest of the state', async () => {
            const res = await get('/api/ezp/controllers');
            expect(res.status).toBe(200);
            const dist = res.body.contentDist as { lastReport: { totals: { uploaded: number } } };
            expect(dist.lastReport.totals.uploaded).toBe(2);
        });

        it('serves one device’s content status, by id or by bare address', async () => {
            for (const p of [
                `/api/ezp/controllers/${encodeURIComponent(DEVICE_ID)}`,
                '/api/ezp/controllers/10.0.0.5',
            ]) {
                const res = await get(p);
                expect(res.status, p).toBe(200);
                expect(res.body.contentStatus, p).toMatchObject({ current: 3, missing: 1, missingBytes: 4096 });
                expect(res.body.channelRanges, p).toBe('0-509');
                expect(res.body.mode, p).toBe('remote');
            }
        });

        it('404s a device it has never seen', async () => {
            expect((await get('/api/ezp/controllers/10.9.9.9')).status).toBe(404);
        });
    });

    it('maps dispatcher messages onto HTTP statuses', () => {
        expect(dispatchErrorStatus('scan already running')).toBe(409);
        expect(dispatchErrorStatus('unknown controller: x')).toBe(404);
        expect(dispatchErrorStatus('disallowed by policy')).toBe(403);
        expect(dispatchErrorStatus('something broke')).toBe(500);
    });
});
