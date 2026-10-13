/**
 * Warm-start gate for a listening session.
 *
 * The first chunk is scheduled only once the clocks it depends on can be
 * trusted: the AudioContext is running (before that its clock reads 0 and it
 * reports no output latency), the opus wasm has compiled, and an HTTP clock
 * sample has arrived. A chunk scheduled before that point comes out late and
 * is trimmed, which is audible as chop. Frames are buffered meanwhile.
 *
 * The context and decoder are hard requirements (nothing can play without
 * them); the clock sample is waited for up to WARMUP_CLOCK_WAIT_MS so a slow
 * time endpoint cannot hold audio back indefinitely.
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
