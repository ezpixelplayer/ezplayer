/**
 * Drag-and-drop helpers for calendar schedule chips. Classifies occurrence
 * position in a recurring series and builds the schedule payloads for move,
 * copy, fill, and boundary-change operations.
 */

import { ScheduledPlaylist, getScheduleTimes } from '@ezplayer/ezplayer-core';
import { convertDateToMilliseconds, timestampToDate } from '@ezplayer/shared-ui-components';
import { format, isSameDay } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { generateDailyOccurrences, generateSelectedDaysOccurrences, type RecurrenceOption } from './scheduleRecurrence';

export type ScheduleOccurrenceRole = 'single' | 'first' | 'middle' | 'last';
export type ScheduleDragDialogType = 'single' | 'recurring-first' | 'recurring-last';
export type ScheduleDragOperation = 'copy' | 'move' | 'fill' | 'changeStartDate' | 'changeEndDate';

export function dateKeyToDate(dateKey: string): Date {
    const [y, m, d] = dateKey.split('-').map((v) => Number(v));
    return new Date(y, m - 1, d);
}

export function isRecurringSchedule(schedule: ScheduledPlaylist): boolean {
    return ['daily', 'selectedDays'].includes(schedule.recurrence ?? '');
}

export function getSeriesOccurrences(
    schedule: ScheduledPlaylist,
    allSchedules: ScheduledPlaylist[],
): ScheduledPlaylist[] {
    if (!isRecurringSchedule(schedule)) {
        return [schedule];
    }

    const baseId = schedule.baseScheduleId || schedule.id;
    return allSchedules
        .filter((s) => !s.deleted && (s.baseScheduleId === baseId || s.id === baseId))
        .sort((a, b) => a.date - b.date);
}

export function getOccurrenceRole(
    schedule: ScheduledPlaylist,
    allSchedules: ScheduledPlaylist[],
): ScheduleOccurrenceRole {
    if (!isRecurringSchedule(schedule)) {
        return 'single';
    }

    const series = getSeriesOccurrences(schedule, allSchedules);
    if (series.length <= 1) {
        return 'single';
    }

    const index = series.findIndex((s) => s.id === schedule.id);
    if (index <= 0) return 'first';
    if (index >= series.length - 1) return 'last';
    return 'middle';
}

export function isScheduleDragAllowed(schedule: ScheduledPlaylist, allSchedules: ScheduledPlaylist[]): boolean {
    return getOccurrenceRole(schedule, allSchedules) !== 'middle';
}

export function getDragDialogType(
    schedule: ScheduledPlaylist,
    allSchedules: ScheduledPlaylist[],
): ScheduleDragDialogType {
    const role = getOccurrenceRole(schedule, allSchedules);
    if (role === 'first') return 'recurring-first';
    if (role === 'last') return 'recurring-last';
    return 'single';
}

export function getFillDateRange(sourceDate: Date, destinationDate: Date): { startDate: Date; endDate: Date } {
    if (destinationDate.getTime() < sourceDate.getTime()) {
        return { startDate: destinationDate, endDate: sourceDate };
    }
    return { startDate: sourceDate, endDate: destinationDate };
}

function stripOccurrenceFields(schedule: ScheduledPlaylist): Partial<ScheduledPlaylist> {
    const { id: _id, date: _date, baseScheduleId: _base, recurrenceRule: _rule, ...rest } = schedule;
    return rest;
}

function buildBaseScheduleFromOccurrence(
    schedule: ScheduledPlaylist,
    baseScheduleId: string,
): Partial<ScheduledPlaylist> {
    return {
        ...stripOccurrenceFields(schedule),
        id: baseScheduleId,
        updatedAt: Date.now(),
        deleted: false,
    };
}

/**
 * Turn a schedule into a standalone, non-repeating one.
 */
