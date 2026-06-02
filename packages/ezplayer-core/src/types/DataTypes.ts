export interface EZPlayerVersions {
    name: string;
    version: string;
    arch: string;
    builtAtIso: string;
    git: { [key: string]: string };
    packages: { [pkg: string]: string };
    processes: { [proc: string]: string | undefined };
}

export interface SongDetails {
    title: string;
    artist: string;
    length: number;
    description?: string;
    tags?: string[];
    genre?: string;
    artwork?: string;
    music_url?: string;
    video_url?: string;
}

export interface SequenceDetails {
    vendor: string;
    variant?: string;
    sku?: string;
    vendor_url?: string;
    preview_url?: string;
}

export interface SequenceSettings {
    volume_adj?: number;
    lead_time?: number;
    trail_time?: number;
    tags?: string[];
}

export interface SequenceFiles {
    audio?: string;
    fseq?: string;
    video?: string;
    thumb?: string;
}

/** Identifiers for a cloud-sourced file currently installed in the show folder.
 *  Used by the cloud content sync to detect when a sequence's bytes have gone
 *  stale relative to the manifest. */
export interface CloudFileIdent {
    file_id: string;
    file_time: number;
}

export interface CloudSequenceMeta {
    fseq?: CloudFileIdent;
    audio?: CloudFileIdent;
    thumb?: CloudFileIdent;
}

export interface SequenceRecord {
    instanceId: string;
    id: string;
    work: SongDetails;
    sequence?: SequenceDetails;
    settings?: SequenceSettings;
    files?: SequenceFiles;
    updatedAt?: number;
    deleted?: boolean;
    /** Set on sequences installed by the cloud content worker. */
    cloud?: CloudSequenceMeta;
    /** Lineage to the upstream source. Lets the materializer detect
     *  "I already have a record for this grant" and the sync layer overlay
     *  render-state from `user_seq_render`. `'manual'` records (no upstream)
     *  carry no `source_id`. */
    source_kind?: 'vendor' | 'user_upload' | 'manual';
    /** ID within the source — `vsequence_id` for vendor grants, file id for
     *  user uploads, undefined for manual records. */
    source_id?: string;
    /** Computed at sync time from `user_seq_render.enabled`. `false` means
     *  the user has suspended the sequence — clients hide it from playlists,
     *  jukebox, etc. (same handling as `deleted`, but user-reversible). Not
     *  persisted on the show-builder side; the source of truth is the
     *  `user_seq_render` row. */
    render_enabled?: boolean;
}

export interface PlaylistItem {
    id: string; // Sequence ID
    sequence: number;
}

export interface PlaylistRecord {
    duration?: string;
    id: string; // Playlist ID
    title: string;
    tags: string[];
    items: PlaylistItem[];
    createdAt: number;
    updatedAt?: number;
    deleted?: boolean;
    /** Suspend without delete (same Halloween-vs-Christmas pattern as
     *  `SequenceRecord.render_enabled`). Persisted directly on the record.
     *  `undefined` means enabled; clients hide entries with `enabled===false`
     *  but are responsible for graceful handling if the suspended item is
     *  currently in-flight. */
    enabled?: boolean;
}

export type ScheduleEndPolicy = 'seqboundearly' | 'seqboundlate' | 'seqboundnearest' | 'hardcut';

export interface ScheduledPlaylist {
    scheduleType?: 'main' | 'background';
    baseScheduleId?: string;
    recurrenceRule?: RecurrenceRule;
    id: string;
    playlistId: string;
    prePlaylistId?: string;
    postPlaylistId?: string;
    title: string;
    date: number;
    fromTime: string;
    toTime: string;
    playlistTitle: string; // Materialized join?
    duration: number;
    recurrence?: string; // TODO CRAZ we have exceptions to this... 'daily' | 'weekly' | 'monthly' | 'custom';
    width?: string;
    left?: string;
    repeatDays?: string[];
    updatedAt?: number;
    deleted?: boolean;
    shuffle?: boolean;
    loop?: boolean;
    hardCutIn?: boolean; // Set to cause a sequence to preempt others immediately rather than gracefully
    preferHardCutIn?: boolean; // Set on, say, static, to allow others to preempt immediately
    endPolicy?: ScheduleEndPolicy; // For schedules over alotted time, how to end?
    keepToScheduleWhenPreempted?: boolean; // Keep "running" when overriden
    priority?: 'high' | 'normal' | 'low';
    /** Suspend without delete; same semantics as `PlaylistRecord.enabled`. */
    enabled?: boolean;
}

