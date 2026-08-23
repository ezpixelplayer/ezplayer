/**
 * Controllers API — HTTP face of the controller-ops subsystem (plus the
 * FPP-compat GET /api/proxies). Commands run in the MAIN process via the
 * injected `controllerCommand` RPC; state reads are served from the worker's
 * cached broadcast snapshot.
 *
 * SECURITY: like scan-api, mounted on the web app ONLY, never the kiosk —
 * commands mutate state and touch LAN devices.
 */

import Router from '@koa/router';
import type { DiscoveryDepth, DiscoveryResult } from '@ezplayer/epp-controllers';
import type {
    ControllerCommand,
    ControllerOpOrigin,
    ControllerOpsState,
    DiscoveredController,
} from '@ezplayer/ezplayer-core';
import { hostNetworks } from '../../cli/net.js';

const DEPTHS: readonly DiscoveryDepth[] = ['sweep', 'identify', 'full'];
const UPLOAD_SCOPES = ['inputs', 'strings', 'full'] as const;
const COMMAND_VERBS = [
    'scan',
    'status',
    'action',
    'upload',
    'record',
    'network',
    'refreshInterfaces',
    'cancel',
] as const;

export interface ControllersApiDeps {
    /** Issue a command to the main-process controller-ops dispatcher. */
    controllerCommand: (command: ControllerCommand, origin: ControllerOpOrigin) => Promise<DiscoveryResult | undefined>;
    /** Latest broadcast controllerops snapshot (worker-side cache). */
    getControllerOpsState: () => ControllerOpsState;
    /** Per-network policy check — false refuses listing/bridging that host. */
    isIpAllowed: (hostname: string) => boolean;
}

/** Map a dispatcher error message to an HTTP status — the patterns below are
 *  its stable guard/lookup messages; anything else is a real failure. */
export function dispatchErrorStatus(message: string): number {
    if (/already running|too many concurrent/i.test(message)) return 409;
    if (/^unknown (controller|operation)/i.test(message)) return 404;
    if (/disallowed by policy/i.test(message)) return 403;
    return 500;
}

/** Minimal shape validation: a known cmd verb plus the per-verb fields the
 *  dispatcher dereferences unconditionally. */
function validateCommand(body: unknown): { command?: ControllerCommand; error?: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'body must be a ControllerCommand JSON object' };
    }
    const o = body as Record<string, unknown>;
    const cmd = o.cmd;
    if (typeof cmd !== 'string' || !(COMMAND_VERBS as readonly string[]).includes(cmd)) {
        return { error: `unknown cmd '${String(cmd)}' (expected ${COMMAND_VERBS.join(' | ')})` };
    }
    const needString = (field: string): string | undefined =>
        typeof o[field] === 'string' && o[field] !== '' ? undefined : `'${cmd}' needs a string '${field}'`;
    const needObject = (field: string): string | undefined =>
        o[field] && typeof o[field] === 'object' && !Array.isArray(o[field])
            ? undefined
            : `'${cmd}' needs an object '${field}'`;
    let error: string | undefined;
    switch (cmd) {
        case 'scan':
            if (!DEPTHS.includes(o.depth as DiscoveryDepth)) {
                error = `'scan' needs depth (${DEPTHS.join(' | ')})`;
            }
            break;
        case 'status':
            error = needString('id');
            break;
        case 'action':
            error = needString('id') ?? needString('action');
            break;
        case 'upload':
            error = needString('id');
            if (!error && !(UPLOAD_SCOPES as readonly string[]).includes(o.scope as string)) {
                error = `'upload' needs scope (${UPLOAD_SCOPES.join(' | ')})`;
            }
            break;
        case 'record':
            error = needString('name') ?? needObject('patch');
            break;
        case 'network':
            error = needString('cidr') ?? needObject('patch');
            break;
        case 'refreshInterfaces':
            break;
        case 'cancel':
            error = needString('opId');
            break;
    }
    if (error) return { error };
    // The dispatcher (and drivers) validate the rest.
    return { command: body as ControllerCommand };
}

export function registerControllersApiRoutes(router: Router, deps: ControllersApiDeps): void {
    // GET /api/ezp/controllers — the whole controllerops snapshot.
    router.get('/api/ezp/controllers', (ctx) => {
        ctx.body = deps.getControllerOpsState();
    });

    // GET /api/ezp/controllers/:id — one device. `:id` is the state key
    // ("<ip>|<via>…", URL-encode the '|') or a bare IP (direct entry first).
    router.get('/api/ezp/controllers/:id', (ctx) => {
        const id = String(ctx.params.id);
        const state = deps.getControllerOpsState();
        const dev: DiscoveredController | undefined =
            state.devices[id] ?? state.devices[`${id}|direct`] ?? Object.values(state.devices).find((d) => d.ip === id);
        if (!dev) {
            ctx.status = 404;
            ctx.body = { error: `unknown controller: ${id}` };
            return;
        }
        ctx.body = dev;
    });

    // POST /api/ezp/controllers/command — the generic command funnel (same
    // ControllerCommand shape as the LAN WS message and cloud commands).
    // Synchronous: resolves when the op finishes; a scan returns its
    // DiscoveryResult, other verbs return {ok:true}.
    router.post('/api/ezp/controllers/command', async (ctx) => {
        const { command, error } = validateCommand(ctx.request.body);
        if (!command) {
            ctx.status = 400;
            ctx.body = { error };
            return;
        }
        try {
            const result = await deps.controllerCommand(command, 'lan');
            ctx.body = result ?? { ok: true };
        } catch (err) {
            const message = (err as Error).message;
            ctx.status = dispatchErrorStatus(message);
            ctx.body = { error: message };
        }
    });

    // GET /api/proxies — FPP 8+ shape [{host, description}], advertising hosts
    // reachable through this player's /proxy/<host>/… bridge. `description`
    // must always be present. List = known controllers ∪ direct-scanned
    // devices, excluding our own IPs and policy-disallowed networks.
    // (POST stays 404 on purpose: never fake-ack a write.)
    router.get('/api/proxies', (ctx) => {
        const state = deps.getControllerOpsState();
        const self = new Set(hostNetworks().map((n) => n.address));
        const list = new Map<string, string>();
        for (const d of Object.values(state.devices)) {
            // A device behind another proxy/player is not ours to bridge.
            if (d.source.via !== 'direct') continue;
            if (self.has(d.ip) || !deps.isIpAllowed(d.ip)) continue;
            list.set(d.ip, [d.vendor, d.model].filter(Boolean).join(' ') || d.hostname || d.driverType || '');
        }
        for (const k of state.known ?? []) {
            if (!k.address || self.has(k.address) || !deps.isIpAllowed(k.address)) continue;
            // The known record's name wins over the scan-derived description.
            list.set(k.address, k.name);
        }
        ctx.body = [...list.entries()]
            .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
            .map(([host, description]) => ({ host, description }));
    });
}
