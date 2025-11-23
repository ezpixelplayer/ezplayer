import { ScheduleDays, ViewerControlScheduleEntry, ViewerControlState, VolumeControlState, VolumeScheduleEntry } from "src/types/DataTypes";

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

// Date -> minutes since start of local week (Sunday 00:00)
function getMinutesOfWeek(date: Date): number {
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday (local time)
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return day * MINUTES_PER_DAY + hours * 60 + minutes;
}

// "HH:MM" (HH can be up to 168) -> minutes
function parseExtendedTimeToMinutes(time: string): number {
    const [hStr, mStr] = time.split(':');
    const hours = parseInt(hStr, 10);
    const mins = parseInt(mStr, 10);
    if (
        Number.isNaN(hours) ||
        Number.isNaN(mins) ||
        mins < 0 ||
        mins > 59 ||
        hours < 0
    ) {
        throw new Error(`Invalid time string: ${time}`);
    }
    return hours * 60 + mins;
}

// Map your ScheduleDays to day indices (0 = Sunday … 6 = Saturday)
function expandScheduleDays(days: ScheduleDays): number[] {
    switch (days) {
        case 'all':
            return [0, 1, 2, 3, 4, 5, 6];
        case 'weekend-fri-sat':
            return [5, 6]; // Fri, Sat
        case 'weekend-sat-sun':
            return [6, 0]; // Sat, Sun
        case 'weekday-mon-fri':
            return [1, 2, 3, 4, 5]; // Mon..Fri
        case 'weekday-sun-thu':
            return [0, 1, 2, 3, 4]; // Sun..Thu
        case 'sunday':
            return [0];
        case 'monday':
            return [1];
        case 'tuesday':
            return [2];
        case 'wednesday':
            return [3];
        case 'thursday':
            return [4];
        case 'friday':
            return [5];
        case 'saturday':
            return [6];
    }
}

type BaseScheduleEntry = {
    days: ScheduleDays;
    startTime: string;
    endTime: string;
};

function scheduleEntryMatchesNow<T extends BaseScheduleEntry>(
    entry: T,
    nowMinutesOfWeek: number
): boolean {
    const startMinutesLocal = parseExtendedTimeToMinutes(entry.startTime);
    const endMinutesLocal = parseExtendedTimeToMinutes(entry.endTime);

    if (endMinutesLocal <= startMinutesLocal) {
        // invalid / zero-length; treat as non-matching
        return false;
    }

    const dayIndices = expandScheduleDays(entry.days);

    for (const dayIndex of dayIndices) {
        const start = dayIndex * MINUTES_PER_DAY + startMinutesLocal;
        const end = dayIndex * MINUTES_PER_DAY + endMinutesLocal;

        if (start >= MINUTES_PER_WEEK) {
            // Just in case misconfigured beyond 168:00 from Sunday
            continue;
        }

        if (end <= MINUTES_PER_WEEK) {
            // Simple case: stays within this week
            if (nowMinutesOfWeek >= start && nowMinutesOfWeek < end) {
                return true;
            }
        } else {
            // Wrap-around case: spills past end of week
            const wrappedEnd = end - MINUTES_PER_WEEK;

            // Interval 1: [start, endOfWeek)
            if (nowMinutesOfWeek >= start && nowMinutesOfWeek < MINUTES_PER_WEEK) {
                return true;
            }

            // Interval 2: [0, wrappedEnd)
            if (nowMinutesOfWeek >= 0 && nowMinutesOfWeek < wrappedEnd) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Find the applicable schedule entry at the given time.
 * Later entries in the array have higher priority.
 */
export function findMatchingScheduleEntry<T extends BaseScheduleEntry>(
    entries: T[],
    now: Date = new Date()
): T | null {
    if (!entries.length) return null;

    const nowMinutes = getMinutesOfWeek(now);

    // later entries should win, so iterate from the end
    for (let i = entries.length - 1; i >= 0; i--) {
        if (scheduleEntryMatchesNow(entries[i], nowMinutes)) {
            return entries[i];
        }
    }

    return null;
}

export function getActiveViewerControlSchedule(
    viewerControl: ViewerControlState,
    now: Date = new Date()
): ViewerControlScheduleEntry | null {
    if (!viewerControl.enabled || viewerControl.type !== 'remote-falcon') {
        return null;
    }

    return findMatchingScheduleEntry(viewerControl.schedule, now);
}

export function getActiveVolumeSchedule(
    volumeControl: VolumeControlState,
    now: Date = new Date()
): VolumeScheduleEntry | null {
    if (!volumeControl.schedule.length) {
        return null;
    }
    return findMatchingScheduleEntry(volumeControl.schedule, now);
}