interface RecurrenceRule {
    frequency: 'daily' | 'weekly';
    byWeekDay?: string[];
    startDate: number;
    endDate: number;
}

export type PlaylistTags = string[];

export interface PlayingItem {
    type: 'Scheduled' | 'Immediate' | 'Queued';
    item: 'Song' | 'Playlist' | 'Schedule';
    title: string;
    at?: number;
    until?: number;
    priority?: number;
    request_id?: string;
    sequence_id?: string;
    playlist_id?: string;
    schedule_id?: string;
}

export interface PlayerPStatusContent {
    // P - Player
    ptype: 'EZP' | 'FPP'; // FPP or EZP
    status:
        | 'Playing' // EZP: Playing
        | 'Stopping' // EZP: Graceful stop happening
        | 'Stopped' // EZP: Stopped due to stop request
        | 'Paused' // EZP: Paused - time is not advancing
        | 'Suppressed' // EZP: Time advancing, but not emitting the sound/light
        | 'Up' // FPP: online heartbeat (no playback semantics)
        | 'Down'; // FPP: offline / unreachable

    reported_time: number;
    now_playing?: PlayingItem;
    upcoming?: PlayingItem[];
    immediate?: PlayingItem;
    queue?: PlayingItem[];
    suspendedItems?: PlayingItem[];
    preemptedItems?: PlayingItem[];

    volume?: {
        level: number; // 0-100
        muted?: boolean;
    };

    /** Files pinned by currently-loaded playback (foreground + background), as stored
     *  on the sequence records (may be show-relative). The main process unions this
     *  with the current records to decide which cloud files are safe to GC. */
    referencedFiles?: string[];

    // TODO: system status, storage, memory, temp, etc?

    // Statistics currently sent separately - PlaybackStatistics
    //   TODO figure out how to make sure that gets reflected...
}

/** Manifest entry returned by the cloud's per-player sequence list endpoint
 *  (currently /fppapi/player/getseqforplayer/:token). One per sequence the
 *  player is entitled to. The sub-records identify each downloadable file
 *  by an opaque file_id and a file_time used for staleness checks. */
export interface CloudSeqManifestEntry {
    id: string;
    user_id: string;
    vseq_id: string;
    title: string;
    artist: string;
    /** Vendor display string. Optional; cloud may not always provide it. */
    vendor?: string;
    duration_ms?: number;
    fseq?: { file_id: string; file_time: number };
    audio?: { file_id: string; file_time: number };
    xsqz?: { file_id: string; file_time: number };
    pvid?: { file_id: string; file_time: number };
    /** Direct (presigned) thumbnail URL when available. */
    thumb?: string;
}

/** Per-sequence projection of the in-flight cloud sync. The UI rolls up status
 *  from the per-file entries; this struct is just identity + which files belong. */
export interface CloudSequenceProgress {
    vseq_id: string;
    title: string;
    artist: string;
    vendor?: string;
    /** file_ids of every file the manifest lists for this sequence (fseq/audio/thumb). */
    fileIds: string[];
}

/** Per-file status used by the cloud content sync. */
export type CloudFileKind = 'fseq' | 'audio' | 'thumb';
export type CloudFileStatus =
    | 'known' // listed in manifest, nothing started yet
    | 'downloading' // fetch in progress
    | 'staged' // bytes on disk under .ezplayer/cloud, not yet promoted
    | 'installed' // active in show folder root, sequence record updated
    | 'error'; // last attempt failed

