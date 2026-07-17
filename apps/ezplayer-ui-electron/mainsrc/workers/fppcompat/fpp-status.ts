/**
 * FPP-compat status/identity translators — pure functions over cached state.
 * Field names AND types mirror FPP (src/httpAPI.cpp): index/count/seconds_*
 * are strings, milliseconds_elapsed/mode/status/volume are ints, times are
 * MM:SS. Integrators depend on these shapes — do not "fix" them.
 */

import * as path from 'path';
import type { PlayerPStatusContent, PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '@ezplayer/ezplayer-core';

/** FPP PlaylistStatus enum (src/playlist/Playlist.h). */
export const FPP_STATUS = {
    IDLE: 0,
    PLAYING: 1,
    STOPPING_GRACEFULLY: 2,
    STOPPING_GRACEFULLY_AFTER_LOOP: 3,
    STOPPING_NOW: 4,
    PAUSED: 5,
} as const;

/** Advertised FPP compat level; the real EZPlayer version rides in the suffix. */
export const FPP_COMPAT_MAJOR = 8;
export const FPP_COMPAT_MINOR = 0;
export function fppCompatVersion(appVersion: string): string {
    return `${FPP_COMPAT_MAJOR}.${FPP_COMPAT_MINOR}-EZPlayer-${appVersion}`;
}

export interface FppIdentity {
    hostName: string;
    appVersion: string;
    uuid: string;
    ips: string[];
}

export interface FppStatusSources {
    pStatus?: PlayerPStatusContent;
    sequences?: SequenceRecord[];
    playlists?: PlaylistRecord[];
    schedule?: ScheduledPlaylist[];
}

/** FPP secondsToTime: MM:SS below one hour, H:MM:SS above. */
export function fppTimeStr(totalSeconds: number): string {
    const t = Math.max(0, Math.floor(totalSeconds));
    const p2 = (n: number) => String(n).padStart(2, '0');
    if (t >= 3600) return `${Math.floor(t / 3600)}:${p2(Math.floor(t / 60) % 60)}:${p2(t % 60)}`;
    return `${p2(Math.floor(t / 60))}:${p2(t % 60)}`;
}

function mapStatus(p?: PlayerPStatusContent): { status: number; status_name: string } {
    switch (p?.status) {
        case 'Playing':
        case 'Suppressed': // output suppressed but time advancing — playing as far as FPP semantics go
            return { status: FPP_STATUS.PLAYING, status_name: 'playing' };
        case 'Stopping':
            return { status: FPP_STATUS.STOPPING_GRACEFULLY, status_name: 'stopping gracefully' };
        case 'Paused':
            return { status: FPP_STATUS.PAUSED, status_name: 'paused' };
        case 'Stopped':
        case 'Up':
        case 'Down':
        default:
            return { status: FPP_STATUS.IDLE, status_name: 'idle' };
    }
}

function findPlaylist(playlists: PlaylistRecord[] | undefined, id?: string): PlaylistRecord | undefined {
    if (!id) return undefined;
    return playlists?.find((p) => p.id === id);
}

function findSequence(sequences: SequenceRecord[] | undefined, id?: string): SequenceRecord | undefined {
    if (!id) return undefined;
    return sequences?.find((s) => s.id === id);
}

function fppDateTimeStr(ms: number | undefined): string {
    if (!ms) return '';
    const d = new Date(ms);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** Build the /api/system/status and /api/fppd/status payload. `now` is
 *  injected for testability. */
export function buildFppStatus(src: FppStatusSources, identity: FppIdentity, now: number): Record<string, unknown> {
    const p = src.pStatus;
    const { status, status_name } = mapStatus(p);
    const playing = status === FPP_STATUS.PLAYING || status === FPP_STATUS.PAUSED || status === FPP_STATUS.STOPPING_GRACEFULLY;
    const np = playing ? p?.now_playing : undefined;

    // Idle defaults — exactly FPP's idle shape (Playlist.cpp GetCurrentStatus).
    let currentPlaylist = { playlist: '', description: '', type: '', index: '0', count: '0' };
    let currentSequence = '';
    let currentSong = '';
    let secondsPlayed = 0;
    let secondsRemaining = 0;
    let repeatMode = '0';

    if (np) {
        // scheduled items carry schedule_id, not playlist_id
        let playlistId = np.playlist_id;
        if (!playlistId && np.schedule_id) {
            playlistId = src.schedule?.find((s) => s.id === np.schedule_id)?.playlistId;
        }
        const pl = findPlaylist(src.playlists, playlistId);
        const seq = findSequence(src.sequences, np.sequence_id);
        const seqIdx = pl && np.sequence_id ? pl.items.findIndex((i) => i.id === np.sequence_id) : -1;
        currentPlaylist = {
            playlist: pl?.title ?? np.title ?? '',
            description: '',
            type: seq?.files?.audio ? 'both' : 'sequence',
            index: String(seqIdx >= 0 ? seqIdx + 1 : 1),
            count: String(pl ? pl.items.length : 1),
        };
        currentSequence = seq?.files?.fseq ? path.basename(seq.files.fseq) : '';
        currentSong = seq?.files?.audio ? path.basename(seq.files.audio) : '';

        // While playing, the clock is wall time (pstatus pushes are event-driven
        // and go stale); while paused, the engine clock, which freezes exactly
        // at the pause point.
        const clock = status === FPP_STATUS.PAUSED ? (p?.engine_time ?? p?.reported_time ?? now) : now;
        if (np.until !== undefined) {
            secondsRemaining = Math.max(0, (np.until - clock) / 1000);
        }
        // elapsed = duration - remaining: the readout re-clamps `at` each push; `until` is honest
        const durationSec = seq?.work?.length;
        if (durationSec && np.until !== undefined) {
            secondsPlayed = Math.min(durationSec, Math.max(0, durationSec - secondsRemaining));
        } else if (np.at !== undefined) {
            secondsPlayed = Math.max(0, (clock - np.at) / 1000);
        }
        const sched = np.schedule_id ? src.schedule?.find((s) => s.id === np.schedule_id) : undefined;
        repeatMode = sched?.loop ? '1' : '0';
    }

    const upcoming = p?.upcoming?.[0];
    const nextPlaylist = {
        playlist: upcoming?.title ?? '',
        start_time: upcoming?.at ? fppDateTimeStr(upcoming.at) : '',
    };

    const secPlayedInt = Math.floor(secondsPlayed);
    const secRemainInt = Math.floor(secondsRemaining);

    const uptimeSeconds = Math.floor(process.uptime());

    return {
        fppd: 'running',
        version: fppCompatVersion(identity.appVersion),
        branch: 'EZPlayer',
        platform: 'EZPlayer',
        uuid: identity.uuid,
        host_name: identity.hostName,
        host_description: '',
        mode: 2,
        mode_name: 'player',
        status,
        status_name,
        bridging: false,
        multisync: false,
        channelInputsEnabled: false,
        channelOutputsEnabled: true,
        volume: Math.round(p?.volume?.level ?? 100),
        time: new Date(now).toString(),
        uptimeTotalSeconds: uptimeSeconds,
        uptime: fppTimeStr(uptimeSeconds),
        warnings: [],
        MQTT: { configured: false, connected: false },

        next_playlist: nextPlaylist,
        current_playlist: currentPlaylist,
        current_sequence: currentSequence,
        current_song: currentSong,
        seconds_played: String(secPlayedInt),
        seconds_elapsed: String(secPlayedInt),
        milliseconds_elapsed: Math.floor(secondsPlayed * 1000),
        seconds_remaining: String(secRemainInt),
        time_elapsed: fppTimeStr(secPlayedInt),
        time_remaining: fppTimeStr(secRemainInt),
        repeat_mode: repeatMode,
        scheduler: buildSchedulerBlock(src, now),
    };
}

function buildSchedulerBlock(src: FppStatusSources, now: number): Record<string, unknown> {
    const p = src.pStatus;
    const np = p?.now_playing;
    const playingScheduled = np?.type === 'Scheduled' && np.schedule_id;
    const block: Record<string, unknown> = {
        enabled: 1,
        status: playingScheduled ? 'playing' : 'idle',
    };
    if (playingScheduled) {
        const sched = src.schedule?.find((s) => s.id === np!.schedule_id);
        block.currentPlaylist = {
            playlistName: np!.title ?? '',
            scheduledStartTime: np!.at ? Math.floor(np!.at / 1000) : 0,
            scheduledEndTime: np!.until ? Math.floor(np!.until / 1000) : 0,
            currentTime: Math.floor(now / 1000),
            stopType: sched?.endPolicy === 'hardcut' ? 1 : 0,
            stopTypeStr: sched?.endPolicy === 'hardcut' ? 'Hard' : 'Graceful',
        };
    }
    const upcoming = p?.upcoming?.[0];
    if (upcoming) {
        block.nextPlaylist = {
            playlistName: upcoming.title ?? '',
            scheduledStartTime: upcoming.at ? Math.floor(upcoming.at / 1000) : 0,
            scheduledStartTimeStr: upcoming.at ? fppDateTimeStr(upcoming.at) : '',
        };
    }
    return block;
}

/** GET /api/system/info payload. */
export function buildSystemInfo(identity: FppIdentity, os: { freemem: number; totalmem: number }): Record<string, unknown> {
    const uptimeSeconds = Math.floor(process.uptime());
    return {
        HostName: identity.hostName,
        HostDescription: '',
        Platform: 'EZPlayer',
        Variant: 'EZPlayer',
        SubPlatform: '',
        backgroundColor: '2E8B57',
        Mode: 'player',
        Version: fppCompatVersion(identity.appVersion),
        Branch: 'EZPlayer',
        majorVersion: FPP_COMPAT_MAJOR,
        minorVersion: FPP_COMPAT_MINOR,
        typeId: 0xee, // honest non-FPP hardware id
        uuid: identity.uuid,
        Utilization: {
            CPU: 0,
            Memory: os.totalmem > 0 ? ((os.totalmem - os.freemem) / os.totalmem) * 100 : 0,
            Uptime: fppTimeStr(uptimeSeconds),
        },
        Kernel: process.version,
        LocalGitVersion: '',
        RemoteGitVersion: '',
        UpgradeSource: '',
        IPs: identity.ips,
        channelRanges: '',
    };
}

/** GET /api/fppd/version payload. */
export function buildFppdVersion(identity: FppIdentity): Record<string, unknown> {
    return {
        version: fppCompatVersion(identity.appVersion),
        majorVersion: FPP_COMPAT_MAJOR,
        minorVersion: FPP_COMPAT_MINOR,
        branch: 'EZPlayer',
        fppdAPI: 4,
        Status: 'OK',
    };
}
