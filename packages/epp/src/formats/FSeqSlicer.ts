/**
 * Cut an FSEQ down to the channels one player needs.
 *
 * An FPP remote plays the show's timeline but only drives its own controllers,
 * so it only needs those channels. Slicing writes a sparse copy holding just
 * them: a fraction of the bytes to send and to store, with the same frame
 * count, step time, unique id and media name, so the device still sees one
 * sequence shared with the master.
 *
 * Two rules keep a slice honest:
 *  - The output covers only channels the source actually has. Asking for more
 *    would store zeros, and FPP leaves channels outside a sparse file's ranges
 *    alone — so inventing them would black out output the source deliberately
 *    did not touch.
 *  - The range table stays within version 2.2's one-byte count. Gaps are
 *    closed to fit, but only gaps the source covers; if that is not enough,
 *    slicing is declined rather than guessed at.
 */

import { promises as fsp } from 'fs';
import { FSEQReaderSync, type FSEQHeader } from './FSeqUtil';
import { FseqV2Writer, limitRanges, MAX_SPARSE_RANGES, type FseqCompression, type FseqRange } from './FSeqWriter';

/** One copy from the source frame into the output frame. */
interface GatherSegment {
    srcOffset: number;
    dstOffset: number;
    len: number;
}

export interface SlicePlan {
    /** Ranges the output will store, ascending. */
    ranges: FseqRange[];
    /** Channels stored per output frame. */
    stride: number;
    /** Per-frame copies, in output order. */
    gather: GatherSegment[];
    numFrames: number;
    stepTimeMs: number;
    uniqueId: bigint;
    mediaName?: string;
    /** Channels asked for that the source does not hold. */
    droppedChannels: number;
    /** Extra channels pulled in by closing gaps to fit the range table. */
    addedChannels: number;
}

/** What the source stores, as absolute runs paired with their frame offsets. */
function sourceCoverage(header: FSEQHeader): { startch: number; chcount: number; offset: number }[] {
    if (!header.nsparseranges || !header.chranges.length) {
        return [{ startch: 0, chcount: header.stepsize, offset: 0 }];
    }
    const out: { startch: number; chcount: number; offset: number }[] = [];
    let offset = 0;
    for (const r of header.chranges) {
        out.push({ startch: r.startch, chcount: r.chcount, offset });
        offset += r.chcount;
    }
    return out.sort((a, b) => a.startch - b.startch);
}

export function fseqUniqueId(header: FSEQHeader): bigint {
    return (BigInt(header.uuid2 >>> 0) << 32n) | BigInt(header.uuid1 >>> 0);
}

/**
 * Work out what a slice would hold, without reading a single frame — so the
 * caller can compare it with what a device already has and decide whether the
 * bytes are needed at all.
 *
 * Returns null when the source cannot be cut to fit (see the rules above), and
 * the caller should send it whole instead.
 */
