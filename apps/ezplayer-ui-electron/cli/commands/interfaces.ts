/**
 * `interfaces` — list the host's external IPv4 networks, as CIDRs ready to
 * feed to `discover --networks`. No electron.
 */

import { hostNetworks } from '../net.js';

export async function run(_args: string[]): Promise<number> {
    const rows = hostNetworks();
    if (rows.length === 0) {
        console.log('(no external IPv4 interfaces)');
        return 0;
    }
    console.log(`  ${'INTERFACE'.padEnd(20)} ${'ADDRESS'.padEnd(16)} NETWORK`);
    for (const r of rows) {
        console.log(`  ${r.name.padEnd(20)} ${r.address.padEnd(16)} ${r.network}`);
    }
    return 0;
}
