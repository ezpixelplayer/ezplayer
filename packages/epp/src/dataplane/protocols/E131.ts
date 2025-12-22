import { UdpClient, UDPSender } from './UDP';
import { SenderJob, SendJob, SendJobSenderState } from '../SenderJob';
import { toDataView } from '../../util/Utils';

export const E131_PORT_DEFAULT = 5568;
export const E131_DEFAULT_PAYLOAD = 510;
export const E131_MAX_PAYLOAD = 512;

const E131_PACKET_HEADERLEN = 126;
const E131_SYNCPACKET_LEN = 49;
const E131_PACKET_LEN_MAX = E131_PACKET_HEADERLEN + E131_MAX_PAYLOAD;
const E131_DEFAULT_PRIORITY = 100;
const E131_EZP_UUID = 'e4eaaaf2-d142-11e1-b3e4-080027620cdd';
const E131_EZP_UUID_BUF = Buffer.from(E131_EZP_UUID.replace(/-/g, ''), 'hex');
const E131_ROOT_PREAMBLE_SIZE = 0x0010;
const E131_ROOT_POSTAMBLE_SIZE = 0x0000;
const ACN_PACKET_IDENTIFIER = Buffer.from([
    0x41,
    0x53,
    0x43,
    0x2d,
    0x45,
    0x31,
    0x2e,
    0x31,
    0x37,
    0x00,
    0x00,
    0x00, // "ASC-E1.17\0\0\0"
]);
const E131_VECTOR_EXTENDED_SYNCHRONIZATION = 0x00000001;
const E131_VECTOR_DATA_PACKET = 0x00000002;
const E131_VECTOR_ROOT_DATA = 0x00000004;
const E131_VECTOR_ROOT_EXTENDED = 0x00000008;
const E131_VECTOR_DMP_SET_PROPERTY = 0x02;
const E131_START_CODE = 0x00;

// NB: This supports a 12-bit length
function setE131LengthField(buffer: DataView, offset: number, length: number) {
    buffer.setUint16(offset, 0x7000 | length, false); // This is the framing length protocol flags + length
}

//
// For reference, consult the E1.31 specification
// https://tsp.esta.org/tsp/documents/docs/E1-31-2016.pdf

/**
 * Headerize a single E1.31 packet containing pixel data;
 *  (according to ChatGPT, which is admittedly spotty on this.)
 *
 * 1. Root Layer
 *    Preamble, Postamble: Standard constants
 *    CID: UUID identifying your sender
 *    Vector: Should be 0x00000004 (indicating Data Packet)
 *
 * 2. Framing Layer
 *    Source Name: 64-byte UTF-8 string (can be any ASCII name)
 *    Priority: Typically 100 (default), 0–200
 *    Synchronization Address: If you're using sync packets, set this
 *    Universe: 16-bit number (1–63999)
 *    Options: Bitmask (set "Preview Data" or "Stream Terminated" if needed)
 *
 * 3. DMP Layer
 *    Address Type/Data Type: Always 0xa1
 *    First Property Address: Always 0x0000
 *    Address Increment: Always 0x0001
 *    Property Value Count: 1 + number of slots (e.g., 513 for full DMX universe)
 *    Property Values:
 *      First byte is always 0 (start code — typically ignored)
 *      Remaining 512 bytes = DMX channel values (0–255)
 */

const encoder = new TextEncoder();

// Constants (dubious)

function fillE131PacketHeader(
    rdataPacket: Uint8Array,
    universe: number,
    sourceName: string,
    sequence: number,
    dataLen: number,
    cid?: Uint8Array,
) {
    if (dataLen > 512) {
        throw new Error('DMX data cannot exceed 512 bytes.');
    }

    const dataPacket = toDataView(rdataPacket);

    rdataPacket.fill(0, 0, E131_PACKET_HEADERLEN); // 126
    // Root Layer
    dataPacket.setUint16(0, E131_ROOT_PREAMBLE_SIZE, false);
    dataPacket.setUint16(2, E131_ROOT_POSTAMBLE_SIZE, false);
    rdataPacket.set(ACN_PACKET_IDENTIFIER, 4); // 12 bytes
    setE131LengthField(dataPacket, 16, E131_PACKET_HEADERLEN + dataLen - 16); // Root layer flag and length;
    dataPacket.setUint32(18, E131_VECTOR_ROOT_DATA, false); // Root vector (VECTOR_ROOT_E131_DATA)
    rdataPacket.set(cid ?? E131_EZP_UUID_BUF, 22); // 16 byte UUID

    // Frame Layer
    setE131LengthField(dataPacket, 38, E131_PACKET_HEADERLEN + dataLen - 38); // Frame layer flag and length;
    dataPacket.setUint32(40, E131_VECTOR_DATA_PACKET, false);
    // Source name, hmm.
    let bytes = encoder.encode(sourceName);
    // Cut to 63 bytes max, utf-8 validity be darned
    if (bytes.length > 63) {
        bytes = bytes.slice(0, 63);
    }
    rdataPacket.set(bytes, 44);
    rdataPacket[108] = E131_DEFAULT_PRIORITY;
    dataPacket.setUint16(109, 0, false); // Synchronization address
    rdataPacket[111] = sequence & 0xff;
    rdataPacket[112] = 0; // Options: Bit 7 = Preview_Data, Bit 6 = Stream_Terminated, Bit 5 = Force_Synchronization
    dataPacket.setUint16(113, universe, false); // Universe

    // DMP layer
    setE131LengthField(dataPacket, 115, E131_PACKET_HEADERLEN + dataLen - 115); // dmp layer flag and length;
    rdataPacket[117] = E131_VECTOR_DMP_SET_PROPERTY;
    rdataPacket[118] = 0xa1; // This is not explained.  It "identifies format of address and data"
    dataPacket.setUint16(119, 0, false); // Start address (0)
    dataPacket.setUint16(121, 1, false); // Address increment (1)
    dataPacket.setUint16(123, dataLen + 1, false); // Property value count
    rdataPacket[125] = E131_START_CODE;
}

