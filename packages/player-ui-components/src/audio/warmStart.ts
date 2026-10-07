/**
 * Warm-start gate for a listening session.
 *
 * A cold start used to schedule the first chunks against clocks that were not
 * yet trustworthy: the AudioContext had not opened the device (its clock read
 * 0 and reported no output latency), the opus wasm was still compiling, and
 * the first HTTP clock sample was still in flight on a cold HTTPS connection.
 * Every one of those chunks then came out late and was trimmed — the choppy
 * first seconds on phones, cured by stop + listen because a restart finds all
 * three already warm.
 *
 * So the first anchor waits until the pieces are ready, buffering frames
 * meanwhile. The context and decoder are hard requirements (nothing can play
 * without them); the clock sample is waited for up to WARMUP_CLOCK_WAIT_MS so
 * a slow time endpoint cannot hold audio back indefinitely.
 */

/** Longest the first anchor waits for an HTTP clock sample. */
export const WARMUP_CLOCK_WAIT_MS = 1500;
/** Frames held back while warming up: ~100 ms each, so about 3 s. */
export const WARMUP_MAX_PENDING_FRAMES = 30;

export interface WarmupState {
    contextState: AudioContextState | undefined;
    contextTime: number;
    decoderReady: boolean;
    haveClockSample: boolean;
    /** ms since start() */
    elapsedMs: number;
}

/** True once the first chunk may be scheduled. */
export function warmupReady(s: WarmupState): boolean {
    if (s.contextState !== 'running' || !(s.contextTime > 0)) return false;
    if (!s.decoderReady) return false;
    return s.haveClockSample || s.elapsedMs >= WARMUP_CLOCK_WAIT_MS;
}

/** Of the frames held during warm-up, the ones still worth scheduling: those
 *  whose hop has not already passed on the player clock. Scheduling the rest
 *  would only produce trims and drops. */
export function stillPlayable<T extends { playAt: number; hopFrames: number; sampleRate: number }>(
    frames: readonly T[],
    playerNowMs: number,
): T[] {
    return frames.filter((f) => f.playAt + (f.hopFrames / f.sampleRate) * 1000 > playerNowMs);
}
