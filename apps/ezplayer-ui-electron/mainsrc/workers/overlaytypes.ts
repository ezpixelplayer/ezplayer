/* Overlay lease commands, carried from the HTTP API through main to the playback worker. */

import type { OverlayLeaseInfo, OverlayLeaseRequest, OverlayTargetInfo, OverlayTargetQuery } from '@ezplayer/epp';

export type OverlayCommand =
    /** `groups` adds the show's xLights model groups to the answer. */
    | ({ op: 'targets'; groups?: boolean } & OverlayTargetQuery)
    | { op: 'list' }
    | { op: 'open'; request: OverlayLeaseRequest }
    | { op: 'close'; id: number; token?: number }
    | { op: 'keepalive'; id: number; token: number }
    /** A whole payload delivered over HTTP instead of UDP. */
    | { op: 'frame'; id: number; token: number; seq: number; data: Uint8Array };

/** A model row also says what xLights draws it as, when the player knows. */
export type OverlayTarget = OverlayTargetInfo & { type?: string };

/** An xLights model group, reduced to the models that can take an overlay. */
export interface OverlayModelGroup {
    name: string;
    models: string[];
    /** Members given as "Model/Submodel" whose model is not itself a member. */
    subModels: string[];
}

export type OverlayResult =
    | { ok: true; targets: OverlayTarget[]; layoutVersion: number; groups?: OverlayModelGroup[] }
    | { ok: true; leases: OverlayLeaseInfo[] }
    | { ok: true; lease: OverlayLeaseInfo; udpPort: number }
    | { ok: true }
    /** `conflict`: an exclusive lease holds the nodes; `heldBy` says which. */
    | { ok: false; error: string; code?: 'conflict'; heldBy?: OverlayLeaseInfo };
