import type Router from '@koa/router';
import fs from 'node:fs';
import os from 'node:os';
import { requestPi } from '../pi-client.js';

const ACTIONS = new Set([
    'status',
    'scan',
    'wifi',
    'ethernet',
    'confirm',
    'revert',
    'hotspot',
    'timezone',
    'restartPlayer',
    'reboot',
    'shutdown',
]);
const available = () =>
    process.platform === 'linux' &&
    process.env.EZPLAYER_PI_APPLIANCE === '1' &&
    fs.existsSync('/run/ezplayer-pi/control.sock');

export function trustedPiOrigin(origin: string, expected: string, hostname: string, localHosts: string[]): boolean {
    return origin === expected && localHosts.includes(hostname.toLowerCase());
}

export function registerPiApiRoutes(router: Router): void {
    router.get('/api/ezp/pi/available', (ctx) => {
        ctx.set('Cache-Control', 'no-store');
        ctx.body = { available: available() };
    });
    router.post('/api/ezp/pi', async (ctx) => {
        ctx.set('Cache-Control', 'no-store');
        if (!available()) ctx.throw(404, 'Pi service unavailable');
        const localHosts = [
            'localhost',
            'ezplayer.setup',
            os.hostname().toLowerCase() + '.local',
            ...Object.values(os.networkInterfaces()).flatMap((entries) =>
                (entries ?? []).map((entry) => entry.address),
            ),
        ];
        if (
            !trustedPiOrigin(ctx.get('Origin'), `${ctx.protocol}://${ctx.host}`, ctx.hostname, localHosts) ||
            ctx.get('X-EZPlayer-Pi') !== '1' ||
            !ctx.is('json')
        ) {
            ctx.throw(403, 'Pi settings require the local player page');
        }
        const body = ctx.request.body;
        if (
            !body ||
            typeof body !== 'object' ||
            Array.isArray(body) ||
            !ACTIONS.has(String((body as Record<string, unknown>).action))
        ) {
            ctx.throw(400, 'Unsupported Pi action');
        }
        try {
            ctx.body = await requestPi(body as Record<string, unknown>);
        } catch (error) {
            ctx.status = 400;
            ctx.body = { error: error instanceof Error ? error.message : 'Pi settings failed' };
        }
    });
}
