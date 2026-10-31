import { describe, expect, it } from 'vitest';
import { SendJob, SenderJob, SendJobSenderState } from '../SenderJob';
import { e131Universes, E131Sender, fillE131PacketHeaderStatic, updateE131PacketHeader } from './E131';
import type { UdpClient } from './UDP';

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

describe('e131Universes', () => {
    it('pairs numbers with sizes in channel order', () => {
        expect(e131Universes([1, 7], [3, 150])).toEqual([
            { universe: 1, size: 3 },
            { universe: 7, size: 150 },
        ]);
    });

    it('defaults a missing size, skips empty universes, and always yields one', () => {
        expect(e131Universes([1, 2, 3], [0, 100])).toEqual([
            { universe: 2, size: 100 },
            { universe: 3, size: 510 },
        ]);
        expect(e131Universes()).toEqual([{ universe: 1, size: 510 }]);
    });
});

describe('E131Sender packetizing', () => {
    interface Sent {
        universe: number;
        slots: number[];
    }

    /** Send `channels` of ramp data (value = channel index & 0xff), recording each packet. */
    function sendFrame(sender: E131Sender, channels: number, burstSize = 1_000_000) {
        const sent: Sent[] = [];
        sender.pushAtEnd = false; // as controller setup does
        sender.client = {
            isConnected: () => true,
            addSendToBatch: (bufs: Uint8Array[]) => {
                const [hdr, ...data] = bufs;
                sent.push({
                    universe: Buffer.from(hdr).readUInt16BE(113),
                    slots: data.flatMap((d) => Array.from(d)),
                });
            },
        } as unknown as UdpClient;

        const job = new SendJob();
        const sj = new SenderJob();
        sj.sender = sender;
        sj.burstSize = burstSize;
        sj.parts.push({ bufIdx: 0, bufStart: 0, bufLen: channels });
        job.senders.push(sj);
        job.dataBuffers = [Uint8Array.from({ length: channels }, (_, i) => i & 0xff)];

        const state = new SendJobSenderState();
        sender.startFrame();
        let calls = 1;
        while (!sender.sendPortion(job, sj, state)) ++calls;
        return { sent, sj, state, calls };
    }

    const ramp = (start: number, n: number) => Array.from({ length: n }, (_, i) => (start + i) & 0xff);

    it('universe per string: gives each universe its own size', () => {
        const sender = new E131Sender();
        sender.universes = e131Universes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [3, 3, 3, 3, 3, 150, 150, 150, 150, 150]);

        const { sent, sj, state } = sendFrame(sender, 765);

        expect(sent.map((p) => p.universe)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(sent.map((p) => p.slots.length)).toEqual([3, 3, 3, 3, 3, 150, 150, 150, 150, 150]);
        expect(sent[5].slots).toEqual(ramp(15, 150));
        expect(sent[9].slots).toEqual(ramp(615, 150));
        expect(state.wireBytesSent).toBe(sender.frameWireBytes(sj));
    });

    it('follows gaps in the universe numbers', () => {
        const sender = new E131Sender();
        sender.universes = e131Universes([1, 100, 40], [6, 3, 9]);

        const { sent } = sendFrame(sender, 18);

        expect(sent).toEqual([
            { universe: 1, slots: ramp(0, 6) },
            { universe: 100, slots: ramp(6, 3) },
            { universe: 40, slots: ramp(9, 9) },
        ]);
    });

    it('continues on consecutive universes past the end of the list', () => {
        const sender = new E131Sender();
        sender.universes = e131Universes([5, 9], [3, 510]);

        const { sent, sj, state } = sendFrame(sender, 1200);

        expect(sent.map((p) => p.universe)).toEqual([5, 9, 10, 11]);
        expect(sent.map((p) => p.slots.length)).toEqual([3, 510, 510, 177]);
        expect(state.wireBytesSent).toBe(sender.frameWireBytes(sj));
    });

    it('stays on the right universe when a frame spans several bursts', () => {
        const sender = new E131Sender();
        sender.universes = e131Universes([1, 2, 3, 4], [3, 150, 3, 150]);

        const { sent, calls } = sendFrame(sender, 306, 1); // one packet per burst

        expect(calls).toBe(4);
        expect(sent.map((p) => [p.universe, p.slots.length])).toEqual([
            [1, 3],
            [2, 150],
            [3, 3],
            [4, 150],
        ]);
        expect(sent.flatMap((p) => p.slots)).toEqual(ramp(0, 306));
    });

    // A receiver treats a step of -19..0 as a stale packet (E1.31 6.7.2).
    it.each([1, 10, 237, 255, 256, 512])('steps every universe by one a frame with %i universes', (n) => {
        const sender = new E131Sender();
        sender.pushAtEnd = false;
        sender.universes = Array.from({ length: n }, (_, i) => ({ universe: i + 1, size: 3 }));
        const sequences = new Map<number, number[]>();
        sender.client = {
            isConnected: () => true,
            addSendToBatch: (bufs: Uint8Array[]) => {
                const hdr = Buffer.from(bufs[0]);
                const universe = hdr.readUInt16BE(113);
                sequences.set(universe, [...(sequences.get(universe) ?? []), hdr[111]]);
            },
        } as unknown as UdpClient;

        const job = new SendJob();
        const sj = new SenderJob();
        sj.sender = sender;
        sj.burstSize = 1_000_000;
        sj.parts.push({ bufIdx: 0, bufStart: 0, bufLen: n * 3 });
        job.senders.push(sj);
        job.dataBuffers = [new Uint8Array(n * 3)];

        const state = new SendJobSenderState();
        state.curE131SeqNum = 254; // over the wrap
        for (let frame = 0; frame < 4; ++frame) {
            state.reset();
            sender.startFrame();
            while (!sender.sendPortion(job, sj, state));
            sender.sendPush(job, sj, state);
        }

        expect(sequences.size).toBe(n);
        for (const seqs of sequences.values()) expect(seqs).toEqual([254, 255, 0, 1]);
    });
});
