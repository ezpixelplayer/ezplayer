import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, test } from 'vitest';
import { FSEQReaderAsync, FSEQReaderSync } from './FSeqUtil';

// A v2 header with one compression block, `nranges` sparse ranges of 3 channels
// each, an 'mf' variable header, and `countByte` in the range count field.
function header(nranges: number, countByte = nranges & 255, channels = nranges * 3) {
    const shdrlen = 32 + 8 + nranges * 6;
    const vhdr = Buffer.from('mf\0\0x.xsq\0', 'latin1');
    vhdr.writeUInt16LE(vhdr.length, 0);
    vhdr.write('mf', 2, 'latin1');
    const off2chdata = Math.ceil((shdrlen + vhdr.length) / 4) * 4;
    const b = Buffer.alloc(off2chdata);
    b.write('PSEQ', 0, 'ascii');
    b.writeUInt16LE(off2chdata, 4);
    b[6] = 0;
    b[7] = 2;
    b.writeUInt16LE(shdrlen, 8);
    b.writeUInt32LE(channels, 10);
    b.writeUInt32LE(1, 14);
    b[18] = 50;
    b[20] = 1;
    b[21] = 1;
    b[22] = countByte;
    b.writeUInt32LE(0, 32);
    b.writeUInt32LE(16, 36);
    for (let i = 0; i < nranges; ++i) {
        b.writeUIntLE(i * 10, 40 + i * 6, 3);
        b.writeUIntLE(3, 43 + i * 6, 3);
    }
    vhdr.copy(b, shdrlen);
    return b;
}

function decode(b: Buffer) {
    return FSEQReaderAsync.decodeFSEQHeader(new Uint8Array(b), 0, false);
}

describe('sparse range count', () => {
    test('takes the count byte when it agrees with the header length', () => {
        const h = decode(header(3));
        expect(h.nsparseranges).toBe(3);
        expect(h.chranges).toHaveLength(3);
        expect(h.headers.mf).toBe('x.xsq');
    });

    test('recovers a count past 255 from the header length', () => {
        // 278 ranges stored as 278 & 255 = 22 (xLights 2026.04+ on big layouts)
        const h = decode(header(278));
        expect(h.nsparseranges).toBe(278);
        expect(h.chranges[277]).toEqual({ startch: 2770, chcount: 3 });
        expect(h.headers.mf).toBe('x.xsq');
    });

    test('keeps the count byte when the ranges do not add up to the channel count', () => {
        expect(decode(header(278, 22, 278 * 3 + 1)).nsparseranges).toBe(22);
    });

    test('keeps the count byte when its low bits disagree', () => {
        expect(decode(header(278, 21)).nsparseranges).toBe(21);
    });

    test('file reader recovers the count too', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fseq-'));
        const fn = path.join(dir, 'big.fseq');
        try {
            await fsp.writeFile(fn, Buffer.concat([header(278), Buffer.alloc(16)]));
            const r = new FSEQReaderSync(fn);
            await r.open();
            await r.readHeader();
            await r.close();
            expect(r.header!.nsparseranges).toBe(278);
            expect(r.header!.chranges[277]).toEqual({ startch: 2770, chcount: 3 });
            expect(r.header!.headers.mf).toBe('x.xsq');
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });
});

// A 2.3 file: the first 255 of `nranges` 3-channel ranges in the header with
// byte 22 = 255, and the whole table in an 'SR' extended data block after the
// 16 bytes of channel data. `channels` and `table` stand in for stale copies.
function file23(nranges: number, channels = nranges * 3, table = rangeTable(nranges)) {
    const shdrlen = 32 + 8 + 255 * 6;
    const mf = Buffer.from('\0\0mfx.xsq\0', 'latin1');
    mf.writeUInt16LE(mf.length, 0);
    const ed = Buffer.alloc(18);
    ed.writeUInt16LE(18, 0);
    ed.write('EDSR', 2, 'latin1');
    const off2chdata = Math.ceil((shdrlen + mf.length + ed.length) / 4) * 4;
    ed.writeUInt32LE(off2chdata + 16, 6);
    ed.writeUInt32LE(table.length, 14);
    const b = Buffer.alloc(off2chdata + 16);
    b.write('PSEQ', 0, 'ascii');
    b.writeUInt16LE(off2chdata, 4);
    b[6] = 3;
    b[7] = 2;
    b.writeUInt16LE(shdrlen, 8);
    b.writeUInt32LE(channels, 10);
    b.writeUInt32LE(1, 14);
    b[18] = 50;
    b[20] = 1;
    b[21] = 1;
    b[22] = 255;
    b.writeUInt32LE(0, 32);
    b.writeUInt32LE(16, 36);
    rangeTable(255).copy(b, 40);
    mf.copy(b, shdrlen);
    ed.copy(b, shdrlen + mf.length);
    return Buffer.concat([b, table]);
}

