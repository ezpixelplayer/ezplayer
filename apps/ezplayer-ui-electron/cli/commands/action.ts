/**
 * `action` — run a driver-enumerated management action (reboot, restart, ...)
 * against one controller, headless.
 *
 * Standalone: probes and dispatches the driver action directly (no app needed
 * for an IP target; the CLI invocation itself is the user's explicit consent,
 * including for dangerous actions). A name is resolved via the running app.
 */

import { probeController } from '@ezplayer/epp-controllers';
import { resolveHost, resolveTargetIp } from '../ezp-client.js';

export async function run(args: string[]): Promise<number> {
    const positionals: string[] = [];
    let hostFlag: string | undefined;
    let fppProxy: string | undefined;
    let list = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--host') hostFlag = args[++i];
        else if (a === '--fpp-proxy') fppProxy = args[++i];
        else if (a === '--list') list = true;
        else if (!a.startsWith('-')) positionals.push(a);
        else {
            console.error(`action: unrecognized argument '${a}'`);
            return 2;
        }
    }
    const [target, actionId] = positionals;
    if (!target) {
        console.error('action: missing <ip-or-name>');
        return 2;
    }

    let ip: string;
    try {
        ip = await resolveTargetIp(target, resolveHost(hostFlag));
    } catch (e) {
        console.error(`action: ${(e as Error).message}`);
        return 1;
    }

    process.stderr.write(`Probing ${ip}${fppProxy ? ` via ${fppProxy}` : ''}...\n`);
    const probe = await probeController(ip, fppProxy);
    if (!probe.success || !probe.driver) {
        console.error(`action: ${probe.error ?? 'no controller responded'} (${ip})`);
        return 1;
    }

    const actions = probe.driver.getActions();
    if (list || !actionId) {
        console.log(`Actions for ${ip}:`);
        for (const a of actions) {
            const danger = a.dangerous ? '  [dangerous]' : '';
            console.log(`  ${a.id.padEnd(16)} ${a.label}${a.description ? ` — ${a.description}` : ''}${danger}`);
        }
        if (!actionId && !list) {
            console.error('\naction: missing <actionId>');
            return 2;
        }
        return 0;
    }

    const result = await probe.driver.runAction(actionId);
    if (!result.success) {
        console.error(`action: ${actionId} failed: ${result.message ?? 'unknown error'}`);
        return 1;
    }
    console.log(`${actionId}: ${result.message ?? 'OK'}`);
    return 0;
}
