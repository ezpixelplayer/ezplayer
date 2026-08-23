/**
 * Client helpers for CLI verbs that talk to a RUNNING EZPlayer app's web API.
 * Pure Node `fetch`, no electron. The generic player client (playback,
 * statistics, host defaults) lives in @ezplayer/ezplayer-client; this module
 * adds the controller-ops endpoints and local-player discovery.
 */

import fs from 'fs';
import path from 'path';
import type { ControllerCommand, ControllerOpsState } from '@ezplayer/ezplayer-core';
import { resolveHost, unreachableHint } from '@ezplayer/ezplayer-client';
import { SUBDIR_NAME } from '../mainsrc/data/SettingsMigration.js';
import { runningPlayerWebPort } from '../mainsrc/showfolder-lock.js';

export { resolveHost, unreachableHint };

/**
 * Host for verbs that default to the local player (`play`, `stats`):
 * `--host` beats the show folder's lock file (the port the player actually
 * bound) beats EZPLAYER_WEB_PORT beats 3000. The folder is `--show-folder`,
 * or the current directory when it is one.
 */
export async function resolveLocalPlayerHost(
    hostFlag: string | undefined,
    showFolderFlag: string | undefined,
): Promise<{ host: string; source: string }> {
    if (hostFlag) return { host: resolveHost(hostFlag), source: '--host' };

    const folder = showFolderFlag
        ? path.resolve(showFolderFlag)
        : fs.existsSync(path.join(process.cwd(), SUBDIR_NAME))
          ? process.cwd()
          : undefined;
    if (folder) {
        const port = await runningPlayerWebPort(folder).catch(() => undefined);
        if (port) return { host: `127.0.0.1:${port}`, source: `the lock file in ${folder}` };
    }
    return { host: resolveHost(undefined), source: 'the default' };
}

/** GET the shared controllerops snapshot from the running app. */
export async function getOpsState(host: string): Promise<ControllerOpsState> {
    const res = await fetch(`http://${host}/api/ezp/controllers`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`GET http://${host}/api/ezp/controllers → HTTP ${res.status}`);
    // Our own API — the body is the shared core type.
    return (await res.json()) as ControllerOpsState;
}

/** POST a ControllerCommand to the running app's generic command endpoint.
 *  Synchronous like the route itself: resolves when the op has finished. */
export async function postCommand(host: string, command: ControllerCommand): Promise<unknown> {
    const res = await fetch(`http://${host}/api/ezp/controllers/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
        // Scans run to the engine's ~120s cap; uploads probe + write + verify.
        signal: AbortSignal.timeout(150_000),
    });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) {
        const msg =
            body && typeof body === 'object' && 'error' in body
                ? String((body as { error: unknown }).error)
                : `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return body;
}

export const isIpv4 = (s: string): boolean => /^\d+\.\d+\.\d+\.\d+$/.test(s);

/** Resolve an `<ip-or-name>` argument: an IPv4 literal passes through;
 *  anything else is looked up in the running app's state — known controller
 *  name first, then a discovered device hostname. */
export async function resolveTargetIp(arg: string, host: string): Promise<string> {
    if (isIpv4(arg)) return arg;
    let state: ControllerOpsState;
    try {
        state = await getOpsState(host);
    } catch {
        throw new Error(
            `'${arg}' is not an IPv4 address, and resolving a name needs the app:\n${unreachableHint(host)}`,
        );
    }
    const lower = arg.toLowerCase();
    const known = (state.known ?? []).find((k) => k.name.toLowerCase() === lower);
    if (known?.address) return known.address;
    const dev = Object.values(state.devices).find((d) => d.hostname?.toLowerCase() === lower);
    if (dev) return dev.ip;
    throw new Error(`no known controller or discovered hostname matches '${arg}'`);
}
