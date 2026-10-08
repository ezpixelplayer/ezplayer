/**
 * Schedules decoded audio chunks on the Web Audio clock so each one is
 * audible at its `playAt` instant on the player's clock.
 *
 * Chunks may carry a trailing crossfade tail (PCM fallback): every chunk is
 * rendered in full and the next one starts `hopFrames` later so the ramped
 * edges overlap and sum to unity. Continuous opus chunks have no tail and
 * butt-join.
 *
 * Contiguous chunks (same incarnation, playAt exactly where the previous one
 * left off) are chained on the AudioContext clock rather than re-anchored, so
 * the clock offset's jitter never reaches the audio. The chained schedule is
 * compared against the ideal (wall-clock derived) start on every chunk, but
 * only a PERSISTENT deviation re-anchors: the median of the last few readings
 * must exceed DRIFT_SNAP_MS. A single noisy reading of the browser's clocks
 * (Firefox quantizes timers under resistFingerprinting, and its output
 * timestamp pairing is coarser than Chrome's) used to snap the schedule on
 * its own, which was audible as a chop about once a second. A gross error
 * still snaps immediately.
 *
 * Output latency: `getOutputTimestamp()` pairs a context time that is being
 * output right now with a performance timestamp, so mapping wall time through
 * it accounts for the device's output latency (Bluetooth included). The pair
 * is sanity-checked against `currentTime` / `performance.now()`; browsers
 * without it, or with an inconsistent pair, fall back to
 * `currentTime − outputLatency`.
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
    /** The chained schedule was abandoned for the ideal start. */
    snapped: boolean;
    /** Ideal − chained start for this chunk, ms (0 when re-anchored). */
    deviationMs: number;
    /** Where the wall↔context mapping came from. */
    mapping: 'outputTimestamp' | 'currentTime';
    /** How much later than the stamp the chain is playing because the device could
     *  not honor the stamp (output latency exceeds the stream's lead). 0 = in sync. */
    lateShiftMs: number;
}

/** Persistent deviation that re-anchors the chained schedule. */
const DRIFT_SNAP_MS = 50;
/** A single reading this far off re-anchors at once. */
const DRIFT_HARD_SNAP_MS = 400;
const DRIFT_WINDOW = 10;
const DRIFT_MIN_SAMPLES = 6;
/** Lead-in when a late chunk has to start "now". */
const CATCHUP_MARGIN_S = 0.004;
/** Extra room added when the chain has to be shifted later, so arrival jitter does
 *  not put the next chunk straight back behind the context. */
const LATE_HEADROOM_S = 0.03;
/** A shifted chain is pulled back toward the stamp once its chunks have had at least
 *  this much more slack than the shift for DRIFT_MIN_SAMPLES chunks. */
