import type {
    CloudConfig,
    CloudStatus,
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

export interface AudioChunk {
    playAtRealTime: number; // Sent in advance, adjustment already applied to compensate for display
    incarnation: number; // Increments if a break in the audio is convenient

    sampleRate: number;
    channels: number;
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

export interface AutoDetectedSongFiles {
    audioFile?: string;
    imageFile?: string;
    imageGeneratedFromAudio?: boolean;
    detectedTitle?: string;
    detectedArtist?: string;
    durationSecs?: number;
}

export interface AudioTagMetadata {
    title?: string;
    artist?: string;
    imageFile?: string;
    imageGeneratedFromAudio?: boolean;
}

// Node/coord types, color profile, channel mapping, and `GetNodeResult` now live in
// xllayoutcalcs — this package re-exports `GetNodeResult` so consumers have a single source
// of truth and don't drift when the upstream shape evolves.
export type { GetNodeResult, ChannelRole, ChannelRoleKind, ImageInfo } from 'xllayoutcalcs';

export type AutoUpdateStatus =
    | { state: 'checking' }
    | { state: 'available'; version: string; releaseDate: string; releaseNotes?: string }
    | { state: 'not-available'; version: string }
    | { state: 'downloading'; percent: number; bytesPerSecond: number; transferred: number; total: number }
    | { state: 'downloaded'; version: string }
    | { state: 'error'; message: string };

export interface EZPElectronAPI {
    shouldShowWelcomeOnLaunch: () => boolean;

    // FS Utilities
    selectDirectory: (options?: Omit<FileSelectOptions, 'types'>) => Promise<string[]>;
    selectFiles: (options?: FileSelectOptions) => Promise<string[]>;
    autoDetectSongFilesFromFseq: (fseqPath: string) => Promise<AutoDetectedSongFiles>;
    extractAudioTagMetadata: (audioPath: string) => Promise<AudioTagMetadata>;

    writeFile: (filename: string, content: string) => Promise<string>;
    readFile: (filename: string) => Promise<string>;

    // Open URL in system web browser
    openExternal: (url: string) => void;

    // Cloud config: persisted in show-folder JSON, mutated through main.
    getCloudConfig: () => Promise<CloudConfig>;
    setPlayerIdToken: (token: string) => Promise<void>;
    setCloudServiceUrl: (url: string) => Promise<void>;
    onCloudConfigUpdated: (callback: (data: CloudConfig) => void) => void;
    /** Trigger an immediate manifest refresh + content sync. */
    cloudSyncNow: () => Promise<void>;
    /** Trigger an immediate layout fetch (zip + xml overlay). */
    cloudFetchLayoutNow: () => Promise<void>;
    /** Run a single registration heartbeat poll off-cycle. Cheap; used by the welcome
     *  bootstrap panel to tighten the wait-for-registration loop. */
    cloudPollNow: () => Promise<void>;

    /** Set the BrowserWindow's zoom factor (1.0 = 100%). Native page zoom — handles
     *  canvas/WebGL correctly, unlike CSS `zoom`. Used for the UI scale slider. */
    setZoomFactor: (factor: number) => Promise<void>;

    // Cloud status: in-memory in main, polled by the cloud worker, pushed to renderer.
    getCloudStatus: () => Promise<CloudStatus>;
    onCloudStatusUpdated: (callback: (data: CloudStatus) => void) => void;

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
    requestChooseCloudShowFolder: () => Promise<string>;
    validateShowDirectory: (showDirectory?: string) => Promise<{
        valid: boolean;
        missingFiles: string[];
        inaccessibleFiles: string[];
        error?: string;
    }>;
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
    getServerStatus: () => Promise<{
        port: number;
        portSource: string;
        status: 'listening' | 'stopped' | 'error';
    } | null>;

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

    // Audio
    ipcRequestAudioDevices: (callback: () => Promise<AudioDevice[]>) => void;
    onAudioChunk: (callback: (data: AudioChunk) => void) => void;

    // Auto-update
    checkForUpdates: () => Promise<void>;
    downloadUpdate: () => Promise<void>;
    installUpdateNow: () => Promise<void>;
    installUpdateOnQuit: () => void;
    onAutoUpdateStatus: (callback: (status: AutoUpdateStatus) => void) => void;
}
