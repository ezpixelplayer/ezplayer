/**
 * Which outputs the player drives and what level each should be at right now.
 *
 * One place resolves this for everyone: the playback worker slews toward these
 * targets and reports the live levels in `PlayerPStatusContent.volume`, and the
 * desktop audio windows apply the worker's gains.
 */

import type { PlaybackSettings, VolumeControlState } from '../types/DataTypes';
import { isPhysicalAudioOutput } from './audioOutputs';
import { getActiveVolumeSchedule } from './SettingsScheduleUtils';

/** Target id used for the system default output. */
export const DEFAULT_VOLUME_TARGET_ID = 'default';

export type VolumeOutputMode = 'default' | 'outputs';

export interface VolumeTarget {
    /** `DEFAULT_VOLUME_TARGET_ID`, or `AudioOutputConfig.id`. */
    id: string;
    label: string;
    /** Scheduled level now, 0..100. */
    level: number;
    deviceId?: string;
    groupId?: string;
}

export interface VolumeTargets {
    mode: VolumeOutputMode;
    /** Empty in `outputs` mode when no physical output is selected. */
    targets: VolumeTarget[];
}

function clampLevel(level: number): number {
    if (!Number.isFinite(level)) return 100;
    return Math.max(0, Math.min(100, level));
}

/** The level a volume control calls for at `now`: its active schedule entry,
 *  else its default, else 100. */
export function scheduledVolumeLevel(volumeControl: VolumeControlState | undefined, now: Date = new Date()): number {
    if (!volumeControl) return 100;
    const sched = getActiveVolumeSchedule(volumeControl, now);
    return clampLevel(sched?.volumeLevel ?? volumeControl.defaultVolume ?? 100);
}

export function resolveVolumeTargets(
    settings: Pick<PlaybackSettings, 'volumeControl' | 'useDefaultAudioOutput' | 'audioOutputs'> | undefined,
    now: Date = new Date(),
): VolumeTargets {
    if (!settings || settings.useDefaultAudioOutput !== false) {
        return {
            mode: 'default',
            targets: [
                {
                    id: DEFAULT_VOLUME_TARGET_ID,
                    label: 'System default',
                    level: scheduledVolumeLevel(settings?.volumeControl, now),
                },
            ],
        };
    }
    const targets: VolumeTarget[] = [];
    for (const o of settings.audioOutputs ?? []) {
        if (!isPhysicalAudioOutput({ deviceId: o.deviceId, kind: 'audiooutput' })) continue;
        targets.push({
            id: o.id,
            label: o.label,
            deviceId: o.deviceId,
            groupId: o.groupId,
            level: scheduledVolumeLevel(o.volumeControl, now),
        });
    }
    return { mode: 'outputs', targets };
}
