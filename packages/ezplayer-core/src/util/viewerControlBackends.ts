/**
 * Which viewer-control backends a player runs. Both may be on at once — the
 * built-in EZPlayer request line and Remote Falcon — with built-in requests
 * taking precedence (the player asks its own request line first each round
 * and polls Remote Falcon only when that had nothing).
 *
 * Storage: newer players write `backends`; `type` remains the *primary*
 * backend so older readers (and older builds opening the same settings file)
 * keep working. Absent `backends` is derived from `type`.
 *
 * Both backends run on `schedule` unless `separateRemoteFalconSchedule` gives
 * Remote Falcon its own `remoteFalconSchedule` (`viewerControlSchedule()`).
 */

import type {
    ViewerControlBackend,
    ViewerControlScheduleEntry,
    ViewerControlScheduleList,
    ViewerControlState,
} from '../types/DataTypes';

const KNOWN: readonly ViewerControlBackend[] = ['remote-falcon', 'ezplayer'];

export function viewerControlBackends(vc: ViewerControlState | undefined | null): ViewerControlBackend[] {
    if (!vc || !vc.enabled) return [];
    if (Array.isArray(vc.backends)) {
        return KNOWN.filter((b) => vc.backends!.includes(b));
    }
    return vc.type === 'remote-falcon' || vc.type === 'ezplayer' ? [vc.type] : [];
}

export function hasViewerControlBackend(
    vc: ViewerControlState | undefined | null,
    backend: ViewerControlBackend,
): boolean {
    return viewerControlBackends(vc).includes(backend);
}

/** Which schedule list a backend runs on: Remote Falcon has its own only
 *  when `separateRemoteFalconSchedule` is set. */
export function viewerControlScheduleList(
    vc: ViewerControlState | undefined | null,
    backend: ViewerControlBackend,
): ViewerControlScheduleList {
    return backend === 'remote-falcon' && vc?.separateRemoteFalconSchedule ? 'remoteFalconSchedule' : 'schedule';
}

export function viewerControlSchedule(
    vc: ViewerControlState | undefined | null,
    backend: ViewerControlBackend,
): ViewerControlScheduleEntry[] {
    return vc?.[viewerControlScheduleList(vc, backend)] ?? [];
}

/** The single `type` value that best describes a backend set, for legacy
 *  readers: built-in wins when both are on. */
export function primaryViewerControlType(backends: readonly ViewerControlBackend[]): ViewerControlState['type'] {
    if (backends.includes('ezplayer')) return 'ezplayer';
    if (backends.includes('remote-falcon')) return 'remote-falcon';
    return 'disabled';
}

/** Normalised settings for a chosen backend set: `backends`, the legacy
 *  `type`, and `enabled` kept consistent. */
export function withViewerControlBackends(
    vc: ViewerControlState,
    backends: readonly ViewerControlBackend[],
): ViewerControlState {
    const list = KNOWN.filter((b) => backends.includes(b));
    return { ...vc, backends: list, type: primaryViewerControlType(list), enabled: list.length > 0 };
}
