import { describe, expect, it } from 'vitest';
import type { PlaylistRecord } from '@ezplayer/ezplayer-core';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildFppdSchedule,
    fppDayToWeekdays,
    fppScheduleToRecords,
    recordsToFppSchedule,
    weekdaysToFppDay,
} from './fpp-schedule';
import { gaps } from './shape-check';

// Captured from a real FPP; see __fixtures__/fpp-10.1/README.md.
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'fpp-10.1');

const playlists: PlaylistRecord[] = [{ id: 'pl1', title: 'Main Show', tags: [], createdAt: 0, items: [] }];

// Wed 2026-07-15 12:00 local
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime();

describe('day code mapping', () => {
    it('maps FPP day codes to weekday sets', () => {
        expect(fppDayToWeekdays(7)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
        expect(fppDayToWeekdays(0)).toEqual(['Sun']);
        expect(fppDayToWeekdays(6)).toEqual(['Sat']);
        expect(fppDayToWeekdays(8)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
        expect(fppDayToWeekdays(9)).toEqual(['Sat', 'Sun']);
        expect(fppDayToWeekdays(13)).toEqual(['Fri', 'Sat']);
        expect(fppDayToWeekdays(14)).toBeUndefined(); // odd day-of-month
        // bitmask: Sunday 0x4000 | Saturday 0x0100
        expect(fppDayToWeekdays(0x10000 | 0x4000 | 0x0100)).toEqual(['Sun', 'Sat']);
    });

    it('round-trips weekday sets to codes', () => {
        expect(weekdaysToFppDay(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])).toBe(7);
        expect(weekdaysToFppDay(['Wed'])).toBe(3);
        expect(weekdaysToFppDay(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])).toBe(8);
        expect(weekdaysToFppDay(['Fri', 'Sat'])).toBe(13);
        expect(weekdaysToFppDay(['Mon', 'Sat'])).toBe(0x10000 | 0x02000 | 0x00100);
        for (const code of [7, 0, 3, 8, 9, 10, 11, 12, 13]) {
            expect(weekdaysToFppDay(fppDayToWeekdays(code)!)).toBe(code);
        }
    });
});

describe('fppScheduleToRecords', () => {
    it('materializes a daily entry per day within the range', () => {
        const { records, warnings } = fppScheduleToRecords(
            [
                {
                    enabled: 1,
                    day: 7,
                    playlist: 'Main Show',
                    startTime: '17:00:00',
                    endTime: '22:00:00',
                    startDate: '2026-07-15',
                    endDate: '2026-07-21',
                    repeat: 1,
                    stopType: 0,
                },
            ],
            playlists,
            NOW,
        );
        expect(warnings).toEqual([]);
        expect(records.length).toBe(7);
        expect(records[0]).toMatchObject({
            playlistId: 'pl1',
            fromTime: '17:00',
            toTime: '22:00',
            loop: true,
            enabled: true,
            endPolicy: 'seqboundnearest',
            recurrence: 'daily',
        });
        expect(records.every((r) => r.baseScheduleId === records[0].baseScheduleId)).toBe(true);
        // consecutive days
        expect(new Date(records[1].date).getDate() - new Date(records[0].date).getDate()).toBe(1);
    });

    it('filters weekend-only entries to Sat/Sun and maps stopType', () => {
        const { records } = fppScheduleToRecords(
            [
                {
                    enabled: 1,
                    day: 9,
                    playlist: 'Main Show',
                    startTime: '18:00:00',
                    endTime: '23:00:00',
                    startDate: '2026-07-15',
                    endDate: '2026-07-28',
                    repeat: 0,
                    stopType: 1,
                },
            ],
            playlists,
            NOW,
        );
        expect(records.length).toBe(4); // Jul 18,19,25,26
        expect(
            records.every((r) =>
                ['Sat', 'Sun'].includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(r.date).getDay()]),
            ),
        ).toBe(true);
        expect(records[0].endPolicy).toBe('hardcut');
        expect(records[0].loop).toBe(false);
    });

    it('warns and skips unknown playlists and unsupported day codes', () => {
        const { records, warnings } = fppScheduleToRecords(
            [
                { day: 7, playlist: 'Nope', startTime: '17:00:00', endTime: '18:00:00' },
                { day: 14, playlist: 'Main Show', startTime: '17:00:00', endTime: '18:00:00' },
            ],
            playlists,
            NOW,
        );
        expect(records).toEqual([]);
        expect(warnings.length).toBe(2);
    });

    it('caps materialization at the horizon with a warning', () => {
        const { records, warnings } = fppScheduleToRecords(
            [
                {
                    day: 7,
                    playlist: 'Main Show',
                    startTime: '17:00:00',
                    endTime: '18:00:00',
                    startDate: '2026-01-01',
                    endDate: '2099-12-31',
                },
            ],
            playlists,
            NOW,
        );
        expect(records.length).toBeLessThanOrEqual(401);
        expect(records.length).toBeGreaterThan(390);
        expect(warnings.some((w) => w.includes('materialized'))).toBe(true);
        // materialization starts today, not 2026-01-01
        expect(records[0].date).toBeGreaterThanOrEqual(new Date(2026, 6, 15).getTime());
    });
});

