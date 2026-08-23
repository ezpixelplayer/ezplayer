import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { describe, expect, it } from 'vitest';

import {
    buildBoundaryChangeSchedules,
    buildFillSchedules,
    buildMoveOrCopySchedule,
    getDragDialogType,
    getOccurrenceRole,
    getSeriesOccurrences,
} from './scheduleDragDrop';

const once: ScheduledPlaylist = {
    id: 'one',
    playlistId: 'pl',
    playlistTitle: 'PL',
    title: 'Show',
    date: new Date(2026, 7, 10).getTime(),
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0,
    recurrence: 'once',
    baseScheduleId: '',
};

/** Apply a payload to a schedule list the way the store would after a post. */
function applyPayload(
    all: ScheduledPlaylist[],
    payload: {
        schedulesToDelete: ScheduledPlaylist[];
        schedulesToCreate: ScheduledPlaylist[];
        schedulesToUpdate: ScheduledPlaylist[];
    },
): ScheduledPlaylist[] {
    const byId = new Map(all.map((s) => [s.id, s]));
    for (const s of [...payload.schedulesToDelete, ...payload.schedulesToCreate, ...payload.schedulesToUpdate]) {
        byId.set(s.id, s);
    }
    return [...byId.values()];
}

describe('buildMoveOrCopySchedule', () => {
    it('a copy of a lone repeating occurrence is a standalone one-off, not a member of the series', () => {
        // fill Aug 10 → Aug 14
        const fill = buildFillSchedules(once, new Date(2026, 7, 14));
        let all = applyPayload([once], fill);
        expect(fill.schedulesToCreate).toHaveLength(5);
        const baseId = fill.schedulesToCreate[0].baseScheduleId!;

        // drag the end back to the start → one-day series
        const last = fill.schedulesToCreate[4];
        const shrink = buildBoundaryChangeSchedules(last, all, new Date(2026, 7, 10), 'end')!;
        all = applyPayload(all, shrink);
        const live = all.filter((s) => !s.deleted);
        expect(live).toHaveLength(1);
        const lone = live[0];
        expect(lone.recurrence).toBe('daily');
        expect(getOccurrenceRole(lone, all)).toBe('single');
        expect(getDragDialogType(lone, all)).toBe('single');

        // copy it to Aug 20
        const copy = buildMoveOrCopySchedule(lone, new Date(2026, 7, 20), 'copy');
        expect(copy.id).not.toBe(lone.id);
        expect(copy.date).toBe(new Date(2026, 7, 20).getTime());
        expect(copy.recurrence).toBe('once');
        expect(copy.baseScheduleId).toBe('');
        expect(copy.recurrenceRule).toBeUndefined();
        expect(copy.title).toBe('Show');
        expect(copy.fromTime).toBe('18:00');

        // the copy must not be grouped with the original series, and the
        // original must still be a lone occurrence
        all = [...all, copy];
        expect(getSeriesOccurrences(copy, all).map((s) => s.id)).toEqual([copy.id]);
        expect(getOccurrenceRole(copy, all)).toBe('single');
        expect(getDragDialogType(copy, all)).toBe('single');
        expect(getSeriesOccurrences(lone, all).map((s) => s.id)).toEqual([lone.id]);
        expect(getOccurrenceRole(lone, all)).toBe('single');
        expect(all.filter((s) => !s.deleted && s.baseScheduleId === baseId)).toHaveLength(1);
    });

    it('a copy of a one-off stays a one-off with a fresh id', () => {
        const copy = buildMoveOrCopySchedule(once, new Date(2026, 7, 12), 'copy');
        expect(copy.id).not.toBe(once.id);
        expect(copy.recurrence).toBe('once');
        expect(copy.baseScheduleId).toBe('');
        expect(copy.date).toBe(new Date(2026, 7, 12).getTime());
    });

    it('moving a one-off keeps its id and just changes the date', () => {
        const moved = buildMoveOrCopySchedule(once, new Date(2026, 7, 12), 'move');
        expect(moved.id).toBe(once.id);
        expect(moved.recurrence).toBe('once');
        expect(moved.date).toBe(new Date(2026, 7, 12).getTime());
    });

    it('moving a lone repeating occurrence detaches it from the series', () => {
        const fill = buildFillSchedules(once, new Date(2026, 7, 10));
        const lone = fill.schedulesToCreate[0];
        expect(lone.recurrence).toBe('daily');
        expect(lone.recurrenceRule).toBeDefined();

        const moved = buildMoveOrCopySchedule(lone, new Date(2026, 7, 12), 'move');
        expect(moved.id).toBe(lone.id);
        expect(moved.recurrence).toBe('once');
        expect(moved.baseScheduleId).toBe('');
        expect(moved.recurrenceRule).toBeUndefined();
        expect(moved.date).toBe(new Date(2026, 7, 12).getTime());
    });
});
