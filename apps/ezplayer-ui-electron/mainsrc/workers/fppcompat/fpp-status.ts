/**
 * FPP-compat status/identity translators — pure functions over cached state.
 * Field names AND types mirror FPP (src/httpAPI.cpp): index/count/seconds_*
 * are strings, milliseconds_elapsed/mode/status/volume are ints, times are
 * MM:SS. Integrators depend on these shapes — do not "fix" them.
 */

import * as os from 'os';
import { fileBaseName } from '../pathnames.js';
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

/** What the player is doing, resolved against the records, in the terms the
 *  FPP status endpoints report. */
export interface FppNowPlaying {
    status: number;
    status_name: string;
    /** Something is loaded: playing, paused or stopping. */
    active: boolean;
    playlist?: PlaylistRecord;
    sequence?: SequenceRecord;
    /** Playlist title (or the song title when no playlist is involved). */
    playlistName: string;
    /** 1-based position of the current item; 0 when idle. */
    index: number;
    count: number;
    sequenceFile: string;
    songFile: string;
    secondsPlayed: number;
    secondsRemaining: number;
    /** Started by the scheduler rather than by hand. */
    scheduled: boolean;
    schedule?: ScheduledPlaylist;
    repeat: boolean;
    /** Epoch ms the current item started and is due to end, when known. */
    startMs?: number;
    stopMs?: number;
    priority?: number;
}

export function resolveNowPlaying(src: FppStatusSources, now: number): FppNowPlaying {
    const p = src.pStatus;
    const { status, status_name } = mapStatus(p);
    const active =
        status === FPP_STATUS.PLAYING || status === FPP_STATUS.PAUSED || status === FPP_STATUS.STOPPING_GRACEFULLY;
    const np = active ? p?.now_playing : undefined;
    const idle: FppNowPlaying = {
        status,
        status_name,
        active: false,
        playlistName: '',
        index: 0,
        count: 0,
        sequenceFile: '',
        songFile: '',
        secondsPlayed: 0,
        secondsRemaining: 0,
        scheduled: false,
        repeat: false,
    };
    if (!np) return { ...idle, status: active ? status : FPP_STATUS.IDLE, status_name: active ? status_name : 'idle' };

    // scheduled items carry schedule_id, not playlist_id
    const schedule = np.schedule_id ? src.schedule?.find((s) => s.id === np.schedule_id) : undefined;
    const playlistId = np.playlist_id ?? schedule?.playlistId;
    const playlist = findPlaylist(src.playlists, playlistId);
    const sequence = findSequence(src.sequences, np.sequence_id);
    const seqIdx = playlist && np.sequence_id ? playlist.items.findIndex((i) => i.id === np.sequence_id) : -1;

    // While playing, the clock is wall time (pstatus pushes are event-driven
    // and go stale); while paused, the engine clock, which freezes exactly
    // at the pause point.
    const clock = status === FPP_STATUS.PAUSED ? (p?.engine_time ?? p?.reported_time ?? now) : now;
    let secondsRemaining = 0;
    let secondsPlayed = 0;
    if (np.until !== undefined) {
        secondsRemaining = Math.max(0, (np.until - clock) / 1000);
    }
    // elapsed = duration - remaining: the readout re-clamps `at` each push; `until` is honest
    const durationSec = sequence?.work?.length;
    if (durationSec && np.until !== undefined) {
        secondsPlayed = Math.min(durationSec, Math.max(0, durationSec - secondsRemaining));
    } else if (np.at !== undefined) {
        secondsPlayed = Math.max(0, (clock - np.at) / 1000);
    }

    return {
        status,
        status_name,
        active: true,
        playlist,
        sequence,
        playlistName: playlist?.title ?? np.title ?? '',
        index: seqIdx >= 0 ? seqIdx + 1 : 1,
        count: playlist ? playlist.items.length : 1,
        sequenceFile: sequence?.files?.fseq ? fileBaseName(sequence.files.fseq) : '',
        songFile: sequence?.files?.audio ? fileBaseName(sequence.files.audio) : '',
        secondsPlayed,
        secondsRemaining,
        scheduled: np.type === 'Scheduled',
        schedule,
        repeat: !!schedule?.loop,
        startMs: np.at,
        stopMs: np.until,
        priority: np.priority,
    };
}

