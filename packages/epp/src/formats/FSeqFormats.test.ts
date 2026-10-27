/**
 * Format matrix: build every FSEQ variant we claim to play, as the real writers
 * (xLights / FPP, via FPP's FSEQFile.cpp) lay them out, and play each one through
 * all three consumers: FSEQReaderSync.processFrames, FSEQReaderAsync.readFrame,
 * and the FSeqPrefetchCache that playback actually uses.
 *
 * Layout notes, from FPP's FSEQFile.cpp:
 *  - v1: 28 byte fixed header, then variable headers, data offset padded to 4.
 *        The channel count in the header is already rounded up to 4; the frame
 *        stride equals it.
 *  - v2 uncompressed: FPP writes ZERO block-index entries (computeMaxBlocks() is 0
 *        for CompressionType::none). The frames are one contiguous run.
 *  - v2 zstd: each block is an independent zstd frame. FPP reserves the block
 *        table up front and leaves unused trailing entries as zeros.
 *  - v2 sparse: the header channel count is the number of channels stored (sum of
 *        the ranges); ranges are 0-based; frames are packed with no gaps.
 *  - ESEQ: 20 byte header, no frame count, no timing, no compression.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { zstdCompressSync } from 'zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { FSEQReaderAsync, FSEQReaderSync } from './FSeqUtil';
import { FSeqPrefetchCache } from './FSeqPrefetcher';

interface Range {
    startch: number; // 0-based
    chcount: number;
}

interface Spec {
    kind: 'v1' | 'v2' | 'eseq';
    channels: number; // dense channel count (v1/v2) or model size (eseq)
    frames: number;
    msPerFrame?: number;
    zstd?: boolean;
    /** v2 uncompressed: how many block entries to emit (real writers: 0). */
    uncompressedBlocks?: number;
    /** v2 zstd: frames per block. */
    framesPerBlock?: number;
    /** v2 zstd: trailing zero block entries, as FPP's reserved table leaves them. */
    reservedBlocks?: number;
    sparse?: Range[];
    /** v2 / v1 variable headers, e.g. { mf: 'song.mp3' }. */
    headers?: Record<string, string>;
    /** eseq: model start channel (1-based like xLights writes it). */
    modelStart?: number;
}

/** Deterministic, non-repeating fill so a misaligned stride shows up immediately. */
function denseFrame(f: number, channels: number) {
    const a = new Uint8Array(channels);
    for (let c = 0; c < channels; ++c) a[c] = (f * 31 + c * 7 + 3) & 255;
    return a;
}