export interface CloudFileEntry {
    vseq_id: string;
    kind: CloudFileKind;
    file_id: string;
    file_time?: number;
    filename?: string;
    status: CloudFileStatus;
    bytes?: number;
    totalBytes?: number;
    error?: string;
}

export interface PlayerCStatusContent {
    // C - Content
    n_sequences?: number;
    n_needing_download?: number;
    sequence_sync_time?: number;
    n_playlists?: number;
    n_schedules?: number;
    schedule_sync_time?: number;

    // Cloud content sync (worker-driven)
    files?: Record<string, CloudFileEntry>; // keyed by file_id
    sequences?: Record<string, CloudSequenceProgress>; // keyed by vseq_id
    layout?: CloudLayoutInfo;
    lastManifestAt?: number;
    lastError?: string;
    /** True when the circuit breaker has tripped after consecutive download failures. */
    halted?: boolean;
}

export type CloudLayoutStatus =
    | 'idle'
    | 'fetching' // downloading zip and/or xml files
    | 'unpacking' // extracting zip
    | 'uploading' // packing + sending zip to cloud
    | 'done'
    | 'noLayout' // cloud reported no layout available
    | 'error';

export interface CloudLayoutInfo {
    status: CloudLayoutStatus;
    /** Whether the most recent activity was a download or upload — disambiguates
     *  the shared `done` / `error` states for the UI. */
    direction?: 'download' | 'upload';
    /** Bytes transferred this fetch/upload. */
    bytes?: number;
    /** Total bytes for the current transfer, when known. */
    totalBytes?: number;
    /** Epoch ms of last successful download. */
    lastFetchedAt?: number;
    /** Epoch ms of last successful upload. */
    lastUploadedAt?: number;
    error?: string;
}

export interface ControllerStatus {
    name?: string;
    description?: string;
    type?: string;
    proto?: string;
    protoDetails?: string;
    model?: string;
    address?: string;
    state?: 'Active' | 'Inactive' | 'xLights Only' | 'Unknown';
    status?: 'open' | 'skipped' | 'error' | 'unusable';
    notices?: string[];
    errors?: string[];
    connectivity?: 'Up' | 'Down' | 'Pending' | 'N/A';
    pingSummary?: string;
    reported_time?: number;
    startCh?: number; // 1-based start channel within the fseq channel array
    nCh?: number; // Channel count owned by this controller
}

export interface PlayerNStatusContent {
    // N - Network / coNtroller
    controllers?: ControllerStatus[];
    n_models?: number;
    n_channels?: number;
}

export interface CombinedPlayerStatus {
    player_token?: string;
    player_updated?: number;
    player?: PlayerPStatusContent;
    content_updated?: number;
    content?: PlayerCStatusContent;
    controller_updated?: number;
    controller?: PlayerNStatusContent;

    show?: {
        show_name?: string;
    };
}

export interface PrefetchCacheStats {
    totalItems: number;
    referencedItems: number;
    readyItems: number;
    pendingItems: number;
    errorItems: number;
    inProgressItems: number;

    budget: number;
    used: number;

    refHitsCumulative: number;
    refMissesCumulative: number;
    expiredItemsCumulative: number;
    evictedItemsCumulative: number;

    completedRequestsCumulative: number;
    erroredRequestsCumulative: number;
}

export interface PlaybackStatistics {
    iteration: number;

    // Errors (TODO Improve)
    lastError: string | undefined;

    // Timing Distribution
    measurementPeriod: number;
    idleTimePeriod: number;
    sendTimePeriod: number;
    // Presumably, the rest is other things...

    // Timing Stability
    worstLagHistorical: number;
    worstAdvanceHistorical: number;

    // Frame Timings
    avgSendTime: number;
    maxSendTimeHistorical: number;

