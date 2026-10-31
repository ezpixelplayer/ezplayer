/**
 * Minimal FSEQ v2 writer for test fixtures. Layout mirrors what
 * packages/epp/src/formats/FSeqUtil.ts readHeader() parses:
 *
 *   0-3   'PSEQ'
 *   4-5   u16 LE offset to channel data
 *   6     u8 minor version (0)
 *   7     u8 major version (2)
 *   8-9   u16 LE fixed-header length
 *   10-13 u32 LE channel count
 *   14-17 u32 LE frame count
 *   18    u8 step time ms
 *   19    u8 reserved
 *   20    u8 compression (low nibble; 0 = none) | block-count high bits
 *   21    u8 block-count low byte
 *   22    u8 sparse-range count
 *   23    u8 reserved
 *   24-31 u32 LE uuid x2
 *   then block index entries (u32 frame#, u32 bytes) — the reader iterates
 *   compblocklist, so even uncompressed data needs one block covering all
 *   frames — then sparse ranges (u24 LE start, u24 LE count) — then channel
 *   data, exactly `channels` bytes per frame, or the ranges packed tight. Real
 *   writers (FPP, xLights) never pad the frame; sparse files in particular
 *   have counts that are not multiples of 4, and the reader must cope.
 */

import fsp from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

export interface FseqSpec {
    channels: number;
    frames: number;
    msPerFrame?: number;
    /** Per-frame channel fill. Default: every channel = `value`. */
    pattern?: (frameIndex: number, channelData: Uint8Array) => void;
    /** Constant fill value when no pattern is given. Default 255. */
    value?: number;
    /** Keep only these channels, as xLights does for the master view's models. */
    sparse?: { startch: number; chcount: number }[];
    /** Compress the one block with zlib, as xLights does for Effect sequences. */
    zlib?: boolean;
}

export function buildFseq(spec: FseqSpec): Buffer {
    const msPerFrame = spec.msPerFrame ?? 50;
    const ranges = spec.sparse ?? [];
    const stepSize = spec.sparse ? ranges.reduce((n, r) => n + r.chcount, 0) : spec.channels;
    const rangesAt = 32 + 8; // fixed header + one block-index entry
    const headerLen = rangesAt + ranges.length * 6;
    const header = Buffer.alloc(headerLen);
    const data = Buffer.alloc(spec.frames * stepSize);

    const buf = header;
    buf.write('PSEQ', 0, 'ascii');
    buf.writeUInt16LE(headerLen, 4);
    buf.writeUInt8(0, 6); // minor
    buf.writeUInt8(2, 7); // major
    buf.writeUInt16LE(headerLen, 8);
    buf.writeUInt32LE(stepSize, 10);
    buf.writeUInt32LE(spec.frames, 14);
    buf.writeUInt8(msPerFrame, 18);
    buf.writeUInt8(0, 19);
    buf.writeUInt8(spec.zlib ? 2 : 0, 20); // block count high bits 0
    buf.writeUInt8(1, 21); // one block
    buf.writeUInt8(ranges.length, 22);
    buf.writeUInt8(0, 23);
    buf.writeUInt32LE(0x455a5031, 24); // uuid halves — arbitrary
    buf.writeUInt32LE(0x54455354, 28);
    ranges.forEach((r, i) => {
        buf.writeUIntLE(r.startch, rangesAt + i * 6, 3);
        buf.writeUIntLE(r.chcount, rangesAt + i * 6 + 3, 3);
    });

    const frame = new Uint8Array(spec.channels);
    for (let f = 0; f < spec.frames; f++) {
        if (spec.pattern) {
            frame.fill(0);
            spec.pattern(f, frame);
        } else {
            frame.fill(spec.value ?? 255);
        }
        let at = f * stepSize;
        for (const r of spec.sparse ?? [{ startch: 0, chcount: spec.channels }]) {
            data.set(frame.subarray(r.startch, r.startch + r.chcount), at);
            at += r.chcount;
        }
    }

    // block index: all frames in one block
    const block = spec.zlib ? deflateSync(data) : data;
    buf.writeUInt32LE(0, 32);
    buf.writeUInt32LE(block.length, 36);
    return Buffer.concat([header, block]);
}

export async function writeFseq(filePath: string, spec: FseqSpec): Promise<void> {
    await fsp.writeFile(filePath, buildFseq(spec));
}