function rangeTable(nranges: number) {
    const t = Buffer.alloc(nranges * 6);
    for (let i = 0; i < nranges; ++i) {
        t.writeUIntLE(i * 10, i * 6, 3);
        t.writeUIntLE(3, i * 6 + 3, 3);
    }
    return t;
}

async function readBoth(b: Buffer) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fseq-'));
    const fn = path.join(dir, 'v23.fseq');
    try {
        await fsp.writeFile(fn, b);
        const r = new FSEQReaderSync(fn);
        await r.open();
        await r.readHeader();
        await r.close();
        return [r.header!, await FSEQReaderAsync.readFSEQHeaderAsync(fn)];
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
}

describe('FSEQ 2.3 sparse range block', () => {
    test('the header alone keeps 255 and notes where the full table is', () => {
        const b = file23(278);
        const h = decode(b);
        expect(h.nsparseranges).toBe(255);
        expect(h.extsparse).toEqual({ offset: b.length - 278 * 6, length: 278 * 6 });
        expect(h.headers).toEqual({ mf: 'x.xsq' });
    });

    test('both file readers take the full table', async () => {
        for (const h of await readBoth(file23(278))) {
            expect(h.nsparseranges).toBe(278);
            expect(h.chranges).toHaveLength(278);
            expect(h.chranges[277]).toEqual({ startch: 2770, chcount: 3 });
            expect(h.headers).toEqual({ mf: 'x.xsq' });
            expect(h.extsparse).toBeUndefined();
        }
    });

    test('a table that does not add up to the channel count is ignored', async () => {
        // What an older writer leaves: 255 ranges, their channel count, and the old 'SR' block.
        for (const h of await readBoth(file23(278, 255 * 3))) {
            expect(h.nsparseranges).toBe(255);
            expect(h.chranges).toHaveLength(255);
        }
    });

    test('a table that does not start with the header ranges is ignored', async () => {
        const table = rangeTable(278);
        table.writeUIntLE(5, 0, 3);
        for (const h of await readBoth(file23(278, 278 * 3, table))) {
            expect(h.nsparseranges).toBe(255);
        }
    });
});

describe('uncompressed v2 without block entries', () => {
    test('both file readers walk the frames as one run', async () => {
        // 3 frames of 4 channels, no compression blocks, one sparse range
        const b = Buffer.alloc(40 + 12);
        b.write('PSEQ', 0, 'ascii');
        b.writeUInt16LE(40, 4);
        b[6] = 0;
        b[7] = 2;
        b.writeUInt16LE(38, 8);
        b.writeUInt32LE(4, 10);
        b.writeUInt32LE(3, 14);
        b[18] = 50;
        b[22] = 1;
        b.writeUIntLE(100, 32, 3);
        b.writeUIntLE(4, 35, 3);
        for (let i = 0; i < 12; ++i) b[40 + i] = i;
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fseq-'));
        const fn = path.join(dir, 'raw.fseq');
        try {
            await fsp.writeFile(fn, b);
            const frames: number[][] = [];
            const s = new FSEQReaderSync(fn);
            await s.open();
            await s.readHeader();
            await s.processFrames(({ frame }) => frames.push([...frame]));
            await s.close();
            expect(frames).toEqual([
                [0, 1, 2, 3],
                [4, 5, 6, 7],
                [8, 9, 10, 11],
            ]);
            const a = new FSEQReaderAsync(fn);
            await a.open();
            try {
                for (let f = 0; f < 3; ++f) expect([...(await a.readFrame(f))]).toEqual(frames[f]);
            } finally {
                await a.close();
                await a.filereader.asyncClose();
            }
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });
});