    // Frame delivery
    missedFramesCumulative: number;
    missedHeadersCumulative: number;
    missedBackgroundFramesCumulative: number;
    sentFramesCumulative: number;
    skippedFramesCumulative: number;
    framesSkippedDueToManyOutstandingFramesCumulative: number;

    // Skipped controller frames
    cframesSkippedDueToDirectiveCumulative: number;
    cframesSkippedDueToIncompletePriorCumulative: number;

    // Audio delivery
    sentAudioChunksCumulative: number;
    skippedAudioChunksCumulative: number;

    // Audio Decode
    audioDecode?: {
        fileReadTimeCumulative: number;
        decodeTimeCumulative: number;
    };

    // Sequence Decompress
    sequenceDecompress?: {
        fileReadTimeCumulative: number;
        decompressTimeCumulative: number;
    };

    // Effects Processing
    effectsProcessing?: {
        backgroundBlendTimePeriod: number;
    };

    // FSEQ Cache
    fseqPrefetch?: {
        totalMem: number;
        headerCache: PrefetchCacheStats;
        chunkCache: PrefetchCacheStats;
    };

    // Audio decode cache
    audioPrefetch?: {
        decodeCache: PrefetchCacheStats;
    };
}

export type EZPlayerCommand =
    | {
          command: 'reloadcontrollers'; // Reset playback from current show folder, reloading network, and reopening controllers
      }
    | {
          command: 'resetplayback'; // Reread and reset playback from current schedule items
      }
    | {
          command: 'resetstats'; // Reset cumulative stats counters
      }
    | {
          command: 'stopnow'; // Stop all playing
      }
    | {
          command: 'stopgraceful'; // Stop all playing, at convenient spot
      }
    | {
          command: 'pause'; // Pause all playback
      }
    | {
          command: 'resume'; // Resume playback
      }
    | {
          command: 'suppressoutput'; // Playback continues, but not audio / video not sent out
      }
    | {
          command: 'activateoutput'; // Playback continues, but not audio / video not sent out
      }
    | {
          command: 'playsong'; // Play or enqueue a song
          songId: string;
          immediate: boolean; // If false, enqueue
          priority: number; // Allows precedence over RF, lower is higher priority
          requestId: string; // To identify, for canceling
      }
    | {
          command: 'endsong'; // End song (skip to next)
          songId?: string;
      }
    | {
          command: 'playplaylist'; // Play or enqueue a playlist
          playlistId: string;
          immediate: boolean;
          priority: number; // Allows precedence over RF, lower is higher priority
          requestId: string; // To identify, for canceling
      }
    | {
          command: 'deleterequest';
          requestId: string; // Identity, for canceling, of a song or a
      }
    | {
          command: 'clearrequests'; // Clear all requests
      }
    | {
          command: 'setvolume';
          volume?: number;
          mute?: boolean;
      };

export type ScheduleDays =
    | 'all'
    | 'weekend-fri-sat'
    | 'weekend-sat-sun'
    | 'weekday-mon-fri'
    | 'weekday-sun-thu'
    | 'monday'
    | 'tuesday'
    | 'wednesday'
    | 'thursday'
    | 'friday'
    | 'saturday'
    | 'sunday';

export interface ViewerControlScheduleEntry {
    id: string;
    days: ScheduleDays;
    startTime: string; // HH:MM format
    endTime: string; // HH:MM format (can exceed 24:00)
    playlist: string;
}

export interface VolumeScheduleEntry {
    id: string;
    days: ScheduleDays;
    startTime: string; // HH:MM format
    endTime: string; // HH:MM format (can exceed 24:00)
    volumeLevel: number; // 0-100
}

/** A single allowed-window for cloud content polling. Same shape as the other
 *  schedule entries but no per-window payload — being inside the window IS the
 *  payload (= "polling allowed"). */
export interface CloudPollScheduleEntry {
    id: string;
    days: ScheduleDays;
    startTime: string; // HH:MM
    endTime: string; // HH:MM
}

