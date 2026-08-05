/**
 * `upload` — push the xLights-derived configuration to one controller, by
 * known-record name. Runs THROUGH the running app: the upload intent only
 * exists in the app's known state. If the target was never scanned, a `status`
 * command materializes the device entry from the record's address first.
 */

import type { ControllerOpsState } from '@ezplayer/ezplayer-core';
import { getOpsState, postCommand, resolveHost, unreachableHint } from '../ezp-client.js';

const SCOPES = ['inputs', 'strings', 'full'] as const;
type Scope = (typeof SCOPES)[number];

export async function run(args: string[]): Promise<number> {
    const positionals: string[] = [];
    let hostFlag: string | undefined;
    let scope: Scope = 'full';
    let fullControl = false;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--host') hostFlag = args[++i];
        else if (a === '--full-control') fullControl = true;
        else if (a === '--scope') {
            const v = args[++i];
            if (!v || !(SCOPES as readonly string[]).includes(v)) {
                console.error(`upload: invalid --scope '${v ?? ''}' (expected ${SCOPES.join(' | ')})`);
                return 2;
            }
            scope = v as Scope;
        } else if (!a.startsWith('-')) positionals.push(a);
        else {
            console.error(`upload: unrecognized argument '${a}'`);
            return 2;
        }
    }
    // Controller names may contain spaces — join unquoted positionals back up.
    const name = positionals.join(' ');
    if (!name) {
        console.error('upload: missing <name> (a known controller name from the running app)');
        return 2;
    }
    const host = resolveHost(hostFlag);

    let state: ControllerOpsState;
    try {
        state = await getOpsState(host);
    } catch (e) {
        console.error(`upload: ${(e as Error).message}`);
        console.error(unreachableHint(host));
        return 1;
    }

    const known = (state.known ?? []).find((k) => k.name.toLowerCase() === name.toLowerCase());
    if (!known) {
        console.error(`upload: no known controller named '${name}'`);
        const names = (state.known ?? []).map((k) => k.name);
        if (names.length) console.error(`known controllers: ${names.join(', ')}`);
        return 1;
    }
    if (!known.address) {
        console.error(`upload: '${known.name}' has no address — associate it with a device first`);
        return 1;
    }
    const addr = known.address;

    // The dispatcher targets a scanned-device id. Prefer an existing direct
    // entry; otherwise deep-read by address to materialize one.
    let id = Object.values(state.devices).find((d) => d.source.via === 'direct' && (d.ip === addr || d.hostname === addr))?.id;
    try {
        if (!id) {
            id = `${addr}|direct`;
            process.stderr.write(`No scanned entry for ${addr}; reading it first…\n`);
            await postCommand(host, { cmd: 'status', id, address: addr });
        }
        process.stderr.write(`Uploading ${scope} config to '${known.name}' (${addr})${fullControl ? ' [full control]' : ''}…\n`);
        await postCommand(host, { cmd: 'upload', id, scope, fullControl });
    } catch (e) {
        console.error(`upload: ${(e as Error).message}`);
        return 1;
    }

    // The op has finished (the route is synchronous); pull its outcome — the
    // label carries any driver warnings.
    try {
        const after = await getOpsState(host);
        const op = Object.values(after.operations)
            .filter((o) => o.kind === 'upload' && o.target === id)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
        if (op) {
            console.log(`${op.label} — ${op.status}${op.error ? `: ${op.error}` : ''}`);
            return op.status === 'error' ? 1 : 0;
        }
    } catch {
        /* state re-read is best-effort; the POST above already succeeded */
    }
    console.log(`Upload ${scope} → ${known.name}: OK`);
    return 0;
}
