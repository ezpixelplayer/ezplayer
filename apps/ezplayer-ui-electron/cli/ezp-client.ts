/**
 * Client helpers for CLI verbs that talk to a RUNNING EZPlayer app's web API
 * (/api/ezp/controllers*). Pure Node `fetch`, no electron.
 *
 * Target defaults to 127.0.0.1:3000; a non-default configured port needs
 * --host or EZPLAYER_WEB_PORT (the app's stored port preference is not
 * readable here).
 */

import type {
    ControllerCommand,
    ControllerOpsState,
    EZPlayerCommand,
    PlaybackStatistics,
    PlayerPStatusContent,
    PlaylistRecord,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';

const DEFAULT_PORT = 3000;

function defaultPort(): number {
    const env = Number(process.env.EZPLAYER_WEB_PORT);
    return Number.isInteger(env) && env > 0 ? env : DEFAULT_PORT;
}

/** `--host` value → "host:port" (port defaulted); undefined → local player. */
export function resolveHost(hostFlag: string | undefined): string {
    if (hostFlag) return hostFlag.includes(':') ? hostFlag : `${hostFlag}:${defaultPort()}`;
    return `127.0.0.1:${defaultPort()}`;
}

export function unreachableHint(host: string): string {
    return (
        `could not reach EZPlayer at http://${host} — is the app running?\n` +
        `(use --host <host[:port]> or EZPLAYER_WEB_PORT if it serves a different address/port)`
    );
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

/** GET /api/ezp/current-show — the player's loaded sequences / playlists / status. */
export async function getCurrentShow(host: string): Promise<{
    showFolder?: string;
    sequences: SequenceRecord[];
    playlists: PlaylistRecord[];
    pStatus?: PlayerPStatusContent;
}> {
    const res = await fetch(`http://${host}/api/ezp/current-show`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`GET http://${host}/api/ezp/current-show → HTTP ${res.status}`);
    return (await res.json()) as Awaited<ReturnType<typeof getCurrentShow>>;
}

/** POST an EZPlayerCommand (playsong, resetstats, suppressoutput, …) to the running app. */
export async function postPlayerCommand(host: string, command: EZPlayerCommand): Promise<void> {
    const res = await fetch(`http://${host}/api/ezp/player-command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`POST /api/ezp/player-command (${command.command}) → HTTP ${res.status}`);
}

/** GET /api/ezp/playback-stats — undefined while the worker hasn't reported yet (503). */
export async function getPlaybackStats(
    host: string,
): Promise<{ stats: PlaybackStatistics; pStatus?: PlayerPStatusContent; serverNow: number } | undefined> {
    const res = await fetch(`http://${host}/api/ezp/playback-stats`, { signal: AbortSignal.timeout(5_000) });
    if (res.status === 503) return undefined;
    if (!res.ok) throw new Error(`GET http://${host}/api/ezp/playback-stats → HTTP ${res.status}`);
    return (await res.json()) as Awaited<ReturnType<typeof getPlaybackStats>>;
}

/** Resolve a `<sequence>` argument against the loaded show: exact id, then
 *  title (case-insensitive), then the fseq file name with or without `.fseq`. */
export function findSequence(sequences: SequenceRecord[], arg: string): SequenceRecord | undefined {
    const live = sequences.filter((s) => !s.deleted);
    const byId = live.find((s) => s.id === arg);
    if (byId) return byId;
    const lower = arg.toLowerCase();
    const byTitle = live.find((s) => s.work?.title?.toLowerCase() === lower);
    if (byTitle) return byTitle;
    const base = (p: string | undefined) =>
        p
            ?.split(/[\\/]/)
            .pop()
            ?.replace(/\.fseq$/i, '')
            .toLowerCase();
    const wanted = lower.replace(/\.fseq$/i, '');
    return live.find((s) => base(s.files?.fseq) === wanted);
}
