import { describe, expect, it } from 'vitest';

import { generateDailyOccurrences, generateSelectedDaysOccurrences } from './scheduleRecurrence';

// Calendar expansion for recurring schedules. Dates are constructed with the
// local-time Date constructor and compared against the same construction, so
// every assertion holds regardless of the machine's timezone; the meaningful
// claim is "one row per calendar day at local midnight".

const base = {
    id: 'ser',
    playlistId: 'pl',
    playlistTitle: 'PL',
    title: 'Series',
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0,
};

const midnight = (y: number, m: number, d: number) => new Date(y, m, d).getTime();

describe('generateDailyOccurrences', () => {
    it('creates one linked row per day, endpoints inclusive', () => {
        const rows = generateDailyOccurrences(new Date(2026, 7, 10), new Date(2026, 7, 14), base);
        expect(rows.map((r) => r.id)).toEqual([
            'ser-2026-08-10',
            'ser-2026-08-11',
            'ser-2026-08-12',
            'ser-2026-08-13',
            'ser-2026-08-14',
        ]);
        expect(rows.map((r) => r.date)).toEqual([10, 11, 12, 13, 14].map((d) => midnight(2026, 7, d)));
        for (const r of rows) {
            expect(r.baseScheduleId).toBe('ser');
            expect(r.recurrence).toBe('daily');
            expect(r.fromTime).toBe('18:00');
            expect(r.toTime).toBe('19:00');
            expect(r.recurrenceRule).toEqual({
                frequency: 'daily',
                startDate: midnight(2026, 7, 10),
                endDate: midnight(2026, 7, 14),
            });
        }
    });

    it('start == end yields a single-row series', () => {
        const rows = generateDailyOccurrences(new Date(2026, 7, 10), new Date(2026, 7, 10), base);
        expect(rows.map((r) => r.id)).toEqual(['ser-2026-08-10']);
    });

    it('without an end date falls back to one standalone row', () => {
        const rows = generateDailyOccurrences(new Date(2026, 7, 10), null, base);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('ser'); // no per-day suffix
        expect(rows[0].baseScheduleId).toBeUndefined();
        expect(rows[0].date).toBe(midnight(2026, 7, 10));
    });

    it('crosses a month boundary', () => {
        const rows = generateDailyOccurrences(new Date(2026, 7, 30), new Date(2026, 8, 2), base);
        expect(rows.map((r) => r.id)).toEqual(['ser-2026-08-30', 'ser-2026-08-31', 'ser-2026-09-01', 'ser-2026-09-02']);
    });

    it('crosses a DST transition with one row per calendar day at local midnight', () => {
        // US fall-back is Nov 1 2026; in DST zones that day is 25h long
        const rows = generateDailyOccurrences(new Date(2026, 9, 31), new Date(2026, 10, 2), base);
        expect(rows.map((r) => r.id)).toEqual(['ser-2026-10-31', 'ser-2026-11-01', 'ser-2026-11-02']);
        expect(rows.map((r) => r.date)).toEqual([midnight(2026, 9, 31), midnight(2026, 10, 1), midnight(2026, 10, 2)]);
    });
});

describe('generateSelectedDaysOccurrences', () => {
    it('keeps only the selected weekdays across the range', () => {
        // Mon Aug 10 .. Sun Aug 23 2026, Mon/Wed/Fri
        const rows = generateSelectedDaysOccurrences(
            new Date(2026, 7, 10),
            new Date(2026, 7, 23),
            ['Mon', 'Wed', 'Fri'],
            base,
        );
        expect(rows.map((r) => r.id)).toEqual([
            'ser-2026-08-10',
            'ser-2026-08-12',
            'ser-2026-08-14',
            'ser-2026-08-17',
            'ser-2026-08-19',
            'ser-2026-08-21',
        ]);
        for (const r of rows) {
            expect([1, 3, 5]).toContain(new Date(r.date).getDay());
            expect(r.recurrence).toBe('selectedDays');
            expect(r.recurrenceRule).toEqual({
                frequency: 'weekly',
                byWeekDay: ['Mon', 'Wed', 'Fri'],
                startDate: midnight(2026, 7, 10),
                endDate: midnight(2026, 7, 23),
            });
        }
    });

    it('yields no weekend rows for a weekday selection over a weekend', () => {
        // Sat Aug 15 .. Sun Aug 16 2026
        const rows = generateSelectedDaysOccurrences(
            new Date(2026, 7, 15),
            new Date(2026, 7, 16),
            ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            base,
        );
        expect(rows).toHaveLength(0);
    });

    it('without an end date or days falls back to one standalone row', () => {
        const noEnd = generateSelectedDaysOccurrences(new Date(2026, 7, 10), null, ['Mon'], base);
        expect(noEnd).toHaveLength(1);
        expect(noEnd[0].id).toBe('ser');

        const noDays = generateSelectedDaysOccurrences(new Date(2026, 7, 10), new Date(2026, 7, 23), [], base);
        expect(noDays).toHaveLength(1);
        expect(noDays[0].id).toBe('ser');
    });
});
