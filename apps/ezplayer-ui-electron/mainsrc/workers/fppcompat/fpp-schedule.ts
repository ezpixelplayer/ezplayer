/**
 * FPP schedule translators — FPP schedule.json entries ⇄ EZPlayer
 * ScheduledPlaylist records.
 *
 * EZPlayer's engine consumes ONE DATED OCCURRENCE per record (`date` +
 * `fromTime`/`toTime`); recurring schedules are materialized per-day by the
 * writer (exactly what the desktop scheduler UI does, with `baseScheduleId`
 * grouping and `recurrenceRule` metadata). FPP entries are recurring rules, so
 * ingest materializes them across a bounded horizon (MATERIALIZE_DAYS from
 * today — FPP's customary endDate of 2099-12-31 would otherwise create tens of
 * thousands of records), and egress collapses each baseScheduleId group back
 * into a single FPP entry.
 *
 * FPP `day` codes (src/Scheduler.h): 0-6 = Sun..Sat, 7 everyday, 8 weekdays,
 * 9 weekend, 10 Mon/Wed/Fri, 11 Tue/Thu, 12 Sun-Thu, 13 Fri/Sat,
 * 14 odd / 15 even (unsupported here), and 0x10000|mask with per-day bits
 * (Sunday 0x4000 down to Saturday 0x0100).
 */

import * as crypto from 'crypto';
import type { PlaylistRecord, ScheduledPlaylist, ScheduleEndPolicy } from '@ezplayer/ezplayer-core';

export const MATERIALIZE_DAYS = 400; // ~13 months: covers a full season plan

export interface FppScheduleEntry {
    enabled?: number;
    day?: number;
    playlist?: string;
    startTime?: string; // "HH:MM:SS"
    endTime?: string;
    startDate?: string; // "YYYY-MM-DD"
    endDate?: string;
    repeat?: number;
    stopType?: number; // 0 graceful, 1 hard, 2 graceful-after-loop
    sequence?: number;
    [k: string]: unknown;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MASK_BITS: Array<[string, number]> = [
    ['Sun', 0x04000],
    ['Mon', 0x02000],
    ['Tue', 0x01000],
    ['Wed', 0x00800],
    ['Thu', 0x00400],
    ['Fri', 0x00200],
    ['Sat', 0x00100],
];

/** FPP day code → weekday-name set; undefined = unsupported (odd/even). */
export function fppDayToWeekdays(day: number | undefined): string[] | undefined {
    if (day === undefined) return [...DAY_NAMES];
    if (day >= 0 && day <= 6) return [DAY_NAMES[day]];
    switch (day) {
        case 7:
            return [...DAY_NAMES];
        case 8:
            return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        case 9:
            return ['Sat', 'Sun'];
        case 10:
            return ['Mon', 'Wed', 'Fri'];
        case 11:
            return ['Tue', 'Thu'];
        case 12:
            return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'];
        case 13:
            return ['Fri', 'Sat'];
        case 14:
        case 15:
            return undefined; // odd/even day-of-month not supported
    }
    if (day >= 0x10000) {
        const days = MASK_BITS.filter(([, bit]) => (day & bit) !== 0).map(([n]) => n);
        return days.length ? days : undefined;
    }
    return undefined;
}

/** Weekday-name set → FPP day code (special codes preferred, else bitmask). */
export function weekdaysToFppDay(days: string[] | undefined): number {
    const set = new Set(days && days.length ? days : DAY_NAMES);
    const eq = (names: string[]) => names.length === set.size && names.every((n) => set.has(n));
    if (set.size === 7) return 7;
    if (set.size === 1) return DAY_NAMES.indexOf([...set][0] as (typeof DAY_NAMES)[number]);
    if (eq(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])) return 8;
    if (eq(['Sat', 'Sun'])) return 9;
    if (eq(['Mon', 'Wed', 'Fri'])) return 10;
    if (eq(['Tue', 'Thu'])) return 11;
    if (eq(['Sun', 'Mon', 'Tue', 'Wed', 'Thu'])) return 12;
    if (eq(['Fri', 'Sat'])) return 13;
    let mask = 0x10000;
    for (const [name, bit] of MASK_BITS) if (set.has(name)) mask |= bit;
    return mask;
}

function hhmm(t: string | undefined, fallback: string): string {
    if (!t) return fallback;
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim());
    if (!m) return fallback;
    return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function hhmmss(t: string | undefined): string {
    if (!t) return '00:00:00';
    const parts = t.split(':');
    while (parts.length < 3) parts.push('00');
    return parts.map((p) => p.padStart(2, '0')).join(':');
}

