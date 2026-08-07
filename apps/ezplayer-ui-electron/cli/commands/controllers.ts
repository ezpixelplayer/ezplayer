/**
 * `controllers` — print the reconcile state from a RUNNING EZPlayer: known
 * controllers joined against scanned devices, plus recent operations.
 * Read-only view of GET /api/ezp/controllers; no standalone fallback ("known"
 * only exists where a show folder is open).
 */

import type { ControllerOpsState, DiscoveredController, KnownController } from '@ezplayer/ezplayer-core';
import { getOpsState, resolveHost, unreachableHint } from '../ezp-client.js';

interface Row {
    state: 'present' | 'absent' | 'unregistered';
    name: string;
    address: string;
    type: string;
    firmware: string;
    seen: string;
}

function deviceType(d: DiscoveredController): string {
    return [d.vendor, d.model].filter(Boolean).join(' ') || d.driverType || d.hostname || '—';
}

function knownType(k: KnownController): string {
    return [k.vendor, k.model].filter(Boolean).join(' ') || '—';
}

/** Join known ↔ devices by address (direct entries preferred), like the grid. */
function buildRows(state: ControllerOpsState): Row[] {
    const devices = Object.values(state.devices);
    const claimed = new Set<string>();
    const rows: Row[] = [];
    const matchesAddr = (d: DiscoveredController, addr: string): boolean =>
        d.ip === addr || (!!d.hostname && d.hostname === addr);
    for (const k of state.known ?? []) {
        const addr = k.address;
        const match = addr
            ? (devices.find((d) => d.source.via === 'direct' && matchesAddr(d, addr)) ??
              devices.find((d) => matchesAddr(d, addr)))
            : undefined;
        if (match) claimed.add(match.id);
        rows.push({
            state: match ? 'present' : 'absent',
            name: k.name + (k.active === false ? ' (inactive)' : ''),
            address: k.address ?? '—',
            type: match ? deviceType(match) : knownType(k),
            firmware: match?.firmwareVersion ?? '—',
            seen: match?.seenAt ?? '—',
        });
    }
    for (const d of devices) {
        if (claimed.has(d.id)) continue;
        rows.push({
            state: 'unregistered',
            name: d.hostname ?? '—',
            address: d.ip + (d.source.via !== 'direct' ? ` (via ${d.source.via})` : ''),
            type: deviceType(d),
            firmware: d.firmwareVersion ?? '—',
            seen: d.seenAt,
        });
    }
    return rows;
}

export async function run(args: string[]): Promise<number> {
    let hostFlag: string | undefined;
    let json = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--host') hostFlag = args[++i];
        else if (a === '--json') json = true;
        else {
            console.error(`controllers: unrecognized argument '${a}'`);
            return 2;
        }
    }
    const host = resolveHost(hostFlag);

    let state: ControllerOpsState;
    try {
        state = await getOpsState(host);
    } catch (e) {
        console.error(`controllers: ${(e as Error).message}`);
        console.error(unreachableHint(host));
        return 1;
    }

    if (json) {
        process.stdout.write(JSON.stringify(state));
        return 0;
    }

    const rows = buildRows(state);
    if (rows.length === 0) {
        console.log('(no known controllers and no scanned devices — open a show folder and/or run a scan)');
    } else {
        console.log(
            `  ${'STATE'.padEnd(12)} ${'NAME'.padEnd(24)} ${'ADDRESS'.padEnd(22)} ${'TYPE'.padEnd(28)} ${'FIRMWARE'.padEnd(12)} SEEN`,
        );
        for (const r of rows) {
            console.log(
                `  ${r.state.padEnd(12)} ${r.name.padEnd(24)} ${r.address.padEnd(22)} ${r.type.padEnd(28)} ${r.firmware.padEnd(12)} ${r.seen}`,
            );
        }
    }

    const ops = Object.values(state.operations).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (ops.length) {
        console.log('\nOperations (newest first):');
        for (const o of ops.slice(0, 8)) {
            const err = o.error ? ` — ${o.error}` : '';
            console.log(`  [${o.status.padEnd(7)}] ${o.label} (${o.origin}, ${o.startedAt})${err}`);
        }
    }
    const policies = state.networkPolicies ?? [];
    if (policies.length) {
        console.log('\nNetwork policies:');
        for (const p of policies) {
            const bits = [
                p.allow === false ? 'disallowed' : 'allowed',
                p.expectControllers ? 'expect-controllers' : undefined,
                p.note,
            ].filter(Boolean);
            console.log(`  ${p.cidr.padEnd(20)} ${bits.join(', ')}`);
        }
    }
    return 0;
}
