/** Viewer-control wire DTOs shared between player, cloud, and public page.
 *  Index signatures on cross-process types are intentional — fields must
 *  grow additively without a wire version bump. */

/** A song the player offers for viewer control. `id` is the stable song
 *  identifier (equal to `SequenceRecord.id`); the rest mirrors `SongDetails`
 *  for display on the public page. */
export interface VcSong {
    id: string;
    title: string;
    artist?: string;
    /** Vendor / source of the sequence (mirrors `SequenceDetails.vendor`). */
    vendor?: string;
    /** Milliseconds. Normalized on the wire (the player converts from
     *  whatever `SongDetails.length` unit it holds). */
    durationMs?: number;
    /** Mirrors `SongDetails.artwork`. */
    artwork?: string;
    [k: string]: unknown;
}

/** One current/upcoming entry. Modeled on `PlayingItem` (`title`, `at`,
 *  `until`, `sequence_id`) so the player can map its existing playback
 *  timeline straight onto the wire. Display-only. */
export interface VcPlayingItem {
    /** Maps to `VcSong.id` (`PlayingItem.sequence_id`). */
    songId?: string;
    title?: string;
    /** Display artist, when the cloud resolves the playing song against the
     *  song list. Absent for jukebox-only sequences not in the list. */
    artist?: string;
    /** Cover-art URL, same resolution caveat as `artist`. Often absent for
     *  light-show sequences. */
    artwork?: string;
    /** Epoch ms it is expected to start (mirrors `PlayingItem.at`). */
    at?: number;
    /** Epoch ms it is expected to end (mirrors `PlayingItem.until`). */
    until?: number;
    durationMs?: number;
    [k: string]: unknown;
}

/**
 * Argument to `POST /api/player/vc/playing`. Extensible by design: today the
 * player may send only the two identity keys; tomorrow it can add the richer
 * `now` / `upcoming` timeline with times and durations without a wire break.
 * `nowPlaying` / `nextScheduled` are the canonical song-identity keys;
 * everything else is display data for the page.
 */
export interface VcPlayingUpdate {
    /** Currently-playing song id — the now-playing identity key (used for
     *  de-duplication). */
    nowPlaying?: string;
    /** Immediate next song id — the next-up identity key. */
    nextScheduled?: string;
    /** Richer current item for the page (optional, additive). */
    now?: VcPlayingItem;
    /** Richer near-term lookahead for the page (optional, additive). This is
     *  the song timeline — distinct from {@link VcScheduleEntry}, which is the
     *  show's operating-hours summary. */
    upcoming?: VcPlayingItem[];
    [k: string]: unknown;
}

/** A summarized, viewer-safe schedule entry for the public page (calendar).
 *  Used for two distinct feeds on `VcPublicShowState`: `schedule` (show
 *  operating hours) and `requestWindows` (when the request/vote line is open).
 *  Deliberately loose so the calendar UI can evolve without churning this
 *  type. Display data for the page. */
export interface VcScheduleEntry {
    title?: string;
    /** Player's choice of ISO-8601 or `HH:MM`; the calendar UI interprets. */
    start: string;
    end: string;
    /** 0=Sun .. 6=Sat for weekly recurrence, when applicable. */
    daysOfWeek?: number[];
    [k: string]: unknown;
}

/** Why a request/vote was refused — the closed set of refusal reasons
 *  returned on the wire. */
export type VcSelectionReason =
    | 'mode-off'
    | 'unknown-song'
    | 'anonymous-not-allowed'
    | 'already-selected'
    | 'in-cooldown'
    | 'duplicate'
    | 'viewer-limit'
    | 'queue-full';

/** Body of `POST /api/show/:short_name/{request,vote}`. */
export interface VcSelectionRequest {
    songId: string;
}

/** Result of a request/vote. */
export interface VcSelectionOutcome {
    accepted: boolean;
    reason?: VcSelectionReason;
    /** Set when accepted in request mode. */
    queuePosition?: number;
    /** Set when accepted in vote mode (the song's tally after the vote). */
    voteCount?: number;
}

/** One song as the public page sees it (live state joined with display
 *  metadata). */
export interface VcPublicSong {
    id: string;
    title: string;
    artist?: string;
    artwork?: string;
    queued: boolean;
    queuePosition?: number;
    /** Present in vote mode. */
    votes?: number;
    /** Selectable now (not playing/next, not in cooldown). */
    eligible: boolean;
    /** This viewer already requested/voted this specific song. */
    actedByViewer: boolean;
    [k: string]: unknown;
}

/** The public, credential-free state of a show. No `user_id`, no token —
 *  the viewer plane only ever knows `short_name`. Returned by
 *  `GET /api/show/:short_name/state` and pushed over the live WS. */
export interface VcPublicShowState {
    showName?: string;
    /** Configured interaction mode — independent of whether it's open now. */
    mode: 'off' | 'request' | 'vote';
    /** The player is reporting to the cloud (reachable / checked in recently). */
    online: boolean;
    /** A sequence is playing right now. */
    showRunning: boolean;
    /** The request/vote line is currently accepting input. */
    requestsOpen: boolean;
    nowPlaying?: VcPlayingItem;
    nextUp?: VcPlayingItem;
    /** The planned upcoming song lineup ("what's coming"), when supplied. */
    upcoming?: VcPlayingItem[];
    /** Show operating hours — when the show plays. */
    schedule?: VcScheduleEntry[];
    /** When the request/vote line is open — distinct from operating hours. */
    requestWindows?: VcScheduleEntry[];
    /** Interactive request/vote offering (the active viewer-control window). */
    songs: VcPublicSong[];
    /** Static "songs you may hear" catalog — the player's jukebox-filtered
     *  sequence list, independent of viewer control. Display-only; `artwork` is
     *  the cloud's per-song proxy URL (same mechanism as now-playing). */
    catalog?: VcSong[];
    /** This viewer has spent their action (vote mode); page disables controls. */
    viewerHasActed: boolean;
    [k: string]: unknown;
}