const UNSHIFT_SLACK_S = 0.05;

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export class RealTimeChunkPlayer {
    readonly context: AudioContext;
    private incarnation: number | undefined;
    private nextPlayAt: number | undefined;
    private nextStartCtx: number | undefined;
    private deviations: number[] = [];
    /** Sources started but possibly not yet playing, so a re-anchor can cut them. */
    private scheduled: Array<{ source: AudioBufferSourceNode; start: number; end: number }> = [];
    private lateShiftSec = 0;
    /** idealStart − earliest schedulable time, for recent chained chunks (shifted chains only). */
    private slack: number[] = [];
    private readonly offsetRef: ClockOffsetRef;
    private readonly onChunk?: (ev: ChunkPlaybackEvent) => void;
    private gain: GainNode;
    private lastMapping: ChunkPlaybackEvent['mapping'] = 'currentTime';

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
        this.deviations.length = 0;
    }

    /** Current late shift, ms (diagnostics). */
    get lateShiftMs(): number {
        return this.lateShiftSec * 1000;
    }

    /** Which mapping the last chunk used (diagnostics). */
    get mapping(): ChunkPlaybackEvent['mapping'] {
        return this.lastMapping;
    }

    /** Context time at which audio scheduled would be audible, paired with the
     *  browser wall clock at that same instant. */
    private outputNow(): { ctx: number; wall: number } {
        const c = this.context;
        const ts = typeof c.getOutputTimestamp === 'function' ? c.getOutputTimestamp() : undefined;
        if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.contextTime > 0) {
            // Trust the pair only when it is close to the clocks it claims to relate:
            // a stale or mismatched pair would move every ideal start with it.
            const perfNow = performance.now();
            if (Math.abs(ts.performanceTime - perfNow) < 1000 && Math.abs(c.currentTime - ts.contextTime) < 1) {
                this.lastMapping = 'outputTimestamp';
                return { ctx: ts.contextTime, wall: Date.now() - perfNow + ts.performanceTime };
            }
        }
        this.lastMapping = 'currentTime';
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

        const ctxNow = this.context.currentTime;
        // Nothing can be scheduled earlier than this.
        const earliest = ctxNow + CATCHUP_MARGIN_S;

        let start: number;
        let snapped = false;
        let deviationMs = 0;
        if (
            incarnation !== this.incarnation ||
            this.nextPlayAt === undefined ||
            Math.abs(playAt - this.nextPlayAt) > 1.5 ||
            this.nextStartCtx === undefined
        ) {
            this.incarnation = incarnation;
            start = this.anchor(idealStart, earliest);
        } else {
            start = this.nextStartCtx;
            // Deviation is measured against the stamp plus whatever shift the chain carries.
            deviationMs = (idealStart + this.lateShiftSec - start) * 1000;
            this.deviations.push(deviationMs);
            if (this.deviations.length > DRIFT_WINDOW) this.deviations.shift();
            if (this.lateShiftSec > 0) {
                this.slack.push(idealStart - earliest);
                if (this.slack.length > DRIFT_WINDOW) this.slack.shift();
            }
            const persistent =
                this.deviations.length >= DRIFT_MIN_SAMPLES && Math.abs(median(this.deviations)) > DRIFT_SNAP_MS;
            // The chain fell behind what the context can still play: shift it later as a
            // whole rather than trimming the front of every chunk from here on.
            const behind = start < earliest;
            // The device now has room to play closer to the stamp: take some of the shift back.
            const unshift =
                this.lateShiftSec > 0 &&
                this.slack.length >= DRIFT_MIN_SAMPLES &&
                median(this.slack) > this.lateShiftSec + UNSHIFT_SLACK_S;
            if (Math.abs(deviationMs) > DRIFT_HARD_SNAP_MS || persistent || behind || unshift) {
                start = this.anchor(idealStart, earliest);
                snapped = true;
            }
        }
        this.nextPlayAt = playAt + hopMs;
        this.nextStartCtx = start + hopSec;

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
            deviationMs,
            mapping: this.lastMapping,
            lateShiftMs: this.lateShiftSec * 1000,
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
        this.scheduled.push({ source, start: when, end: when + (frames - sourceOffset * sampleRate) / sampleRate });
        if (this.scheduled.length > 64) this.prune(ctxNow);
    }

    /**
     * Start a new chain at `ideal`, or — when the device cannot play that soon — as early
     * as it can plus headroom, remembering the shift. Anything the previous chain had
     * queued from the new start onward is cut so the two never sound together.
     */
    private anchor(ideal: number, earliest: number): number {
        this.deviations.length = 0;
        this.slack.length = 0;
        let start = ideal;
        if (ideal < earliest) {
            start = earliest + LATE_HEADROOM_S;
            this.lateShiftSec = start - ideal;
        } else {
            this.lateShiftSec = 0;
        }
        this.cutFrom(start);
        return start;
    }

    /** Stop queued sources at `at`: those not yet started are cancelled, one playing
     *  across `at` ends there. */
    private cutFrom(at: number): void {
        const keep: typeof this.scheduled = [];
        for (const s of this.scheduled) {
            if (s.end <= at) {
                keep.push(s);
                continue;
            }
            try {
                s.source.stop(Math.max(at, this.context.currentTime));
            } catch {
                /* already stopped */
            }
        }
        this.scheduled = keep;
        this.prune(this.context.currentTime);
    }

    private prune(ctxNow: number): void {
        this.scheduled = this.scheduled.filter((s) => s.end > ctxNow);
    }
}
