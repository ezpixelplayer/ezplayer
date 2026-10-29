/**
 * FSEQ v2 writer — dense or sparse, uncompressed or zstd blocks.
 *
 * The layout matches what FSeqUtil's reader expects, and what FPP's own
 * V2FSEQFile reads:
 *   0-3   "PSEQ"
 *   4-5   u16 offset to channel data
 *   6     u8  minor version
 *   7     u8  major version (2)
 *   8-9   u16 standard header length (32)
 *   10-13 u32 channels stored per frame (the stride)
 *   14-17 u32 frame count
 *   18    u8  step time ms
 *   19    u8  flags
 *   20    u8  compression type (low nibble) | block count bits 8-11 (high nibble)
 *   21    u8  compression block count, low byte
 *   22    u8  sparse range count
 *   23    u8  flags2
 *   24-31 u64 unique id
 *   32..  block table: u32 first frame, u32 compressed size, per block
 *   then  sparse range table: u24 start (0-based), u24 length, per range
 *   then  variable headers: u16 total length (including these 4 bytes),
 *         two ascii code bytes, payload
 *
 * This writes version 2.2 at the newest: a file that needs more than 255
 * sparse ranges has them merged down to fit (see `limitRanges`).
 */

import * as fs from 'fs';
import { zstdCompressSync } from 'zlib';

/** A run of channels stored in the file, named as the reader names them. */
export interface FseqRange {
    /** 0-based absolute start channel. */
    startch: number;
    chcount: number;
}

export type FseqCompression = 'none' | 'zstd';

/** FPP's own limit: the block count is 12 bits. */
const MAX_BLOCKS = 4095;

/** The sparse range count is one byte. */
export const MAX_SPARSE_RANGES = 255;

const STANDARD_HEADER_LEN = 32;

export interface FseqWriteOptions {
    /** Frames the file will hold. The header states it, so it must be exact. */
    numFrames: number;
    stepTimeMs: number;
    /**
     * Channel runs stored per frame, ascending and non-overlapping. Omit for a
     * dense file, which then needs `channelCount`.
     */
    ranges?: FseqRange[];
    /** Channels per frame for a dense file; ignored when `ranges` is given. */
    channelCount?: number;
    compression?: FseqCompression;
    /**
     * The sequence's unique id. A slice carries its source's id so a device
     * sees the same sequence rather than an unrelated one.
     */
    uniqueId?: string | bigint;
    /** Media file this sequence plays with, written as the 'mf' header. */
    mediaName?: string;
    /** Frames per compression block; chosen from the stride when omitted. */
    framesPerBlock?: number;
    minorVersion?: number;
}

function toBigInt(id: string | bigint | undefined): bigint {
    if (id === undefined) return 0n;
    if (typeof id === 'bigint') return id;
    try {
        return BigInt(id);
    } catch {
        return 0n;
    }
}

/** The stride a file with these options stores per frame. */
export function fseqStride(opts: Pick<FseqWriteOptions, 'ranges' | 'channelCount'>): number {
    if (opts.ranges?.length) return opts.ranges.reduce((n, r) => n + r.chcount, 0);
    return opts.channelCount ?? 0;
}

/**
 * Merge runs until at most `max` remain, always closing the smallest gap
 * first. The result still covers every channel asked for; it may carry a few
 * extra between them, which is real data from the same sequence and so
 * harmless. Overlapping or touching runs are merged regardless of `max`.
 *
 * Cutting the table down is what keeps the file at version 2.2. FSEQ 2.3 moved
 * a longer table into an 'SR' variable header, which no controller image reads.
 */
export function limitRanges(ranges: FseqRange[], max: number = MAX_SPARSE_RANGES): FseqRange[] {
    const sorted = ranges
        .filter((r) => r.chcount > 0)
        .map((r) => ({ ...r }))
        .sort((a, b) => a.startch - b.startch);
    if (!sorted.length) return [];

    // Always coalesce what actually touches or overlaps.
    const merged: FseqRange[] = [sorted[0]];
    for (const r of sorted.slice(1)) {
        const last = merged[merged.length - 1];
        const lastEnd = last.startch + last.chcount;
        if (r.startch <= lastEnd) {
            const end = Math.max(lastEnd, r.startch + r.chcount);
            last.chcount = end - last.startch;
        } else {
            merged.push(r);
        }
    }

    // Then close the cheapest gaps until the table fits.
    while (merged.length > max) {
        let at = 0;
        let smallest = Infinity;
        for (let i = 0; i < merged.length - 1; i++) {
            const gap = merged[i + 1].startch - (merged[i].startch + merged[i].chcount);
            if (gap < smallest) {
                smallest = gap;
                at = i;
            }
        }
        const a = merged[at];
        const b = merged[at + 1];
        a.chcount = b.startch + b.chcount - a.startch;
        merged.splice(at + 1, 1);
    }
    return merged;
}

/**
 * Streams frames into an FSEQ v2 file. The header and its tables are reserved
 * up front, each compression block is written as soon as its frames are in,
 * and the block table is patched on close — so memory is one block whatever
 * the sequence length.
 */
export class FseqV2Writer {
    private readonly fd: number;
    private readonly numFrames: number;
    private readonly framesPerBlock: number;
    private readonly nBlocks: number;
    private readonly header: Buffer;
    private readonly chunk: Uint8Array | null;
    /** Channels stored per frame. */
    readonly stride: number;
    readonly ranges: FseqRange[];
    private inBlock = 0;
    private block = 0;
    private written = 0;
    private closed = false;

