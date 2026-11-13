import { UDP_WIRE_OVERHEAD, UdpClient, UDPSender } from './UDP';
import { E131Universe, e131Universes } from './E131';
import { SenderJob, SendJob, SendJobSenderState } from '../SenderJob';
import { toDataView } from '../../util/Utils';

export const ARTNET_PORT = 6454;
export const ARTNET_MAX_PAYLOAD = 512;

/** ArtDmx header: ID, OpCode, protocol version, sequence, physical, port address, length. */
export const ARTNET_HEADERLEN = 18;
const ARTNET_ID = Buffer.from('Art-Net\0', 'ascii');
const ARTNET_OP_DMX = 0x5000;
const ARTNET_PROTOCOL_VERSION = 14;
/** A frame's channel data must be an even count; an odd one is padded with this. */
const ZERO_PAD = new Uint8Array(1);

//
// For reference, consult the Art-Net 4 specification, https://art-net.org.uk/
//
// An ArtDmx packet carries one universe (the spec's "port address", 15 bits:
// net 7, sub-net 4, universe 4; xLights numbers them as one integer, which is
// what the layout file holds). The header is 18 bytes, little-endian OpCode,
// big-endian everything else that is two bytes.

/** Fill the header fields that never change between packets from one sender. */
export function fillArtNetHeaderStatic(rheader: Uint8Array) {
    const header = toDataView(rheader);
    rheader.fill(0, 0, ARTNET_HEADERLEN);
    rheader.set(ARTNET_ID, 0);
    header.setUint16(8, ARTNET_OP_DMX, true);
    header.setUint16(10, ARTNET_PROTOCOL_VERSION, false);
    // [12] sequence, [13] physical (always 0), [14..16) port address, [16..18) length: per packet
}

/**
 * Stamp the per-packet fields of a buffer prepared by `fillArtNetHeaderStatic`.
 * `dataLen` is the channel count; the wire length is rounded up to even, so
 * the caller pads an odd payload with one zero byte.
 */
export function updateArtNetHeader(rheader: Uint8Array, universe: number, sequence: number, dataLen: number) {
    if (dataLen < 1 || dataLen > ARTNET_MAX_PAYLOAD) {
        throw new Error('ArtDmx data must be 1 to 512 bytes.');
    }
    const header = toDataView(rheader);
    rheader[12] = sequence & 0xff;
    header.setUint16(14, universe & 0xffff, true);
    header.setUint16(16, dataLen + (dataLen & 1), false);
}

/** The wire length of a packet carrying `dataLen` channels: header plus even payload. */
export function artNetPacketLength(dataLen: number): number {
    return ARTNET_HEADERLEN + dataLen + (dataLen & 1);
}

export class ArtNetSender extends UDPSender {
    /** Filled in order, one per packet; must not be empty. Channels past the last
     *  one continue on consecutive universes of its size. */
    universes: E131Universe[] = e131Universes();

    headers: Buffer[] = [];
    sendBufSize?: number = undefined;

    // This could throw - if you ignore it, send won't work...
    async connect() {
        if (!this.client) {
            // Art-Net wants packets to come from 6454 as well as go to it.
            this.client = new UdpClient(
                'udp4',
                this.address,
                ARTNET_PORT,
                this.sendBufSize ?? 625_000 /*100Mbps 50ms*/,
                this.localAddress,
                { preferredLocalPort: ARTNET_PORT },
            );
        }
        if (!this.client.isConnected()) {
            await this.client.connect();
        }
    }

    curPacketNum = 0;
    startFrame(): void {
        this.curPacketNum = 0;
    }
    endFrame(): void {}

    private universeOfPacket(packetNum: number): number {
        const last = this.universes.length - 1;
        return packetNum <= last
            ? this.universes[packetNum].universe
            : this.universes[last].universe + packetNum - last;
    }

    private sizeOfPacket(packetNum: number): number {
        return this.universes[Math.min(packetNum, this.universes.length - 1)].size;
    }

    frameWireBytes(job: SenderJob): number {
        let payload = 0;
        for (const p of job.parts) payload += p.bufLen;
        let wire = 0;
        for (let left = payload, packet = 0; left > 0; ++packet) {
            const n = Math.min(left, this.sizeOfPacket(packet));
            wire += artNetPacketLength(n) + UDP_WIRE_OVERHEAD;
            left -= n;
        }
        return wire;
    }

    /** Send up to job.burstSize wire bytes (whole packets), then yield.
     *  Returns true when the frame is fully sent for this sender. */
    sendPortion(frame: SendJob, job: SenderJob, state: SendJobSenderState): boolean {
        const connected = this.client?.isConnected();
        if (!this.client || !connected) return true;

        let burstLeft = job.burstSize;

        let bytesThisPacket = 0;
        let packetBufs: Uint8Array[] = [];

        const sendOut = () => {
            if (!bytesThisPacket) return;
            const univ = this.universeOfPacket(state.sendPacketNum());
            if (this.curPacketNum >= this.headers.length) {
                const nh = Buffer.alloc(ARTNET_HEADERLEN);
                fillArtNetHeaderStatic(nh);
                this.headers.push(nh);
            }
            const hdr = this.headers[this.curPacketNum];
            updateArtNetHeader(hdr, univ, state.getArtNetSeqNum(), bytesThisPacket);
            if (bytesThisPacket & 1) packetBufs.push(ZERO_PAD);
            this.client!.addSendToBatch([hdr, ...packetBufs]);
            const wire = artNetPacketLength(bytesThisPacket) + UDP_WIRE_OVERHEAD;
            state.wireBytesSent += wire;
            burstLeft -= wire;
            packetBufs = [];
            state.curChNum += bytesThisPacket;
            bytesThisPacket = 0;
            ++this.curPacketNum;
        };

        // Go through the parts, packetizing; stop at a packet boundary once the
        // burst budget is spent (the scheduler calls again at the paced time).
        for (; state.curPart < job.parts.length;) {
            const part = job.parts[state.curPart];
            const leftThisJob = part.bufLen - state.curOffset;
            if (!leftThisJob) {
                ++state.curPart;
                state.curOffset = 0;
                continue;
            }

            const avToSend = this.sizeOfPacket(state.sendPacketNumber) - bytesThisPacket;

            if (avToSend === 0) {
                // Only way to make progress is to send -- and we know there is more.
                sendOut();
                if (burstLeft <= 0) return false;
                continue;
            }

            // Slice, scatter gather, fragment, etc.
            const buf = frame.dataBuffers[part.bufIdx];
            const thisJob = Math.min(avToSend, leftThisJob);
            packetBufs.push(buf.subarray(state.curOffset + part.bufStart, state.curOffset + part.bufStart + thisJob));
            bytesThisPacket += thisJob;
            state.curOffset += thisJob;
        }

        // May have stuff left...
        sendOut();
        return true;
    }

    sendPush(_frame: SendJob, _job: SenderJob, state: SendJobSenderState): void {
        // One sequence number per frame, shared by its universes; it steps here.
        // (ArtSync is not sent: it is broadcast, and few controllers want it.)
        state.nextArtNetSeqNum();
    }
}
