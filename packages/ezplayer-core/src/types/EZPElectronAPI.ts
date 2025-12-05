import type {
    CombinedPlayerStatus,
    EndUser,
    EndUserShowSettings,
    PlaylistRecord,
    ScheduledPlaylist,
    SequenceRecord,
    PlaybackStatistics,
    PlayerPStatusContent,
    PlayerCStatusContent,
    PlayerNStatusContent,
    EZPlayerVersions,
    EZPlayerCommand,
    PlaybackSettings,
} from './DataTypes';

export interface AudioDevice {
    deviceId: string;
    groupId: string;
    kind: string;
    label: string;
}

export interface AudioTimeSyncR2M {
    audioCtxTime: number; // Time from audio context
    perfNowTime: number; // Main process assumed process performance.now()
    incarnation: number;
    latency?: number;
}

export interface AudioTimeSyncM2R {
    perfNowTime: number; // Main thread performance.now()
    realTime: number; // Real time, as understood by performance.now()
}

export interface AudioChunk {
    sampleRate: number;
    channels: number;
    incarnation: number;
    startTime: number;
    buffer: ArrayBuffer;
}

export interface FileSelectOptions {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;

    types?: {
        name: string;
        extensions: string[];
    }[];

    multi?: boolean;
}

export interface EZPElectronAPI {
    // FS Utilities
    selectDirectory: (options?: Omit<FileSelectOptions, 'types'>) => Promise<string[]>;
    selectFiles: (options?: FileSelectOptions) => Promise<string[]>;

    writeFile: (filename: string, content: string) => Promise<string>;
    readFile: (filename: string) => Promise<string>;

    // Open URL in system web browser
    openExternal: (url: string) => void;

    // Set up / remove callbacks
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;

    // Get versions
    getVersions: () => Promise<EZPlayerVersions>;

    // Send a command
    immediatePlayerCommand: (cmd: EZPlayerCommand) => Promise<boolean>;
    setPlaybackSettings: (s: PlaybackSettings) => Promise<boolean>;

    // Get / save data  (Nobody is actually calling some of the getters; as they shouldn't... use selectors instead.)
    requestChooseShowFolder: () => Promise<string>;
    getSequences: () => Promise<SequenceRecord[]>;
    putSequences: (recs: SequenceRecord[]) => Promise<SequenceRecord[]>;
    getPlaylists: () => Promise<PlaylistRecord[]>;
    putPlaylists: (recs: PlaylistRecord[]) => Promise<PlaylistRecord[]>;
    getSchedule: () => Promise<ScheduledPlaylist[]>;
    putSchedule: (recs: ScheduledPlaylist[]) => Promise<ScheduledPlaylist[]>;

    getShowProfile: () => Promise<EndUserShowSettings>;
    putShowProfile: (data: EndUserShowSettings) => Promise<EndUserShowSettings>;
    getUserProfile: () => Promise<EndUser>;
    putUserProfile: (data: Partial<EndUser>) => Promise<EndUser>;

    getCombinedStatus: () => Promise<CombinedPlayerStatus>;

    // Data change callbacks:
    onShowFolderUpdated: (callback: (data: string) => void) => void;
    onSequencesUpdated: (callback: (data: SequenceRecord[]) => void) => void;
    onPlaylistsUpdated: (callback: (data: PlaylistRecord[]) => void) => void;
    onScheduleUpdated: (callback: (data: ScheduledPlaylist[]) => void) => void;
    onUserUpdated: (callback: (data: EndUser) => void) => void;
    onShowUpdated: (callback: (data: EndUserShowSettings) => void) => void;

    onStatusUpdated: (callback: (data: CombinedPlayerStatus) => void) => void;
    onPlaybackSettingsUpdated: (callback: (data: PlaybackSettings) => void) => void;
    onCStatusUpdated: (callback: (data: PlayerCStatusContent) => void) => void;
    onNStatusUpdated: (callback: (data: PlayerNStatusContent) => void) => void;
    onPStatusUpdated: (callback: (data: PlayerPStatusContent) => void) => void;
    onStatsUpdated: (callback: (data: PlaybackStatistics) => void) => void;

    // Navigation callback for menu bar navigation
    onNavigate: (callback: (path: string) => void) => void;

    // Time management
    getMainSyncTime: () => Promise<AudioTimeSyncM2R>;
    sendAudioSyncTime: (sync: AudioTimeSyncR2M) => Promise<void>;
    ipcGetAudioSyncTime: (callback: (mSync: AudioTimeSyncM2R) => AudioTimeSyncR2M) => void;

    // Audio
    ipcRequestAudioDevices: (callback: () => Promise<AudioDevice[]>) => void;
    onAudioChunk: (callback: (data: AudioChunk) => void) => void;
}