function parseDateLocal(d: string | undefined, fallback: Date): Date {
    if (!d) return fallback;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
    if (!m) return fallback;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function ymd(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

function stopTypeToEndPolicy(stopType: number | undefined): ScheduleEndPolicy {
    switch (stopType) {
        case 1:
            return 'hardcut';
        case 2:
            return 'seqboundlate';
        default:
            return 'seqboundnearest';
    }
}

function endPolicyToStopType(p: ScheduleEndPolicy | undefined): number {
    switch (p) {
        case 'hardcut':
            return 1;
        case 'seqboundlate':
            return 2;
        default:
            return 0;
    }
}

export interface FppScheduleIngest {
    records: ScheduledPlaylist[];
    warnings: string[];
}

/** Materialize FPP schedule entries into per-day ScheduledPlaylists. `now` is
 *  injected for testability. */
export function fppScheduleToRecords(
    entries: FppScheduleEntry[],
    playlists: PlaylistRecord[] | undefined,
    now: number,
): FppScheduleIngest {
    const warnings: string[] = [];
    const records: ScheduledPlaylist[] = [];
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + MATERIALIZE_DAYS);

    entries.forEach((entry, i) => {
        const plName = entry.playlist ?? '';
        const pl = playlists?.find((p) => !p.deleted && p.title.toLowerCase() === plName.toLowerCase());
        if (!pl) {
            warnings.push(`schedule entry ${i}: unknown playlist '${plName}' skipped`);
            return;
        }
        const weekdays = fppDayToWeekdays(entry.day);
        if (!weekdays) {
            warnings.push(`schedule entry ${i}: day code ${entry.day} (odd/even) not supported, skipped`);
            return;
        }
        const startDate = parseDateLocal(entry.startDate, today);
        const endDate = parseDateLocal(entry.endDate, horizon);
        const from = startDate > today ? startDate : today;
        const to = endDate < horizon ? endDate : horizon;
        if (to < from) {
            warnings.push(`schedule entry ${i}: date range entirely in the past, skipped`);
            return;
        }
        if (endDate > horizon) {
            warnings.push(
                `schedule entry ${i}: materialized ${MATERIALIZE_DAYS} days ahead (through ${ymd(horizon)}); re-POST the schedule to extend`,
            );
        }

        const baseId = `fpp-${crypto.randomUUID()}`;
        const daySet = new Set(weekdays);
        const fromTime = hhmm(entry.startTime, '00:00');
        const toTime = hhmm(entry.endTime, '24:00');
        const rule = {
            frequency: (daySet.size === 7 ? 'daily' : 'weekly') as 'daily' | 'weekly',
            byWeekDay: daySet.size === 7 ? undefined : weekdays,
            startDate: startDate.getTime(),
            endDate: endDate.getTime(),
        };

        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
            if (!daySet.has(DAY_NAMES[d.getDay()])) continue;
            records.push({
                id: `${baseId}-${ymd(d)}`,
                baseScheduleId: baseId,
                scheduleType: 'main',
                playlistId: pl.id,
                title: pl.title,
                playlistTitle: pl.title,
                date: d.getTime(),
                fromTime,
                toTime,
                duration: 0,
                recurrence: daySet.size === 7 ? 'daily' : 'selectedDays',
                recurrenceRule: rule,
                enabled: entry.enabled !== 0,
                loop: !!entry.repeat,
                endPolicy: stopTypeToEndPolicy(entry.stopType),
            });
        }
    });
    return { records, warnings };
}

/** Collapse ScheduledPlaylist records back into FPP schedule entries — one per
 *  baseScheduleId group (standalone records become single-day entries). */
export function recordsToFppSchedule(records: ScheduledPlaylist[] | undefined): FppScheduleEntry[] {
    const groups = new Map<string, ScheduledPlaylist[]>();
    for (const r of records ?? []) {
        if (r.deleted) continue;
        const key = r.baseScheduleId ?? r.id;
        const g = groups.get(key);
        if (g) g.push(r);
        else groups.set(key, [r]);
    }
    const out: FppScheduleEntry[] = [];
    for (const group of groups.values()) {
        group.sort((a, b) => a.date - b.date);
        const first = group[0];
        const rule = first.recurrenceRule;
        const weekdays =
            rule?.frequency === 'daily'
                ? [...DAY_NAMES]
                : (rule?.byWeekDay ?? [...new Set(group.map((r) => DAY_NAMES[new Date(r.date).getDay()]))]);
        out.push({
            enabled: first.enabled === false ? 0 : 1,
            playlist: first.playlistTitle || first.title,
            day: weekdaysToFppDay(weekdays),
            startTime: hhmmss(first.fromTime),
            endTime: hhmmss(first.toTime),
            startDate: ymd(new Date(rule?.startDate ?? first.date)),
            endDate: ymd(new Date(rule?.endDate ?? group[group.length - 1].date)),
            repeat: first.loop ? 1 : 0,
            stopType: endPolicyToStopType(first.endPolicy),
        });
    }
    return out;
}
