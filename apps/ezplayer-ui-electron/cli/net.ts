/**
 * Host network enumeration — shared by the `interfaces` and `discover` commands.
 * Pure Node `os.networkInterfaces()`, no electron.
 */

import os from 'node:os';

export interface HostNetwork {
    name: string;
    address: string;
    /** Network CIDR (e.g. 192.168.1.0/24), ready to feed discover --networks. */
    network: string;
}

/** "192.168.1.5/24" → "192.168.1.0/24" (host CIDR → network CIDR). */
function toNetworkCidr(hostCidr: string): string {
    const [ip, bitsStr] = hostCidr.split('/');
    const bits = parseInt(bitsStr ?? '24', 10);
    const ipInt = ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0) >>> 0;
    const mask = bits <= 0 ? 0 : bits >= 32 ? 0xffffffff : ~((1 << (32 - bits)) - 1) >>> 0;
    const net = (ipInt & mask) >>> 0;
    return `${[net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join('.')}/${bits}`;
}

/** External IPv4 networks on this host (excludes internal + link-local). */
export function hostNetworks(): HostNetwork[] {
    const rows: HostNetwork[] = [];
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs ?? []) {
            // Node <18 reports family 'IPv4'; >=18 may report 4 — accept both.
            const isV4 = a.family === 'IPv4' || (a.family as unknown) === 4;
            if (!isV4 || a.internal) continue;
            if (a.address.startsWith('169.254.')) continue; // link-local, never useful
            rows.push({ name, address: a.address, network: toNetworkCidr(a.cidr ?? `${a.address}/24`) });
        }
    }
    return rows;
}