function detachFromSeries(schedule: ScheduledPlaylist): ScheduledPlaylist {
    const { recurrenceRule: _rule, ...rest } = schedule;
    return {
        ...rest,
        baseScheduleId: '',
        recurrence: 'once' as RecurrenceOption,
    };
}

export function buildMoveOrCopySchedule(
    sourceSchedule: ScheduledPlaylist,
    destinationDate: Date,
    operation: 'copy' | 'move',
): ScheduledPlaylist {
    const destinationDateMS = convertDateToMilliseconds(destinationDate);
    if (operation === 'copy') {
        return {
            ...detachFromSeries(sourceSchedule),
            id: uuidv4(),
            date: destinationDateMS,
            updatedAt: Date.now(),
            deleted: false,
        };
    }

    // Move is only offered for a standalone schedule or the sole remaining
    // occurrence of a repeating series.
    const moved = isRecurringSchedule(sourceSchedule) ? detachFromSeries(sourceSchedule) : sourceSchedule;
    return {
        ...moved,
        date: destinationDateMS,
        updatedAt: Date.now(),
        deleted: false,
    };
}

export function buildFillSchedules(
    sourceSchedule: ScheduledPlaylist,
    destinationDate: Date,
): {
    schedulesToDelete: ScheduledPlaylist[];
    schedulesToCreate: ScheduledPlaylist[];
    schedulesToUpdate: ScheduledPlaylist[];
} {
    const sourceDate = timestampToDate(sourceSchedule.date);
    const { startDate, endDate } = getFillDateRange(sourceDate, destinationDate);
    const baseScheduleId = uuidv4();
    const baseSchedule = buildBaseScheduleFromOccurrence(sourceSchedule, baseScheduleId);

    const schedulesToCreate = generateDailyOccurrences(startDate, endDate, {
        ...baseSchedule,
        recurrence: 'daily' as RecurrenceOption,
        baseScheduleId,
    });

    return {
        schedulesToDelete: [{ ...sourceSchedule, deleted: true, updatedAt: Date.now() }],
        schedulesToCreate,
        schedulesToUpdate: [],
    };
}

function dateToKey(date: Date | number): string {
    return format(typeof date === 'number' ? timestampToDate(date) : date, 'yyyy-MM-dd');
}

function generateTargetSeries(
    template: ScheduledPlaylist,
    baseScheduleId: string,
    newStart: Date,
    newEnd: Date,
): ScheduledPlaylist[] {
    const recurrence = (template.recurrence as RecurrenceOption) || 'daily';
    const baseSchedule = buildBaseScheduleFromOccurrence(template, baseScheduleId);

    if (recurrence === 'selectedDays') {
        return generateSelectedDaysOccurrences(newStart, newEnd, template.recurrenceRule?.byWeekDay || [], {
            ...baseSchedule,
            recurrence: 'selectedDays',
            baseScheduleId,
        });
    }

    return generateDailyOccurrences(newStart, newEnd, {
        ...baseSchedule,
        recurrence: 'daily',
        baseScheduleId,
    });
}