function packSparse(dense: Uint8Array, ranges: Range[]) {
    const parts = ranges.map((r) => dense.subarray(r.startch, r.startch + r.chcount));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

function varHeaders(headers: Record<string, string> | undefined) {
    const bufs: Buffer[] = [];
    for (const [code, value] of Object.entries(headers ?? {})) {
        const data = Buffer.from(value + '\0', 'latin1');
        const b = Buffer.alloc(4 + data.length);
        b.writeUInt16LE(b.length, 0);
        b.write(code, 2, 'latin1');
        data.copy(b, 4);
        bufs.push(b);
    }
    return Buffer.concat(bufs);
}

const pad4 = (n: number) => (n + 3) & ~3;

/** The on-disk frame for frame f: dense, or packed sparse ranges. */
function fileFrame(spec: Spec, f: number) {
    const d = denseFrame(f, spec.channels);
    return spec.sparse ? packSparse(d, spec.sparse) : d;
}

function buildV1(spec: Spec) {
    const stride = pad4(spec.channels);
    const vh = varHeaders(spec.headers);
    const off2chdata = pad4(28 + vh.length);
    const b = Buffer.alloc(off2chdata + spec.frames * stride);
    b.write('PSEQ', 0, 'ascii');
    b.writeUInt16LE(off2chdata, 4);
    b[6] = 0;
    b[7] = 1;
    b.writeUInt16LE(28, 8);
    b.writeUInt32LE(stride, 10);
    b.writeUInt32LE(spec.frames, 14);
    b[18] = spec.msPerFrame ?? 50;
    b[19] = 0;
    b.writeUInt16LE(Math.ceil(stride / 512), 20);
    b.writeUInt16LE(512, 22);
    b[24] = 1; // gamma
    b[25] = 2; // color encoding RGB
    b.writeUInt16LE(0, 26);
    vh.copy(b, 28);
    for (let f = 0; f < spec.frames; ++f) b.set(denseFrame(f, spec.channels), off2chdata + f * stride);
    return b;
}

function buildV2(spec: Spec) {
    const stride = spec.sparse ? spec.sparse.reduce((n, r) => n + r.chcount, 0) : spec.channels;
    const raw = Buffer.alloc(spec.frames * stride);
    for (let f = 0; f < spec.frames; ++f) raw.set(fileFrame(spec, f), f * stride);

    // Channel data blocks and their index entries
    const blocks: { framenum: number; data: Buffer }[] = [];
    if (spec.zstd) {
        const fpb = spec.framesPerBlock ?? spec.frames;
        for (let f = 0; f < spec.frames; f += fpb) {
            const n = Math.min(fpb, spec.frames - f);
            blocks.push({ framenum: f, data: zstdCompressSync(raw.subarray(f * stride, (f + n) * stride)) });
        }
    } else {
        const nb = spec.uncompressedBlocks ?? 0;
        if (nb > 0) {
            const fpb = Math.ceil(spec.frames / nb);
            for (let f = 0; f < spec.frames; f += fpb) {
                const n = Math.min(fpb, spec.frames - f);
                blocks.push({ framenum: f, data: raw.subarray(f * stride, (f + n) * stride) });
            }
        }
    }
    const nblockEntries = blocks.length + (spec.reservedBlocks ?? 0);
    const nranges = spec.sparse?.length ?? 0;
    const shdrlen = 32 + nblockEntries * 8 + nranges * 6;
    const vh = varHeaders(spec.headers);
    const off2chdata = pad4(shdrlen + vh.length);

    const h = Buffer.alloc(off2chdata);
    h.write('PSEQ', 0, 'ascii');
    h.writeUInt16LE(off2chdata, 4);
    h[6] = 0;
    h[7] = 2;
    h.writeUInt16LE(shdrlen, 8);
    h.writeUInt32LE(stride, 10);
    h.writeUInt32LE(spec.frames, 14);
    h[18] = spec.msPerFrame ?? 50;
    h[19] = 0;
    h[20] = (spec.zstd ? 1 : 0) | ((nblockEntries >> 8) << 4);
    h[21] = nblockEntries & 255;
    h[22] = nranges;
    h[23] = 0;
    h.writeUInt32LE(0x455a5031, 24);
    h.writeUInt32LE(0x54455354, 28);
    let o = 32;
    for (const blk of blocks) {
        h.writeUInt32LE(blk.framenum, o);
        h.writeUInt32LE(blk.data.length, o + 4);
        o += 8;
    }
    o += (spec.reservedBlocks ?? 0) * 8; // zeros
    for (const r of spec.sparse ?? []) {
        h.writeUIntLE(r.startch, o, 3);
        h.writeUIntLE(r.chcount, o + 3, 3);
        o += 6;
    }
    vh.copy(h, shdrlen);

    return Buffer.concat([h, ...(blocks.length ? blocks.map((b) => b.data) : [raw])]);
}

function buildEseq(spec: Spec) {
    const stride = spec.channels;
    const b = Buffer.alloc(20 + spec.frames * stride);
    b.write('ESEQ', 0, 'ascii');
    b.writeUInt32LE(1, 4);
    b.writeUInt32LE(stride, 8);
    b.writeUInt32LE(spec.modelStart ?? 1, 12);
    b.writeUInt32LE(spec.channels, 16);
    for (let f = 0; f < spec.frames; ++f) b.set(denseFrame(f, spec.channels), 20 + f * stride);
    return b;
}

function build(spec: Spec) {
    return spec.kind === 'v1' ? buildV1(spec) : spec.kind === 'eseq' ? buildEseq(spec) : buildV2(spec);
}

/** What each consumer should hand back for frame f. */
function expectedPacked(spec: Spec, f: number) {
    if (spec.kind === 'v1') {
        const a = new Uint8Array(pad4(spec.channels));
        a.set(denseFrame(f, spec.channels));
        return a;
    }
    return fileFrame(spec, f);
}

function expectedDense(spec: Spec, f: number) {
    if (!spec.sparse) return expectedPacked(spec, f);
    const maxCh = Math.max(...spec.sparse.map((r) => r.startch + r.chcount));
    const a = new Uint8Array(pad4(maxCh));
    const d = denseFrame(f, spec.channels);
    for (const r of spec.sparse) a.set(d.subarray(r.startch, r.startch + r.chcount), r.startch);
    return a;
}

const CASES: { name: string; spec: Spec }[] = [
    {
        name: 'v1 uncompressed, channels not a multiple of 4',
        spec: { kind: 'v1', channels: 150, frames: 7, headers: { mf: 'a.mp3' } },
    },
    {
        name: 'v2 uncompressed, no block entries (xLights/FPP)',
        spec: { kind: 'v2', channels: 150, frames: 7, headers: { mf: 'a.mp3' } },
    },
    { name: 'v2 uncompressed, one block entry', spec: { kind: 'v2', channels: 150, frames: 7, uncompressedBlocks: 1 } },
    {
        name: 'v2 uncompressed, three block entries',
        spec: { kind: 'v2', channels: 150, frames: 7, uncompressedBlocks: 3 },
    },
    {
        name: 'v2 uncompressed sparse, no block entries',
        spec: {
            kind: 'v2',
            channels: 300,
            frames: 7,
            sparse: [
                { startch: 10, chcount: 15 },
                { startch: 100, chcount: 33 },
            ],
        },
    },
    {
        name: 'v2 zstd, one block',
        spec: { kind: 'v2', channels: 150, frames: 7, zstd: true, headers: { mf: 'a.mp3' } },
    },
    {
        name: 'v2 zstd, three frames per block',
        spec: { kind: 'v2', channels: 150, frames: 7, zstd: true, framesPerBlock: 3 },
    },
    {
        name: 'v2 zstd, reserved empty block entries (FPP)',
        spec: { kind: 'v2', channels: 150, frames: 7, zstd: true, framesPerBlock: 2, reservedBlocks: 5 },
    },
    {
        name: 'v2 zstd sparse, two frames per block',
        spec: {
            kind: 'v2',
            channels: 300,
            frames: 7,
            zstd: true,
            framesPerBlock: 2,
            sparse: [
                { startch: 10, chcount: 15 },
                { startch: 100, chcount: 33 },
            ],
            headers: { mf: 'a.mp3' },
        },
    },
    {
        name: 'v2 zstd, 25ms frames, 2000 channels',
        spec: { kind: 'v2', channels: 2000, frames: 11, msPerFrame: 25, zstd: true, framesPerBlock: 4 },
    },
    { name: 'eseq', spec: { kind: 'eseq', channels: 150, frames: 7, modelStart: 1001 } },
];

let dir: string;
const files = new Map<string, string>();

beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fseq-matrix-'));
    for (const [i, c] of CASES.entries()) {
        const fn = path.join(dir, `case${i}.fseq`);
        await fsp.writeFile(fn, build(c.spec));
        files.set(c.name, fn);
    }
});

afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
});

function checkHeader(
    h: {
        majver: number;
        frames: number;
        msperframe: number;
        compression: number;
        nsparseranges: number;
        headers: Record<string, string>;
    },
    spec: Spec,
) {
    expect(h.majver).toBe(spec.kind === 'v1' ? 1 : 2);
    expect(h.frames).toBe(spec.frames);
    expect(h.compression).toBe(spec.zstd ? 1 : 0);
    expect(h.nsparseranges).toBe(spec.sparse?.length ?? 0);
    if (spec.kind !== 'eseq') expect(h.msperframe).toBe(spec.msPerFrame ?? 50);
    for (const [k, v] of Object.entries(spec.headers ?? {})) expect(h.headers[k]).toBe(v);
}

describe.each(CASES)('$name', ({ name, spec }) => {
    test('FSEQReaderSync.processFrames', async () => {
        const r = new FSEQReaderSync(files.get(name)!);
        await r.open();
        try {
            await r.readHeader();
            checkHeader(r.header!, spec);
            const seen: number[] = [];
            await r.processFrames(({ frame, fnum, ftime }) => {
                seen.push(fnum);
                expect(ftime).toBe(fnum * r.header!.msperframe);
                expect(frame, `frame ${fnum}`).toEqual(expectedPacked(spec, fnum));
            });
            expect(seen).toEqual([...Array(spec.frames).keys()]);
        } finally {
            await r.close();
        }
    });

    // The async reader cannot size an ESEQ file: nothing in the app plays them.
    test.skipIf(spec.kind === 'eseq')('FSEQReaderAsync.readFrame', async () => {
        const r = new FSEQReaderAsync(files.get(name)!);
        await r.open();
        try {
            checkHeader(r.header!, spec);
            // Out of order on purpose: each chunk must locate independently.
            const order = [spec.frames - 1, 0, Math.floor(spec.frames / 2), ...Array(spec.frames).keys()];
            for (const f of order) expect(await r.readFrame(f), `frame ${f}`).toEqual(expectedPacked(spec, f));
            await expect(r.readFrame(spec.frames)).rejects.toThrow(/Invalid frame/);
        } finally {
            await r.close();
            await r.filereader.asyncClose();
        }
    });

    test.skipIf(spec.kind === 'eseq')('FSeqPrefetchCache.getFrame (playback path)', async () => {
        const fn = files.get(name)!;
        const errors: string[] = [];
        const pf = new FSeqPrefetchCache({ now: 0 }, (m) => errors.push(m));
        try {
            pf.prefetchSeqMetadata({ fseqfile: fn, needByTime: 0 });
            pf.dispatch();
            await pf.headerPrefetchCache.finishFetches();
            const hdr = pf.getHeaderInfo({ fseqfile: fn });
            expect(hdr?.err).toBeUndefined();
            checkHeader(hdr!.ref!.header, spec);
            expect(hdr!.ref!.layout.isSparse).toBe(!!spec.sparse);

            pf.prefetchSeqFrames({ fseqfile: fn, startFrame: 0, nFrames: spec.frames, needByTime: 0 });
            pf.dispatch();
            await pf.decompPrefetchCache.finishFetches();
            expect(errors).toEqual([]);

            for (let f = 0; f < spec.frames; ++f) {
                const got = pf.getFrame(fn, { num: f });
                expect(got?.err, `frame ${f}`).toBeUndefined();
                expect(got?.ref?.frame, `frame ${f}`).toEqual(expectedDense(spec, f));
                got!.ref!.release();
            }
            expect(pf.getFrame(fn, { num: spec.frames })).toBeUndefined();
        } finally {
            await pf.shutdown();
        }
    });
});
