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
