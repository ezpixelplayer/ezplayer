/**
 * Writing FSEQ v2, and cutting one down to the channels a single player needs.
 *
 * Everything written here is read back with FSEQReaderSync — the reader real
 * playback uses — so the writer is never checked against itself. The sparse
 * source is built by hand from FPP's documented layout for the same reason.
 */

import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FSEQReaderSync } from './FSeqUtil';
import { FseqV2Writer, limitRanges } from './FSeqWriter';
import { parseChannelRanges, planFseqSlice, sliceFseqFile } from './FSeqSlicer';

let dir = '';
beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-slice-'));
});
afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
});

/** A value per (channel, frame) that makes a misplaced byte obvious. */
const val = (channel: number, frame: number) => (channel * 7 + frame * 13 + 1) & 0xff;

const FRAMES = 9;
const STEP_MS = 25;

/** Write a dense source with our writer; the reader checks it independently. */
async function denseSource(name: string, channels: number, opts: { zstd?: boolean; media?: string } = {}) {
    const file = path.join(dir, name);
    const w = new FseqV2Writer(file, {
        numFrames: FRAMES,
        stepTimeMs: STEP_MS,
        channelCount: channels,
        compression: opts.zstd === false ? 'none' : 'zstd',
        framesPerBlock: 4,
        uniqueId: '1234567890123',
        ...(opts.media ? { mediaName: opts.media } : {}),
    });
    const frame = new Uint8Array(channels);
    for (let f = 0; f < FRAMES; f++) {
        for (let c = 0; c < channels; c++) frame[c] = val(c, f);
        w.addFrame(frame);
    }
    w.close();
    return file;
}

/**
 * A sparse v2 source laid out by hand, per FPP's FSEQFile.cpp: 32-byte fixed
 * header, no block table (uncompressed writes none), the range table, then the
 * variable headers, data offset padded to 4.
 */
async function handBuiltSparseSource(name: string, ranges: { startch: number; chcount: number }[], media?: string) {
    const stride = ranges.reduce((n, r) => n + r.chcount, 0);
    const mf = media ? Buffer.concat([Buffer.from(media, 'utf8'), Buffer.from([0])]) : Buffer.alloc(0);
    const vh = mf.length ? Buffer.alloc(4 + mf.length) : Buffer.alloc(0);
    if (vh.length) {
        vh.writeUInt16LE(vh.length, 0);
        vh.write('mf', 2, 'ascii');
        mf.copy(vh, 4);
    }
    const fixed = 32 + ranges.length * 6;
    const offset = Math.ceil((fixed + vh.length) / 4) * 4;
    const h = Buffer.alloc(offset);
    h.write('PSEQ', 0, 'ascii');
    h.writeUInt16LE(offset, 4);
    h.writeUInt8(2, 6); // minor
    h.writeUInt8(2, 7); // major
    h.writeUInt16LE(32, 8);
    h.writeUInt32LE(stride, 10);
    h.writeUInt32LE(FRAMES, 14);
    h.writeUInt8(STEP_MS, 18);
    h.writeUInt8(0, 20); // uncompressed, zero blocks
    h.writeUInt8(0, 21);
    h.writeUInt8(ranges.length, 22);
    h.writeBigUInt64LE(987654321n, 24);
    let at = 32;
    for (const r of ranges) {
        h.writeUIntLE(r.startch, at, 3);
        h.writeUIntLE(r.chcount, at + 3, 3);
        at += 6;
    }
    vh.copy(h, fixed);

    // Frames hold the stored channels only, packed with no gaps.
    const body = Buffer.alloc(FRAMES * stride);
    for (let f = 0; f < FRAMES; f++) {
        let o = f * stride;
        for (const r of ranges) {
            for (let i = 0; i < r.chcount; i++) body[o + i] = val(r.startch + i, f);
            o += r.chcount;
        }
    }
    const file = path.join(dir, name);
    await fsp.writeFile(file, Buffer.concat([h, body]));
    return file;
}

/** Every frame as stored, plus the header, straight from the reader. */
async function readBack(file: string) {
    const r = new FSEQReaderSync(file);
    await r.open();
    try {
        await r.readHeader();
        const frames: Uint8Array[] = [];
        await r.processFrames(({ frame }) => frames.push(Uint8Array.from(frame)));
        return { header: r.header!, frames };
    } finally {
        await r.close();
    }
}

