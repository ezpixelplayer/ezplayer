/**
 * Pulls viewer-activity events from the player's home player_server every
 * PULL_INTERVAL_MS, stores them (ViewerStatsStorage), recomputes the owner
 * summary and broadcasts it as the `viewerStats` state key.
 *
 * Runs in main: the pull is one small GET, and main owns the show folder
 * the events persist into. Identity (cloud URL, home server, token) is the
 * same triple the playback worker gets as `cloudidentity`.
 */

import { summarizeViewerStats, type VcStatsResponse, type ViewerStatsSummary } from '@ezplayer/ezplayer-core';
import { applyViewerStatsPull, getViewerStatsStore } from './data/ViewerStatsStorage.js';
import { trustSystemCAs } from './trustSystemCAs.js';

const PULL_INTERVAL_MS = 30_000;
const PULL_TIMEOUT_MS = 10_000;
const WINDOW_DAYS = 30;

interface Identity {
    cloudUrl: string;
    liveUrl?: string;
    playerToken: string;
}

let identity: Identity | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let lastError: string | undefined;
let broadcaster: ((summary: ViewerStatsSummary) => void) | undefined;
let casTrusted = false;

export function setViewerStatsBroadcaster(cb: (summary: ViewerStatsSummary) => void): void {
    broadcaster = cb;
}

/** (Re)configure the pull target. Empty cloudUrl / token stops pulling. */
export function configureViewerStatsSync(next: { cloudUrl?: string; liveUrl?: string; playerToken?: string }): void {
    const cloudUrl = (next.cloudUrl ?? '').trim();
    const playerToken = (next.playerToken ?? '').trim();
    if (!cloudUrl || !playerToken) {
        identity = undefined;
        stopTimer();
        return;
    }
    const changed =
        !identity ||
        identity.cloudUrl !== cloudUrl ||
        identity.liveUrl !== next.liveUrl ||
        identity.playerToken !== playerToken;
    identity = { cloudUrl, liveUrl: next.liveUrl, playerToken };
    if (!timer) {
        timer = setInterval(() => void pullViewerStats(), PULL_INTERVAL_MS);
        timer.unref?.();
    }
    if (changed) void pullViewerStats();
}

function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
}

/** Current summary for first-connect snapshots. */
export function getViewerStatsSummary(): ViewerStatsSummary {
    return buildSummary();
}

/** Recompute and push (after a folder load, or a pull). */
export function publishViewerStats(): void {
    broadcaster?.(buildSummary());
}

function buildSummary(): ViewerStatsSummary {
    const store = getViewerStatsStore();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = Date.now();
    const parts = summarizeViewerStats(store.events, { tz, now, windowDays: WINDOW_DAYS });
    return {
        updatedAt: now,
        ...parts,
        cursor: store.cursor,
        lastPullAt: store.lastPullAt,
        lastPullError: lastError,
        gap: store.gapAt !== undefined && now - store.gapAt < 24 * 3600_000,
        live: store.lastSnapshot,
        storedEvents: store.events.length,
    };
}

function statsUrl(id: Identity, afterSeq: number): string {
    const base = (id.liveUrl || id.cloudUrl).replace(/\/+$/, '');
    return `${base}/api/player/vc/stats/${encodeURIComponent(id.playerToken)}?afterSeq=${afterSeq}`;
}

export async function pullViewerStats(): Promise<void> {
    const id = identity;
    if (!id || inFlight) return;
    inFlight = true;
    try {
        if (!casTrusted) {
            trustSystemCAs();
            casTrusted = true;
        }
        const store = getViewerStatsStore();
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), PULL_TIMEOUT_MS);
        let res: Response;
        try {
            res = await fetch(statsUrl(id, store.cursor.seq), {
                headers: { Accept: 'application/json' },
                signal: ctrl.signal,
            });
        } finally {
            clearTimeout(to);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as VcStatsResponse;
        if (!body || typeof body.epoch !== 'string' || !Array.isArray(body.events)) throw new Error('bad response');
        applyViewerStatsPull(body);
        lastError = undefined;
        publishViewerStats();
    } catch (err) {
        const msg = (err as Error).message ?? String(err);
        if (lastError !== msg) console.warn(`[viewer-stats] pull failed: ${msg}`);
        lastError = msg;
        publishViewerStats();
    } finally {
        inFlight = false;
    }
}
