/**
 * Pure reporting helpers over PlaybackStatistics: per-sample trace lines and
 * an end-of-run summary. No I/O.
 */

import type { PlaybackStatistics } from '@ezplayer/ezplayer-core';

export interface StatsSample {
    /** ms since the run started (wall clock) */
    t: number;
    stats: PlaybackStatistics;
}

const n = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ms = (v: number | undefined, digits = 1): string => `${n(v).toFixed(digits)}ms`;
const secs = (msv: number | undefined): string => `${(n(msv) / 1000).toFixed(2)}s`;
const pct = (num: number, den: number): string => (den > 0 ? `${((100 * num) / den).toFixed(1)}%` : '—');

/** Counters that only ever grow between resets; deltas are meaningful. */
function cumulative(s: PlaybackStatistics) {
    const cc = s.fseqPrefetch?.chunkCache;
    return {
        sent: n(s.sentFramesCumulative),
        missed: n(s.missedFramesCumulative),
        skipped: n(s.skippedFramesCumulative),
        missedHeaders: n(s.missedHeadersCumulative),
        missedBackground: n(s.missedBackgroundFramesCumulative),
        outstandingSkips: n(s.framesSkippedDueToManyOutstandingFramesCumulative),
        cfSkipDirective: n(s.cframesSkippedDueToDirectiveCumulative),
        cfSkipIncomplete: n(s.cframesSkippedDueToIncompletePriorCumulative),
        audioSent: n(s.sentAudioChunksCumulative),
        audioSkipped: n(s.skippedAudioChunksCumulative),
        fseqRead: n(s.sequenceDecompress?.fileReadTimeCumulative),
        fseqDecomp: n(s.sequenceDecompress?.decompressTimeCumulative),
        audioRead: n(s.audioDecode?.fileReadTimeCumulative),
        audioDecode: n(s.audioDecode?.decodeTimeCumulative),
        chunkFetches: n(cc?.completedRequestsCumulative),
        chunkErrors: n(cc?.erroredRequestsCumulative),
        chunkHits: n(cc?.refHitsCumulative),
        chunkMisses: n(cc?.refMissesCumulative),
        chunkEvicted: n(cc?.evictedItemsCumulative),
        chunkExpired: n(cc?.expiredItemsCumulative),
    };
}
type Cumulative = ReturnType<typeof cumulative>;

function delta(a: Cumulative, b: Cumulative): Cumulative {
    const out = { ...b };
    for (const k of Object.keys(b) as (keyof Cumulative)[]) out[k] = b[k] - a[k];
    return out;
}

/** One line per sample: what changed since the previous sample, plus gauges. */
export function formatTraceLine(sample: StatsSample, prev?: StatsSample): string {
    const s = sample.stats;
    const cur = cumulative(s);
    const d = prev ? delta(cumulative(prev.stats), cur) : cur;
    const cc = s.fseqPrefetch?.chunkCache;
    const ld = s.loopDelay;
    const parts = [
        `t=${(sample.t / 1000).toFixed(0).padStart(3)}s`,
        `sent=+${d.sent}`,
        `skip=+${d.skipped}`,
        `miss=+${d.missed}`,
        d.cfSkipIncomplete || d.cfSkipDirective ? `cskip=+${d.cfSkipIncomplete + d.cfSkipDirective}` : undefined,
        `lag=${ms(s.worstLagHistorical)}`,
        `send=${ms(s.avgSendTime)}`,
        `idle=${pct(n(s.idleTimePeriod), n(s.measurementPeriod))}`,
        ld ? `loop(p99/max)=${ms(ld.p99)}/${ms(ld.max)}` : undefined,
        cc ? `cache=${n(cc.readyItems)}r/${n(cc.pendingItems)}p/${n(cc.inProgressItems)}f` : undefined,
        `fetch=+${d.chunkFetches}`,
        `read=+${ms(d.fseqRead, 0)}`,
        `decomp=+${ms(d.fseqDecomp, 0)}`,
        s.lastError ? `err=${JSON.stringify(s.lastError)}` : undefined,
    ];
    return parts.filter(Boolean).join(' ');
}

export interface PlaybackSummary {
    durationS: number;
    samples: number;
    frames: {
        sent: number;
        skipped: number;
        missed: number;
        /** sent / (sent + skipped + missed): a lower bound, since a late frame
         *  with no data counts in both skipped and missed. */
        deliveryRatio: number;
        missedHeaders: number;
        missedBackground: number;
        outstandingSkips: number;
        controllerSkipsDirective: number;
        controllerSkipsIncomplete: number;
    };
    timing: {
        worstLagMs: number;
        worstAdvanceMs: number;
        avgSendMs: number;
        maxSendMs: number;
        idleRatio: number;
        loopDelayP99Ms?: number;
        loopDelayMaxMs?: number;
    };
    fseq: {
        chunkFetches: number;
        chunkErrors: number;
        refHits: number;
        refMisses: number;
        evicted: number;
        expired: number;
        readMs: number;
        decompressMs: number;
        /** mean wall time per fetch, read+decompress (includes event-loop queueing) */
        avgFetchMs: number;
        cacheBytesUsed?: number;
        cacheBytesBudget?: number;
    };
    audio: { chunksSent: number; chunksSkipped: number; readMs: number; decodeMs: number };
    lastError?: string;
}

