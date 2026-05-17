/**
 * In-house viewer-control **wire DTOs** — the shared contract between the
 * player poller (worker thread), the cloud computations / API endpoints, and
 * the public viewer page. Lives here in `@ezplayer/ezplayer-core` (not in
 * `@ezplayer/builder-core`) on purpose: the player must never depend on
 * builder-core, which carries the cloud-only policy engine. builder-core owns
 * the *engine* (policy + runtime state); this file owns the *wire*.
 *
 * Shapes deliberately echo the existing UI/player structures (`SongDetails`,
 * `SequenceRecord.id`, `PlayingItem`) so a viewer-control payload looks like
 * the rest of the app. Several types carry an index signature: these cross
 * three process boundaries and must grow additively without a breaking
 * version churn.
 */

/** A song the player offers for viewer control. `id` is the sequence id
 *  (the engine's opaque key — equal to `SequenceRecord.id`); the rest mirrors
 *  `SongDetails` for display on the public page. */
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
 *  timeline straight onto the wire. Display-only — the engine never reads it. */
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
 * player may send only the two opaque dedupe keys; tomorrow it can add the
 * richer `now` / `upcoming` timeline with times and durations without a wire
 * break. The engine only ever consumes `nowPlaying` / `nextScheduled` (as
 * opaque song ids); everything else is display data for the page.
 */
export interface VcPlayingUpdate {
    /** Currently-playing song id — the engine's now-playing dedupe key. */
    nowPlaying?: string;
    /** Immediate next song id — the engine's next-up dedupe key. */
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
 *  without churning this type. Engine never sees this — display data. */
export interface VcScheduleEntry {
    title?: string;
    /** Player's choice of ISO-8601 or `HH:MM`; the calendar UI interprets. */
    start: string;
    end: string;
    /** 0=Sun .. 6=Sat for weekly recurrence, when applicable. */
    daysOfWeek?: number[];
    [k: string]: unknown;
}

/** Why a request/vote was refused. Intentionally mirrors builder-core's
 *  `SelectionRejectReason` — that is the engine-internal enum; this is its
 *  wire image so the viewer never has to depend on builder-core. Keep the
 *  two in sync. */
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

/** Result of a request/vote. Wire image of the engine's selection outcome. */
export interface VcSelectionOutcome {
    accepted: boolean;
    reason?: VcSelectionReason;
    /** Set when accepted in request mode. */
    queuePosition?: number;
    /** Set when accepted in vote mode (the song's tally after the vote). */
    voteCount?: number;
}

/** One song as the public page sees it (engine view joined with display
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