export interface ViewerControlState {
    enabled: boolean;
    /** `'ezplayer'` = the built-in EZPlayer viewer control. Unlike
     *  `'remote-falcon'` it needs no token here — it uses the player's
     *  existing cloud identity — and reuses `schedule` for the live window. */
    type: 'disabled' | 'remote-falcon' | 'ezplayer';
    remoteFalconToken?: string;
    schedule: ViewerControlScheduleEntry[];
}

export interface VolumeControlState {
    defaultVolume: number;
    schedule: VolumeScheduleEntry[];
}

export interface JukeboxSettings {
    /**
     * Tags that always exclude a song from the jukebox.
     * Matching is intended to be case-insensitive on the client.
     */
    excludedTags?: string[];
    /**
     * If empty/undefined: no "include" filtering is applied (all songs allowed except excluded ones).
     * If present: only songs matching at least one tag are allowed (after excluded-tags filtering).
     */
    includedTags?: string[];
}

export interface PlaybackSettings {
    audioSyncAdjust?: number;
    backgroundSequence?: 'overlay' | 'underlay';
    viewerControl: ViewerControlState;
    volumeControl: VolumeControlState;
    jukebox?: JukeboxSettings;
}

/** The "playback" cloud-managed settings group — the part of PlaybackSettings
 *  that isn't its own group (volume / viewer control). */
export type PlaybackGroupSettings = Pick<PlaybackSettings, 'audioSyncAdjust' | 'backgroundSequence' | 'jukebox'>;

/** Cloud-managed player settings as served by `getsettingsforplayer`: three
 *  groups, each paired with an epoch-ms `*_updated` stamp. A group/stamp pair
 *  is `undefined` when never set in the cloud. One-way (show-builder → player);
 *  the player adopts each group by per-group last-write-wins against a locally
 *  persisted stamp. */
export interface CloudPlayerSettings {
    playback_settings?: PlaybackGroupSettings;
    playback_settings_updated?: number;
    volume_control?: VolumeControlState;
    volume_control_updated?: number;
    viewer_control_state?: ViewerControlState;
    viewer_control_state_updated?: number;
}

/** Per-file identity for the layout files we have on disk. Lets the worker decide
 *  whether the cloud's manifest entry is newer than what we have, by both id and time. */
export interface LayoutFileMeta {
    file_id: string;
    file_time: number;
}

/** Persisted-in-show-folder cloud configuration. Empty strings mean "not configured / cleared". */
export interface CloudConfig {
    cloudServiceUrl: string;
    playerIdToken: string;
    /**
     * Who owns this show folder's layout. `'xlights'` (or absent) = the user manages
     * `xlights_rgbeffects.xml` / `xlights_networks.xml` themselves; the cloud worker
     * does not touch them. `'cloud'` = the worker downloads layout from the cloud and
     * writes those files into the folder root.
     */
    layoutSource?: 'xlights' | 'cloud';
    /** Whether the cloud worker should be active. Default true. False keeps the
     *  configured URL/token but suspends polling and downloads — the user can
     *  flip back without re-entering anything. */
    cloudEnabled?: boolean;
    /** When the worker is enabled, how aggressively it polls content. `'always'`
     *  polls on the configured cadence. `'scheduled'` polls only when current
     *  local time is inside any window in `cloudPollSchedule`. Registration
     *  heartbeat polling is unaffected — it always runs when enabled. Absent
     *  defaults to `'always'`. */
    cloudPollMode?: 'always' | 'scheduled';
    /** Whitelist windows for content polling under `'scheduled'` mode.
     *  Overlapping windows just merge into a longer "on" period. */
    cloudPollSchedule?: CloudPollScheduleEntry[];
    /** Per-folder polling cadence overrides. Absent fields fall back to worker
     *  defaults (which are demo-aggressive — production should set these). */
    cloudPollIntervals?: {
        registrationMs?: number;
        manifestMs?: number;
    };
    /** Last-known cloud file_id/file_time for each layout file we've successfully
     *  downloaded. Drives staleness checks so we skip redundant downloads. */
    layoutMeta?: {
        zip?: LayoutFileMeta;
        rgbeffects?: LayoutFileMeta;
        networks?: LayoutFileMeta;
        lastFetchedAt?: number;
    };
}