/** Roll the samples of one run up into a summary. Cumulative counters are taken
 *  as last − first (so the run needs a resetstats first, or at least a baseline
 *  sample); the historical maxima and per-period gauges are max / weighted over
 *  the samples. */
export function summarize(samples: StatsSample[]): PlaybackSummary | undefined {
    if (samples.length === 0) return undefined;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const d = delta(cumulative(first.stats), cumulative(last.stats));

    let worstLag = 0,
        worstAdvance = 0,
        maxSend = 0,
        loopP99: number | undefined,
        loopMax: number | undefined,
        idleSum = 0,
        periodSum = 0,
        sendWeighted = 0,
        sendWeight = 0;
    for (const s of samples) {
        const st = s.stats;
        worstLag = Math.max(worstLag, n(st.worstLagHistorical));
        worstAdvance = Math.max(worstAdvance, n(st.worstAdvanceHistorical));
        maxSend = Math.max(maxSend, n(st.maxSendTimeHistorical));
        if (st.loopDelay) {
            loopP99 = Math.max(loopP99 ?? 0, n(st.loopDelay.p99));
            loopMax = Math.max(loopMax ?? 0, n(st.loopDelay.max));
        }
        idleSum += n(st.idleTimePeriod);
        periodSum += n(st.measurementPeriod);
        // avgSendTime is per measurement period; weight it by that period's sends
        // (approximated by the period length — the counters don't carry it).
        sendWeighted += n(st.avgSendTime) * n(st.measurementPeriod);
        sendWeight += n(st.measurementPeriod);
    }

    const cc = last.stats.fseqPrefetch?.chunkCache;
    const attempted = d.sent + d.skipped + d.missed;
    return {
        durationS: (last.t - first.t) / 1000,
        samples: samples.length,
        frames: {
            sent: d.sent,
            skipped: d.skipped,
            missed: d.missed,
            deliveryRatio: attempted > 0 ? d.sent / attempted : 0,
            missedHeaders: d.missedHeaders,
            missedBackground: d.missedBackground,
            outstandingSkips: d.outstandingSkips,
            controllerSkipsDirective: d.cfSkipDirective,
            controllerSkipsIncomplete: d.cfSkipIncomplete,
        },
        timing: {
            worstLagMs: worstLag,
            worstAdvanceMs: worstAdvance,
            avgSendMs: sendWeight > 0 ? sendWeighted / sendWeight : 0,
            maxSendMs: maxSend,
            idleRatio: periodSum > 0 ? idleSum / periodSum : 0,
            loopDelayP99Ms: loopP99,
            loopDelayMaxMs: loopMax,
        },
        fseq: {
            chunkFetches: d.chunkFetches,
            chunkErrors: d.chunkErrors,
            refHits: d.chunkHits,
            refMisses: d.chunkMisses,
            evicted: d.chunkEvicted,
            expired: d.chunkExpired,
            readMs: d.fseqRead,
            decompressMs: d.fseqDecomp,
            avgFetchMs: d.chunkFetches > 0 ? (d.fseqRead + d.fseqDecomp) / d.chunkFetches : 0,
            cacheBytesUsed: cc?.used,
            cacheBytesBudget: cc?.budget,
        },
        audio: { chunksSent: d.audioSent, chunksSkipped: d.audioSkipped, readMs: d.audioRead, decodeMs: d.audioDecode },
        lastError: last.stats.lastError ?? undefined,
    };
}

