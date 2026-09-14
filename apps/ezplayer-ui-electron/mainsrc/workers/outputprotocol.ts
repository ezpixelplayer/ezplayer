/* Messages between the playback conductor and the output worker. */

import type { ControllerState, OpenControllerReport, OutputPolicy } from '@ezplayer/epp';

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
    | { type: 'close' };

export type OutputWorkerOutMsg =
    | { type: 'ready' }
    | { type: 'opened'; reports: (OpenControllerReport | undefined)[] }
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
