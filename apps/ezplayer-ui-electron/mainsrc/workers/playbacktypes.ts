import { GetNodeResult } from 'xllayoutcalcs';
import type { RPCRequest, RPCResponse } from './rpctypes';
import type {
    AudioChunk,
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    PlaybackStatistics,
    PlayerPStatusContent,
    PlayerCStatusContent,
    PlayerNStatusContent,
    EZPlayerCommand,
    PlaybackSettings,
    LatestFrameRingBuffer,
} from '@ezplayer/ezplayer-core';

export interface PlaybackWorkerData {
    name: string;
    logFile: string;
}

// TODO CRAZ Replace with better interfaces
export interface QueueEntry {
    cmdseq: number;
    seqid: string;
    fseqpath: string;
    audiopath: string;
}

// Layout-level settings from the xLights <settings> element
export interface LayoutSettings {
    backgroundImage?: string;   // Show-folder-relative path to background image
    backgroundBrightness?: number; // 0-100 brightness for the background image
    previewWidth?: number;      // Layout preview canvas width in pixels
    previewHeight?: number;     // Layout preview canvas height in pixels
}

// View objects (meshes like house models, images) from XML
export interface ViewObject {
    name: string;
    displayAs: string;
    objFile?: string;        // Path to OBJ file (for DisplayAs="Mesh")
    imageFile?: string;      // Path to image file (for DisplayAs="Image")
    transparency?: number;   // 0-100, where 0=opaque, 100=fully transparent
    worldPosX: number;
    worldPosY: number;
    worldPosZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    rotateX: number;
    rotateY: number;
    rotateZ: number;
    brightness?: number;
    active?: boolean;
}

// Should something be in the RPC API?
// Yes, if you want to await it (like fetch a value)
// Not necessarily, otherwise

export type PlayWorkerRPCAPI = {
    add: (args: { a: number; b: number }) => number;
    fail: (args: { msg: string }) => void;
    stopPlayback: (args: {}) => Promise<boolean> | boolean;
    getModelCoordinates: (args: {}) => Promise<Record<string, GetNodeResult>>;
    getModelCoordinates2D: (args: {}) => Promise<Record<string, GetNodeResult>>;
    getFrameExportBuffer: () => Promise<SharedArrayBuffer | undefined>;
};

export type MainRPCAPI = {
    add: (args: { a: number; b: number }) => number;
    fail: (args: { msg: string }) => void;
};

export type PlayerCommand =
    | {
          type: 'schedupdate';
          showFolder: string;
          seqs: SequenceRecord[];
          pls: PlaylistRecord[];
          sched: ScheduledPlaylist[];
      }
    | { type: 'frontendcmd'; cmd: EZPlayerCommand }
    | { type: 'settings'; settings: PlaybackSettings }
    | { type: 'rpc'; rpc: RPCRequest }
    | { type: 'rpc-response'; response: RPCResponse };

export type WorkerToMainMessage =
    | { type: 'ready' }
    | { type: 'audioChunk'; chunk: AudioChunk }
    | { type: 'pixelbuffer'; buffer: SharedArrayBuffer | undefined }
    | { type: 'done' }
    | { type: 'error'; message: string }
    | { type: 'stats'; stats: PlaybackStatistics }
    | { type: 'cstatus'; status: PlayerCStatusContent }
    | { type: 'nstatus'; status: PlayerNStatusContent }
    | { type: 'pstatus'; status: PlayerPStatusContent }
    | {
          type: 'modelCoordinates';
          coords3D: Record<string, GetNodeResult>;
          coords2D: Record<string, GetNodeResult>;
          viewObjects?: Array<ViewObject>;
          layoutSettings?: LayoutSettings;
      }
    | { type: 'audiobuffer'; buffer: SharedArrayBuffer }
    | { type: 'rpc'; rpc: RPCRequest }
    | { type: 'rpc-response'; response: RPCResponse };
