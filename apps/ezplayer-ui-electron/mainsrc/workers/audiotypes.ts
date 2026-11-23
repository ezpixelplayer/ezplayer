/* Audio bus commands, carried from the HTTP API through main to the playback worker. */

import type { AudioBusConfig } from '@ezplayer/ezplayer-core';
import type {
    AudioBusStatus,
    AudioClipInfo,
    AudioLeaseInfo,
    AudioLeaseRequest,
    AudioPlayRequest,
    AudioPlayResult,
} from './audiobus';

export type AudioCommand =
    | { op: 'buses' }
    | { op: 'list' }
    /** `newBus` is a bus registered with this call; the settings that hold it follow. */
    | { op: 'open'; request: AudioLeaseRequest; newBus?: AudioBusConfig }
    | { op: 'close'; id: number; token?: number }
    | { op: 'keepalive'; id: number; token: number }
    | { op: 'gain'; id: number; token: number; gain: number }
    /** A stream chunk delivered over HTTP instead of UDP. */
    | { op: 'stream'; id: number; token: number; data: Uint8Array; at?: number; seq?: number }
    | { op: 'clip'; id: number; token: number; name: string; data: Uint8Array }
    | { op: 'unclip'; id: number; token: number; name: string }
    | { op: 'play'; id: number; token: number; request: AudioPlayRequest }
    | { op: 'stop'; id: number; token: number; voice?: number; fadeMs?: number };

/** `now` is the player clock at the time of the answer. */
export type AudioResult =
    | { ok: true; now: number; buses: AudioBusStatus[]; udpPort: number }
    | { ok: true; now: number; leases: AudioLeaseInfo[] }
    | { ok: true; now: number; lease: AudioLeaseInfo; udpPort: number }
    | { ok: true; now: number; clip: AudioClipInfo }
    | { ok: true; now: number; play: AudioPlayResult }
    | { ok: true; now: number; stream: { bufferedMs: number; lateMs: number } }
    | { ok: true; now: number; stopped: number }
    | { ok: true; now: number }
    | { ok: false; error: string };
