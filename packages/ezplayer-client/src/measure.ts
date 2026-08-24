/**
 * Measured playback run: play one sequence on a running player, sample its
 * PlaybackStatistics, and summarize. Used by the `EZPlayer play` CLI verb and
 * usable from tests/tools directly.
 */

import type { PlayerPStatusContent, SequenceRecord } from '@ezplayer/ezplayer-core';
import { getPlaybackStats, postPlayerCommand } from './client';
import { summarize, type PlaybackSummary, type StatsSample } from './playback-stats';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MeasurePlaybackOptions {
    host: string;
    sequence: SequenceRecord;
    /** Seconds to run; the run also ends early when the sequence finishes. */
    durationS: number;
    /** Seconds between samples. Default 1. */
    intervalS?: number;
    /** Suppress controller output for the run (restored afterwards). */
    suppressOutput?: boolean;
    /** Leave the sequence playing at the end instead of ending it. */
    keepPlaying?: boolean;
    /** Request id for the jukebox play. Default derived from the time. */
    requestId?: string;
    onSample?: (sample: StatsSample, prev: StatsSample | undefined) => void;
    onInfo?: (msg: string) => void;
}

export interface MeasurePlaybackResult {
    samples: StatsSample[];
    summary?: PlaybackSummary;
    /** The player reported the sequence as playing at some point. */
    sawPlaying: boolean;
    /** Ended before durationS because the sequence finished. */
    finishedEarly: boolean;
}

function isOurPlay(p: PlayerPStatusContent | undefined, seq: SequenceRecord): boolean {
    return p?.status === 'Playing' && p.now_playing?.sequence_id === seq.id;
}

export async function measurePlayback(o: MeasurePlaybackOptions): Promise<MeasurePlaybackResult> {
    const intervalS = o.intervalS ?? 1;
    const seq = o.sequence;
    const requestId = o.requestId ?? `client-play-${Date.now()}`;
    const samples: StatsSample[] = [];
    let outputSuppressed = false;
    let sawPlaying = false;
    let finishedEarly = false;
    const t0 = Date.now();
    try {
        if (o.suppressOutput) {
            await postPlayerCommand(o.host, { command: 'suppressoutput' });
            outputSuppressed = true;
        }
        await postPlayerCommand(o.host, { command: 'resetstats' });
        await postPlayerCommand(o.host, {
            command: 'playsong',
            songId: seq.id,
            immediate: true,
            priority: 1,
            requestId,
        });

        let prev: StatsSample | undefined;
        let idleAfterPlay = 0;
        const deadline = t0 + o.durationS * 1000;
        while (Date.now() < deadline) {
            await sleep(intervalS * 1000);
            const r = await getPlaybackStats(o.host);
            if (!r) {
                o.onInfo?.('(no playback statistics yet)');
                continue;
            }
            const sample: StatsSample = { t: Date.now() - t0, stats: r.stats };
            samples.push(sample);
            o.onSample?.(sample, prev);
            prev = sample;

            // End early once the sequence has finished (idle again after playing).
            if (isOurPlay(r.pStatus, seq)) {
                sawPlaying = true;
                idleAfterPlay = 0;
            } else if (sawPlaying && ++idleAfterPlay >= 2) {
                finishedEarly = true;
                o.onInfo?.('Sequence finished.');
                break;
            }
        }
    } finally {
        try {
            if (!o.keepPlaying) {
                const r = await getPlaybackStats(o.host).catch(() => undefined);
                if (isOurPlay(r?.pStatus, seq)) await postPlayerCommand(o.host, { command: 'endsong', songId: seq.id });
            }
            if (outputSuppressed) await postPlayerCommand(o.host, { command: 'activateoutput' });
        } catch (e) {
            o.onInfo?.(`cleanup failed: ${(e as Error).message}`);
        }
    }

    return { samples, summary: summarize(samples), sawPlaying, finishedEarly };
}
