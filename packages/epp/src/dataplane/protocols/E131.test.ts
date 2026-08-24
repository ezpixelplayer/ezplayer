import { describe, expect, it } from 'vitest';
import { fillE131PacketHeaderStatic, updateE131PacketHeader } from './E131';

/**
 * Reference: the original single-pass header builder (every field, every
 * packet), kept here verbatim so the split static/per-packet builder is
 * checked byte-for-byte against it. E1.31 is wire protocol — see
 * https://tsp.esta.org/tsp/documents/docs/E1-31-2016.pdf
 */
const HDR = 126;
const ACN_ID = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);
const EZP_CID = Buffer.from('e4eaaaf2-d142-11e1-b3e4-080027620cdd'.replace(/-/g, ''), 'hex');
function referenceHeader(universe: number, sourceName: string, sequence: number, dataLen: number, cid?: Uint8Array) {
    const p = new Uint8Array(HDR);
    const dv = new DataView(p.buffer);
    const len = (off: number, l: number) => dv.setUint16(off, 0x7000 | l, false);
    dv.setUint16(0, 0x0010, false);
    dv.setUint16(2, 0x0000, false);
    p.set(ACN_ID, 4);
    len(16, HDR + dataLen - 16);
    dv.setUint32(18, 0x00000004, false);
    p.set(cid ?? EZP_CID, 22);
    len(38, HDR + dataLen - 38);
    dv.setUint32(40, 0x00000002, false);
    let bytes = new TextEncoder().encode(sourceName);
    if (bytes.length > 63) bytes = bytes.slice(0, 63);
    p.set(bytes, 44);
    p[108] = 100;
    dv.setUint16(109, 0, false);
    p[111] = sequence & 0xff;
    p[112] = 0;
    dv.setUint16(113, universe, false);
    len(115, HDR + dataLen - 115);
    p[117] = 0x02;
    p[118] = 0xa1;
    dv.setUint16(119, 0, false);
    dv.setUint16(121, 1, false);
    dv.setUint16(123, dataLen + 1, false);
    p[125] = 0x00;
    return p;
}

describe('E1.31 data packet header', () => {
    it('static fill + per-packet update matches the single-pass reference byte for byte', () => {
        const hdr = Buffer.alloc(HDR);
        fillE131PacketHeaderStatic(hdr, 'EZPlayer');
        // The same buffer is reused across packets, with varying dynamic fields.
        const cases: Array<[number, number, number]> = [
            [1, 0, 510],
            [2, 1, 510],
            [63999, 255, 512],
            [17, 256, 3], // short last packet; sequence wraps to 0
            [1, 7, 510],
        ];
        for (const [universe, seq, dataLen] of cases) {
            updateE131PacketHeader(hdr, universe, seq, dataLen);
            expect(Buffer.from(hdr).equals(referenceHeader(universe, 'EZPlayer', seq, dataLen))).toBe(true);
        }
    });

    it('truncates the source name to 63 bytes and honors a custom CID', () => {
        const longName = 'x'.repeat(80);
        const cid = new Uint8Array(16).fill(0xab);
        const hdr = Buffer.alloc(HDR);
        fillE131PacketHeaderStatic(hdr, longName, cid);
        updateE131PacketHeader(hdr, 5, 9, 100);
        expect(Buffer.from(hdr).equals(referenceHeader(5, longName, 9, 100, cid))).toBe(true);
        expect(hdr[44 + 62]).toBe('x'.charCodeAt(0));
        expect(hdr[44 + 63]).toBe(0); // 64th byte is the terminator
    });

    it('rejects more than 512 bytes of DMX data', () => {
        const hdr = Buffer.alloc(HDR);
        fillE131PacketHeaderStatic(hdr, 'n');
        expect(() => updateE131PacketHeader(hdr, 1, 0, 513)).toThrow(/512/);
    });
});