export function planFseqSlice(
    header: FSEQHeader,
    wanted: FseqRange[],
    maxRanges: number = MAX_SPARSE_RANGES,
): SlicePlan | null {
    const coverage = sourceCoverage(header);
    const asked = limitRanges(wanted, Number.MAX_SAFE_INTEGER);
    const askedChannels = asked.reduce((n, r) => n + r.chcount, 0);

    // Intersect: only channels the source actually holds survive.
    const pieces: { startch: number; chcount: number; offset: number }[] = [];
    for (const want of asked) {
        const wantEnd = want.startch + want.chcount;
        for (const have of coverage) {
            const haveEnd = have.startch + have.chcount;
            const start = Math.max(want.startch, have.startch);
            const end = Math.min(wantEnd, haveEnd);
            if (end <= start) continue;
            pieces.push({ startch: start, chcount: end - start, offset: have.offset + (start - have.startch) });
        }
    }
    if (!pieces.length) return null;
    pieces.sort((a, b) => a.startch - b.startch);
    // Channels both asked for and present: measured before any merging, so
    // what the merge adds can be told apart from what the source lacks.
    const keptChannels = pieces.reduce((n, p) => n + p.chcount, 0);

    // Join runs that touch, then close the cheapest gaps until the table fits
    // — but only gaps the source covers, since a gap it does not cover has no
    // bytes to copy.
    const covers = (from: number, to: number): boolean =>
        coverage.some((c) => c.startch <= from && c.startch + c.chcount >= to);

    let runs: FseqRange[] = [{ startch: pieces[0].startch, chcount: pieces[0].chcount }];
    for (const p of pieces.slice(1)) {
        const last = runs[runs.length - 1];
        const lastEnd = last.startch + last.chcount;
        if (p.startch <= lastEnd) {
            last.chcount = Math.max(lastEnd, p.startch + p.chcount) - last.startch;
        } else {
            runs.push({ startch: p.startch, chcount: p.chcount });
        }
    }

    while (runs.length > maxRanges) {
        let at = -1;
        let smallest = Infinity;
        for (let i = 0; i < runs.length - 1; i++) {
            const from = runs[i].startch + runs[i].chcount;
            const to = runs[i + 1].startch;
            if (!covers(from, to)) continue;
            if (to - from < smallest) {
                smallest = to - from;
                at = i;
            }
        }
        // Every remaining gap is a hole in the source: cutting further would
        // mean inventing channel data.
        if (at < 0) return null;
        runs[at].chcount = runs[at + 1].startch + runs[at + 1].chcount - runs[at].startch;
        runs.splice(at + 1, 1);
    }
    runs = runs.sort((a, b) => a.startch - b.startch);

    // Then the copies, by walking each output run across the source's runs.
    const gather: GatherSegment[] = [];
    let dstOffset = 0;
    let stride = 0;
    for (const run of runs) {
        const runEnd = run.startch + run.chcount;
        for (const have of coverage) {
            const haveEnd = have.startch + have.chcount;
            const start = Math.max(run.startch, have.startch);
            const end = Math.min(runEnd, haveEnd);
            if (end <= start) continue;
            gather.push({
                srcOffset: have.offset + (start - have.startch),
                dstOffset: dstOffset + (start - run.startch),
                len: end - start,
            });
        }
        dstOffset += run.chcount;
        stride += run.chcount;
    }

    return {
        ranges: runs,
        stride,
        gather,
        numFrames: header.frames,
        stepTimeMs: header.msperframe,
        uniqueId: fseqUniqueId(header),
        ...(header.headers.mf ? { mediaName: header.headers.mf } : {}),
        droppedChannels: Math.max(0, askedChannels - keptChannels),
        addedChannels: Math.max(0, stride - keptChannels),
    };
}

export interface SliceResult extends SlicePlan {
    /** Size of the written file. */
    bytes: number;
}

/**
 * Write `src` sliced to `wanted` at `dest`. The plan is returned alongside the
 * size, so a caller that already planned can compare the two.
 *
 * Returns null when the source cannot be sliced; the caller sends it whole.
 */
export async function sliceFseqFile(
    src: string,
    dest: string,
    wanted: FseqRange[],
    opts: { maxRanges?: number; compression?: FseqCompression } = {},
): Promise<SliceResult | null> {
    const reader = new FSEQReaderSync(src);
    await reader.open();
    let plan: SlicePlan | null = null;
    try {
        await reader.readHeader();
        if (!reader.header) throw new Error(`fseq: could not read the header of ${src}`);
        plan = planFseqSlice(reader.header, wanted, opts.maxRanges);
        if (!plan) return null;

        const writer = new FseqV2Writer(dest, {
            numFrames: plan.numFrames,
            stepTimeMs: plan.stepTimeMs,
            ranges: plan.ranges,
            uniqueId: plan.uniqueId,
            ...(plan.mediaName ? { mediaName: plan.mediaName } : {}),
            ...(opts.compression ? { compression: opts.compression } : {}),
        });
        const out = new Uint8Array(plan.stride);
        try {
            await reader.processFrames(({ frame }) => {
                for (const g of plan!.gather) {
                    out.set(frame.subarray(g.srcOffset, g.srcOffset + g.len), g.dstOffset);
                }
                writer.addFrame(out);
            });
            writer.close();
        } catch (e) {
            writer.abort();
            await fsp.rm(dest, { force: true });
            throw e;
        }
    } finally {
        await reader.close();
    }

    const st = await fsp.stat(dest);
    return { ...plan, bytes: st.size };
}

/** Parse FPP's `channelRanges` ("0-510,1024-2047"), which is 0-based and inclusive. */
export function parseChannelRanges(ranges: string | undefined): FseqRange[] {
    if (!ranges) return [];
    const out: FseqRange[] = [];
    for (const part of ranges.split(',')) {
        const text = part.trim();
        if (!text) continue;
        const [a, b] = text.split('-');
        const startch = Number.parseInt(a, 10);
        if (!Number.isFinite(startch) || startch < 0) continue;
        // xLights treats a bare start as at least 4 channels; a pair is inclusive.
        const end = b === undefined ? startch + 3 : Number.parseInt(b, 10);
        const chcount = Number.isFinite(end) ? Math.max(4, end - startch + 1) : 4;
        out.push({ startch, chcount });
    }
    return limitRanges(out, Number.MAX_SAFE_INTEGER);
}
