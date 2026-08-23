import { describe, expect, it } from 'vitest';
import type { PlaybackStatistics, PrefetchCacheStats } from '@ezplayer/ezplayer-core';
import { formatStatsSnapshot, formatSummary, formatTraceLine, summarize, type StatsSample } from './playback-stats.js';
import { findSequence } from './ezp-client.js';

const cache = (over: Partial<PrefetchCacheStats> = {}): PrefetchCacheStats => ({
    totalItems: 0,
    referencedItems: 0,
    readyItems: 0,
    pendingItems: 0,
    errorItems: 0,
    inProgressItems: 0,
    budget: 1_000_000_000,
    used: 0,
    refHitsCumulative: 0,
    refMissesCumulative: 0,
    expiredItemsCumulative: 0,
    evictedItemsCumulative: 0,
    completedRequestsCumulative: 0,
    erroredRequestsCumulative: 0,
    ...over,
});

const stats = (over: Partial<PlaybackStatistics> = {}): PlaybackStatistics => ({
    iteration: 0,
    lastError: undefined,
    measurementPeriod: 1000,
    idleTimePeriod: 500,
    sendTimePeriod: 400,
    worstLagHistorical: 0,
    worstAdvanceHistorical: 0,
    avgSendTime: 10,
    maxSendTimeHistorical: 0,
    missedFramesCumulative: 0,
    missedHeadersCumulative: 0,
    missedBackgroundFramesCumulative: 0,
    sentFramesCumulative: 0,
    skippedFramesCumulative: 0,
    framesSkippedDueToManyOutstandingFramesCumulative: 0,
    cframesSkippedDueToDirectiveCumulative: 0,
    cframesSkippedDueToIncompletePriorCumulative: 0,
    sentAudioChunksCumulative: 0,
    skippedAudioChunksCumulative: 0,
    sequenceDecompress: { fileReadTimeCumulative: 0, decompressTimeCumulative: 0 },
    fseqPrefetch: { totalMem: 0, headerCache: cache(), chunkCache: cache() },
    ...over,
});

describe('playback stats summary', () => {
    it('returns nothing for no samples', () => {
        expect(summarize([])).toBeUndefined();
    });

    it('takes cumulative counters as last − first and maxima over the run', () => {
        const samples: StatsSample[] = [
            { t: 1000, stats: stats({ sentFramesCumulative: 10, worstLagHistorical: 3 }) },
            {
                t: 2000,
                stats: stats({
                    sentFramesCumulative: 50,
                    skippedFramesCumulative: 4,
                    missedFramesCumulative: 6,
                    worstLagHistorical: 12,
                    maxSendTimeHistorical: 30,
                    loopDelay: { p50: 1, p99: 20, max: 45 },
                    sequenceDecompress: { fileReadTimeCumulative: 400, decompressTimeCumulative: 100 },
                    fseqPrefetch: {
                        totalMem: 0,
                        headerCache: cache(),
                        chunkCache: cache({ completedRequestsCumulative: 20, refMissesCumulative: 6, used: 5e8 }),
                    },
                }),
            },
            {
                t: 3000,
                stats: stats({
                    sentFramesCumulative: 90,
                    skippedFramesCumulative: 4,
                    missedFramesCumulative: 6,
                    worstLagHistorical: 8, // reset between periods; the run max is still 12
                    maxSendTimeHistorical: 12,
                    loopDelay: { p50: 1, p99: 5, max: 9 },
                    sequenceDecompress: { fileReadTimeCumulative: 700, decompressTimeCumulative: 150 },
                    fseqPrefetch: {
                        totalMem: 0,
                        headerCache: cache(),
                        chunkCache: cache({ completedRequestsCumulative: 40, refMissesCumulative: 6, used: 6e8 }),
                    },
                }),
            },
        ];
        const s = summarize(samples)!;
        expect(s.durationS).toBe(2);
        expect(s.samples).toBe(3);
        expect(s.frames).toMatchObject({ sent: 80, skipped: 4, missed: 6 });
        expect(s.frames.deliveryRatio).toBeCloseTo(80 / 90);
        expect(s.timing.worstLagMs).toBe(12);
        expect(s.timing.maxSendMs).toBe(30);
        expect(s.timing.loopDelayP99Ms).toBe(20);
        expect(s.timing.loopDelayMaxMs).toBe(45);
        expect(s.timing.idleRatio).toBeCloseTo(0.5);
        expect(s.fseq.chunkFetches).toBe(40);
        expect(s.fseq.refMisses).toBe(6);
        expect(s.fseq.readMs).toBe(700);
        expect(s.fseq.decompressMs).toBe(150);
        expect(s.fseq.avgFetchMs).toBeCloseTo(850 / 40);
        expect(s.fseq.cacheBytesUsed).toBe(6e8);

        const text = formatSummary(s).join('\n');
        expect(text).toContain('80 sent, 4 skipped (late), 6 missed (no data)');
        expect(text).toContain('88.9%');
        expect(text).toContain('worst lag 12.0ms');
        expect(text).toContain('loop delay p99 20.0ms / max 45.0ms');
        expect(text).toContain('40 chunk fetches');
    });

    it('formats a trace line with deltas against the previous sample', () => {
        const a: StatsSample = { t: 1000, stats: stats({ sentFramesCumulative: 40 }) };
        const b: StatsSample = {
            t: 2000,
            stats: stats({ sentFramesCumulative: 80, skippedFramesCumulative: 2, lastError: 'boom' }),
        };
        const line = formatTraceLine(b, a);
        expect(line).toContain('sent=+40');
        expect(line).toContain('skip=+2');
        expect(line).toContain('miss=+0');
        expect(line).toContain('idle=50.0%');
        expect(line).toContain('err="boom"');
        // Without a previous sample the cumulative values are shown as-is.
        expect(formatTraceLine(b)).toContain('sent=+80');
    });

    it('renders a snapshot without optional sections', () => {
        const lines = formatStatsSnapshot(stats({ fseqPrefetch: undefined, sequenceDecompress: undefined }));
        expect(lines.join('\n')).toContain('FSEQ chunk cache: —');
        expect(lines.some((l) => l.startsWith('Frames:'))).toBe(true);
    });
});

describe('findSequence', () => {
    const seqs = [
        { id: 'abc', instanceId: 'abc', work: { title: 'Jingle Bells' }, files: { fseq: 'sub\\JingleBells.fseq' } },
        { id: 'def', instanceId: 'def', work: { title: 'Carol' }, files: { fseq: 'Carol.fseq' }, deleted: true },
        { id: 'ghi', instanceId: 'ghi', work: { title: 'Carol' }, files: { fseq: 'Carol2.fseq' } },
    ] as unknown as Parameters<typeof findSequence>[0];

    it('matches id, then title (case-insensitive), then fseq base name', () => {
        expect(findSequence(seqs, 'abc')?.id).toBe('abc');
        expect(findSequence(seqs, 'jingle bells')?.id).toBe('abc');
        expect(findSequence(seqs, 'JingleBells.fseq')?.id).toBe('abc');
        expect(findSequence(seqs, 'jinglebells')?.id).toBe('abc');
        expect(findSequence(seqs, 'carol2')?.id).toBe('ghi');
        expect(findSequence(seqs, 'nope')).toBeUndefined();
    });

    it('skips deleted records', () => {
        expect(findSequence(seqs, 'Carol')?.id).toBe('ghi');
        expect(findSequence(seqs, 'def')).toBeUndefined();
    });
});