export function formatSummary(s: PlaybackSummary): string[] {
    const f = s.frames;
    const t = s.timing;
    const q = s.fseq;
    const lines = [
        `Run: ${s.durationS.toFixed(1)}s, ${s.samples} samples`,
        `Frames: ${f.sent} sent, ${f.skipped} skipped (late), ${f.missed} missed (no data) → delivery ≈ ${pct(f.sent, f.sent + f.skipped + f.missed)}`,
    ];
    if (f.missedHeaders || f.missedBackground || f.outstandingSkips) {
        lines.push(
            `        ${f.missedHeaders} missed headers, ${f.missedBackground} missed background frames, ${f.outstandingSkips} skipped (too many outstanding)`,
        );
    }
    if (f.controllerSkipsDirective || f.controllerSkipsIncomplete) {
        lines.push(
            `        controller frame skips: ${f.controllerSkipsDirective} by directive, ${f.controllerSkipsIncomplete} prior send incomplete`,
        );
    }
    lines.push(
        `Timing: worst lag ${ms(t.worstLagMs)}, worst advance ${ms(t.worstAdvanceMs)}; send avg ${ms(t.avgSendMs, 2)} / max ${ms(t.maxSendMs)}; loop idle ${pct(t.idleRatio, 1)}` +
            (t.loopDelayP99Ms !== undefined
                ? `; loop delay p99 ${ms(t.loopDelayP99Ms)} / max ${ms(t.loopDelayMaxMs)}`
                : ''),
    );
    lines.push(
        `FSEQ:   ${q.chunkFetches} chunk fetches (${q.chunkErrors} errors), ${q.refHits} hits / ${q.refMisses} misses, ${q.evicted} evicted, ${q.expired} expired; ` +
            `read ${secs(q.readMs)} + decompress ${secs(q.decompressMs)} = ${ms(q.avgFetchMs)} per fetch (wall, incl. queueing)` +
            (q.cacheBytesBudget
                ? `; cache ${((q.cacheBytesUsed ?? 0) / 1e6).toFixed(0)} / ${(q.cacheBytesBudget / 1e6).toFixed(0)} MB`
                : ''),
    );
    lines.push(
        `Audio:  ${s.audio.chunksSent} chunks sent, ${s.audio.chunksSkipped} skipped; read ${secs(s.audio.readMs)} + decode ${secs(s.audio.decodeMs)}`,
    );
    if (s.lastError) lines.push(`Last error: ${s.lastError}`);
    return lines;
}

/** Human-readable one-shot dump of a stats object (for `stats`). */
export function formatStatsSnapshot(s: PlaybackStatistics): string[] {
    const cc = s.fseqPrefetch?.chunkCache;
    const hc = s.fseqPrefetch?.headerCache;
    const ac = s.audioPrefetch?.decodeCache;
    const cache = (c: typeof cc) =>
        c
            ? `${n(c.readyItems)} ready, ${n(c.pendingItems)} pending, ${n(c.inProgressItems)} fetching, ${n(c.errorItems)} errored; ` +
              `${n(c.refHitsCumulative)} hits / ${n(c.refMissesCumulative)} misses; ${n(c.evictedItemsCumulative)} evicted, ${n(c.expiredItemsCumulative)} expired; ` +
              `${(n(c.used) / 1e6).toFixed(0)} / ${(n(c.budget) / 1e6).toFixed(0)} MB`
            : '—';
    return [
        `Iteration ${n(s.iteration)}; period ${ms(s.measurementPeriod, 0)}: idle ${ms(s.idleTimePeriod, 0)}, send ${ms(s.sendTimePeriod, 0)}` +
            (s.loopDelay
                ? `; loop delay p50/p99/max ${ms(s.loopDelay.p50)}/${ms(s.loopDelay.p99)}/${ms(s.loopDelay.max)}`
                : ''),
        `Frames: ${n(s.sentFramesCumulative)} sent, ${n(s.skippedFramesCumulative)} skipped, ${n(s.missedFramesCumulative)} missed, ${n(s.missedHeadersCumulative)} missed headers, ${n(s.missedBackgroundFramesCumulative)} missed background`,
        `Timing: worst lag ${ms(s.worstLagHistorical)}, worst advance ${ms(s.worstAdvanceHistorical)}, send avg ${ms(s.avgSendTime, 2)} / max ${ms(s.maxSendTimeHistorical)}`,
        `Controller skips: ${n(s.cframesSkippedDueToDirectiveCumulative)} directive, ${n(s.cframesSkippedDueToIncompletePriorCumulative)} incomplete prior; ${n(s.framesSkippedDueToManyOutstandingFramesCumulative)} too many outstanding`,
        `Audio: ${n(s.sentAudioChunksCumulative)} chunks sent, ${n(s.skippedAudioChunksCumulative)} skipped; read ${secs(s.audioDecode?.fileReadTimeCumulative)}, decode ${secs(s.audioDecode?.decodeTimeCumulative)}`,
        `FSEQ read ${secs(s.sequenceDecompress?.fileReadTimeCumulative)}, decompress ${secs(s.sequenceDecompress?.decompressTimeCumulative)}; cache mem ${(n(s.fseqPrefetch?.totalMem) / 1e6).toFixed(0)} MB`,
        `FSEQ chunk cache: ${cache(cc)}`,
        `FSEQ header cache: ${cache(hc)}`,
        `Audio cache: ${cache(ac)}`,
        ...(s.lastError ? [`Last error: ${s.lastError}`] : []),
    ];
}
