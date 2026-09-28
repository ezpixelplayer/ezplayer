/**
 * Player-clock offset estimation for synced audio.
 *
 * Every chunk's `serverNow` and `playAt` are the PLAYER's `Date.now()`: the
 * lights fire on the player at `playAt`, so the browser must play the chunk
 * at the same instant on the player's clock. We estimate
 * `offset = playerClock − browserClock` two ways and combine them:
 *
 *   - HTTP round trips to a time endpoint that answers with the player's
 *     clock (`{ now }`). Cristian's algorithm: the clock read is assumed to
 *     have happened in the middle of the round trip, and the sample with the
 *     shortest round trip wins because its midpoint assumption is the least
 *     wrong. Re-run periodically as a backstop for drift.
 *   - Per-chunk `serverNow − Date.now()`. Each sample is `offset − oneWay`,
 *     so the max over a short window is a floor on the true offset. It never
 *     beats a good HTTP sample, but it catches a browser clock that stepped
 *     (NTP correction, phone wake) within a few seconds.
 *
 * The applied value only snaps when the estimate moves by more than
 * SNAP_THRESHOLD_MS, so tiny refinements don't pop the schedule.
 */

export interface ClockOffsetRef {
    /** Applied offset (player − browser, ms). Stable between snaps. */
    value: number;
    /** Running estimate; pushed to `value` on a snap. */
    estimate: number;
    /** Sliding window of `serverNow − Date.now()` samples from chunks. */
    chunkCandidates: number[];
    /** Last HTTP Cristian sample. */
    httpSample?: number;
    /** Round trip of the accepted HTTP sample (ms), for diagnostics. */
    httpRtt?: number;
}

export interface ClockOffsetSample {
    offset: number;
    rtt: number;
}

export const CLOCK_REFRESH_INTERVAL_MS = 30_000;
const CLOCK_SYNC_SAMPLES = 6;
const SNAP_THRESHOLD_MS = 50;
/** ~100 ms per chunk → about 6 s of history. */
const CHUNK_CANDIDATE_WINDOW = 64;

export function createClockOffsetRef(): ClockOffsetRef {
    return { value: 0, estimate: 0, chunkCandidates: [] };
}

/** Cristian round trips against `timeUrl`, which must answer `{ now: <player ms> }`. */
export async function estimateClockOffset(
    timeUrl: string,
    signal?: AbortSignal,
    samples = CLOCK_SYNC_SAMPLES,
): Promise<ClockOffsetSample | null> {
    let best: ClockOffsetSample | null = null;
    for (let i = 0; i < samples; i++) {
        if (signal?.aborted) break;
        const t0 = Date.now();
        try {
            const res = await fetch(timeUrl, { cache: 'no-store', signal });
            const t1 = Date.now();
            if (!res.ok) continue;
            const { now } = (await res.json()) as { now?: number };
            if (typeof now !== 'number') continue;
            const rtt = t1 - t0;
            const offset = now - (t0 + rtt / 2);
            if (best === null || rtt < best.rtt) best = { offset, rtt };
        } catch {
            /* one bad sample is fine */
        }
    }
    return best;
}

export function refineClockOffset(ref: ClockOffsetRef, serverNow: number): void {
    ref.chunkCandidates.push(serverNow - Date.now());
    if (ref.chunkCandidates.length > CHUNK_CANDIDATE_WINDOW) ref.chunkCandidates.shift();
    ref.estimate = combinedEstimate(ref);
    maybeSnap(ref);
}

export function applyHttpClockOffset(ref: ClockOffsetRef, sample: ClockOffsetSample): void {
    ref.httpSample = sample.offset;
    ref.httpRtt = sample.rtt;
    ref.estimate = combinedEstimate(ref);
    maybeSnap(ref);
}

/** Drop the one-way samples (they predate a sleep / reconnect) but keep the
 *  last HTTP sample so playback can continue while a fresh one is fetched. */
export function resetClockWindow(ref: ClockOffsetRef): void {
    ref.chunkCandidates.length = 0;
    ref.estimate = combinedEstimate(ref);
}

function combinedEstimate(ref: ClockOffsetRef): number {
    let best = ref.httpSample ?? -Infinity;
    for (const v of ref.chunkCandidates) if (v > best) best = v;
    return best === -Infinity ? 0 : best;
}

function maybeSnap(ref: ClockOffsetRef): void {
    if (Math.abs(ref.estimate - ref.value) >= SNAP_THRESHOLD_MS) ref.value = ref.estimate;
}
