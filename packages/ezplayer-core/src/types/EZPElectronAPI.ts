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

export interface NodeCoord {
    // For default / logical render buffer
    //  This ought to be a separate concern really...
    //  Other things can be determined by ordinal number or
    bufX: number;
    bufY: number;
    bufZ: number;

    // In 3D space, prop relative not world
    modelX: number;
    modelY: number;
    modelZ: number;

    // World
    wX: number;
    wY: number;
    wZ: number;
}

export interface NodeLoc {
    physicalNum: number; // Number 1-n, based on wiring
    physicalStrand: number; // Strand number, for models that do this, ignoreable but affects some render styles.  0-based?
    physicalNumOnStrand: number; // Physical pixel num on strand, 0-sl
    channel?: number;

    logicalNum: number; // Number logical to a model type, regardless of how it is wired, for example top to bottom left to right
    logicalX: number; // Commonly, the column in a grid
    logicalY: number; // Commonly, the row in a grid
    logicalZ: number; // Commonly, the grid sheet

    coords: NodeCoord[];
}

/**
 * A contiguous run of nodes mapped to channels.
 * Most models have a single run; Advanced mode models may have multiple.
 *
 * All channel numbers are 0-based (matching xLights model export).
 */
export interface ChannelRun {
    nodeStart: number;       // First node index in this run (0-based)
    nodeCount: number;       // Number of nodes in this run
    channelStart: number;    // First channel (0-based)
    channelsPerNode: number; // 3=RGB, 4=RGBW, 1=single color, etc.
    stringIndex: number;     // Which string/strand this run belongs to (0-based)
}

/**
 * Complete channel mapping for a model.
 * Maps from node index space to channel space.
 *
 * All channel numbers are 0-based (matching xLights model export).
 */
export interface ModelChannelMapping {
    nodeChannelMap: ChannelRun[];  // Usually just 1, but multiple for Advanced mode
    totalNodes: number;            // Total nodes in model
    totalChannels: number;         // Sum of nodeCount * channelsPerNode across runs
    channelsPerNode: number;       // Default/common value from StringType
    numStrings: number;            // Number of strings in the model

    // Convenience: overall channel bounds (0-based)
    firstChannel: number;          // Min channel used
    lastChannel: number;           // Max channel used
}

/**
 * The return of getNodeCoords.
 * We are making a different abstraction than xLights.
 *   Coordinates in nodes[] is normalized / logical
 * Thus the attachment of some of the physical transformation
 *   A good bit more of that was already done by xLights
 */
export interface GetNodeResult {
    nodes: NodeLoc[];

    logicalBufferWidth: number;
    logicalBufferHeight: number;
    logicalBufferDepth: number;

    /** Metadata */
    pixelSize?: number;
    pixelStyle?: string;
    modelType?: string;
    pixelType?: string;
    stringType?: string;

    /** Channel mapping (populated after channel resolution) */
    channelMapping?: ModelChannelMapping;
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
    getServerStatus: () => Promise<{
        port: number;
        portSource: string;
        status: 'listening' | 'stopped' | 'error';
    } | null>;

    // Preview window
    getModelCoordinates: () => Promise<Record<string, GetNodeResult>>;

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
}
