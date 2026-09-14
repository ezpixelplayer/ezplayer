import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { FSeqPrefetchCache } from './FSeqPrefetcher';
import { compileLayout, LayoutModelSpec } from '../pipeline/Layout';
import { compileInputMap, sharedInputMapProgram } from '../pipeline/InputMap';
import { descriptorFromSpecs } from '../pipeline/xlAdapter';

/**
 * Write an FSEQ v2 file: optional sparse ranges (0-based starts, as xLights
 * writes them), optional zstd compression in one block.
 */
function writeFseq(
    file: string,
    opts: { channels: number; frames: number; sparse?: { start: number; count: number }[]; zstd?: boolean; fill: (f: number, ch: Uint8Array) => void },
) {
    const fileStride = opts.sparse ? opts.sparse.reduce((a, r) => a + r.count, 0) : Math.floor((opts.channels + 3) / 4) * 4;
    const nranges = opts.sparse?.length ?? 0;
    const headerLen = 32 + 8 + nranges * 6;
    const data = Buffer.alloc(opts.frames * fileStride);
    const full = new Uint8Array(opts.channels);
    for (let f = 0; f < opts.frames; ++f) {
        full.fill(0);
        opts.fill(f, full);
        let off = f * fileStride;
        if (opts.sparse) {
            for (const r of opts.sparse) {
                data.set(full.subarray(r.start, r.start + r.count), off);
                off += r.count;
            }
        } else {
            data.set(full, off);
        }
    }
    const payload = opts.zstd ? zstdCompressSync(data) : data;
    const hdr = Buffer.alloc(headerLen);
    hdr.write('PSEQ', 0, 'ascii');
    hdr.writeUInt16LE(headerLen, 4);
    hdr.writeUInt8(0, 6);
    hdr.writeUInt8(2, 7);
    hdr.writeUInt16LE(headerLen, 8);
    hdr.writeUInt32LE(opts.channels, 10);
    hdr.writeUInt32LE(opts.frames, 14);
    hdr.writeUInt8(50, 18);
    hdr.writeUInt8(0, 19);
    hdr.writeUInt8(opts.zstd ? 1 : 0, 20);
    hdr.writeUInt8(1, 21);
    hdr.writeUInt8(nranges, 22);
    hdr.writeUInt8(0, 23);
    hdr.writeUInt32LE(1, 24);
    hdr.writeUInt32LE(2, 28);
    hdr.writeUInt32LE(0, 32);
    hdr.writeUInt32LE(payload.length, 36);
    let o = 40;
    for (const r of opts.sparse ?? []) {
        hdr.writeUIntLE(r.start, o, 3);
        hdr.writeUIntLE(r.count, o + 3, 3);
        o += 6;
    }
    fs.writeFileSync(file, Buffer.concat([hdr, payload]));
}

const RGB = [
    { offset: 0, kind: 'red' as const },
    { offset: 1, kind: 'green' as const },
    { offset: 2, kind: 'blue' as const },
];
const GRB = [
    { offset: 0, kind: 'green' as const },
    { offset: 1, kind: 'red' as const },
    { offset: 2, kind: 'blue' as const },
];

function model(name: string, startChannel: number, nodeCount: number, roles = RGB): LayoutModelSpec {
    return { name, startChannel, nodeCount, channelsPerNode: 3, roles };
}

async function settle(cache: FSeqPrefetchCache, ms = 1500) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        cache.dispatch();
        await new Promise((r) => setTimeout(r, 10));
    }
}

describe('FSeqPrefetchCache canonical frames', () => {
    let dir: string;
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezp-canon-'));
    });
    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const CH = 40;
    // Layout: A at 0..12 (RGB), B at 20..32 (RGB), plus raw channel 35.
    const layoutSpecs = [model('A', 0, 4), model('B', 20, 4)];
    const layout = compileLayout(layoutSpecs, { channelCeiling: CH });
    // The file was rendered with B as GRB and an extra model we no longer have.
    const fileSpecs = [model('A', 0, 4), model('B', 20, 4, GRB), model('Gone', 32, 1)];
    const descriptor = descriptorFromSpecs(fileSpecs, CH);

    const fill = (f: number, ch: Uint8Array) => {
        for (let i = 0; i < CH; ++i) ch[i] = (i * 7 + f) & 255;
    };

    for (const variant of [
        { name: 'dense uncompressed', sparse: undefined, zstd: false },
        { name: 'dense zstd', sparse: undefined, zstd: true },
        { name: 'sparse uncompressed', sparse: [{ start: 0, count: 12 }, { start: 20, count: 20 }], zstd: false },
        { name: 'sparse zstd', sparse: [{ start: 20, count: 20 }, { start: 0, count: 12 }], zstd: true },
    ]) {
        it(`serves canonical frames from a ${variant.name} file`, async () => {
            const file = path.join(dir, `${variant.name.replace(/ /g, '_')}.fseq`);
            writeFseq(file, { channels: CH, frames: 5, sparse: variant.sparse, zstd: variant.zstd, fill });

            const cache = new FSeqPrefetchCache(
                {
                    now: 0,
                    canonicalizer: (_file, _hdr, fl) => {
                        const sparse = fl.isSparse ? fl.scatterPlan.map((r) => ({ srcOffset: r.srcOffset, channelStart: r.dstOffset, length: r.length })) : undefined;
                        return sharedInputMapProgram(compileInputMap(descriptor, layout, sparse));
                    },
                },
                (m) => {
                    throw new Error(m);
                },
            );
            cache.prefetchSeqFrames({ fseqfile: file, startFrame: 0, nFrames: 5, needByTime: 0 });
            await settle(cache);
            cache.prefetchSeqFrames({ fseqfile: file, startFrame: 0, nFrames: 5, needByTime: 0 });
            await settle(cache, 300);

            const f3 = cache.getFrame(file, { num: 3 });
            expect(f3?.ref?.frame).toBeDefined();
            const frame = f3!.ref!.frame!;
            expect(frame.length).toBe(layout.frameBytes);
            const expected = new Uint8Array(CH);
            fill(3, expected);
            // A: straight copy of channels 0..12
            expect(Array.from(frame.subarray(0, 12))).toEqual(Array.from(expected.subarray(0, 12)));
            // B: file is GRB, canonical is RGB
            const b = layout.models[1].nodeStart * 3;
            for (let n = 0; n < 4; ++n) {
                expect(frame[b + n * 3]).toBe(expected[20 + n * 3 + 1]);
                expect(frame[b + n * 3 + 1]).toBe(expected[20 + n * 3]);
                expect(frame[b + n * 3 + 2]).toBe(expected[20 + n * 3 + 2]);
            }
            // Raw region: channels 12..20 and 32..40 by identity, where the file has them.
            const raw = frame.subarray(layout.rawOffset, layout.rawOffset + layout.rawCount);
            const spans = layout.rawSpans;
            expect(spans.map((s) => [s.channelStart, s.count])).toEqual([
                [12, 8],
                [32, 8],
            ]);
            const has = (ch: number) => !variant.sparse || variant.sparse.some((r) => ch >= r.start && ch < r.start + r.count);
            for (let ch = 12; ch < 20; ++ch) expect(raw[ch - 12]).toBe(has(ch) ? expected[ch] : 0);
            for (let ch = 32; ch < 40; ++ch) expect(raw[8 + ch - 32]).toBe(has(ch) ? expected[ch] : 0);
            f3!.ref!.release();
            await cache.shutdown();
        });
    }
});
