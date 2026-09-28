import { describe, expect, it } from 'vitest';

import type { VcStatsEvent } from '../types/ViewerControlWire';
import { summarizeViewerStats, trimViewerStatsEvents, viewerStatsDayKey, viewerStatsDayKeys } from './viewerStats';

const TZ = 'America/New_York';
// 2026-09-26 21:30 New York (01:30Z on the 27th) — a time where UTC and show-local days differ.
const NOW = Date.UTC(2026, 8, 27, 1, 30);

let seq = 0;
function ev(kind: VcStatsEvent['kind'], ts: number, extra: Partial<VcStatsEvent> = {}): VcStatsEvent {
    return { seq: ++seq, ts, kind, ...extra };
}

describe('viewerStats', () => {
    it('buckets days in the show timezone', () => {
        expect(viewerStatsDayKey(NOW, TZ)).toBe('2026-09-26');
        expect(viewerStatsDayKey(NOW, 'UTC')).toBe('2026-09-27');
        const keys = viewerStatsDayKeys(NOW, TZ, 3);
        expect(keys).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    });

    it('falls back to a usable formatter for an invalid zone', () => {
        expect(viewerStatsDayKey(NOW, 'Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('summarizes counts, unique viewers, peaks, songs and refusals', () => {
        const h = 3600_000;
        const events: VcStatsEvent[] = [
            ev('viewers', NOW - 5 * h, { count: 3 }),
            ev('request', NOW - 4 * h, { songId: 'a', title: 'Alpha', viewer: 'v1', count: 1, mode: 'request' }),
            ev('request', NOW - 3 * h, { songId: 'b', title: 'Beta', viewer: 'v2', count: 2, mode: 'request' }),
            ev('refused', NOW - 3 * h + 1, { songId: 'b', viewer: 'v2', reason: 'duplicate', mode: 'request' }),
            ev('pick', NOW - 2 * h, { songId: 'a', mode: 'request' }),
            ev('play', NOW - 2 * h + 5, { songId: 'a', title: 'Alpha' }),
            ev('listeners', NOW - 1 * h, { count: 7 }),
            ev('viewers', NOW - 1 * h, { count: 1 }),
            // yesterday (show-local)
            ev('vote', NOW - 26 * h, { songId: 'b', viewer: 'v3', count: 1, mode: 'vote' }),
            ev('vote', NOW - 26 * h + 1, { songId: 'b', viewer: 'v1', count: 2, mode: 'vote' }),
            // outside a 7-day window
            ev('request', NOW - 10 * 24 * h, { songId: 'z', viewer: 'v9' }),
        ];
        const s = summarizeViewerStats(events, { tz: TZ, now: NOW, windowDays: 7, recentLimit: 4 });
        expect(s.today).toMatchObject({
            day: '2026-09-26',
            requests: 2,
            votes: 0,
            refused: 1,
            picks: 1,
            plays: 1,
            uniqueViewers: 2,
            peakViewers: 3,
            peakListeners: 7,
        });
        expect(s.days).toHaveLength(7);
        expect(s.days[5]).toMatchObject({ day: '2026-09-25', votes: 2, uniqueViewers: 2 });
        expect(s.days[0].requests).toBe(0);
        expect(s.window).toMatchObject({ requests: 2, votes: 2, refused: 1, picks: 1, plays: 1, uniqueViewers: 3 });
        // b: 1 request + 2 votes = 3; a: 1 request
        expect(s.songs.map((x) => x.songId)).toEqual(['b', 'a']);
        expect(s.songs[0]).toMatchObject({ title: 'Beta', requests: 1, votes: 2, refused: 1 });
        expect(s.songs[1]).toMatchObject({ title: 'Alpha', picks: 1, plays: 1 });
        expect(s.refusals).toEqual([{ reason: 'duplicate', count: 1 }]);
        // Newest first, count samples excluded, limited.
        expect(s.recent.map((e) => e.kind)).toEqual(['play', 'pick', 'refused', 'request']);
    });

    it('trims by age then by count, keeping the newest', () => {
        const events = Array.from({ length: 10 }, (_, i) => ev('play', NOW - (10 - i) * 1000));
        expect(trimViewerStatsEvents(events, NOW, 5500, 100).map((e) => e.ts)).toEqual(
            events.slice(5).map((e) => e.ts),
        );
        expect(trimViewerStatsEvents(events, NOW, 1e9, 3)).toEqual(events.slice(7));
        expect(trimViewerStatsEvents(events, NOW, 1e9, 100)).toBe(events);
    });
});
