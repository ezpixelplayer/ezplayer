import { describe, expect, it } from 'vitest';
import { SendJob, SenderJob, SendJobSenderState } from '../SenderJob';
import {
    ARTNET_HEADERLEN,
    ARTNET_PORT,
    ArtNetSender,
    artNetPacketLength,
    fillArtNetHeaderStatic,
    updateArtNetHeader,
} from './ArtNet';
import { e131Universes } from './E131';
import type { UdpClient } from './UDP';

/** An ArtDmx header built field by field from the Art-Net 4 specification. */
function referenceHeader(universe: number, sequence: number, dataLen: number): Buffer {
    const p = Buffer.alloc(ARTNET_HEADERLEN);
    p.write('Art-Net\0', 0, 'ascii');
    p.writeUInt16LE(0x5000, 8); // OpDmx
    p.writeUInt16BE(14, 10); // protocol version
    p[12] = sequence;
    p[13] = 0; // physical
    p[14] = universe & 0xff; // sub-net + universe
    p[15] = (universe >> 8) & 0xff; // net
    p.writeUInt16BE(dataLen + (dataLen & 1), 16);
    return p;
}

describe('ArtDmx header', () => {
    it('static fill + per-packet update matches the specification field by field', () => {
        const hdr = Buffer.alloc(ARTNET_HEADERLEN);
        fillArtNetHeaderStatic(hdr);
        const cases: Array<[number, number, number]> = [
            [0, 1, 510],
            [1, 2, 512],
            [0x7fff, 255, 2],
            [0x1234, 17, 3], // odd payload: length rounds up
        ];
        for (const [universe, seq, dataLen] of cases) {
            updateArtNetHeader(hdr, universe, seq, dataLen);
            expect(hdr.equals(referenceHeader(universe, seq, dataLen))).toBe(true);
        }
    });

    it('rejects an empty or oversized payload', () => {
        const hdr = Buffer.alloc(ARTNET_HEADERLEN);
        fillArtNetHeaderStatic(hdr);
        expect(() => updateArtNetHeader(hdr, 1, 1, 0)).toThrow(/512/);
        expect(() => updateArtNetHeader(hdr, 1, 1, 513)).toThrow(/512/);
    });

    it('counts the pad byte in a packet length', () => {
        expect(artNetPacketLength(510)).toBe(ARTNET_HEADERLEN + 510);
        expect(artNetPacketLength(3)).toBe(ARTNET_HEADERLEN + 4);
    });
});

describe('ArtNetSender packetizing', () => {
    interface Sent {
        universe: number;
        sequence: number;
        length: number;
        slots: number[];
    }

    /** Send `channels` of ramp data (value = channel index & 0xff), recording each packet. */
    function sendFrame(
        sender: ArtNetSender,
        channels: number,
        state = new SendJobSenderState(),
        burstSize = 1_000_000,
    ) {
        const sent: Sent[] = [];
        sender.client = {
            isConnected: () => true,
            addSendToBatch: (bufs: Uint8Array[]) => {
                const [hdr, ...data] = bufs;
                const h = Buffer.from(hdr);
                sent.push({
                    universe: h.readUInt16LE(14),
                    sequence: h[12],
                    length: h.readUInt16BE(16),
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

        state.reset();
        sender.startFrame();
        let calls = 1;
        while (!sender.sendPortion(job, sj, state)) ++calls;
        sender.sendPush(job, sj, state);
        return { sent, sj, state, calls };
    }

    const ramp = (start: number, n: number) => Array.from({ length: n }, (_, i) => (start + i) & 0xff);

    it('gives each universe its own size, continuing past the last at its size', () => {
        const sender = new ArtNetSender();
        sender.universes = e131Universes([0, 1, 5], [3, 510, 100]);

        const { sent } = sendFrame(sender, 3 + 510 + 100 + 150);
        expect(sent.map((s) => [s.universe, s.slots.length])).toEqual([
            [0, 4], // 3 channels plus the pad byte
            [1, 510],
            [5, 100],
            [6, 100],
            [7, 50],
        ]);
        expect(sent[0].length).toBe(4);
        expect(sent[0].slots).toEqual([...ramp(0, 3), 0]);
        expect(sent[1].slots).toEqual(ramp(3, 510));
        expect(sent[4].slots).toEqual(ramp(3 + 510 + 200, 50));
    });

    it('numbers frames 1 to 255 and never 0', () => {
        const sender = new ArtNetSender();
        sender.universes = e131Universes([1], [510]);
        const state = new SendJobSenderState();
        const seen: number[] = [];
        for (let i = 0; i < 300; i++) {
            const { sent } = sendFrame(sender, 510, state);
            seen.push(sent[0].sequence);
        }
        expect(seen.slice(0, 3)).toEqual([1, 2, 3]);
        expect(seen[254]).toBe(255);
        expect(seen[255]).toBe(1);
        expect(seen).not.toContain(0);
    });

    it('accounts for the wire bytes of a frame, pad included', () => {
        const sender = new ArtNetSender();
        sender.universes = e131Universes([1, 2], [510, 3]);
        const sj = new SenderJob();
        sj.parts.push({ bufIdx: 0, bufStart: 0, bufLen: 513 });
        const { state } = sendFrame(sender, 513);
        expect(sender.frameWireBytes(sj)).toBe(state.wireBytesSent);
    });

    it('asks to send from the Art-Net port', async () => {
        const sender = new ArtNetSender();
        sender.address = '127.0.0.1';
        await sender.connect();
        try {
            expect(sender.client?.preferredLocalPort).toBe(ARTNET_PORT);
            expect(sender.client?.localPort).toBeDefined();
        } finally {
            await sender.client?.disconnect();
        }
    });

    it('yields at a packet boundary when the burst budget is spent', () => {
        const sender = new ArtNetSender();
        sender.universes = e131Universes([1], [510]);
        const { sent, calls } = sendFrame(sender, 510 * 4, new SendJobSenderState(), 1);
        expect(sent).toHaveLength(4);
        expect(calls).toBe(4);
    });
});