function buildE131SyncPacket(rsyncData: Uint8Array, syncUniverse: number, sequence: number, cid?: Uint8Array) {
    const syncData = toDataView(rsyncData);
    rsyncData.fill(0, 0, E131_SYNCPACKET_LEN);

    // Root layer
    syncData.setUint16(0, E131_ROOT_PREAMBLE_SIZE, false); // Root layer preamble size
    syncData.setUint16(2, E131_ROOT_POSTAMBLE_SIZE, false); // Root layer postamble size (none, actually)
    rsyncData.set(ACN_PACKET_IDENTIFIER, 4); // 12 bytes
    setE131LengthField(syncData, 16, E131_SYNCPACKET_LEN - 16); // Root layer flag and length
    syncData.setUint32(18, E131_VECTOR_ROOT_EXTENDED, false); // Root vector (VECTOR_ROOT_E131_EXTENDED)
    rsyncData.set(cid ?? E131_EZP_UUID_BUF, 22); // 16 byte UUID

    // Framing layer
    setE131LengthField(syncData, 38, E131_SYNCPACKET_LEN - 38); // Framing layer flag and length
    syncData.setUint32(40, E131_VECTOR_EXTENDED_SYNCHRONIZATION, false);

    rsyncData[44] = sequence & 0xff; // sequence number
    syncData.setUint16(45, syncUniverse, false);
}

export class E131Sender extends UDPSender {
    startUniverse: number = 0; // Unclear how to do refragmentation on this...
    syncUniverse: number = 0;
    channelsPerPacket: number = 510;
    pushAtEnd: boolean = true;
    useTimecodes: boolean = false;

    headers: Buffer[] = [];
    syncPacket = Buffer.alloc(E131_SYNCPACKET_LEN);
    sendBufSize?: number = undefined;

    // This could throw - if you ignore it, send won't work...
    async connect() {
        if (!this.client) {
            this.client = new UdpClient(
                'udp4',
                this.address,
                E131_PORT_DEFAULT,
                this.sendBufSize ?? 625_000 /*100Mbps 50ms*/,
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
    endFrame(): void {
        // This would be a time to push at end?
    }

    sendPortion(frame: SendJob, job: SenderJob, state: SendJobSenderState): boolean {
        const connected = this.client?.isConnected();
        if (!this.client || !connected) return true;

        const burst = job.burstSize;
        let rlLeftToSend = burst;

        let bytesThisPacket = 0;
        let packetBufs: Uint8Array[] = [];

        // TODO: We may be asked to do scattered universes and fractional packets.  Not now, but at some point.
        const sendOut = (sourceName: string, _last: boolean) => {
            if (!bytesThisPacket) return;
            const univ = state.sendPacketNum() + this.startUniverse;
            if (this.curPacketNum >= this.headers.length) {
                this.headers.push(Buffer.alloc(E131_PACKET_HEADERLEN));
            }
            const hdr = this.headers[this.curPacketNum];
            fillE131PacketHeader(hdr, univ, sourceName, state.nextE131SeqNum(), bytesThisPacket);
            this.client!.addSendToBatch([hdr, ...packetBufs]);
            packetBufs = [];
            state.curChNum += bytesThisPacket;
            bytesThisPacket = 0;
            ++this.curPacketNum;
        };

        // Outer loop - go through all the parts
        //  When to return: all done, or budget hit and we're about to enqueue
        // OK go through and do it ALL... and update the next send time based on the token bucket
        for (; state.curPart < job.parts.length; ) {
            const part = job.parts[state.curPart];
            const leftThisJob = part.bufLen - state.curOffset;
            if (!leftThisJob) {
                ++state.curPart;
                state.curOffset = 0;
                continue;
            }

            const avToSend = this.channelsPerPacket - bytesThisPacket;

            if (avToSend === 0) {
                // Only way to make progress is to send -- and we know there is more.
                rlLeftToSend -= bytesThisPacket;
                sendOut('blaBlaBLA', false);
                continue;
            }

            // Slice, scatter gather, fragment, etc.
            const buf = frame.dataBuffers[part.bufIdx];
            const thisJob = Math.min(avToSend, leftThisJob);
            packetBufs.push(buf.subarray(state.curOffset + part.bufStart, state.curOffset + part.bufStart + thisJob));
            bytesThisPacket += thisJob;
            state.curOffset += thisJob;
        }

        // TODO EZP Rate limit write-back

        // May have stuff left...
        sendOut('blaBlaBLA', true);
        return true;
    }

    async sendPush(_frame: SendJob, _job: SenderJob, state: SendJobSenderState): Promise<void> {
        if (this.pushAtEnd) {
            buildE131SyncPacket(this.syncPacket, this.syncUniverse, state.nextE131SeqNum());
            if (this.client?.isConnected()) {
                this.client?.addSendToBatch(this.syncPacket);
            }
        }
    }
}
