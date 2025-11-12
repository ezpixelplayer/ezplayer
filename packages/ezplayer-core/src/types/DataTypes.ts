export interface EZPlayerVersions {
    name: string;
    version: string;
    arch: string;
    builtAtIso: string;
    git: {[key: string]: string};
    packages: {[pkg: string]: string};
    processes: {[proc: string]: string | undefined};
};

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

export interface SequenceRecord {
    instanceId: string;
    id: string;
    work: SongDetails;
    sequence?: SequenceDetails;
    settings?: SequenceSettings;
    files?: SequenceFiles;
    updatedAt?: number;
    deleted?: boolean;
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

export interface UserPlayer {
    player_token: string;
    user_id: string | null;
    ownership_updated: number;
    last_checkin?: number;
    last_sync?: number;
    last_pstatus?: number;
    last_cstatus?: number;
    last_nstatus?: number;
}

export interface PlayingItem {
    type: 'Scheduled' | 'Immediate' | 'Queued',
    item: 'Song' | 'Playlist' | 'Schedule',
    title: string,
    at?: number,
    until?: number,
    priority?: number,
    request_id?: string,
    sequence_id?: string,
    playlist_id?: string,
    schedule_id?: string,
}

export interface PlayerPStatusContent {
    // P - Player
    ptype: 'EZP' | 'FPP'; // FPP or EZP
    status: 'Playing' | // Playing
            'Stopping' | // Graceful stop happening
            'Stopped' | // Stopped due to stop request
            'Paused' | // Paused - time is not advancing
            'Suppressed'; // Time advancing, but not emitting the sound/light

    reported_time: number;
    now_playing?: PlayingItem;
    upcoming?: PlayingItem[];
    immediate?: PlayingItem;
    queue?: PlayingItem[];

    volume?: {
        level: number,
        muted?: boolean,
    }

    // TODO: system status, storage, memory, temp, etc?

    // Statistics currently sent separately - PlaybackStatistics
    //   TODO figure out how to make sure that gets reflected...
}

export interface PlayerCStatusContent {
    // C - Content
    n_sequences?: number;
    n_needing_download?: number;
    sequence_sync_time?: number;
    n_playlists?: number;
    n_schedules?: number;
    schedule_sync_time?: number;
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
    connectivity?: "Up" | "Down" | "Pending" | "N/A";
    pingSummary?: string;
    reported_time?: number;
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

export interface PlaybackStatistics {
    iteration: number;

    // Errors (TODO Improve)
    lastError: string | undefined;

    // Timing Distribution
    measurementPeriod: number;
    totalIdle: number;
    totalSend: number;
    // Presumably, the rest is other things...

    // Timing Stability
    worstLag: number;
    worstAdvance: number;

    // Frame Timings
    avgSendTime: number;
    maxSendTime: number;

    // Frame delivery
    missedFrames: number;
    missedHeaders: number;
    sentFrames: number;
    skippedFrames: number;
    framesSkippedDueToManyOutstandingFrames: number;

    // Skipped controller frames
    cframesSkippedDueToDirective: number;
    cframesSkippedDueToIncompletePrior: number;

    // Audio delivery
    sentAudioChunks: number;
    skippedAudioChunks: number;
}

export type EZPlayerCommand =
{
    command: 'reloadcontrollers'; // Reset playback from current show folder, reloading network, and reopening controllers
} |
{
    command: 'resetplayback'; // Reread and reset playback from current schedule items
} |
{
    command: 'stopnow'; // Stop all playing
} |
{ 
    command: 'stopgraceful'; // Stop all playing, at convenient spot
} | 
{
    command: 'pause'; // Pause all playback
} |
{
    command: 'resume'; // Resume playback
} |
{
    command: 'suppressoutput'; // Playback continues, but not audio / video not sent out
} |
{
    command: 'activateoutput'; // Playback continues, but not audio / video not sent out
} |
{
    command: 'playsong'; // Play or enqueue a song
    songId: string;
    immediate: boolean; // If false, enqueue
    priority: number; // Allows precedence over RF, lower is higher priority
    requestId: string; // To identify, for canceling
} |
{
    command: 'playplaylist'; // Play or enqueue a playlist
    playlistId: string;
    immediate: boolean; 
    priority: number; // Allows precedence over RF, lower is higher priority
    requestId: string; // To identify, for canceling
} | {
    command: 'deleterequest';
    requestId: string; // Identity, for canceling, of a song or a
} | {
    command: 'clearrequests'; // Clear all requests
};

export interface EndUser {
    user_id: string; // UUID
    email: string;
    name_f: string;
    name_l: string;
    name_nn: string;
    status: string; // active, pending, disabled
    class: string; // free basic pro commercial
    create_time?: number;
}

export interface EndUserShowSettings {
    user_id: string; // UUID
    updated: number;
    show_name?: string;
    message?: string;
    tune_to?: string;
    fps?: number;
    layout_dim?: string; // '2D, 3D, Default'
    guess_layout?: string;
    group_mode?: string;
    rot_y?: number; // Rotate around Y axis for effects
}

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
