/**
 * Minimal uncompressed FSEQ v2 writer for test fixtures. Layout mirrors what
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
 *   22    u8 sparse-range count (0)
 *   23    u8 reserved
 *   24-31 u32 LE uuid x2
 *   then block index entries (u32 frame#, u32 bytes) — the reader iterates
 *   compblocklist, so even uncompressed data needs one block covering all
 *   frames — then channel data, each frame padded to ceil(channels/4)*4.
 */

import fsp from 'node:fs/promises';

export interface FseqSpec {
    channels: number;
    frames: number;
    msPerFrame?: number;
    /** Per-frame channel fill. Default: every channel = `value`. */
    pattern?: (frameIndex: number, channelData: Uint8Array) => void;
    /** Constant fill value when no pattern is given. Default 255. */
    value?: number;
}

export function buildFseq(spec: FseqSpec): Buffer {
    const msPerFrame = spec.msPerFrame ?? 50;
    const stepSize = Math.floor((spec.channels + 3) / 4) * 4;
    const headerLen = 32 + 8; // fixed header + one block-index entry
    const buf = Buffer.alloc(headerLen + spec.frames * stepSize);

    buf.write('PSEQ', 0, 'ascii');
    buf.writeUInt16LE(headerLen, 4);
    buf.writeUInt8(0, 6); // minor
    buf.writeUInt8(2, 7); // major
    buf.writeUInt16LE(headerLen, 8);
    buf.writeUInt32LE(spec.channels, 10);
    buf.writeUInt32LE(spec.frames, 14);
    buf.writeUInt8(msPerFrame, 18);
    buf.writeUInt8(0, 19);
    buf.writeUInt8(0, 20); // uncompressed, block count high bits 0
    buf.writeUInt8(1, 21); // one block
    buf.writeUInt8(0, 22); // no sparse ranges
    buf.writeUInt8(0, 23);
    buf.writeUInt32LE(0x455a5031, 24); // uuid halves — arbitrary
    buf.writeUInt32LE(0x54455354, 28);
    // block index: all frames in one uncompressed block
    buf.writeUInt32LE(0, 32);
    buf.writeUInt32LE(spec.frames * stepSize, 36);

    const frame = new Uint8Array(spec.channels);
    for (let f = 0; f < spec.frames; f++) {
        if (spec.pattern) {
            frame.fill(0);
            spec.pattern(f, frame);
        } else {
            frame.fill(spec.value ?? 255);
        }
        buf.set(frame, headerLen + f * stepSize);
    }
    return buf;
}

export async function writeFseq(filePath: string, spec: FseqSpec): Promise<void> {
    await fsp.writeFile(filePath, buildFseq(spec));
}
