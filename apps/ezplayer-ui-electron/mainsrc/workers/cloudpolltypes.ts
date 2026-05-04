import type { CloudStatus } from '@ezplayer/ezplayer-core';

/** Parent → worker. */
export type CloudPollInMessage =
    | { type: 'setConfig'; cloudUrl: string; playerIdToken: string; intervalMs?: number }
    | { type: 'pollNow' }
    | { type: 'stop' };

/** Worker → parent. */
export type CloudPollOutMessage =
    | { type: 'cloudStatus'; status: CloudStatus }
    | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string };
