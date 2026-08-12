import type {
    CloudConfig,
    CloudStatus,
    CombinedPlayerStatus,
    UIConnectSnapshot,
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
    CloudCommand,
    RemoteAccessAvailability,
} from './DataTypes';
import type { ControllerCommand, ControllerOpsState } from './ControllerOps';

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
    // Interleaved sample count by which the consumer should advance its playback
    // position (the "hop"). The buffer itself may contain MORE samples than this
    // (a trailing crossfade overlap) — those are still played, but the next chunk
    // begins `advanceSamples` later so adjacent chunks overlap and crossfade.
    // When 0/absent, consumers fall back to advancing by the full buffer length.
    advanceSamples?: number;
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
    /** True when the FSEQ header names an audio file that must be resolved. */
    audioRequired?: boolean;
    /** Basename of the audio file named in the FSEQ header, when present. */
    headerAudioName?: string;
}

export interface AudioTagMetadata {
    title?: string;
    artist?: string;
    imageFile?: string;
    imageGeneratedFromAudio?: boolean;
}

export interface BatchImportFailure {
    fseqPath: string;
    fseqName: string;
    reason: string;
}

export interface BatchImportSuccess {
    fseqPath: string;
    fseqName: string;
    title: string;
    artist: string;
    mediaFound: boolean;
}

/** An FSEQ left alone because a song entry for it already exists. */
export interface BatchImportSkipped {
    fseqPath: string;
    fseqName: string;
    /** Title of the existing song entry, when known. */
    existingTitle?: string;
}

export interface BatchImportSummary {
    total: number;
    imported: number;
    failed: number;
    successes: BatchImportSuccess[];
    failures: BatchImportFailure[];
    /** FSEQs skipped because they already have song entries. */
    skipped?: BatchImportSkipped[];
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
    /** Import many .fseq paths using the same autodetection as single-song add. */
    batchImportSequences: (fseqPaths: string[]) => Promise<BatchImportSummary>;
    /** Import every .fseq under a folder (recursive). */
    batchImportSequencesFromFolder: (folderPath: string) => Promise<BatchImportSummary>;

    writeFile: (filename: string, content: string) => Promise<string>;
    readFile: (filename: string) => Promise<string>;

    // Open URL in system web browser
    openExternal: (url: string) => void;

    // Cloud config: persisted in show-folder JSON, mutated through main.
    getCloudConfig: () => Promise<CloudConfig>;
    onCloudConfigUpdated: (callback: (data: CloudConfig) => void) => void;
    /** Single umbrella for player-cloud-worker verbs. Modeled on `immediatePlayerCommand`
     *  (which uses an EZPlayerCommand discriminated union). New verbs add a variant
     *  to `CloudCommand` and a case in main's dispatcher — no per-verb IPC plumbing. */
    cloudCommand: (cmd: CloudCommand) => Promise<void>;

    /** Set the BrowserWindow's zoom factor (1.0 = 100%). Native page zoom — handles
     *  canvas/WebGL correctly, unlike CSS `zoom`. Used for the UI scale slider. */
    setZoomFactor: (factor: number) => Promise<void>;

    // Cloud status: in-memory in main, polled by the cloud worker, pushed to renderer.
    getCloudStatus: () => Promise<CloudStatus>;
    onCloudStatusUpdated: (callback: (data: CloudStatus) => void) => void;

    /** Controller ops (discovery/status/action). Same command shape as the LAN
     *  HTTP/WS and cloud. Initial state arrives in the connect() snapshot; updates
     *  push via onControllerOpsUpdated. */
    controllerCommand: (command: ControllerCommand) => Promise<void>;
    onControllerOpsUpdated: (callback: (data: ControllerOpsState) => void) => void;

    /** Pushed whenever remote-access availability changes. */
    onRemoteAccessUpdated: (callback: (state: RemoteAccessAvailability) => void) => void;

    // Set up / remove callbacks
    connect: () => Promise<UIConnectSnapshot | undefined>;
    disconnect: () => Promise<void>;

    // Get versions
    getVersions: () => Promise<EZPlayerVersions>;

    // Send a command
    immediatePlayerCommand: (cmd: EZPlayerCommand) => Promise<boolean>;
    setPlaybackSettings: (s: PlaybackSettings) => Promise<boolean>;

    // Get / save data  (Nobody is actually calling some of the getters; as they shouldn't... use selectors instead.)
    requestChooseShowFolder: () => Promise<string>;
    /** Cloud-managed-folder picker. Returns the chosen folder + whether the
     *  folder was an existing cloud install (so the caller can skip
     *  registration/layout-bootstrap). `folder === ''` means the user
     *  cancelled. */
    requestChooseCloudShowFolder: () => Promise<{ folder: string; existingInstall: boolean }>;
    /** Welcome-screen cloud-CTA flag (electron-store, set by --reset-cloud /
     *  --reset-nocloud). */
    getWelcomeShowCloud: () => Promise<boolean>;
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

    onStatusUpdated: (callback: (data: CombinedPlayerStatus) => void) => void;
    onPlaybackSettingsUpdated: (callback: (data: PlaybackSettings) => void) => void;
    onCStatusUpdated: (callback: (data: PlayerCStatusContent) => void) => void;
    onNStatusUpdated: (callback: (data: PlayerNStatusContent) => void) => void;
    onPStatusUpdated: (callback: (data: PlayerPStatusContent) => void) => void;
    onStatsUpdated: (callback: (data: PlaybackStatistics) => void) => void;

    // Audio
    ipcRequestAudioDevices: (callback: () => Promise<AudioDevice[]>) => void;
    onAudioChunk: (callback: (data: AudioChunk) => void) => void;

    /** Whether sign-in startup can be configured (installed app only, not dev mode). */
    isLoginItemSupported: () => Promise<boolean>;
    /** Whether EZPlayer is configured to launch when the Windows user signs in. */
    getOpenAtLogin: () => Promise<boolean>;
    setOpenAtLogin: (openAtLogin: boolean) => Promise<boolean>;

    // Auto-update
    checkForUpdates: () => Promise<void>;
    downloadUpdate: () => Promise<void>;
    installUpdateNow: () => Promise<void>;
    installUpdateOnQuit: () => void;
    onAutoUpdateStatus: (callback: (status: AutoUpdateStatus) => void) => void;
}
