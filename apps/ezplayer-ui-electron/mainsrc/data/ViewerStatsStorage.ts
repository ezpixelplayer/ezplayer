/**
 * Persisted viewer-activity events for the current show folder
 * (`.ezplayer/viewer-stats.json`). The player is the durable home for what
 * the player_server keeps only briefly in RAM. Same coalescing single-flight
 * writer as CloudConfigStorage; writes happen only when new events landed.
 */

import * as fs from 'fs/promises';
import {
    LOCAL_STATS_EPOCH,
    dedupeViewerStatsEvents,
    trimViewerStatsEvents,
    viewerStatsEventKey,
    type StoredViewerStatsEvent,
    type VcDropReason,
    type VcPickSource,
    type VcStatsEventKind,
    type VcStatsResponse,
    type VcStatsSnapshot,
} from '@ezplayer/ezplayer-core';
import { atomicWriteFile } from './atomicWrite.js';

export interface ViewerStatsFile {
    version: 1;
    cursor: { epoch?: string; seq: number };
    events: StoredViewerStatsEvent[];
    lastSnapshot?: VcStatsSnapshot;
    lastPullAt?: number;
    /** A pull reported the server had dropped events we never saw. */
    gapAt?: number;
}

/** Keep a month of activity, bounded. */
const RETAIN_MS = 31 * 24 * 3600_000;
const MAX_EVENTS = 20_000;

function fresh(): ViewerStatsFile {
    return { version: 1, cursor: { seq: 0 }, events: [] };
}

let current: ViewerStatsFile = fresh();
let currentPath: string | undefined;
let writeInProgress = false;
let writeQueued = false;

export function getViewerStatsStore(): ViewerStatsFile {
    return current;
}

export async function loadViewerStatsFromDisk(filePath: string): Promise<ViewerStatsFile> {
    currentPath = filePath;
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        if (raw.trim() === '') {
            current = fresh();
            return current;
        }
        const parsed = JSON.parse(raw) as Partial<ViewerStatsFile>;
        const stored = Array.isArray(parsed.events) ? (parsed.events as StoredViewerStatsEvent[]) : [];
        // Files written before pulls were de-duplicated can hold repeats; clean them once.
        const events = trimViewerStatsEvents(dedupeViewerStatsEvents(stored), Date.now(), RETAIN_MS, MAX_EVENTS);
        current = {
            version: 1,
            cursor: {
                epoch: typeof parsed.cursor?.epoch === 'string' ? parsed.cursor.epoch : undefined,
                seq: typeof parsed.cursor?.seq === 'number' ? parsed.cursor.seq : 0,
            },
            events,
            lastSnapshot: parsed.lastSnapshot,
            lastPullAt: parsed.lastPullAt,
            gapAt: parsed.gapAt,
        };
        if (events.length !== stored.length) void scheduleWrite();
        return current;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code === 'ENOENT' || e instanceof SyntaxError) {
            current = fresh();
            return current;
        }
        throw err;
    }
}

/** Forget the loaded folder's data (show switch). */
export function resetViewerStatsStore(): void {
    current = fresh();
    currentPath = undefined;
}

/** Merge one pull. Returns the number of new events stored. */
export function applyViewerStatsPull(res: VcStatsResponse, now = Date.now()): number {
    const epochChanged = current.cursor.epoch !== undefined && current.cursor.epoch !== res.epoch;
    // A new server epoch restarts seqs; everything it sends may be new to us. The
    // cursor we sent belonged to the old epoch, so the answer can also repeat events
    // we already hold (the target flipped back to a process we pulled from before).
    const candidates = res.events.filter((e) => epochChanged || e.seq > current.cursor.seq);
    const held = new Set(current.events.map(viewerStatsEventKey));
    const incoming: StoredViewerStatsEvent[] = [];
    for (const e of candidates) {
        const stored = { ...e, epoch: res.epoch };
        const k = viewerStatsEventKey(stored);
        if (held.has(k)) continue;
        held.add(k);
        incoming.push(stored);
    }
    for (const e of incoming) current.events.push(e);
    current.events = trimViewerStatsEvents(current.events, now, RETAIN_MS, MAX_EVENTS);
    current.cursor = { epoch: res.epoch, seq: res.latestSeq };
    current.lastSnapshot = res.snapshot;
    current.lastPullAt = now;
    if (res.truncated && !epochChanged) current.gapAt = now;
    if (incoming.length > 0 || res.truncated) void scheduleWrite();
    return incoming.length;
}

/** Record an event the player itself observed (Remote Falcon / jukebox picks). Local
 *  events live in their own epoch with their own seq so they never collide with the
 *  server's, and the pull cursor ignores them. */
export function appendLocalViewerStatsEvent(
    // Spelled out rather than Omit<>: the wire type's index signature makes Omit drop the known keys.
    ev: {
        ts: number;
        kind: VcStatsEventKind;
        songId?: string;
        title?: string;
        source?: VcPickSource;
        dropReason?: VcDropReason;
        count?: number;
    },
    now = Date.now(),
): void {
    let seq = 0;
    for (const e of current.events) if (e.epoch === LOCAL_STATS_EPOCH && e.seq > seq) seq = e.seq;
    current.events.push({ ...ev, seq: seq + 1, epoch: LOCAL_STATS_EPOCH });
    current.events = trimViewerStatsEvents(current.events, now, RETAIN_MS, MAX_EVENTS);
    void scheduleWrite();
}

async function scheduleWrite(): Promise<void> {
    if (writeInProgress) {
        writeQueued = true;
        return;
    }
    if (!currentPath) return;
    writeInProgress = true;
    const snapshot = current;
    const target = currentPath;
    try {
        await atomicWriteFile(target, JSON.stringify(snapshot));
    } catch (err) {
        console.error('[viewer-stats] write failed:', err);
    } finally {
        writeInProgress = false;
        if (writeQueued) {
            writeQueued = false;
            void scheduleWrite();
        }
    }
}
