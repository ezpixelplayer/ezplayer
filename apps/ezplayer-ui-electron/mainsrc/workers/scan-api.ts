/**
 * Scan API — network discovery over HTTP. Also the federation endpoint the
 * CLI's `--ezp-proxy` calls on a remote EZPlayer.
 *
 * SECURITY: mounted on the web app only, never the public kiosk port — a scan
 * actively probes the LAN.
 *
 * The discovery run itself happens in the MAIN process (via the injected
 * `controllerCommand` RPC): nesting the scanner worker inside this worker
 * thread hard-crashes Electron. This layer only validates input and shapes
 * the HTTP response.
 */

import Router, { RouterContext } from '@koa/router';
import { DiscoveryDepth, DiscoveryResult, ScanDiscoverBody, ScanInterfacesResponse } from '@ezplayer/epp-controllers';
import type { ControllerCommand, ControllerOpOrigin } from '@ezplayer/ezplayer-core';
import { hostNetworks } from '../../cli/net.js';
import { dispatchErrorStatus } from './controllers-api.js';

const DEPTHS: readonly DiscoveryDepth[] = ['sweep', 'identify', 'full'];

export interface ScanApiDeps {
    controllerCommand: (command: ControllerCommand, origin: ControllerOpOrigin) => Promise<DiscoveryResult | undefined>;
}

interface ScanParams {
    networks: { cidr: string }[];
    depth: DiscoveryDepth;
    recurseFppProxies: boolean;
    error?: string;
}

/** Normalize a request (body or query) into engine params, applying defaults. */
function resolveParams(input: {
    networks?: { cidr: string }[];
    depth?: string;
    recurseFppProxies?: boolean;
}): ScanParams {
    const depth = (input.depth ?? 'identify') as DiscoveryDepth;
    const base = { networks: [], depth, recurseFppProxies: !!input.recurseFppProxies };
    if (!DEPTHS.includes(depth)) {
        return { ...base, error: `invalid depth '${input.depth}' (expected ${DEPTHS.join(' | ')})` };
    }
    // Omitted networks → scan this host's own networks ("discover on your
    // side", the federated-request case).
    const networks =
        input.networks && input.networks.length > 0 ? input.networks : hostNetworks().map((n) => ({ cidr: n.network }));
    if (networks.length === 0) {
        return { ...base, error: 'no networks to scan (host has no external IPv4 networks)' };
    }
    return { networks, depth, recurseFppProxies: !!input.recurseFppProxies };
}

export function registerScanApiRoutes(router: Router, deps: ScanApiDeps): void {
    // GET /api/ezp/scan/interfaces — the CIDRs to feed a discover request.
    router.get('/api/ezp/scan/interfaces', (ctx) => {
        const resp: ScanInterfacesResponse = { interfaces: hostNetworks() };
        ctx.body = resp;
    });

    // GET /api/ezp/scan/discover?networks=…&depth=…&fppProxy=1 — curl-friendly.
    router.get('/api/ezp/scan/discover', async (ctx) => {
        const q = ctx.query;
        const csv = typeof q.networks === 'string' ? q.networks : undefined;
        const params = resolveParams({
            networks: csv
                ? csv
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((cidr) => ({ cidr }))
                : undefined,
            depth: typeof q.depth === 'string' ? q.depth : undefined,
            recurseFppProxies: q.fppProxy === '1' || q.fppProxy === 'true',
        });
        await handle(ctx, deps, params);
    });

    // POST /api/ezp/scan/discover — JSON body (the canonical form).
    router.post('/api/ezp/scan/discover', async (ctx) => {
        const body = (ctx.request.body ?? {}) as ScanDiscoverBody;
        const params = resolveParams({
            networks: body.networks,
            depth: body.depth,
            recurseFppProxies: body.recurseFppProxies,
        });
        await handle(ctx, deps, params);
    });
}

async function handle(ctx: RouterContext, deps: ScanApiDeps, params: ScanParams): Promise<void> {
    if (params.error) {
        ctx.status = 400;
        ctx.body = { error: params.error };
        return;
    }
    // Concurrency is guarded in ONE place — the main-process dispatcher — so
    // HTTP and WS scans share the same limit; its guard errors map to 409.
    try {
        const command: ControllerCommand = {
            cmd: 'scan',
            networks: params.networks,
            depth: params.depth,
            recurseFppProxies: params.recurseFppProxies,
            // recurseEzpProxies intentionally NOT set: federation stays
            // strictly one level.
        };
        ctx.body = await deps.controllerCommand(command, 'lan');
    } catch (err) {
        const message = (err as Error).message;
        ctx.status = dispatchErrorStatus(message);
        ctx.body = { error: `scan failed: ${message}` };
    }
}
