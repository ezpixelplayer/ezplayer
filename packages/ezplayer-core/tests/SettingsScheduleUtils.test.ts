import { describe, it, expect } from 'vitest';
// or: import { describe, it, expect } from '@jest/globals';

import {
    findMatchingScheduleEntry,
    getActiveViewerControlSchedule,
    getActiveVolumeSchedule,
} from '../src/util/SettingsScheduleUtils';

import type {
    ViewerControlScheduleEntry,
    VolumeScheduleEntry,
    ViewerControlState,
    VolumeControlState,
} from '../src/types/DataTypes'; // adjust this import

// Helper: pick a known week where 2024-09-01 is Sunday
// JS Date(year, monthIndex, day, hour, minute)
// monthIndex=8 → September
function makeLocalDate(
    dayOfWeek: number, // 0=Sunday .. 6=Saturday
    hour: number,
    minute: number,
): Date {
    // 2024-09-01 is a Sunday
    const base = new Date(2024, 8, 1, 0, 0, 0, 0);
    const deltaDays = dayOfWeek; // 0 → same day, 1 → Monday, etc.
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays, hour, minute, 0, 0);
}

describe('findMatchingScheduleEntry', () => {
    it('matches a simple same-day rule with days="all"', () => {
        const entries: ViewerControlScheduleEntry[] = [
            {
                id: 'simple',
                days: 'all',
                startTime: '10:00',
                endTime: '12:00',
                playlist: 'A',
            },
        ];

        // Wednesday 11:00 (any day works, since days="all")
        const inside = makeLocalDate(3, 11, 0); // Wednesday
        const outsideMorning = makeLocalDate(3, 9, 59);
        const outsideAfternoon = makeLocalDate(3, 12, 0);

        const matchInside = findMatchingScheduleEntry(entries, inside);
        const matchOutsideMorning = findMatchingScheduleEntry(entries, outsideMorning);
        const matchOutsideAfternoon = findMatchingScheduleEntry(entries, outsideAfternoon);

        expect(matchInside?.id).toBe('simple');
        expect(matchOutsideMorning).toBeNull();
        expect(matchOutsideAfternoon).toBeNull();
    });

    it('respects multi-day groups like "weekday-mon-fri"', () => {
        const entries: VolumeScheduleEntry[] = [
            {
                id: 'weekday-rule',
                days: 'weekday-mon-fri',
                startTime: '09:00',
                endTime: '17:00',
                volumeLevel: 75,
            },
        ];

        const mondayNoon = makeLocalDate(1, 12, 0); // Monday
        const sundayNoon = makeLocalDate(0, 12, 0); // Sunday
        const saturdayNoon = makeLocalDate(6, 12, 0); // Saturday

        const matchMon = findMatchingScheduleEntry(entries, mondayNoon);
        const matchSun = findMatchingScheduleEntry(entries, sundayNoon);
        const matchSat = findMatchingScheduleEntry(entries, saturdayNoon);

        expect(matchMon?.id).toBe('weekday-rule');
        expect(matchSun).toBeNull();
        expect(matchSat).toBeNull();
    });

    it('handles extended endTime that crosses midnight into the next day', () => {
        const entries: ViewerControlScheduleEntry[] = [
            {
                id: 'fri-late',
                days: 'friday',
                startTime: '20:00', // 8pm Friday
                endTime: '26:00', // 2am Saturday
                playlist: 'LateShow',
            },
        ];

        const friday23 = makeLocalDate(5, 23, 0); // Friday 23:00
        const saturday01 = makeLocalDate(6, 1, 0); // Saturday 01:00
        const saturday03 = makeLocalDate(6, 3, 0); // Saturday 03:00

        const matchFri23 = findMatchingScheduleEntry(entries, friday23);
        const matchSat01 = findMatchingScheduleEntry(entries, saturday01);
        const matchSat03 = findMatchingScheduleEntry(entries, saturday03);

        expect(matchFri23?.id).toBe('fri-late');
        expect(matchSat01?.id).toBe('fri-late'); // crossed into early Saturday
        expect(matchSat03).toBeNull();
    });

    it('wraps rules that spill past the end of the week', () => {
        const entries: ViewerControlScheduleEntry[] = [
            {
                id: 'sat-night',
                days: 'saturday',
                startTime: '20:00', // 8pm Saturday
                endTime: '26:00', // 2am Sunday (wrap across week boundary)
                playlist: 'WeekendEnd',
            },
        ];

        const saturday23 = makeLocalDate(6, 23, 0); // Saturday 23:00
        const sunday01 = makeLocalDate(0, 1, 0); // Sunday 01:00 (next week)
        const sunday03 = makeLocalDate(0, 3, 0); // Sunday 03:00

        const matchSat23 = findMatchingScheduleEntry(entries, saturday23);
        const matchSun01 = findMatchingScheduleEntry(entries, sunday01);
        const matchSun03 = findMatchingScheduleEntry(entries, sunday03);

        expect(matchSat23?.id).toBe('sat-night');
        expect(matchSun01?.id).toBe('sat-night'); // wrapped across week
        expect(matchSun03).toBeNull();
    });

    it('gives priority to later entries when overlapping', () => {
        const entries: VolumeScheduleEntry[] = [
            {
                id: 'base',
                days: 'all',
                startTime: '00:00',
                endTime: '24:00',
                volumeLevel: 50,
            },
            {
                id: 'override-lunch',
                days: 'all',
                startTime: '12:00',
                endTime: '13:00',
                volumeLevel: 80,
            },
        ];

        const noon = makeLocalDate(2, 12, 30); // Tuesday 12:30
        const match = findMatchingScheduleEntry(entries, noon);

        // Should get the later "override-lunch" entry, not "base"
        expect(match?.id).toBe('override-lunch');
    });

    it('returns null when no entries match', () => {
        const entries: ViewerControlScheduleEntry[] = [
            {
                id: 'night-only',
                days: 'all',
                startTime: '22:00',
                endTime: '23:00',
                playlist: 'Night',
            },
        ];

        const daytime = makeLocalDate(4, 14, 0); // Thursday 14:00
        const match = findMatchingScheduleEntry(entries, daytime);
        expect(match).toBeNull();
    });
});

