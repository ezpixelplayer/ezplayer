/**
 * Schedules decoded audio chunks on the Web Audio clock so each one is
 * audible at its `playAt` instant on the player's clock.
 *
 * Chunks are hop + a trailing crossfade tail: every chunk is rendered in full
 * and the next one starts `hopFrames` later, so the ramped edges overlap and
 * sum to unity. That masks codec warm-up, resampling seams and any sub-ms
 * scheduling rounding the browser applies.
 *
 * Contiguous chunks (same incarnation, playAt exactly where the previous one
 * left off) are butt-joined on the AudioContext clock rather than
 * re-anchored, so the clock offset's jitter doesn't reach the audio. A drift
 * of more than DRIFT_SNAP_MS between the chained schedule and the ideal one
 * snaps back, and a new incarnation (new song) re-anchors.
 *
 * Output latency: `getOutputTimestamp()` pairs a context time that is being
 * output right now with a performance timestamp, so mapping wall time through
 * it accounts for the device's output latency (Bluetooth included). Browsers
 * without it fall back to `currentTime − outputLatency`.
 */

import type { ClockOffsetRef } from './clockSync';

export interface DecodedChunk {
    /** Planar channel data; empty for a silent chunk. */
    planar: Float32Array[];
    sampleRate: number;
    /** Frames of audio in `planar` (hop + tail). */
    frames: number;
    /** Frames to advance the schedule by. */
    hopFrames: number;
    /** Player-clock ms the first frame should be audible. */
    playAt: number;
    incarnation: number;
    serverNow: number;
    silent: boolean;
}

export interface ChunkPlaybackEvent {
    playAt: number;
    serverNow: number;
    browserNow: number;
    /** Browser's belief about the player clock at scheduling time. */
    playerNowEstimate: number;
    /** `playerNowEstimate − playAt`: positive means the chunk was already due. */
    lateBy: number;
    offsetValue: number;
    offsetEstimate: number;
    /** Dropped entirely (too late to salvage). */
    dropped: boolean;
    /** Started part-way through to catch up. */
    trimmedMs: number;
    snapped: boolean;
}

const DRIFT_SNAP_MS = 50;
/** Lead-in when a late chunk has to start "now". */
const CATCHUP_MARGIN_S = 0.004;

export class RealTimeChunkPlayer {
    readonly context: AudioContext;
    private incarnation: number | undefined;
    private nextPlayAt: number | undefined;
    private nextStartCtx: number | undefined;
    private readonly offsetRef: ClockOffsetRef;
    private readonly onChunk?: (ev: ChunkPlaybackEvent) => void;
    private gain: GainNode;

    constructor(offsetRef: ClockOffsetRef, onChunk?: (ev: ChunkPlaybackEvent) => void) {
        this.offsetRef = offsetRef;
        this.onChunk = onChunk;
        const AC =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.context = new AC({ sampleRate: 48000, latencyHint: 'playback' });
        this.gain = this.context.createGain();
        this.gain.connect(this.context.destination);
    }

    /** Call from a user gesture (autoplay policy), and again after a suspend. */
    resume(): Promise<void> {
        return this.context.resume().catch(() => undefined);
    }

    close(): void {
        try {
            void this.context.close();
        } catch {
            /* ignore */
        }
    }

    /** Forget chained scheduling state so the next chunk re-anchors — after a
     *  reconnect or a wake-up the AudioContext clock has lost continuity. */
    reanchor(): void {
        this.incarnation = undefined;
        this.nextPlayAt = undefined;
        this.nextStartCtx = undefined;
    }

    /** Context time at which audio scheduled would be audible, paired with the
     *  browser wall clock at that same instant. */
    private outputNow(): { ctx: number; wall: number } {
        const c = this.context;
        const ts = typeof c.getOutputTimestamp === 'function' ? c.getOutputTimestamp() : undefined;
        if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.contextTime > 0) {
            return { ctx: ts.contextTime, wall: Date.now() - performance.now() + ts.performanceTime };
        }
        return { ctx: c.currentTime - (c.outputLatency || 0), wall: Date.now() };
    }

    handleChunk(chunk: DecodedChunk): void {
        const { playAt, incarnation, sampleRate, frames, hopFrames } = chunk;
        if (frames <= 0 || sampleRate <= 0) return;

        const offset = this.offsetRef.value;
        const playerNow = Date.now() + offset;
        const hopSec = hopFrames / sampleRate;
        const hopMs = hopSec * 1000;
        const now = this.outputNow();
        // Local wall ms the chunk should be audible, mapped onto the context clock.
        const idealStart = now.ctx + (playAt - offset - now.wall) / 1000;

        let start: number;
        let snapped = false;
        if (
            incarnation !== this.incarnation ||
            this.nextPlayAt === undefined ||
            Math.abs(playAt - this.nextPlayAt) > 1 ||
            this.nextStartCtx === undefined
        ) {
            this.incarnation = incarnation;
            start = idealStart;
        } else {
            start = this.nextStartCtx;
            if (Math.abs(start - idealStart) > DRIFT_SNAP_MS / 1000) {
                start = idealStart;
                snapped = true;
            }
        }
        this.nextPlayAt = playAt + hopMs;
        this.nextStartCtx = start + hopSec;

        const ctxNow = this.context.currentTime;
        let trimmedMs = 0;
        let dropped = false;
        let when = start;
        let sourceOffset = 0;
        if (start < ctxNow + CATCHUP_MARGIN_S) {
            // Already due: start part-way through rather than leaving a hole,
            // unless the whole hop is gone.
            when = ctxNow + CATCHUP_MARGIN_S;
            sourceOffset = when - start;
            trimmedMs = sourceOffset * 1000;
            if (sourceOffset >= hopSec) dropped = true;
        }

        this.onChunk?.({
            playAt,
            serverNow: chunk.serverNow,
            browserNow: Date.now(),
            playerNowEstimate: playerNow,
            lateBy: playerNow - playAt,
            offsetValue: offset,
            offsetEstimate: this.offsetRef.estimate,
            dropped,
            trimmedMs,
            snapped,
        });
        if (dropped || chunk.silent || chunk.planar.length === 0) return;

        const channels = chunk.planar.length;
        const buffer = this.context.createBuffer(channels, frames, sampleRate);
        for (let ch = 0; ch < channels; ch++) {
            const data = chunk.planar[ch]!;
            const src = data.length === frames ? data : data.subarray(0, frames);
            buffer.copyToChannel(src as Float32Array<ArrayBuffer>, ch);
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gain);
        source.start(when, sourceOffset);
    }
}
