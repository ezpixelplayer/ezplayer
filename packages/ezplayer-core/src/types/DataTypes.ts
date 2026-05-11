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
    type: 'disabled' | 'remote-falcon';
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

export type PlayerWebSocketMessage = PlayerWebSocketSnapshot | PlayerWebSocketPing | PlayerWebSocketKick;

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

export type PlayerClientWebSocketMessage =
    | { type: 'pong'; now: number }
    | { type: 'subscribe'; keys: (keyof FullPlayerState)[] }
    | { type: 'cloudCommand'; cmd: CloudCommand };

/// Cloud check-in (lightweight heartbeat + command pickup)

/** Out-of-band commands the cloud delivers in the checkin response. These
 *  control the cloud-bridge lifecycle (currently: should the player open a
 *  WebSocket bridge to the cloud?). They are deliberately distinct from
 *  `CloudCommand`, which is the in-band UI/IPC verb set delivered through the
 *  WS/IPC layer. New out-of-band commands add a variant here plus a handler
 *  in cloudpollparent. */
export type OutOfBandCommand =
    | {
          type: 'openCloudWS';
          /** Optional override URL to dial. v1: omitted by the cloud; player
           *  synthesizes `${cloudUrl}api/player/wsBridge?…` from its own
           *  config. Reason: a cloud server behind a load balancer / ingress
           *  often doesn't see its own public hostname (`ctx.host` resolves
           *  to an internal upstream IP); the player already knows where it
           *  polled and that's the authoritative answer. Field kept for
           *  future shard-routing where the cloud directs to a specific
           *  node URL. */
          wsUrl?: string;
          /** One-shot session id the bridge will use to correlate the player and
           *  the browser viewer. Player echoes this in its WS handshake. */
          sessionId: string;
          /** TTL (seconds) before this command is stale; if the player hasn't
           *  connected within the TTL it should give up rather than racing
           *  against a viewer that has since closed. Subsequent checkins
           *  re-issue the command with a fresh TTL while the viewer remains. */
          ttlSeconds: number;
      }
    | {
          type: 'closeCloudWS';
          /** sessionId matching the openCloudWS that opened it; lets the player
           *  ignore stale closes for an already-replaced session. Optional —
           *  absence means "close any current bridge." */
          sessionId?: string;
      };

/** POST /api/player/checkin/:player_token — body. All fields are optional, so
 *  an empty body is a valid command-poll. When fields are present, the cloud
 *  records them so the show-builder Players pane can render an at-a-glance
 *  status without the player having to push the heavier pstat/cstat/nstat
 *  endpoints on every tick. */
export interface PlayerCheckinRequest {
    /** Epoch ms reported by the player at checkin time. The cloud uses this
     *  alongside its own clock to bound skew when stamping last_checkin. */
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
}

export interface PlayerCheckinResponse {
    /** False when the cloud doesn't recognize this player_token — player should
     *  treat this the same as `isregistered=false` (paint registration UI). */
    registered: boolean;
    /** Out-of-band commands the player should act on. Empty/omitted when
     *  nothing is pending. */
    commands?: OutOfBandCommand[];
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
