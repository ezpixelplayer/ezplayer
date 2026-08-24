/**
 * HTTP client for a running EZPlayer's web API. Pure Node `fetch`, no electron.
 */

import type {
    EZPlayerCommand,
    PlaybackStatistics,
    PlayerPStatusContent,
    PlaylistRecord,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';

export const DEFAULT_PORT = 3000;

export function defaultPort(): number {
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

/** POST an EZPlayerCommand (playsong, resetstats, suppressoutput, …). */
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

/** Resolve a sequence argument against the loaded show: exact id, then title
 *  (case-insensitive), then the fseq file name with or without `.fseq`. */
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