describe('getActiveViewerControlSchedule', () => {
    it('returns null if viewerControl is disabled or not remote-falcon', () => {
        const baseState: ViewerControlState = {
            enabled: false,
            type: 'disabled',
            remoteFalconToken: undefined,
            schedule: [
                {
                    id: 'foo',
                    days: 'all',
                    startTime: '00:00',
                    endTime: '24:00',
                    playlist: 'X',
                },
            ],
        };

        const now = makeLocalDate(1, 10, 0);

        expect(getActiveViewerControlSchedule(baseState, now)).toBeNull();

        const wrongType: ViewerControlState = {
            ...baseState,
            enabled: true,
            type: 'disabled',
        };

        expect(getActiveViewerControlSchedule(wrongType, now)).toBeNull();
    });

    it('returns active schedule when enabled and remote-falcon', () => {
        const state: ViewerControlState = {
            enabled: true,
            type: 'remote-falcon',
            remoteFalconToken: 'abc',
            schedule: [
                {
                    id: 'rf-rule',
                    days: 'all',
                    startTime: '09:00',
                    endTime: '17:00',
                    playlist: 'RFPlaylist',
                },
            ],
        };

        const nowInside = makeLocalDate(3, 10, 0); // Wednesday 10:00
        const nowOutside = makeLocalDate(3, 18, 0); // Wednesday 18:00

        const matchInside = getActiveViewerControlSchedule(state, nowInside);
        const matchOutside = getActiveViewerControlSchedule(state, nowOutside);

        expect(matchInside?.id).toBe('rf-rule');
        expect(matchOutside).toBeNull();
    });
});

describe('getActiveVolumeSchedule', () => {
    it('returns null when no schedule entries exist', () => {
        const volumeState: VolumeControlState = {
            defaultVolume: 30,
            schedule: [],
        };

        const now = makeLocalDate(2, 12, 0);
        expect(getActiveVolumeSchedule(volumeState, now)).toBeNull();
    });

    it('returns matching volume override when in range', () => {
        const volumeState: VolumeControlState = {
            defaultVolume: 30,
            schedule: [
                {
                    id: 'daytime',
                    days: 'all',
                    startTime: '09:00',
                    endTime: '17:00',
                    volumeLevel: 70,
                },
            ],
        };

        const inside = makeLocalDate(2, 10, 0); // Tuesday 10:00
        const outside = makeLocalDate(2, 20, 0); // Tuesday 20:00

        const matchInside = getActiveVolumeSchedule(volumeState, inside);
        const matchOutside = getActiveVolumeSchedule(volumeState, outside);

        expect(matchInside?.id).toBe('daytime');
        expect(matchOutside).toBeNull();
    });

    it('plays nicely with defaultVolume logic', () => {
        const volumeState: VolumeControlState = {
            defaultVolume: 40,
            schedule: [
                {
                    id: 'evening',
                    days: 'all',
                    startTime: '18:00',
                    endTime: '22:00',
                    volumeLevel: 20,
                },
            ],
        };

        const evening = makeLocalDate(4, 19, 0); // Thursday 19:00
        const morning = makeLocalDate(4, 9, 0); // Thursday 09:00

        const activeEvening = getActiveVolumeSchedule(volumeState, evening);
        const activeMorning = getActiveVolumeSchedule(volumeState, morning);

        const effectiveEveningVolume = activeEvening?.volumeLevel ?? volumeState.defaultVolume;
        const effectiveMorningVolume = activeMorning?.volumeLevel ?? volumeState.defaultVolume;

        expect(effectiveEveningVolume).toBe(20);
        expect(effectiveMorningVolume).toBe(40);
    });
});
