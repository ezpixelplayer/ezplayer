/**
 * Frame-fidelity analysis: match CRCs of frames the mock controller received
 * against CRCs computed from the source fseq. With unique per-frame content,
 * alignment is just the matched index sequence — drops, repeats, ordering,
 * and timing fall out directly. Black frames are tagged and reported, never
 * treated as errors here (leading/trailing ones are idle padding; interior
 * ones are for the caller to interpret).
 */

import { crc32 } from 'node:zlib';
import { FSEQReaderAsync } from '@ezplayer/epp';

export interface FrameSummary {
    t: number;
    seq: number;
    crc: number;
    black: boolean;
}

/** CRC32 per source frame, over exactly the first `channels` bytes (the wire
 *  payload — the fseq's 4-byte step padding is never sent). */
export async function expectedFrameCrcs(fseqPath: string, channels: number): Promise<number[]> {
    const rdr = new FSEQReaderAsync(fseqPath);
    await rdr.open();
    const out: number[] = [];
    for (let f = 0; f < rdr.header!.frames; f++) {
        const frame = await rdr.readFrame(f);
        out.push(crc32(frame.subarray(0, channels)) >>> 0);
    }
    await rdr.close();
    return out;
}

export interface FidelityReport {
    totalFrames: number;
    leadingBlack: number;
    interiorBlack: number;
    trailingBlack: number;
    /** frames whose CRC matched a source frame */
    matched: number;
    /** non-black frames whose CRC matched NO source frame — content corruption */
    unknown: number;
    expectedCount: number;
    /** distinct source frames seen */
    distinctMatched: number;
    firstIndex?: number;
    lastIndex?: number;
    /** source indices in [firstIndex, lastIndex] never received */
    dropped: number;
    /** consecutive re-sends of the same source frame */
    repeats: number;
    /** matched index went backwards */
    orderViolations: number;
    /** arrival time of the first matched frame (ms epoch) */
    firstMatchedAt?: number;
    /** median interval between consecutive-index arrivals */
    cadenceMs?: number;
    /** max |arrival - (t0 + index*frameMs)| across matched frames */
    maxJitterMs?: number;
}

export function analyzeFrames(frames: FrameSummary[], expected: number[], frameMs: number): FidelityReport {
    const crcToIndex = new Map<number, number>();
    expected.forEach((crc, i) => {
        if (crcToIndex.has(crc)) throw new Error(`expected CRCs not unique (frame ${i}) — use a per-frame pattern`);
        crcToIndex.set(crc, i);
    });

    let lead = 0;
    while (lead < frames.length && frames[lead].black) lead++;
    let tail = frames.length;
    while (tail > lead && frames[tail - 1].black) tail--;
    const body = frames.slice(lead, tail);

    const report: FidelityReport = {
        totalFrames: frames.length,
        leadingBlack: lead,
        trailingBlack: frames.length - tail,
        interiorBlack: 0,
        matched: 0,
        unknown: 0,
        expectedCount: expected.length,
        distinctMatched: 0,
        dropped: 0,
        repeats: 0,
        orderViolations: 0,
    };

    const seen = new Set<number>();
    let prevIdx: number | undefined;
    const arrivals: Array<{ idx: number; t: number }> = [];
    for (const f of body) {
        if (f.black) {
            report.interiorBlack++;
            continue;
        }
        const idx = crcToIndex.get(f.crc);
        if (idx === undefined) {
            report.unknown++;
            continue;
        }
        report.matched++;
        seen.add(idx);
        arrivals.push({ idx, t: f.t });
        if (report.firstIndex === undefined) {
            report.firstIndex = idx;
            report.firstMatchedAt = f.t;
        }
        if (prevIdx !== undefined) {
            if (idx === prevIdx) report.repeats++;
            else if (idx < prevIdx) report.orderViolations++;
        }
        prevIdx = idx;
    }
    report.distinctMatched = seen.size;
    if (seen.size > 0) {
        const min = Math.min(...seen);
        const max = Math.max(...seen);
        report.firstIndex = min;
        report.lastIndex = max;
        report.dropped = max - min + 1 - seen.size;
    }

    if (arrivals.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < arrivals.length; i++) {
            const di = arrivals[i].idx - arrivals[i - 1].idx;
            if (di === 1) gaps.push(arrivals[i].t - arrivals[i - 1].t);
        }
        if (gaps.length) {
            gaps.sort((a, b) => a - b);
            report.cadenceMs = gaps[Math.floor(gaps.length / 2)];
        }
        // Align t0 by median offset, then measure worst deviation
        const offsets = arrivals.map((a) => a.t - a.idx * frameMs).sort((a, b) => a - b);
        const t0 = offsets[Math.floor(offsets.length / 2)];
        report.maxJitterMs = Math.max(...arrivals.map((a) => Math.abs(a.t - a.idx * frameMs - t0)));
    }
    return report;
}
