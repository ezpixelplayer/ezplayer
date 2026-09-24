/**
 * One scripted FPP-API session — upload, play, pause, resume, stop, read —
 * run against EZPlayer and against a real FPP from this one copy, recording
 * per call: HTTP status, response structure, and the values that must agree
 * (names, counts, sizes, states). Values that legitimately differ — clocks,
 * uuids, host names, versions — are not recorded.
 */

import type { FppClient, FppStatus } from './fpp-client.js';
import { shapeGaps } from './json-shape.js';

/** One recorded call. */
export interface Step {
    label: string;
    method: string;
    path: string;
    status: number;
    /** Parsed JSON body; undefined for text answers (FPP's command acks). */
    body?: unknown;
    /** Values that must match between targets. */
    facts?: Record<string, unknown>;
}

export interface ScenarioFiles {
    /** Sequence file name and bytes, uploaded to both. */
    song: string;
    fseq: Uint8Array;
    /** Media file name and bytes (FPP before 6.x has no raw upload). */
    audio: string;
    wav: Uint8Array;
    /** Scratch media name, uploaded and then deleted. */
    scratch: string;
    /** Playlist name created on both. */
    show: string;
}

/** A body's fields, as facts. Missing pieces record as undefined, which is
 *  itself a difference worth seeing. */
type Facts = (body: unknown) => Record<string, unknown>;

interface PlayerStatusBody {
    playlists?: { name?: string; currentState?: string; status?: number; position?: number; size?: number }[];
}
interface FileListBody {
    files?: { name?: string; sizeBytes?: string | number }[];
}
interface MediaMetaBody {
    format?: { size?: string | number };
}
interface SequenceMetaBody {
    NumFrames?: number;
    StepTime?: number;
    ChannelCount?: number;
    MaxChannel?: number;
}

const statusFacts: Facts = (b) => {
    const s = b as FppStatus;
    return {
        status_name: s.status_name,
        playlist: s.current_playlist?.playlist,
        index: s.current_playlist?.index,
        count: s.current_playlist?.count,
        sequence: s.current_sequence,
    };
};

const playerFacts: Facts = (b) => {
    const pl = (b as PlayerStatusBody).playlists?.[0];
    return {
        name: pl?.name,
        currentState: pl?.currentState,
        status: pl?.status,
        position: pl?.position,
        size: pl?.size,
    };
};

const playlistFacts: Facts = (b) => {
    const pl = b as { name?: string; mainPlaylist?: { type?: string; sequenceName?: string }[] };
    return {
        name: pl.name,
        items: (pl.mainPlaylist ?? []).map((e) => `${e.type}:${e.sequenceName}`).join(','),
    };
};

/** The names this scenario created, so a target's other content is ignored. */
const ownNames = (f: ScenarioFiles): Set<string> =>
    new Set([f.show, f.song, f.song.replace(/\.fseq$/, ''), f.audio, f.scratch]);

const namesFacts =
    (f: ScenarioFiles): Facts =>
    (b) => ({
        names: (b as string[])
            .filter((n) => ownNames(f).has(n))
            .sort()
            .join(','),
    });

/** The playback commands both sides implement. EZPlayer implements a subset
 *  of FPP's catalog, so comparing all of it would compare feature sets. */
const CHECKED_COMMANDS = [
    'Start Playlist',
    'Start Playlist At Item',
    'Insert Playlist Immediate',
    'Stop Now',
    'Stop Gracefully',
    'Pause Playlist',
    'Resume Playlist',
    'Next Playlist Item',
    'Prev Playlist Item',
    'All Lights Off',
];

const sizeOf = (b: unknown, name: string): number | undefined => {
    const f = (b as FileListBody).files?.find((x) => x.name === name);
    return f === undefined ? undefined : Number(f.sizeBytes);
};

