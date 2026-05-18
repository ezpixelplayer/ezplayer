/**
 * Viewer-control wire DTOs — the shared contract between the player poller,
 * the cloud viewer-control API, and the public show page.
 *
 * Shapes deliberately echo the existing UI/player structures (`SongDetails`,
 * `SequenceRecord.id`, `PlayingItem`) so a viewer-control payload looks like
 * the rest of the app. Several types carry an index signature: they cross
 * process boundaries and must grow additively without a breaking version
 * churn.
 */

/** A song the player offers for viewer control. `id` is the stable song
 *  identifier (equal to `SequenceRecord.id`); the rest mirrors `SongDetails`
 *  for display on the public page. */
export interface VcSong {
    id: string;
    title: string;
    artist?: string;
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

/** A summarized, viewer-safe show-schedule entry for the public page (future
 *  calendar). Deliberately loose: the player decides what the summary means
 *  (operating windows vs viewer-control windows) and the calendar UI evolves
 *  without churning this type. Display data for the page. */
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
    /** Effective mode: `'off'` when disabled or not live. */
    mode: 'off' | 'request' | 'vote';
    /** Player pushed recently and a mode is active. */
    live: boolean;
    nowPlaying?: VcPlayingItem;
    nextUp?: VcPlayingItem;
    /** Richer near-term song lookahead, when the player supplies it. */
    upcoming?: VcPlayingItem[];
    /** Show-hours summary for the page (future calendar). */
    schedule?: VcScheduleEntry[];
    songs: VcPublicSong[];
    /** This viewer has spent their action (vote mode); page disables controls. */
    viewerHasActed: boolean;
    [k: string]: unknown;
}
