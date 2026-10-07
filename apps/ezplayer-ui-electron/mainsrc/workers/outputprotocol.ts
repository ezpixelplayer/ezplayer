/* Messages between the playback conductor and the output worker. */

import type { ControllerState, OpenControllerReport, OutputPolicy, SenderStats } from '@ezplayer/epp';

/** A compiled output whose tables are SharedArrayBuffer-backed (cloned without copying). */
export interface SerializedOutput {
    id: string;
    wireBytes: number;
    ops: Int32Array;
    luts: Uint8Array;
    perms: Int32Array;
    policy: OutputPolicy;
}

export interface OutputWorkerSettings {
    outputEnabled: boolean;
    blackFramesEnabled: boolean;
    maxSlotFraction: number;
}

export interface OutputWorkerOpenMsg {
    type: 'open';
    controllers: ControllerState[];
    opts: { ddpPort?: number; fpsOverrides?: Record<string, number> };
    pool: SharedArrayBuffer;
    stats: SharedArrayBuffer;
    outputs: SerializedOutput[];
    /** For the i-th controller, the index into outputs, or -1 when it has none. */
    senderOutput: number[];
    /** Channel-space export for the existing preview readers. */
    legacy?: { ring: SharedArrayBuffer; output: SerializedOutput };
    settings: OutputWorkerSettings;
}

export type OutputWorkerInMsg =
    | OutputWorkerOpenMsg
    | ({ type: 'settings' } & Partial<OutputWorkerSettings>)
    /** Open (or replace) the senders of these controllers, by index into the open message's list. */
    | { type: 'reopen'; indices: number[] }
    | { type: 'close' };

export type OutputWorkerOutMsg =
    | { type: 'ready' }
    | { type: 'opened'; reports: (OpenControllerReport | undefined)[] }
    | { type: 'reopened'; results: { index: number; report: OpenControllerReport | undefined }[] }
    /** What each controller's sender has sent so far, by controller name; about once a second. */
    | { type: 'senderStats'; stats: Record<string, SenderStats> }
    | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string }
    | { type: 'closed' };

export const OUTPUT_STATS_COUNTERS = [
    'framesSent',
    'framesSkippedStale',
    'idleFramesDropped',
    'cframesSkippedDirective',
    'cframesSkippedIncompletePrior',
    'sendErrors',
    'framesEncoded',
];

export const OUTPUT_STATS_GAUGES = [
    'maxSendMs',
    'lastSendMs',
    'encodeMs',
    'sendActiveMsTotal',
    'sendWaitMsTotal',
    'packetsDroppedBySender',
    'sendOverrunMs',
];