describe('FseqV2Writer', () => {
    it('writes a dense file the reader reads back frame for frame', async () => {
        const file = await denseSource('dense.fseq', 600);
        const { header, frames } = await readBack(file);
        expect(header.majver).toBe(2);
        expect(header.channels).toBe(600);
        expect(header.frames).toBe(FRAMES);
        expect(header.msperframe).toBe(STEP_MS);
        expect(header.compression).toBe(1);
        expect(frames).toHaveLength(FRAMES);
        for (let f = 0; f < FRAMES; f++) {
            for (const c of [0, 1, 299, 599]) expect(frames[f][c], `frame ${f} ch ${c}`).toBe(val(c, f));
        }
    });

    it('carries the unique id and the media name', async () => {
        const file = await denseSource('withmedia.fseq', 64, { media: 'Carol of the Bells.mp3' });
        const { header } = await readBack(file);
        expect((BigInt(header.uuid2 >>> 0) << 32n) | BigInt(header.uuid1 >>> 0)).toBe(1234567890123n);
        expect(header.headers.mf).toBe('Carol of the Bells.mp3');
    });

    it('writes a multi-range sparse file, stride being the sum of the ranges', async () => {
        const file = path.join(dir, 'sparse-out.fseq');
        const ranges = [
            { startch: 100, chcount: 50 },
            { startch: 1000, chcount: 30 },
        ];
        const w = new FseqV2Writer(file, { numFrames: 2, stepTimeMs: 50, ranges, compression: 'none' });
        expect(w.stride).toBe(80);
        w.addFrame(new Uint8Array(80).fill(1));
        w.addFrame(new Uint8Array(80).fill(2));
        w.close();

        const { header, frames } = await readBack(file);
        expect(header.channels).toBe(80);
        expect(header.nsparseranges).toBe(2);
        expect(header.chranges).toEqual(ranges);
        expect(frames[1].every((b) => b === 2)).toBe(true);
    });

    it('refuses a frame of the wrong size, and a short file', async () => {
        const file = path.join(dir, 'bad.fseq');
        const w = new FseqV2Writer(file, { numFrames: 2, stepTimeMs: 50, channelCount: 10, compression: 'none' });
        expect(() => w.addFrame(new Uint8Array(9))).toThrow(/expected 10/);
        w.addFrame(new Uint8Array(10));
        expect(() => w.close()).toThrow(/1 of 2 frames/);
    });
});

describe('limitRanges', () => {
    it('merges overlapping and touching runs whatever the limit', () => {
        expect(
            limitRanges([
                { startch: 10, chcount: 10 },
                { startch: 20, chcount: 5 },
                { startch: 22, chcount: 10 },
            ]),
        ).toEqual([{ startch: 10, chcount: 22 }]);
    });

    it('closes the smallest gap first, until the table fits', () => {
        const ranges = [
            { startch: 0, chcount: 10 },
            { startch: 100, chcount: 10 }, // gap of 90
            { startch: 115, chcount: 10 }, // gap of 5  <- cheapest
            { startch: 500, chcount: 10 },
        ];
        expect(limitRanges(ranges, 3)).toEqual([
            { startch: 0, chcount: 10 },
            { startch: 100, chcount: 25 },
            { startch: 500, chcount: 10 },
        ]);
        expect(limitRanges(ranges, 1)).toEqual([{ startch: 0, chcount: 510 }]);
    });

    it('drops empty runs and sorts what it keeps', () => {
        expect(
            limitRanges([
                { startch: 50, chcount: 5 },
                { startch: 0, chcount: 0 },
                { startch: 10, chcount: 5 },
            ]),
        ).toEqual([
            { startch: 10, chcount: 5 },
            { startch: 50, chcount: 5 },
        ]);
    });
});

describe('slicing a dense source', () => {
    it('keeps exactly the channels asked for, in order', async () => {
        const src = await denseSource('slice-src.fseq', 2048, { media: 'Song.mp3' });
        const dest = path.join(dir, 'slice-dest.fseq');
        const wanted = [
            { startch: 1000, chcount: 100 },
            { startch: 16, chcount: 32 },
        ];
        const result = await sliceFseqFile(src, dest, wanted);
        expect(result).not.toBeNull();
        expect(result!.ranges).toEqual([
            { startch: 16, chcount: 32 },
            { startch: 1000, chcount: 100 },
        ]);
        expect(result!.stride).toBe(132);
        expect(result!.droppedChannels).toBe(0);
        expect(result!.addedChannels).toBe(0);

        const { header, frames } = await readBack(dest);
        expect(header.channels).toBe(132);
        expect(header.frames).toBe(FRAMES);
        expect(header.msperframe).toBe(STEP_MS);
        // The slice stays the same sequence: same id, same media.
        expect((BigInt(header.uuid2 >>> 0) << 32n) | BigInt(header.uuid1 >>> 0)).toBe(1234567890123n);
        expect(header.headers.mf).toBe('Song.mp3');

        for (let f = 0; f < FRAMES; f++) {
            for (let i = 0; i < 32; i++) expect(frames[f][i], `f${f} ch${16 + i}`).toBe(val(16 + i, f));
            for (let i = 0; i < 100; i++) expect(frames[f][32 + i], `f${f} ch${1000 + i}`).toBe(val(1000 + i, f));
        }
    });

    it('is much smaller than the source it came from', async () => {
        const src = await denseSource('big-src.fseq', 8192, { zstd: false });
        const dest = path.join(dir, 'big-dest.fseq');
        const result = await sliceFseqFile(src, dest, [{ startch: 0, chcount: 256 }], { compression: 'none' });
        const srcSize = (await fsp.stat(src)).size;
        // 256 of 8192 channels, so the frames are 32x smaller.
        expect(result!.bytes).toBeLessThan(srcSize / 20);
    });

    it('drops channels past the end of the source', async () => {
        const src = await denseSource('short-src.fseq', 100, { zstd: false });
        const dest = path.join(dir, 'short-dest.fseq');
        const result = await sliceFseqFile(src, dest, [{ startch: 50, chcount: 200 }]);
        expect(result!.ranges).toEqual([{ startch: 50, chcount: 50 }]);
        expect(result!.droppedChannels).toBe(150);
        const { frames } = await readBack(dest);
        expect(frames[0][0]).toBe(val(50, 0));
    });
});