/** FPP's own wording when the schedule has nothing queued. */
const NOTHING_SCHEDULED = 'No playlist scheduled.';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** Local time-zone abbreviation, e.g. "EDT" (strftime %Z). */
function tzAbbrev(d: Date): string {
    const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(d)
        .find((x) => x.type === 'timeZoneName');
    return part?.value ?? '';
}

/** FPP's `time` field and /api/time: strftime "%a %b %d %H:%M:%S %Z %Y", local time. */
export function fppClockString(ms: number): string {
    const d = new Date(ms);
    return (
        `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${p2(d.getDate())} ` +
        `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${tzAbbrev(d)} ${d.getFullYear()}`
    );
}

/** FPP's default TimeFormat "%I:%M %p", or with seconds for timeStrFull. */
function fppTimeOfDay(ms: number, withSeconds: boolean): string {
    const d = new Date(ms);
    const h12 = d.getHours() % 12 || 12;
    const secs = withSeconds ? `:${p2(d.getSeconds())}` : '';
    return `${p2(h12)}:${p2(d.getMinutes())}${secs} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** strftime "%Y-%m-%d %H:%M:%S", local time: FPP's `lastSeenStr`. */
export function fppDateTimeString(ms: number): string {
    const d = new Date(ms);
    return (
        `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
        `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
    );
}

/** FPP's default DateFormat "%a %b %e" (day space-padded to two). */
function fppDateOfDay(ms: number): string {
    const d = new Date(ms);
    return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')}`;
}

/** Build the /api/system/status and /api/fppd/status payload. `now` is
 *  injected for testability. */
export function buildFppStatus(src: FppStatusSources, identity: FppIdentity, now: number): Record<string, unknown> {
    const p = src.pStatus;
    const np = resolveNowPlaying(src, now);
    const { status, status_name } = np;

    // Idle defaults are exactly FPP's idle shape (Playlist.cpp GetCurrentStatus).
    const currentPlaylist = np.active
        ? {
              playlist: np.playlistName,
              description: '',
              type: np.songFile ? 'both' : 'sequence',
              index: String(np.index),
              count: String(np.count),
          }
        : { playlist: '', description: '', type: '', index: '0', count: '0' };
    const secondsPlayed = np.secondsPlayed;
    const secondsRemaining = np.secondsRemaining;
    // FPP's own inconsistency (Playlist::GetCurrentStatus): the string "0"
    // while idle, the playlist's repeat flag as a number while playing.
    const repeatMode: string | number = np.active ? (np.repeat ? 1 : 0) : '0';

    const upcoming = p?.upcoming?.[0];
    const nextPlaylist = {
        playlist: upcoming?.title ?? NOTHING_SCHEDULED,
        start_time: upcoming?.at ? fppDateTimeStr(upcoming.at) : '',
    };

    const secPlayedInt = Math.floor(secondsPlayed);
    const secRemainInt = Math.floor(secondsRemaining);

    const uptimeSeconds = Math.floor(process.uptime());
    const up = {
        days: Math.floor(uptimeSeconds / 86400),
        hours: Math.floor((uptimeSeconds % 86400) / 3600),
        minutes: Math.floor((uptimeSeconds % 3600) / 60),
        seconds: uptimeSeconds % 60,
    };

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
        time: fppClockString(now),
        timeStr: fppTimeOfDay(now, false),
        timeStrFull: fppTimeOfDay(now, true),
        dateStr: fppDateOfDay(now),
        uptimeTotalSeconds: uptimeSeconds,
        uptime: fppTimeStr(uptimeSeconds),
        uptimeSeconds: up.seconds,
        uptimeMinutes: up.minutes,
        uptimeHours: up.hours,
        uptimeDays: up.days,
        uptimeStr: `${up.days} days, ${up.hours} hours, ${up.minutes} minutes, ${up.seconds} seconds`,
        powerBad: false,
        warnings: [],
        warningInfo: [],
        media_playing: np.active && !!np.songFile,
        systemUptimeTotalSeconds: Math.floor(os.uptime()),
        MQTT: { configured: false, connected: false },

        next_playlist: nextPlaylist,
        current_playlist: currentPlaylist,
        current_sequence: np.sequenceFile,
        current_song: np.songFile,
        seconds_played: String(secPlayedInt),
        seconds_elapsed: String(secPlayedInt),
        milliseconds_elapsed: Math.floor(secondsPlayed * 1000),
        seconds_remaining: String(secRemainInt),
        time_elapsed: fppTimeStr(secPlayedInt),
        time_remaining: fppTimeStr(secRemainInt),
        repeat_mode: repeatMode,
        random: 0,
        // FPP reports this block even when no pause is configured.
        global_pause: { active: false, configured: false, duration_ms: 0 },
        scheduler: buildSchedulerBlock(src, now),
    };
}

