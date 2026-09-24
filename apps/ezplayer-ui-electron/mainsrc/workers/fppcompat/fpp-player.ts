/**
 * FPP-compat /api/player* and /api/fppd/playlist* payloads — pure functions
 * over cached state, shaped like FPP's Player::GetStatusJSON and
 * Playlist::GetInfo / GetConfig (src/Player.cpp, src/playlist/Playlist.cpp).
 * FPP plays at most one playlist, so `playlists` holds exactly one entry,
 * the idle placeholder when nothing is playing.
 */

import type { PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';
import { recordToFppPlaylist, type FppPlaylistEntry } from './fpp-playlists.js';
import { FPP_STATUS, resolveNowPlaying, type FppNowPlaying, type FppStatusSources } from './fpp-status.js';

/** Playlist::PlaylistStatusToString. */
const STATE_NAMES: Record<number, string> = {
    [FPP_STATUS.IDLE]: 'idle',
    [FPP_STATUS.PLAYING]: 'playing',
    [FPP_STATUS.STOPPING_GRACEFULLY]: 'stoppingGracefully',
    [FPP_STATUS.STOPPING_GRACEFULLY_AFTER_LOOP]: 'stoppingAfterLoop',
    [FPP_STATUS.STOPPING_NOW]: 'stoppingNow',
    [FPP_STATUS.PAUSED]: 'paused',
};

const seconds = (ms: number | undefined): number => (ms ? Math.floor(ms / 1000) : 0);

/** Playlist flags FPP 5.x reports and later releases dropped; kept for
 *  clients written against 5.x. */
const BLANK_BETWEEN = { blankBetweenIterations: 0, blankBetweenSequences: 0 };

/** One playlist entry as PlaylistEntryBase::GetConfig reports it, with its
 *  run state relative to the current position (1-based). */
function entryConfig(entry: FppPlaylistEntry, position: number, current: number, np: FppNowPlaying) {
    const isCurrent = position === current;
    const done = position < current;
    const out: Record<string, unknown> = {
        ...entry,
        deprecated: 0,
        note: '',
        isStarted: done || isCurrent ? 1 : 0,
        isPlaying: isCurrent ? 1 : 0,
        isFinished: done ? 1 : 0,
        playCount: done || isCurrent ? 1 : 0,
    };
    delete out.duration;
    if (isCurrent) {
        out.secondsElapsed = Math.floor(np.secondsPlayed);
        out.millisecondsElapsed = Math.floor(np.secondsPlayed * 1000);
        out.secondsRemaining = Math.floor(np.secondsRemaining);
    }
    return out;
}

/** Playlist item and duration counts, as FPP stores them with a playlist. */
function playlistInfoOf(items: number): Record<string, number> {
    return {
        leadIn_items: 0,
        leadIn_duration: 0,
        mainPlaylist_items: items,
        mainPlaylist_duration: 0,
        leadOut_items: 0,
        leadOut_duration: 0,
        total_items: items,
        total_duration: 0,
    };
}

interface PlayerView {
    info: Record<string, unknown>;
    config: Record<string, unknown>;
}

/** Playlist::GetInfo and Playlist::GetConfig for what is playing now. */
function playerView(np: FppNowPlaying, sequences: SequenceRecord[] | undefined, now: number): PlayerView {
    const currentState = STATE_NAMES[np.status] ?? 'idle';
    if (!np.active) {
        const info = {
            blankAtEnd: 0,
            ...BLANK_BETWEEN,
            currentEntry: null,
            currentState,
            desc: '',
            loop: 0,
            loopCount: 0,
            name: '',
            random: 0,
            repeat: 0,
            size: 0,
        };
        // A freshly booted FPP reports playlistInfo null here; once anything
        // has played it keeps an object, which is the steady state we match.
        return {
            info,
            config: {
                ...info,
                configTime: seconds(now),
                globalPauseBetweenSequencesMS: 0,
                playlistInfo: playlistInfoOf(0),
            },
        };
    }

    // A playlist from the records, or a single song played on its own.
    const pl: PlaylistRecord | undefined = np.playlist;
    const fpp = pl
        ? recordToFppPlaylist(pl, sequences)
        : {
              mainPlaylist: [
                  {
                      type: np.songFile ? 'both' : 'sequence',
                      enabled: 1,
                      playOnce: 0,
                      sequenceName: np.sequenceFile,
                      ...(np.songFile ? { mediaName: np.songFile } : {}),
                  },
              ],
              playlistInfo: undefined,
          };
    const entries = (fpp.mainPlaylist ?? []).map((e, i) => entryConfig(e, i + 1, np.index, np));
    const info = {
        blankAtEnd: 1,
        ...BLANK_BETWEEN,
        currentEntry: entries[np.index - 1] ?? null,
        currentState,
        desc: '',
        loop: 0,
        loopCount: 0,
        name: np.playlistName,
        random: 0,
        repeat: np.repeat ? 1 : 0,
        size: entries.length,
    };
    return {
        info,
        config: {
            ...info,
            mainPlaylist: entries,
            configTime: seconds(now),
            globalPauseBetweenSequencesMS: 0,
            playlistInfo: fpp.playlistInfo ?? playlistInfoOf(entries.length),
        },
    };
}

/** GET /api/player and /api/player/status (Player::GetStatusJSON). */
export function buildPlayerStatus(src: FppStatusSources, now: number): Record<string, unknown> {
    const np = resolveNowPlaying(src, now);
    const { info, config } = playerView(np, src.sequences, now);
    const pl = np.playlist;
    return {
        playlists: [
            {
                ...info,
                details: config,
                status: np.active ? np.status : FPP_STATUS.IDLE,
                scheduled: np.active ? np.scheduled : true,
                position: np.active ? np.index : 0,
                lastModified: np.active && pl ? seconds(pl.updatedAt ?? pl.createdAt) : 0,
                origStartTime: 0,
                origStopTime: 0,
                startTime: np.active ? seconds(np.startMs) : 0,
                stopTime: np.active && np.scheduled ? seconds(np.stopMs) : 0,
                stopMethod: 0,
                priority: np.active ? (np.priority ?? -1) : 1000,
            },
        ],
    };
}

/** GET /api/player/current: `{playlist: Playlist::GetInfo()}`. */
export function buildPlayerCurrent(src: FppStatusSources, now: number): Record<string, unknown> {
    return { playlist: playerView(resolveNowPlaying(src, now), src.sequences, now).info };
}

const OK = { Status: 'OK', Message: '', respCode: 200 };

/** GET /api/fppd/playlists: names of the running playlists. */
export function buildFppdPlaylists(src: FppStatusSources, now: number): Record<string, unknown> {
    const np = resolveNowPlaying(src, now);
    return { ...OK, playlists: np.active ? [np.playlistName] : [] };
}

/** GET /api/fppd/playlist/config: the running playlist's config, or just the
 *  status fields when nothing is playing. */
export function buildFppdPlaylistConfig(src: FppStatusSources, now: number): Record<string, unknown> {
    const np = resolveNowPlaying(src, now);
    if (!np.active) return { ...OK };
    return { ...OK, ...playerView(np, src.sequences, now).config };
}