/** In-memory cloud connectivity status owned by node main. Pushed; never persisted. */
export interface CloudStatus {
    /** True if the cloud confirms this player ID is registered to a user. */
    playerIdIsRegistered: boolean;
    /** Reported by the cloud during the registration check. */
    cloudVersion?: string;
    /** Epoch ms of the last poll reply (success or graceful error). */
    lastCheckedAt?: number;
    /** Last error string from the polling loop. Cleared on the next success. */
    lastError?: string;
}

/// Player full state & websocket sync
export type FullPlayerState = {
    showFolder?: string;
    sequences?: SequenceRecord[];
    playlists?: PlaylistRecord[];
    schedule?: ScheduledPlaylist[];
    cStatus?: PlayerCStatusContent;
    pStatus?: PlayerPStatusContent;
    nStatus?: PlayerNStatusContent;
    playbackSettings?: PlaybackSettings;
    playbackStatistics?: PlaybackStatistics;
    versions?: EZPlayerVersions;
    cloudConfig?: CloudConfig;
    cloudStatus?: CloudStatus;
};

export type PlayerWebSocketSnapshot = {
    type: 'snapshot';
    v: { [K in keyof FullPlayerState]: number };
    data: Partial<FullPlayerState>;
};

export type PlayerWebSocketPing = {
    type: 'ping';
    now: number;
};

export type PlayerWebSocketKick = {
    type: 'kick';
    reason: string;
};

/** Emitted by the cloud bridge (never by the player itself) to tell viewers
 *  whether the player↔cloud bridge socket is currently up. Cloud sends one
 *  on viewer connect with the current state, and one to all viewers each
 *  time the player WS connects or disconnects at the bridge. */
export type PlayerWebSocketBridgeStatus = {
    type: 'bridgeStatus';
    playerConnected: boolean;
};

export type PlayerWebSocketMessage =
    | PlayerWebSocketSnapshot
    | PlayerWebSocketPing
    | PlayerWebSocketKick
    | PlayerWebSocketBridgeStatus;

/** HTTP-over-WS proxy: lazy fetch of binary/large artifacts (thumbnails,
 *  3D meshes, layout XML caches) over a dedicated WS that's separate from
 *  the status WS so big payloads don't head-of-line block snapshots/pings.
 *
 *  Cloud-endpoint authenticates the upgrade then is a near-transparent
 *  pipe — it reads `reqId` to route player→viewer responses, but doesn't
 *  inspect status/headers/body. v1 sends the full body in one envelope;
 *  chunked variants (`httpProxyChunk` + `httpProxyEnd`) can be added later
 *  without breaking this shape since they're a separate `type`. */
export type HttpProxyRequest = {
    type: 'httpProxyRequest';
    reqId: string;
    method: 'GET';
    /** Path on the player's local Koa, e.g. `/api/getimage/:id`. */
    path: string;
    query?: Record<string, string>;
};

export type HttpProxyResponse = {
    type: 'httpProxyResponse';
    reqId: string;
    status: number;
    headers?: Record<string, string>;
    /** Base64-encoded body. permessage-deflate on the proxy WS recovers
     *  most of the 33% base64 overhead for text/JSON; PNG/JPG stays as-is.
     *  Empty string / omitted for status-only responses (204, redirects)
     *  *and* for chunked responses — body data then arrives via subsequent
     *  `httpProxyChunk` messages. */
    bodyBase64?: string;
    /** When true, body data follows in `httpProxyChunk` messages with the
     *  same `reqId`, terminated by one with `end: true`. Used when a single
     *  WS frame would be too large (multi-MB OBJ files, big XML caches). */
    chunked?: boolean;
};

