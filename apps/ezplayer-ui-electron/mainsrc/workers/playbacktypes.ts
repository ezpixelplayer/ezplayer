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

export interface AudioTimeSyncWorker {
    audioCtxTime?: number;
    audioCtxIncarnation?: number;
    perfNowTime: number;
    realTime?: number;
    latency?: number;
}

// Should something be in the RPC API?
// Yes, if you want to await it (like fetch a value)
// Not necessarily, otherwise

export type PlayWorkerRPCAPI = {
    add: (args: { a: number; b: number }) => number;
    fail: (args: { msg: string }) => void;
};

export type MainRPCAPI = {
    add: (args: { a: number; b: number }) => number;
    fail: (args: { msg: string }) => void;
    timesync: (args: {}) => AudioTimeSyncWorker;
};

export type PlayerCommand =
    | {
          type: 'schedupdate';
          showFolder: string;
          seqs: SequenceRecord[];
          pls: PlaylistRecord[];
          sched: ScheduledPlaylist[];
      }
    | { type: 'frontendcmd'; cmd: EZPlayerCommand}
    | { type: 'rpc'; rpc: RPCRequest }
    | { type: 'rpc-response'; response: RPCResponse };

export type WorkerToMainMessage =
    | { type: 'ready' }
    | { type: 'audioChunk'; chunk: AudioChunk }
    | { type: 'done' }
    | { type: 'error'; message: string }
    | { type: 'stats'; stats: PlaybackStatistics }
    | { type: 'cstatus'; status: PlayerCStatusContent }
    | { type: 'nstatus'; status: PlayerNStatusContent }
    | { type: 'pstatus'; status: PlayerPStatusContent }
    | { type: 'rpc'; rpc: RPCRequest }
    | { type: 'rpc-response'; response: RPCResponse };
