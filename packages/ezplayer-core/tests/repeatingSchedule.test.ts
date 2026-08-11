import { describe, it, expect } from 'vitest';

import { PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '../src/types/DataTypes';
import { PlayerRunState } from '../src/util/schedulecomp';

// Repeating schedules as the scheduler UI materializes them: one dated row per
// occurrence, linked by baseScheduleId. The engine never sees the recurrence —
// these tests pin that the concrete rows simulate correctly across days, and
// what happens when a series is edited while the player has it loaded.
//
// Series edits come in two shapes (mirroring PlaylistScheduler):
//  - 'single' mode: one occurrence row is updated in place (same id)
//  - 'all' mode: every row of the series is deleted and a new series with a
//    new baseScheduleId (and new row ids) is created

const seqA: SequenceRecord = {
    id: 'A',
    instanceId: 'A',
    work: { length: 100, artist: 'a', title: 'A' },
    files: { fseq: 'a.fseq' },
};

const plA: PlaylistRecord = {
    id: 'plA',
    title: 'plA',
    tags: [],
    createdAt: 0,
    items: [{ id: 'A', sequence: 1 }],
};

const DAY = 24 * 3600_000;

// Fixed local date so results don't depend on when the test runs
const FIRST = new Date(2026, 7, 10); // Mon Aug 10 2026, local midnight
const BT = FIRST.getTime();

function ymd(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Dated rows the way the UI generates them; skipDays models selected-days gaps. */
function dailySeries(
    baseId: string,
    days: number,
    fromTime: string,
    toTime: string,
    opts?: { skipDays?: number[]; loop?: boolean },
): ScheduledPlaylist[] {
    const out: ScheduledPlaylist[] = [];
    for (let i = 0; i < days; i++) {
        if (opts?.skipDays?.includes(i)) continue;
        const d = new Date(FIRST);
        d.setDate(d.getDate() + i);
        out.push({
            id: `${baseId}-${ymd(d)}`,
            baseScheduleId: baseId,
            scheduleType: 'main',
            title: baseId,
            playlistId: 'plA',
            playlistTitle: 'plA',
            date: d.getTime(),
            fromTime,
            toTime,
            duration: 0,
            recurrence: 'daily',
            loop: opts?.loop,
        });
    }
    return out;
}

/** Local wall-clock instant on day `i` of the series. */
function at(dayIndex: number, hours: number, minutes = 0, seconds = 0): number {
    const d = new Date(FIRST);
    d.setDate(d.getDate() + dayIndex);
    d.setHours(hours, minutes, seconds, 0);
    return d.getTime();
}

function setUp(schedules: ScheduledPlaylist[]): PlayerRunState {
    const plr = new PlayerRunState(BT);
    const errs: string[] = [];
    plr.setUpSequences([seqA], [plA], schedules, errs);
    expect(errs).toEqual([]);
    return plr;
}

/** State already 10s into day 0's 18:00 occurrence, with `days` days loaded. */
function runningState(schedules: ScheduledPlaylist[], days: number): PlayerRunState {
    const plr = setUp(schedules);
    plr.addTimeRangeToSchedule(BT, BT + days * DAY);
    plr.runUntil(at(0, 18, 0, 10));
    expect(plr.depth).toBeGreaterThan(0);
    return plr;
}

describe('repeating schedule simulation', () => {
    it('plays each occurrence on its own day at the scheduled local time', () => {
        const plr = setUp(dailySeries('ser', 3, '18:00', '19:00'));
        const logs = plr.readOutScheduleUntil(BT + 3 * DAY, 300);

        const starts = logs.filter((l) => l.eventType === 'Schedule Started');
        expect(starts.map((l) => l.scheduleId)).toEqual(['ser-2026-08-10', 'ser-2026-08-11', 'ser-2026-08-12']);
        expect(starts.map((l) => l.eventTime)).toEqual([at(0, 18), at(1, 18), at(2, 18)]);

        // Single 100s song, no loop: each occurrence ends at its sequence end
        const ends = logs.filter((l) => l.eventType === 'Schedule Ended');
        expect(ends.map((l) => l.eventTime)).toEqual([
            at(0, 18, 1, 40),
            at(1, 18, 1, 40),
            at(2, 18, 1, 40),
        ]);
    });

    it('a selected-days gap is silent — nothing plays on the missing day', () => {
        const plr = setUp(dailySeries('ser', 4, '18:00', '19:00', { skipDays: [1] }));
        const logs = plr.readOutScheduleUntil(BT + 4 * DAY, 300);

        const starts = logs.filter((l) => l.eventType === 'Schedule Started');
        expect(starts.map((l) => l.scheduleId)).toEqual(['ser-2026-08-10', 'ser-2026-08-12', 'ser-2026-08-13']);
        const day1Events = logs.filter((l) => l.eventTime > at(0, 19) && l.eventTime < at(2, 0));
        expect(day1Events).toEqual([]);
    });

    it('an overnight occurrence spans midnight without disturbing the next day', () => {
        // 23:30 -> 25:00 (01:00 next day); looped 100s song fits the 90min window exactly
        const plr = setUp(dailySeries('ser', 2, '23:30', '25:00', { loop: true }));
        const logs = plr.readOutScheduleUntil(BT + 3 * DAY, 5000);

        const starts = logs.filter((l) => l.eventType === 'Schedule Started');
        // A looped schedule running out its window emits 'Schedule Stopped' at the end time
        const ends = logs.filter((l) => l.eventType === 'Schedule Stopped');
        expect(starts.map((l) => l.eventTime)).toEqual([at(0, 23, 30), at(1, 23, 30)]);
        expect(ends.map((l) => l.eventTime)).toEqual([at(1, 1, 0), at(2, 1, 0)]);
    });
});

describe('editing a repeating schedule loaded into a running state', () => {
    function apply(plr: PlayerRunState, schedules: ScheduledPlaylist[], days: number) {
        plr.applyDataUpdate([seqA], [plA], schedules, [], plr.currentTime, BT + days * DAY);
    }

    it("adopts an in-place start-time edit of a future occurrence ('single' mode)", () => {
        const series = dailySeries('ser', 3, '18:00', '19:00');
        const plr = runningState(series, 3);
        expect(plr.upcomingById.get('ser-2026-08-11')?.schedStart).toBe(at(1, 18));

        const edited = series.map((s) => (s.id === 'ser-2026-08-11' ? { ...s, fromTime: '20:00', toTime: '21:00' } : s));
        apply(plr, edited, 3);

        expect(plr.upcomingById.get('ser-2026-08-11')?.schedStart).toBe(at(1, 20));
        expect(plr.upcomingById.get('ser-2026-08-12')?.schedStart).toBe(at(2, 18)); // untouched sibling
    });

    it("drops an in-place deleted single occurrence from upcoming ('single' mode delete)", () => {
        const series = dailySeries('ser', 3, '18:00', '19:00');
        const plr = runningState(series, 3);
        expect(plr.upcomingById.has('ser-2026-08-11')).toBe(true);

        const edited = series.map((s) => (s.id === 'ser-2026-08-11' ? { ...s, deleted: true } : s));
        apply(plr, edited, 3);

        expect(plr.upcomingById.has('ser-2026-08-11')).toBe(false);
        expect(plr.upcomingById.has('ser-2026-08-12')).toBe(true);
    });

    it('freezes the active occurrence on start-time edit, accepts an end-time edit', () => {
        const series = dailySeries('ser', 3, '18:00', '19:00');
        const plr = runningState(series, 3);
        const top = plr.stack[plr.stack.length - 1];
        expect(top.item.scheduleId).toBe('ser-2026-08-10');

        // End moved: accepted live
        apply(plr, series.map((s) => (s.id === 'ser-2026-08-10' ? { ...s, toTime: '19:30' } : s)), 3);
        expect(top.item.schedEnd).toBe(at(0, 19, 30));

        // Start moved (with end): frozen — reload applies it
        apply(plr, series.map((s) => (s.id === 'ser-2026-08-10' ? { ...s, fromTime: '17:00', toTime: '20:00' } : s)), 3);
        expect(top.item.schedStart).toBe(at(0, 18));
        expect(top.item.schedEnd).toBe(at(0, 19, 30));
    });

    it("winds down the active occurrence and starts the replacement series ('all' mode)", () => {
        const series = dailySeries('ser', 3, '18:00', '19:00');
        const plr = runningState(series, 3);
        const top = plr.stack[plr.stack.length - 1];

        // The UI replaces a series wholesale: old rows deleted, new base id, new times
        const replaced = [
            ...series.map((s) => ({ ...s, deleted: true })),
            ...dailySeries('ser2', 3, '18:30', '19:30'),
        ];
        apply(plr, replaced, 3);

        // Old active occurrence is wound down (its id no longer exists)
        expect(top.item.schedEnd).toBeLessThanOrEqual(plr.currentTime);
        // Replacement rows are loaded
        expect(plr.upcomingById.has('ser2-2026-08-10')).toBe(true);
        expect(plr.upcomingById.has('ser2-2026-08-11')).toBe(true);

        // Old one stops at its sequence boundary, new one starts on its edited time
        const logs = plr.readOutScheduleUntil(at(0, 20), 100);
        const oldStop = logs.find((l) => l.eventType === 'Schedule Stopped' && l.scheduleId === 'ser-2026-08-10');
        const newStart = logs.find((l) => l.eventType === 'Schedule Started' && l.scheduleId === 'ser2-2026-08-10');
        expect(oldStop?.eventTime).toBe(at(0, 18, 1, 40)); // graceful: the playing 100s song completes
        expect(newStart?.eventTime).toBe(at(0, 18, 30));
    });

    it("starts a replacement whose window already covers now ('all' mode, earlier start)", () => {
        const series = dailySeries('ser', 3, '18:00', '19:00');
        const plr = runningState(series, 3);

        const replaced = [
            ...series.map((s) => ({ ...s, deleted: true })),
            ...dailySeries('ser2', 3, '17:30', '19:30'),
        ];
        apply(plr, replaced, 3);

        // The covering window loads as immediately runnable (heap, not upcoming)
        expect(plr.heapById.has('ser2-2026-08-10')).toBe(true);

        // The wound-down old entry finishes its playing song, then the covering
        // replacement takes over at that same boundary
        const logs = plr.readOutScheduleUntil(at(0, 20), 100);
        const oldStop = logs.find((l) => l.eventType === 'Schedule Stopped' && l.scheduleId === 'ser-2026-08-10');
        const newStart = logs.find((l) => l.eventType === 'Schedule Started' && l.scheduleId === 'ser2-2026-08-10');
        expect(oldStop?.eventTime).toBe(at(0, 18, 1, 40));
        expect(newStart?.eventTime).toBe(at(0, 18, 1, 40));
    });
});