describe('recordsToFppSchedule', () => {
    it('collapses a materialized series back to one FPP entry (round-trip)', () => {
        const { records } = fppScheduleToRecords(
            [
                {
                    enabled: 1,
                    day: 13,
                    playlist: 'Main Show',
                    startTime: '19:30:00',
                    endTime: '23:00:00',
                    startDate: '2026-07-15',
                    endDate: '2026-08-15',
                    repeat: 1,
                    stopType: 2,
                },
            ],
            playlists,
            NOW,
        );
        const back = recordsToFppSchedule(records);
        expect(back.length).toBe(1);
        expect(back[0]).toMatchObject({
            enabled: 1,
            day: 13,
            playlist: 'Main Show',
            startTime: '19:30:00',
            endTime: '23:00:00',
            startDate: '2026-07-15',
            endDate: '2026-08-15',
            repeat: 1,
            stopType: 2,
        });
    });

    it('emits single-day entries for standalone records', () => {
        const back = recordsToFppSchedule([
            {
                id: 's1',
                playlistId: 'pl1',
                title: 'One Off',
                playlistTitle: 'Main Show',
                date: new Date(2026, 6, 20).getTime(),
                fromTime: '17:00',
                toTime: '18:00',
                duration: 0,
            },
        ]);
        expect(back.length).toBe(1);
        expect(back[0]).toMatchObject({
            playlist: 'Main Show',
            day: 1, // 2026-07-20 is a Monday
            startDate: '2026-07-20',
            endDate: '2026-07-20',
            startTime: '17:00:00',
        });
    });
});

describe('buildFppdSchedule (the live scheduler view)', () => {
    // One FPP entry, every day 18:00–22:00, as captured from FPP 10.1.
    const { records } = fppScheduleToRecords(
        [
            {
                enabled: 1,
                playlist: 'RefShow',
                day: 7,
                startTime: '18:00:00',
                endTime: '22:00:00',
                repeat: 0,
                startDate: '2026-01-01',
                endDate: '2099-12-31',
                stopType: 0,
            },
        ],
        [{ id: 'pl1', title: 'RefShow', tags: [], createdAt: 0, items: [] } as PlaylistRecord],
        NOW,
    );

    it('matches the structure FPP reports', () => {
        const ours = buildFppdSchedule(records, NOW);
        const theirs = JSON.parse(
            readFileSync(path.join(fixtureDir, 'scheduled.fppd-schedule.json'), 'utf8'),
        ) as Record<string, unknown>;
        expect(gaps(ours, theirs)).toEqual([]);
    });

    it('lists the rule and the occurrences due in the look-ahead window', () => {
        const out = buildFppdSchedule(records, NOW) as {
            schedule: {
                entries: Record<string, unknown>[];
                items: Record<string, unknown>[];
                scheduleDistance: number;
            };
        };
        expect(out.schedule.entries).toHaveLength(1);
        expect(out.schedule.entries[0]).toMatchObject({
            playlist: 'RefShow',
            day: 7,
            dayStr: 'Everyday',
            startTimeStr: '18:00:00',
            startDateInt: 20260101,
            stopTypeStr: 'Graceful',
            type: 'playlist',
        });
        // Daily for 28 days, plus today's own occurrence.
        expect(out.schedule.items.length).toBeGreaterThanOrEqual(28);
        expect(out.schedule.items[0]).toMatchObject({
            command: 'Start Playlist',
            args: ['RefShow', 'false', 'false'],
            startTimeStr: expect.stringMatching(/@ 06:00 PM$/) as unknown as string,
        });
        // Every listed item ends in the future and starts within the window.
        const horizon = NOW + out.schedule.scheduleDistance * 86_400_000;
        for (const i of out.schedule.items) {
            expect((i.endTime as number) * 1000).toBeGreaterThanOrEqual(NOW);
            expect((i.startTime as number) * 1000).toBeLessThanOrEqual(horizon);
        }
    });
});