export function buildBoundaryChangeSchedules(
    sourceSchedule: ScheduledPlaylist,
    allSchedules: ScheduledPlaylist[],
    destinationDate: Date,
    boundary: 'start' | 'end',
): {
    schedulesToDelete: ScheduledPlaylist[];
    schedulesToCreate: ScheduledPlaylist[];
    schedulesToUpdate: ScheduledPlaylist[];
} | null {
    const series = getSeriesOccurrences(sourceSchedule, allSchedules);
    if (series.length === 0) return null;

    const template = series[0];
    const currentStart = template.recurrenceRule?.startDate
        ? timestampToDate(template.recurrenceRule.startDate)
        : timestampToDate(template.date);
    const currentEnd = template.recurrenceRule?.endDate
        ? timestampToDate(template.recurrenceRule.endDate)
        : timestampToDate(series[series.length - 1].date);

    const newStart = boundary === 'start' ? destinationDate : currentStart;
    const newEnd = boundary === 'end' ? destinationDate : currentEnd;

    if (newStart.getTime() > newEnd.getTime()) {
        return null;
    }

    const baseScheduleId = template.baseScheduleId || template.id;
    const targetSeries = generateTargetSeries(template, baseScheduleId, newStart, newEnd);
    const existingByDateKey = new Map(series.map((occurrence) => [dateToKey(occurrence.date), occurrence]));
    const targetByDateKey = new Map(targetSeries.map((occurrence) => [dateToKey(occurrence.date), occurrence]));

    const schedulesToDelete = series
        .filter((occurrence) => !targetByDateKey.has(dateToKey(occurrence.date)))
        .map((occurrence) => ({ ...occurrence, deleted: true, updatedAt: Date.now() }));

    const schedulesToCreate = targetSeries.filter((occurrence) => !existingByDateKey.has(dateToKey(occurrence.date)));

    const schedulesToUpdate = series
        .filter((occurrence) => targetByDateKey.has(dateToKey(occurrence.date)))
        .map((occurrence) => {
            const targetOccurrence = targetByDateKey.get(dateToKey(occurrence.date))!;
            return {
                ...occurrence,
                recurrenceRule: targetOccurrence.recurrenceRule,
                updatedAt: Date.now(),
                deleted: false,
            };
        });

    return {
        schedulesToDelete,
        schedulesToCreate,
        schedulesToUpdate,
    };
}

export function findScheduleConflicts(
    candidateSchedules: ScheduledPlaylist[],
    existingSchedules: ScheduledPlaylist[],
    excludeIds: Set<string> = new Set(),
): string[] {
    const activeExisting = existingSchedules.filter((s) => !s.deleted && !excludeIds.has(s.id));
    const conflictMessages: string[] = [];

    for (const candidate of candidateSchedules) {
        const destinationExistingSchedules = activeExisting.filter((s) =>
            isSameDay(timestampToDate(s.date), timestampToDate(candidate.date)),
        );

        const mergedDestinationSchedules = [
            ...destinationExistingSchedules.filter((s) => s.id !== candidate.id),
            candidate,
        ];

        try {
            const candidateTimes = getScheduleTimes(candidate);
            const overlappingSchedules = mergedDestinationSchedules.filter((existing) => {
                if (existing.id === candidate.id) return false;
                const existingTimes = getScheduleTimes(existing);
                return (
                    candidateTimes.startTimeMS < existingTimes.endTimeMS &&
                    candidateTimes.endTimeMS > existingTimes.startTimeMS
                );
            });

            for (const existing of overlappingSchedules) {
                const message = `${existing.title || existing.playlistTitle} (${existing.fromTime} - ${existing.toTime})`;
                if (!conflictMessages.includes(message)) {
                    conflictMessages.push(message);
                }
            }
        } catch {
            // Skip candidates that fail time parsing; upstream validation handles those.
        }
    }

    return conflictMessages;
}

export function buildDragOperationPayload(
    operation: ScheduleDragOperation,
    sourceSchedule: ScheduledPlaylist,
    destinationDate: Date,
    allSchedules: ScheduledPlaylist[],
):
    | {
          schedulesToDelete: ScheduledPlaylist[];
          schedulesToCreate: ScheduledPlaylist[];
          schedulesToUpdate: ScheduledPlaylist[];
      }
    | { singleSchedule: ScheduledPlaylist }
    | null {
    if (operation === 'copy' || operation === 'move') {
        return { singleSchedule: buildMoveOrCopySchedule(sourceSchedule, destinationDate, operation) };
    }

    if (operation === 'fill') {
        return buildFillSchedules(sourceSchedule, destinationDate);
    }

    if (operation === 'changeStartDate') {
        return buildBoundaryChangeSchedules(sourceSchedule, allSchedules, destinationDate, 'start');
    }

    if (operation === 'changeEndDate') {
        return buildBoundaryChangeSchedules(sourceSchedule, allSchedules, destinationDate, 'end');
    }

    return null;
}