describe('slicing a sparse source', () => {
    const sourceRanges = [
        { startch: 0, chcount: 100 },
        { startch: 1000, chcount: 100 },
    ];

    it('reads the hand-built source the way we expect', async () => {
        const src = await handBuiltSparseSource('hand.fseq', sourceRanges, 'Hand.mp3');
        const { header, frames } = await readBack(src);
        expect(header.chranges).toEqual(sourceRanges);
        expect(header.channels).toBe(200);
        expect(frames[0][100]).toBe(val(1000, 0)); // second range starts here
    });

    it('intersects what is asked for with what the source holds', async () => {
        const src = await handBuiltSparseSource('hand2.fseq', sourceRanges);
        const dest = path.join(dir, 'hand2-dest.fseq');
        // Spans the hole between the source's two runs.
        const result = await sliceFseqFile(src, dest, [{ startch: 50, chcount: 1000 }]);
        expect(result!.ranges).toEqual([
            { startch: 50, chcount: 50 },
            { startch: 1000, chcount: 50 },
        ]);
        expect(result!.stride).toBe(100);

        const { frames } = await readBack(dest);
        for (let f = 0; f < FRAMES; f++) {
            for (let i = 0; i < 50; i++) expect(frames[f][i]).toBe(val(50 + i, f));
            for (let i = 0; i < 50; i++) expect(frames[f][50 + i]).toBe(val(1000 + i, f));
        }
    });

    it('declines when the source holds none of the channels asked for', async () => {
        const src = await handBuiltSparseSource('hand3.fseq', sourceRanges);
        const dest = path.join(dir, 'hand3-dest.fseq');
        expect(await sliceFseqFile(src, dest, [{ startch: 500, chcount: 100 }])).toBeNull();
        await expect(fsp.stat(dest)).rejects.toThrow();
    });

    it('declines rather than invent channel data to fit the range table', async () => {
        const src = await handBuiltSparseSource('hand4.fseq', sourceRanges);
        const dest = path.join(dir, 'hand4-dest.fseq');
        // Two runs are wanted, one from each source range; the gap between
        // them is a hole in the source, so it cannot be closed.
        const wanted = [
            { startch: 0, chcount: 10 },
            { startch: 1000, chcount: 10 },
        ];
        expect(await sliceFseqFile(src, dest, wanted, { maxRanges: 1 })).toBeNull();
        // With room for both, it slices.
        const ok = await sliceFseqFile(src, dest, wanted, { maxRanges: 2 });
        expect(ok!.ranges).toHaveLength(2);
    });

    it('closes a gap the source does cover, counting what that added', async () => {
        const src = await handBuiltSparseSource('hand5.fseq', [{ startch: 0, chcount: 500 }]);
        const dest = path.join(dir, 'hand5-dest.fseq');
        const wanted = [
            { startch: 0, chcount: 10 },
            { startch: 100, chcount: 10 },
        ];
        const result = await sliceFseqFile(src, dest, wanted, { maxRanges: 1 });
        expect(result!.ranges).toEqual([{ startch: 0, chcount: 110 }]);
        expect(result!.addedChannels).toBe(90);
        const { frames } = await readBack(dest);
        expect(frames[0][105]).toBe(val(105, 0));
    });
});

describe('planFseqSlice', () => {
    it('describes the slice without reading any frames', async () => {
        const src = await denseSource('plan-src.fseq', 1024);
        const r = new FSEQReaderSync(src);
        await r.open();
        try {
            await r.readHeader();
            const plan = planFseqSlice(r.header!, [{ startch: 0, chcount: 64 }]);
            expect(plan).toMatchObject({ stride: 64, numFrames: FRAMES, stepTimeMs: STEP_MS });
            expect(plan!.uniqueId).toBe(1234567890123n);
        } finally {
            await r.close();
        }
    });
});

describe('parseChannelRanges', () => {
    it('reads FPP’s 0-based inclusive list', () => {
        expect(parseChannelRanges('0-509,1024-2047')).toEqual([
            { startch: 0, chcount: 510 },
            { startch: 1024, chcount: 1024 },
        ]);
    });

    it('merges what overlaps and ignores noise', () => {
        expect(parseChannelRanges(' 10-19 , 15-29 ')).toEqual([{ startch: 10, chcount: 20 }]);
        expect(parseChannelRanges('')).toEqual([]);
        expect(parseChannelRanges(undefined)).toEqual([]);
        expect(parseChannelRanges('garbage')).toEqual([]);
    });

    it('gives a bare start the four channels xLights assumes', () => {
        expect(parseChannelRanges('32')).toEqual([{ startch: 32, chcount: 4 }]);
    });
});