    constructor(filePath: string, opts: FseqWriteOptions) {
        const ranges = opts.ranges?.length ? limitRanges(opts.ranges) : [];
        this.ranges = ranges;
        this.stride = fseqStride({
            ranges,
            ...(opts.channelCount !== undefined ? { channelCount: opts.channelCount } : {}),
        });
        if (!(this.stride > 0)) throw new Error('FseqV2Writer: nothing to write (no channels)');
        if (ranges.length > MAX_SPARSE_RANGES) throw new Error('FseqV2Writer: too many sparse ranges');
        this.numFrames = opts.numFrames;

        const compression = opts.compression ?? 'zstd';
        let framesPerBlock = 0;
        if (compression === 'zstd' && opts.numFrames > 0) {
            framesPerBlock =
                opts.framesPerBlock ??
                Math.max(1, Math.ceil(opts.numFrames / MAX_BLOCKS), Math.ceil((1 << 20) / this.stride));
        }
        this.framesPerBlock = framesPerBlock;
        this.nBlocks = framesPerBlock ? Math.ceil(opts.numFrames / framesPerBlock) : 0;
        if (this.nBlocks > MAX_BLOCKS) throw new Error('FseqV2Writer: too many compression blocks');

        // 'mf' is NUL-terminated, the way xLights writes it.
        const vars: Buffer[] = [];
        if (opts.mediaName) {
            const payload = Buffer.concat([Buffer.from(opts.mediaName, 'utf8'), Buffer.from([0])]);
            const v = Buffer.alloc(4 + payload.length);
            v.writeUInt16LE(v.length, 0);
            v.write('mf', 2, 'ascii');
            payload.copy(v, 4);
            vars.push(v);
        }
        const varBytes = Buffer.concat(vars);

        const tableLen = this.nBlocks * 8 + ranges.length * 6 + varBytes.length;
        const dataOffset = Math.ceil((STANDARD_HEADER_LEN + tableLen) / 4) * 4;
        if (dataOffset > 0xffff) throw new Error('FseqV2Writer: header does not fit in 64KB');

        const header = Buffer.alloc(dataOffset);
        header.write('PSEQ', 0, 'ascii');
        header.writeUInt16LE(dataOffset, 4);
        header.writeUInt8(opts.minorVersion ?? 2, 6);
        header.writeUInt8(2, 7);
        header.writeUInt16LE(STANDARD_HEADER_LEN, 8);
        header.writeUInt32LE(this.stride, 10);
        header.writeUInt32LE(opts.numFrames, 14);
        header.writeUInt8(opts.stepTimeMs, 18);
        header.writeUInt8(0, 19);
        header.writeUInt8((compression === 'zstd' ? 1 : 0) | ((this.nBlocks >> 8) << 4), 20);
        header.writeUInt8(this.nBlocks & 0xff, 21);
        header.writeUInt8(ranges.length, 22);
        header.writeUInt8(0, 23);
        header.writeBigUInt64LE(toBigInt(opts.uniqueId), 24);

        let at = STANDARD_HEADER_LEN + this.nBlocks * 8;
        for (const r of ranges) {
            header.writeUIntLE(r.startch, at, 3);
            header.writeUIntLE(r.chcount, at + 3, 3);
            at += 6;
        }
        varBytes.copy(header, at);

        this.header = header;
        this.chunk = this.nBlocks ? new Uint8Array(this.framesPerBlock * this.stride) : null;
        this.fd = fs.openSync(filePath, 'w');
        try {
            // Block sizes are only known after compressing: leave room, patch on close.
            fs.writeSync(this.fd, header);
        } catch (e) {
            fs.closeSync(this.fd);
            throw e;
        }
    }

    /** Add one frame, already laid out as this file stores it (`stride` bytes). */
    addFrame(stored: Uint8Array): void {
        if (this.closed) throw new Error('FseqV2Writer: closed');
        if (this.written >= this.numFrames) throw new Error(`FseqV2Writer: more than ${this.numFrames} frames`);
        if (stored.length !== this.stride) {
            throw new Error(`FseqV2Writer: frame is ${stored.length} bytes, expected ${this.stride}`);
        }
        if (!this.chunk) {
            fs.writeSync(this.fd, stored);
        } else {
            this.chunk.set(stored, this.inBlock * this.stride);
            this.inBlock++;
            if (this.inBlock === this.framesPerBlock) this.flushBlock();
        }
        this.written++;
    }

    private flushBlock(): void {
        if (!this.chunk || this.inBlock === 0) return;
        const comp = zstdCompressSync(this.chunk.subarray(0, this.inBlock * this.stride));
        fs.writeSync(this.fd, comp);
        this.header.writeUInt32LE(this.block * this.framesPerBlock, STANDARD_HEADER_LEN + this.block * 8);
        this.header.writeUInt32LE(comp.length, STANDARD_HEADER_LEN + this.block * 8 + 4);
        this.block++;
        this.inBlock = 0;
    }

    /** Write the last block and patch the block table. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        try {
            // Fewer frames than announced would leave the header lying.
            if (this.written !== this.numFrames) {
                throw new Error(`FseqV2Writer: ${this.written} of ${this.numFrames} frames written`);
            }
            this.flushBlock();
            fs.writeSync(this.fd, this.header, 0, this.header.length, 0);
        } finally {
            fs.closeSync(this.fd);
        }
    }

    /** Abandon a partly-written file; the caller removes it. */
    abort(): void {
        if (this.closed) return;
        this.closed = true;
        fs.closeSync(this.fd);
    }
}
