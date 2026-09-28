/**
 * Owner-facing viewer-activity summary, computed on the player from the
 * event stream it pulls off the player_server (see `VcStatsEvent`). The
 * player is the durable store; the cloud keeps ~72 h in RAM and no database.
 */

import type { VcSelectionReason, VcStatsEvent, VcStatsSnapshot } from '../types/ViewerControlWire';

/** A pulled event as the player stores it: tagged with the server epoch the
 *  seq belongs to, so the pair is unique across server restarts. */
export interface StoredViewerStatsEvent extends VcStatsEvent {
    epoch: string;
}

export interface ViewerStatsCounts {
    requests: number;
    votes: number;
    refused: number;
    picks: number;
    plays: number;
    /** Distinct viewer hashes that requested / voted (or were refused). Hashes
     *  are salted per server process, so a server restart can double count. */
    uniqueViewers: number;
    peakViewers: number;
    peakListeners: number;
}

export interface ViewerStatsDay extends ViewerStatsCounts {
    /** `YYYY-MM-DD` in the show's timezone. */
    day: string;
}

export interface ViewerStatsSong {
    songId: string;
    title?: string;
    requests: number;
    votes: number;
    refused: number;
    picks: number;
    plays: number;
    lastAt: number;
}

export interface ViewerStatsSummary {
    updatedAt: number;
    /** IANA zone used for day bucketing. */
    tz: string;
    windowDays: number;
    /** Where the next pull resumes. */
    cursor: { epoch?: string; seq: number };
    lastPullAt?: number;
    lastPullError?: string;
    /** The server dropped events before the player could pull them; counts
     *  for the affected period are incomplete. */
    gap?: boolean;
    /** Live picture from the last pull. */
    live?: VcStatsSnapshot;
    today: ViewerStatsDay;
    window: ViewerStatsCounts;
    /** One entry per day in the window, oldest first, zero-filled. */
    days: ViewerStatsDay[];
    /** Most requested / voted songs in the window, busiest first. */
    songs: ViewerStatsSong[];
    /** Newest first. */
    recent: VcStatsEvent[];
    /** Refusal reasons in the window, most common first. */
    refusals: Array<{ reason: VcSelectionReason | 'unknown'; count: number }>;
    /** Total events retained on the player. */
    storedEvents: number;
}

