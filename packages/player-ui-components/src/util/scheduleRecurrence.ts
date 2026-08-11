/**
 * Recurring-schedule expansion. A recurring schedule is materialized into one
 * dated ScheduledPlaylist row per occurrence, linked by baseScheduleId; the
 * playback engine only ever sees the concrete rows. Extracted from
 * PlaylistScheduler so the calendar math is unit-testable.
 */

import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { convertDateToMilliseconds } from '@ezplayer/shared-ui-components';
import { eachDayOfInterval, format } from 'date-fns';

export type RecurrenceOption = 'once' | 'daily' | 'selectedDays';

export const DAY_NAME_TO_INDEX: { [key: string]: number } = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

export const generateDailyOccurrences = (
    startDate: Date,
    endDate: Date | null,
    baseSchedule: Partial<ScheduledPlaylist>,
): ScheduledPlaylist[] => {
    if (!endDate) {
        return [
            {
                ...baseSchedule,
                date: convertDateToMilliseconds(startDate),
                scheduleType: baseSchedule.scheduleType || 'main',
            } as ScheduledPlaylist,
        ];
    }

    // Generate all dates between start and end
    const dates = eachDayOfInterval({
        start: startDate,
        end: endDate,
    });

    // Create a schedule for each date
    return dates.map(
        (date) =>
            ({
                ...baseSchedule,
                id: `${baseSchedule.id}-${format(date, 'yyyy-MM-dd')}`,
                date: convertDateToMilliseconds(date),
                baseScheduleId: baseSchedule.id,
                recurrence: 'daily' as RecurrenceOption,
                scheduleType: baseSchedule.scheduleType || 'main',
                recurrenceRule: {
                    frequency: 'daily',
                    startDate: convertDateToMilliseconds(startDate),
                    endDate: convertDateToMilliseconds(endDate),
                },
            }) as ScheduledPlaylist,
    );
};

export const generateSelectedDaysOccurrences = (
    startDate: Date,
    endDate: Date | null,
    selectedDays: string[],
    baseSchedule: Partial<ScheduledPlaylist>,
): ScheduledPlaylist[] => {
    if (!endDate || selectedDays.length === 0) {
        return [
            {
                ...baseSchedule,
                date: convertDateToMilliseconds(startDate),
                scheduleType: baseSchedule.scheduleType || 'main',
            } as ScheduledPlaylist,
        ];
    }

    const dates = eachDayOfInterval({
        start: startDate,
        end: endDate,
    });

    const selectedDates = dates.filter((date) =>
        selectedDays.includes(Object.keys(DAY_NAME_TO_INDEX).find((key) => DAY_NAME_TO_INDEX[key] === date.getDay()) || ''),
    );

    return selectedDates.map(
        (date) =>
            ({
                ...baseSchedule,
                id: `${baseSchedule.id}-${format(date, 'yyyy-MM-dd')}`,
                date: convertDateToMilliseconds(date),
                baseScheduleId: baseSchedule.id,
                recurrence: 'selectedDays' as RecurrenceOption,
                scheduleType: baseSchedule.scheduleType || 'main',
                recurrenceRule: {
                    frequency: 'weekly',
                    byWeekDay: selectedDays,
                    startDate: convertDateToMilliseconds(startDate),
                    endDate: convertDateToMilliseconds(endDate),
                },
            }) as ScheduledPlaylist,
    );
};