export type HttpProxyChunk = {
    type: 'httpProxyChunk';
    reqId: string;
    /** 0-based sequence within this reqId's chunk stream. */
    seq: number;
    /** Base64-encoded chunk body. */
    bodyBase64: string;
    /** When true, this is the final chunk; no more arrive for this reqId. */
    end?: boolean;
};

/** Verbs the renderer can ask the player's cloud worker (or the cloud app's local
 *  cloud-state manager) to perform. Modeled on `EZPlayerCommand`: a discriminated
 *  union dispatched through one umbrella API (`issueCloudCommand`) instead of a
 *  separate IPC/RPC/WS plumb per verb. New commands add a variant here plus a case
 *  in main's `dispatchCloudCommand` (and, on cloud-app surfaces, a case in
 *  `CloudDataStorageAPI.issueCloudCommand`). */
export type CloudCommand =
    | { type: 'syncNow' } // immediate manifest + content sync
    | { type: 'fetchLayoutNow' } // immediate layout download
    | { type: 'uploadLayoutNow' } // immediate layout upload
    | { type: 'pollNow' } // immediate registration heartbeat
    | { type: 'setPlayerIdToken'; token: string } // persist + reconfigure
    | { type: 'setCloudServiceUrl'; url: string } // persist + reconfigure
    | { type: 'setLayoutSource'; mode: 'xlights' | 'cloud' } // persist mode flip
    | { type: 'setCloudEnabled'; enabled: boolean } // pause/resume cloud activity
    | {
          /** Update polling configuration. Any field that's omitted is preserved (so
           *  callers can change one knob without re-sending the others). To clear the
           *  schedule explicitly, pass an empty array — `undefined` preserves it. */
          type: 'setCloudPolling';
          mode?: 'always' | 'scheduled';
          schedule?: CloudPollScheduleEntry[];
          intervals?: { registrationMs?: number; manifestMs?: number };
      };

// `playerCommand` / `settings` / `updatePlaylists` / `updateSchedule` mirror
// the LAN-side HTTP endpoints over the WS so cloud viewers (no HTTP route
// to the player) can drive playback and edits too.
export type PlayerClientWebSocketMessage =
    | { type: 'pong'; now: number }
    | { type: 'subscribe'; keys: (keyof FullPlayerState)[] }
    | { type: 'cloudCommand'; cmd: CloudCommand }
    | { type: 'playerCommand'; cmd: EZPlayerCommand }
    | { type: 'settings'; settings: PlaybackSettings }
    | { type: 'updatePlaylists'; data: PlaylistRecord[] }
    | { type: 'updateSchedule'; data: ScheduledPlaylist[] };

/// Cloud check-in (lightweight heartbeat + command pickup)

/** Bridge-lifecycle commands the cloud emits in the checkin response.
 *  Distinct from `CloudCommand` (those ride the WS once a bridge exists). */
export type OutOfBandCommand =
    | {
          type: 'openCloudWS';
          /** Optional override URL. Omitted in v1; player synthesizes from
           *  its own cloudUrl since cloud-side host detection is unreliable
           *  behind ingress. Reserved for future shard routing. */
          wsUrl?: string;
          /** Parallel WS for HTTP-over-WS proxy traffic (lazy fetches of
           *  thumbnails, layout XML, 3D files). Same auth boundary as wsUrl;
           *  player synthesizes alongside wsUrl for the same reason. */
          proxyWsUrl?: string;
          /** Parallel WS for live-audio push (player→cloud→listener). Lets
           *  the player push each chunk the moment it's produced instead of
           *  waiting for a poll, and keeps audio frames off the status WS
           *  where they'd head-of-line block snapshots. */
          audioWsUrl?: string;
          sessionId: string;
          ttlSeconds: number;
      }
    | {
          type: 'closeCloudWS';
          /** Absent → close any current bridge. */
          sessionId?: string;
      }
    | {
          /** The cloud has no live viewer-control state for this player's
           *  show (e.g. it restarted). Tells the player to forget its vc/*
           *  dedup and re-push a full snapshot so the viewer page recovers
           *  without waiting for the next song/schedule change. */
          type: 'vcResync';
      };