function buildSchedulerBlock(src: FppStatusSources, now: number): Record<string, unknown> {
    const p = src.pStatus;
    const np = p?.now_playing;
    const playingScheduled = np?.type === 'Scheduled' && np.schedule_id;
    const current = resolveNowPlaying(src, now);
    // FPP (Scheduler::GetInfo): "playing" for a scheduled playlist, "manual"
    // for one someone started, "idle" for nothing.
    const block: Record<string, unknown> = {
        enabled: 1,
        status: playingScheduled ? 'playing' : current.active ? 'manual' : 'idle',
    };
    if (!playingScheduled && current.active) {
        // FPP reports only the name for a manually started playlist.
        block.currentPlaylist = { playlistName: current.playlistName };
    }
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
    // FPP always reports a next playlist, with this text when there is none.
    const upcoming = p?.upcoming?.[0];
    block.nextPlaylist = {
        playlistName: upcoming?.title ?? NOTHING_SCHEDULED,
        scheduledStartTime: upcoming?.at ? Math.floor(upcoming.at / 1000) : 0,
        scheduledStartTimeStr: upcoming?.at ? fppDateTimeStr(upcoming.at) : '',
    };
    return block;
}

/** One filesystem's free and total bytes, as FPP reports them. */
export interface FppDiskUsage {
    Free: number;
    Total: number;
}

export interface FppSystemResources {
    freemem: number;
    totalmem: number;
    /** os.version() and os.release() of the host. */
    osVersion?: string;
    osRelease?: string;
    /** The show folder's filesystem, and the one the player itself runs from. */
    media?: FppDiskUsage;
    root?: FppDiskUsage;
}

/** GET /api/system/info payload. */
export function buildSystemInfo(identity: FppIdentity, res: FppSystemResources): Record<string, unknown> {
    const uptimeSeconds = Math.floor(process.uptime());
    const disk: Record<string, FppDiskUsage> = {};
    if (res.media) disk.Media = res.media;
    if (res.root) disk.Root = res.root;
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
        // FPP shows its OS image version here; ours is the host OS.
        OSVersion: res.osVersion ?? '',
        OSRelease: res.osRelease ?? '',
        Logo: '',
        multisync: false,
        channelInputsEnabled: false,
        channelOutputsEnabled: true,
        Utilization: {
            CPU: 0,
            Memory: res.totalmem > 0 ? ((res.totalmem - res.freemem) / res.totalmem) * 100 : 0,
            Uptime: fppTimeStr(uptimeSeconds),
            Disk: disk,
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
    // FPP reports the version numbers as strings here (they are numbers in
    // /api/system/info), and fppdAPI as "v1".
    return {
        version: fppCompatVersion(identity.appVersion),
        majorVersion: String(FPP_COMPAT_MAJOR),
        minorVersion: String(FPP_COMPAT_MINOR),
        branch: 'EZPlayer',
        fppdAPI: 'v1',
        Status: 'OK',
        Message: '',
        respCode: 200,
    };
}
