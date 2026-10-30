import { describe, expect, it } from 'vitest';

import type { PlaybackSettings, VolumeScheduleEntry } from '../types/DataTypes';
import { DEFAULT_VOLUME_TARGET_ID, resolveVolumeTargets, scheduledVolumeLevel } from './volumeTargets';

// Wednesday 2026-10-07 21:30 local.
const WED_2130 = new Date(2026, 9, 7, 21, 30);
const WED_0900 = new Date(2026, 9, 7, 9, 0);

const quietNights: VolumeScheduleEntry = {
    id: 'q',
    days: 'all',
    startTime: '21:00',
    endTime: '23:00',
    volumeLevel: 40,
};

function settings(over: Partial<PlaybackSettings>): PlaybackSettings {
    return {
        viewerControl: { enabled: false, type: 'disabled', schedule: [] },
        volumeControl: { defaultVolume: 80, schedule: [quietNights] },
        ...over,
    };
}

describe('volumeTargets', () => {
    it('scheduledVolumeLevel: schedule entry, else default, else 100, clamped', () => {
        expect(scheduledVolumeLevel({ defaultVolume: 80, schedule: [quietNights] }, WED_2130)).toBe(40);
        expect(scheduledVolumeLevel({ defaultVolume: 80, schedule: [quietNights] }, WED_0900)).toBe(80);
        expect(scheduledVolumeLevel({ defaultVolume: 80 }, WED_2130)).toBe(80);
        expect(scheduledVolumeLevel(undefined, WED_2130)).toBe(100);
        expect(scheduledVolumeLevel({ defaultVolume: 250 }, WED_2130)).toBe(100);
        expect(scheduledVolumeLevel({ defaultVolume: -5 }, WED_2130)).toBe(0);
    });

    it('default mode: one target following volumeControl', () => {
        const r = resolveVolumeTargets(settings({}), WED_2130);
        expect(r.mode).toBe('default');
        expect(r.targets).toEqual([{ id: DEFAULT_VOLUME_TARGET_ID, label: 'System default', level: 40 }]);
        expect(resolveVolumeTargets(settings({ useDefaultAudioOutput: true }), WED_0900).targets[0].level).toBe(80);
        expect(resolveVolumeTargets(undefined, WED_0900)).toEqual({
            mode: 'default',
            targets: [{ id: DEFAULT_VOLUME_TARGET_ID, label: 'System default', level: 100 }],
        });
    });

    it('outputs mode: one target per physical output, each on its own schedule', () => {
        const r = resolveVolumeTargets(
            settings({
                useDefaultAudioOutput: false,
                audioOutputs: [
                    {
                        id: 'a',
                        deviceId: 'dev-a',
                        label: 'Yard speakers',
                        groupId: 'g1',
                        volumeControl: { defaultVolume: 90, schedule: [quietNights] },
                    },
                    { id: 'b', deviceId: 'dev-b', label: 'Garage', volumeControl: { defaultVolume: 60, schedule: [] } },
                    // Synthetic sinks never become named outputs.
                    { id: 'c', deviceId: 'default', label: 'Default', volumeControl: { defaultVolume: 10 } },
                ],
            }),
            WED_2130,
        );
        expect(r.mode).toBe('outputs');
        expect(r.targets).toEqual([
            { id: 'a', label: 'Yard speakers', deviceId: 'dev-a', groupId: 'g1', level: 40 },
            { id: 'b', label: 'Garage', deviceId: 'dev-b', groupId: undefined, level: 60 },
        ]);
        // The default volumeControl's schedule is NOT applied to named outputs.
        expect(r.targets.find((t) => t.id === 'b')!.level).toBe(60);
    });

    it('outputs mode with nothing selected is an empty target list', () => {
        const r = resolveVolumeTargets(settings({ useDefaultAudioOutput: false, audioOutputs: [] }), WED_2130);
        expect(r).toEqual({ mode: 'outputs', targets: [] });
    });
});
