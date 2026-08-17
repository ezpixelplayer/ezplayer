/**
 * `status` — deep-read one controller and print its detail report, headless.
 * Probing is standalone (no app required for an IP target); a name is resolved
 * through the running app's known/scanned state.
 */

import { probeController, reportToTree } from '@ezplayer/epp-controllers';
import { renderTree } from './discover.js';
import { resolveHost, resolveTargetIp } from '../ezp-client.js';

export async function run(args: string[]): Promise<number> {
    let target: string | undefined;
    let hostFlag: string | undefined;
    let fppProxy: string | undefined;
    let json = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--host') hostFlag = args[++i];
        else if (a === '--fpp-proxy') fppProxy = args[++i];
        else if (a === '--json') json = true;
        else if (!a.startsWith('-') && !target) target = a;
        else {
            console.error(`status: unrecognized argument '${a}'`);
            return 2;
        }
    }
    if (!target) {
        console.error('status: missing <ip-or-name>');
        return 2;
    }

    let ip: string;
    try {
        ip = await resolveTargetIp(target, resolveHost(hostFlag));
    } catch (e) {
        console.error(`status: ${(e as Error).message}`);
        return 1;
    }

    process.stderr.write(`Probing ${ip}${fppProxy ? ` via ${fppProxy}` : ''}…\n`);
    const probe = await probeController(ip, fppProxy, { detail: true });
    if (!probe.success || !probe.report) {
        console.error(`status: ${probe.error ?? 'no controller responded'} (${ip})`);
        return 1;
    }
    const report = probe.report;

    if (json) {
        process.stdout.write(JSON.stringify(report));
        return 0;
    }

    const head = [report.driverType, report.vendor, report.model, report.firmwareVersion].filter(Boolean).join(' ');
    console.log(`${ip}  ${head}${report.hostname ? `  (${report.hostname})` : ''}`);
    renderTree(reportToTree(report), '    ');
    return 0;
}