/** Run the scenario against one target, returning its transcript. */
export async function runCompatScenario(c: FppClient, f: ScenarioFiles): Promise<Step[]> {
    const steps: Step[] = [];

    const call = async (
        label: string,
        path: string,
        opts?: { method?: string; body?: Uint8Array | string; headers?: Record<string, string>; facts?: Facts },
    ): Promise<Step> => {
        const res = await fetch(`${c.base}${path}`, {
            method: opts?.method ?? 'GET',
            body: opts?.body,
            headers: opts?.headers,
        });
        const text = await res.text();
        let body: unknown;
        try {
            body = JSON.parse(text) as unknown;
        } catch {
            body = undefined; // text/plain ack, or an error page
        }
        const step: Step = {
            label,
            method: opts?.method ?? 'GET',
            path,
            status: res.status,
            body,
            facts: body !== undefined && opts?.facts ? opts.facts(body) : undefined,
        };
        steps.push(step);
        return step;
    };

    // ---- set the target up from scratch ------------------------------------
    await call('stop before setup', '/api/playlists/stop');
    await c.waitForStatus((s) => s.status_name === 'idle', { label: 'idle before setup' });
    await call('upload sequence', `/api/sequence/${f.song}`, { method: 'POST', body: f.fseq });
    await call('create playlist', `/api/playlist/${f.show}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: f.show,
            mainPlaylist: [{ type: 'sequence', enabled: 1, playOnce: 0, sequenceName: f.song }],
        }),
    });

    // ---- what the target says about what it now holds -----------------------
    await call('read playlist', `/api/playlist/${f.show}`, { facts: playlistFacts });
    await call('list playlists', '/api/playlists', { facts: namesFacts(f) });
    await call('list playable', '/api/playlists/playable', { facts: namesFacts(f) });
    await call('list sequences', '/api/sequence', { facts: namesFacts(f) });
    await call('list sequence files', '/api/files/sequences', {
        facts: (b) => ({ size: sizeOf(b, f.song) }),
    });
    await call('sequence meta', `/api/sequence/${f.song}/meta`, {
        facts: (b) => {
            const m = b as SequenceMetaBody;
            return {
                NumFrames: m.NumFrames,
                StepTime: m.StepTime,
                ChannelCount: m.ChannelCount,
                MaxChannel: m.MaxChannel,
            };
        },
    });

    // ---- media: upload, describe, delete ------------------------------------
    await call('upload media', `/api/file/music/${f.audio}`, { method: 'POST', body: f.wav });
    await call('media meta', `/api/media/${f.audio}/meta`, {
        facts: (b) => ({ size: Number((b as MediaMetaBody).format?.size) }),
    });
    await call('list media', '/api/media', { facts: namesFacts(f) });
    await call('upload scratch media', `/api/file/music/${f.scratch}`, { method: 'POST', body: f.wav });
    await call('delete scratch media', `/api/file/music/${f.scratch}`, { method: 'DELETE' });
    await call('list media after delete', '/api/files/music', {
        facts: (b) => ({ scratchGone: sizeOf(b, f.scratch) === undefined }),
    });

    // ---- idle readings -------------------------------------------------------
    await call('idle status', '/api/fppd/status', { facts: statusFacts });
    await call('idle player status', '/api/player/status', { facts: playerFacts });
    await call('idle player current', '/api/player/current');
    await call('idle fppd playlists', '/api/fppd/playlists', {
        facts: (b) => ({ playlists: ((b as { playlists?: string[] }).playlists ?? []).join(',') }),
    });
    await call('idle playlist config', '/api/fppd/playlist/config');

    // ---- play ----------------------------------------------------------------
    await call('start playlist', `/api/playlist/${f.show}/start`);
    await c.waitForStatus((s) => s.status_name === 'playing', { label: 'playing' });
    // Let a second of playback elapse so positions are meaningful.
    await new Promise((r) => setTimeout(r, 1500));
    await call('playing status', '/api/fppd/status', { facts: statusFacts });
    await call('playing player status', '/api/player/status', { facts: playerFacts });
    await call('playing player current', '/api/player/current');
    await call('playing fppd playlists', '/api/fppd/playlists', {
        facts: (b) => ({ playlists: ((b as { playlists?: string[] }).playlists ?? []).join(',') }),
    });
    await call('playing playlist config', '/api/fppd/playlist/config');

    // ---- pause, resume, graceful stop, stop ----------------------------------
    await call('pause', '/api/playlists/pause');
    await c.waitForStatus((s) => s.status_name === 'paused', { label: 'paused' });
    await call('paused status', '/api/fppd/status', { facts: statusFacts });
    await call('paused player status', '/api/player/status', { facts: playerFacts });
    await call('resume', '/api/playlists/resume');
    await c.waitForStatus((s) => s.status_name === 'playing', { label: 'resumed' });
    await call('stop gracefully', '/api/playlists/stopgracefully');
    await c.waitForStatus((s) => s.status_name === 'stopping gracefully', { label: 'stopping gracefully' });
    await call('stopping status', '/api/fppd/status', { facts: statusFacts });
    await call('stop', '/api/playlists/stop');
    await c.waitForStatus((s) => s.status_name === 'idle', { label: 'stopped' });
    await call('stopped status', '/api/fppd/status', { facts: statusFacts });
    await call('stopped player status', '/api/player/status', { facts: playerFacts });
    await call('stopped playlist config', '/api/fppd/playlist/config');

    // ---- inventory and settings ---------------------------------------------
    await call('version', '/api/fppd/version');
    await call('system info', '/api/system/info');
    await call('time', '/api/time');
    await call('schedule', '/api/schedule');
    await call('fppd schedule', '/api/fppd/schedule');
    await call('multisync systems', '/api/fppd/multiSyncSystems');
    await call('plugins', '/api/plugin');
    await call('commands', '/api/commands', {
        facts: (b) => {
            // Argument names and types, which clients pass positionally.
            const byName = new Map(
                (b as { name: string; args?: { name: string; type: string }[] }[]).map((cmd) => [
                    cmd.name,
                    (cmd.args ?? []).map((a) => `${a.name}:${a.type}`).join(','),
                ]),
            );
            return Object.fromEntries(CHECKED_COMMANDS.map((n) => [`command ${n}`, byName.get(n)]));
        },
    });
    await call('volume read', '/api/system/volume', {
        facts: (b) => ({ volumeType: typeof (b as { volume?: unknown }).volume }),
    });
    await call('volume write', '/api/system/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: 42 }),
    });

    return steps;
}

/** How one target's transcript falls short of the other's. Differences are
 *  one line each, prefixed by the step label so an allowance can name it. */
export function compareTranscripts(ours: Step[], theirs: Step[]): string[] {
    const diffs: string[] = [];
    if (ours.length !== theirs.length) {
        return [`transcripts differ in length: ours ${ours.length}, theirs ${theirs.length}`];
    }
    for (let i = 0; i < ours.length; i++) {
        const o = ours[i];
        const t = theirs[i];
        if (o.label !== t.label) {
            diffs.push(`step ${i}: labels differ (${o.label} vs ${t.label})`);
            continue;
        }
        // An endpoint this FPP release predates: reported once, not as a pile
        // of missing fields.
        if (t.status === 404 && o.status !== 404) {
            diffs.push(`${o.label}: absent in this FPP release`);
            continue;
        }
        if (o.status !== t.status) diffs.push(`${o.label}: status ours=${o.status} theirs=${t.status}`);
        if (t.body !== undefined && o.body !== undefined) {
            diffs.push(...shapeGaps(o.body, t.body, o.label));
        }
        for (const [k, want] of Object.entries(t.facts ?? {})) {
            const got = (o.facts ?? {})[k];
            if (JSON.stringify(got) !== JSON.stringify(want)) {
                diffs.push(`${o.label}: ${k} ours=${JSON.stringify(got)} theirs=${JSON.stringify(want)}`);
            }
        }
    }
    return diffs;
}