/** POST /api/player/checkin/:token body — all fields optional (empty body is
 *  a valid command-poll). Present fields update last_* timestamps and feed
 *  the show-builder Players pane. */
export interface PlayerCheckinRequest {
    now?: number;
    currentlyPlaying?: string;
    lastLayoutSync?: number;
    lastContentSync?: number;
    contentSummary?: {
        n_sequences?: number;
        n_playlists?: number;
        n_schedules?: number;
    };
    halted?: boolean;
    lastError?: string;
    /** The player's current registration-poll interval (ms). The Players pane
     *  uses ~2× this as the "live" cutoff — beyond that it shows "unknown".
     *  Optional; consumers fall back to a 60s default. */
    pollIntervalMs?: number;
}

export interface PlayerCheckinResponse {
    registered: boolean;
    commands?: OutOfBandCommand[];
}

/** One candidate the cloud presents to a player at startup-time home-server
 *  election. The player measures RTT to each candidate's `/healthz`, then
 *  picks one and reports it back via `electHomeServer`. */
export interface CandidateServerSummary {
    /** Stable opaque key — what the player reports back when electing. */
    key: string;
    /** Public URL to use for `/healthz` probes and (once elected) for
     *  cloud-bridge WS connections. No trailing slash. */
    url: string;
    /** Coarse region tag. The cloud may pre-filter the list down to one
     *  region if the user has a preferred region pinned. */
    region: string;
    /** 0..1 load score. Higher = busier. Selectors should avoid >= 0.95
     *  servers unless every candidate is over that threshold. */
    load_hint: number;
    /** How long since the cloud last heard from this server, in seconds.
     *  Lower = fresher. The cloud only returns servers within its registry
     *  prune window, so this is bounded. */
    last_seen_ago_secs: number;
}

/** Response shape for `GET /api/player/candidateServers/:player_token`. */
export interface CandidateServersResponse {
    /** Currently bound key on this player's row, if any. If this is still
     *  in `candidates`, the player should keep it unless it's drained or
     *  the player has just become unreachable from it. */
    current_key?: string;
    candidates: CandidateServerSummary[];
}

/** POST body for `/api/player/electHomeServer/:player_token`. */
export interface ElectHomeServerRequest {
    /** A `key` from a recent `candidateServers` response. */
    key: string;
}

/** Response shape for `POST /api/player/electHomeServer/:player_token`. */
export interface ElectHomeServerResponse {
    ok: true;
    /** The public URL the cloud has on file for the chosen key — same one
     *  the player just probed, returned for confirmation. */
    url: string;
}

/// Layout Edit

export interface JSONEditChoice {
    title: string;
    value?: string;
    choices?: JSONEditChoice[];
}

export interface JSONEditProp {
    value: string;
    choices: JSONEditChoice[];
}

export interface JSONEditHeader {
    title: string;
    key: string;
    fieldActiveWhenAllOf?: {
        anyOf: {
            key: string;
            equals?: string;
            notEquals?: string;
        }[];
    }[];

    fieldType: 'choice' | 'checkbox' | 'text' | undefined;

    allowsNone: boolean;
}

export interface JSONEditItem {
    name: string;
    values: {
        [key: string]: {
            defvalue: string;
            required: boolean;
            choiceid?: string;
        };
    };
}

export type JSONEditState = {
    [name: string]: { enabled: boolean; values: { [key: string]: string } };
};

export interface JSONEditSheet {
    headers: JSONEditHeader[];
    items: JSONEditItem[];
    choices: { [choiceid: string]: JSONEditChoice[] };
    selections: JSONEditState;
}
