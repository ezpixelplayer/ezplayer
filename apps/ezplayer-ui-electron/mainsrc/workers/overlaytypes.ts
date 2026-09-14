/* Overlay lease commands, carried from the HTTP API through main to the playback worker. */

import type { OverlayLeaseInfo, OverlayLeaseRequest } from '@ezplayer/epp';

export type OverlayCommand =
    | { op: 'targets' }
    | { op: 'list' }
    | { op: 'open'; request: OverlayLeaseRequest }
    | { op: 'close'; id: number; token?: number }
    | { op: 'keepalive'; id: number; token: number }
    /** A whole payload delivered over HTTP instead of UDP. */
    | { op: 'frame'; id: number; token: number; seq: number; data: Uint8Array };

export interface OverlayTarget {
    model: string;
    nodeCount: number;
    width?: number;
    height?: number;
}

export type OverlayResult =
    | { ok: true; targets: OverlayTarget[]; layoutVersion: number }
    | { ok: true; leases: OverlayLeaseInfo[] }
    | { ok: true; lease: OverlayLeaseInfo; udpPort: number }
    | { ok: true }
    | { ok: false; error: string };