export interface SummarizeOptions {
    tz: string;
    now?: number;
    windowDays?: number;
    recentLimit?: number;
    topSongs?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(tz: string): Intl.DateTimeFormat {
    let f = formatters.get(tz);
    if (!f) {
        try {
            f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        } catch {
            f = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
        }
        formatters.set(tz, f);
    }
    return f;
}

/** `YYYY-MM-DD` for an instant in the given zone. */
export function viewerStatsDayKey(ts: number, tz: string): string {
    // en-CA formats as YYYY-MM-DD already; normalize in case of odd runtimes.
    const parts = dayFormatter(tz).formatToParts(new Date(ts));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function emptyCounts(): ViewerStatsCounts {
    return {
        requests: 0,
        votes: 0,
        refused: 0,
        picks: 0,
        plays: 0,
        uniqueViewers: 0,
        peakViewers: 0,
        peakListeners: 0,
    };
}

/** The last `windowDays` day keys ending today, oldest first. Steps 12 h at
 *  a time so DST changes can't skip a day, then de-duplicates. */
export function viewerStatsDayKeys(now: number, tz: string, windowDays: number): string[] {
    const keys: string[] = [];
    const seen = new Set<string>();
    let ts = now;
    while (keys.length < windowDays) {
        const k = viewerStatsDayKey(ts, tz);
        if (!seen.has(k)) {
            seen.add(k);
            keys.push(k);
        }
        ts -= 12 * 3600_000;
    }
    return keys.reverse();
}

export function summarizeViewerStats(
    events: readonly VcStatsEvent[],
    opts: SummarizeOptions,
): Pick<ViewerStatsSummary, 'today' | 'window' | 'days' | 'songs' | 'recent' | 'refusals' | 'tz' | 'windowDays'> {
    const now = opts.now ?? Date.now();
    const windowDays = opts.windowDays ?? 30;
    const recentLimit = opts.recentLimit ?? 50;
    const topSongs = opts.topSongs ?? 25;
    const tz = opts.tz;

    const dayKeys = viewerStatsDayKeys(now, tz, windowDays);
    const todayKey = dayKeys[dayKeys.length - 1]!;
    const days = new Map<string, ViewerStatsDay>();
    for (const k of dayKeys) days.set(k, { day: k, ...emptyCounts() });
    const dayViewers = new Map<string, Set<string>>();
    const windowViewers = new Set<string>();
    const window = emptyCounts();
    const songs = new Map<string, ViewerStatsSong>();
    const refusals = new Map<string, number>();

    const song = (ev: VcStatsEvent): ViewerStatsSong | undefined => {
        if (!ev.songId) return undefined;
        let s = songs.get(ev.songId);
        if (!s) {
            s = { songId: ev.songId, requests: 0, votes: 0, refused: 0, picks: 0, plays: 0, lastAt: 0 };
            songs.set(ev.songId, s);
        }
        if (ev.title && !s.title) s.title = ev.title;
        if (ev.ts > s.lastAt) s.lastAt = ev.ts;
        return s;
    };

    for (const ev of events) {
        const key = viewerStatsDayKey(ev.ts, tz);
        const day = days.get(key);
        if (!day) continue; // outside the window
        const sg = song(ev);
        switch (ev.kind) {
            case 'request':
                day.requests++;
                window.requests++;
                if (sg) sg.requests++;
                break;
            case 'vote':
                day.votes++;
                window.votes++;
                if (sg) sg.votes++;
                break;
            case 'refused': {
                day.refused++;
                window.refused++;
                if (sg) sg.refused++;
                const r = ev.reason ?? 'unknown';
                refusals.set(r, (refusals.get(r) ?? 0) + 1);
                break;
            }
            case 'pick':
                day.picks++;
                window.picks++;
                if (sg) sg.picks++;
                break;
            case 'play':
                day.plays++;
                window.plays++;
                if (sg) sg.plays++;
                break;
            case 'viewers':
                if ((ev.count ?? 0) > day.peakViewers) day.peakViewers = ev.count ?? 0;
                if ((ev.count ?? 0) > window.peakViewers) window.peakViewers = ev.count ?? 0;
                break;
            case 'listeners':
                if ((ev.count ?? 0) > day.peakListeners) day.peakListeners = ev.count ?? 0;
                if ((ev.count ?? 0) > window.peakListeners) window.peakListeners = ev.count ?? 0;
                break;
        }
        if (ev.viewer && (ev.kind === 'request' || ev.kind === 'vote' || ev.kind === 'refused')) {
            let set = dayViewers.get(key);
            if (!set) {
                set = new Set();
                dayViewers.set(key, set);
            }
            set.add(ev.viewer);
            windowViewers.add(ev.viewer);
        }
    }
    for (const [k, set] of dayViewers) {
        const d = days.get(k);
        if (d) d.uniqueViewers = set.size;
    }
    window.uniqueViewers = windowViewers.size;

    const songList = Array.from(songs.values())
        .filter((s) => s.requests + s.votes + s.picks + s.plays + s.refused > 0)
        .sort((a, b) => b.requests + b.votes - (a.requests + a.votes) || b.picks - a.picks || b.lastAt - a.lastAt)
        .slice(0, topSongs);

    const recent = events
        .filter((e) => e.kind !== 'viewers' && e.kind !== 'listeners')
        .sort((a, b) => b.ts - a.ts || b.seq - a.seq)
        .slice(0, recentLimit);

    const refusalList = Array.from(refusals.entries())
        .map(([reason, count]) => ({ reason: reason as VcSelectionReason | 'unknown', count }))
        .sort((a, b) => b.count - a.count);

    return {
        tz,
        windowDays,
        today: days.get(todayKey)!,
        window,
        days: dayKeys.map((k) => days.get(k)!),
        songs: songList,
        recent,
        refusals: refusalList,
    };
}

/** Retention applied on the player: drop events older than `retainMs` and
 *  keep at most `maxEvents` (newest). Returns the trimmed array. */
export function trimViewerStatsEvents<T extends VcStatsEvent>(
    events: T[],
    now: number,
    retainMs: number,
    maxEvents: number,
): T[] {
    let start = 0;
    while (start < events.length && now - events[start]!.ts > retainMs) start++;
    if (events.length - start > maxEvents) start = events.length - maxEvents;
    return start > 0 ? events.slice(start) : events;
}
