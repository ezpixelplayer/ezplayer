import dgram from 'dgram';
import { SendBatch, UdpClient, UDPSender } from './UDP';
import { Sender, SenderJob, SendJob, SendJobSenderState } from '../SenderJob';
import { toDataView } from '../../util/Utils';

export const DDP_PORT_DEFAULT = 4048;
export const DDP_MAX_PAYLOAD = 1440;

// http://www.3waylabs.com/ddp/
// We are not messing with most of this.
// We are:
//   Sending uncompressed data
//   Setting the push flag
// We are maybe someday:
//   Setting the timecodes
// We are not:
//   Handling multiple display controller IDs
//   Sending inquiries and accepting responses

/**
 * Headerize a single DDP packet containing pixel data.
 * @param header + start - A buffer space for header.
 * @param startChannel - The starting channel for this packet.
 * @param dataLength - The number of bytes to send (defaults to full buffer).
 * @param push - Whether to set push
 * @param seqnum - Sequence number to set on packet
 * @param timecode - if set, for push packet, set the push time...
 */
export function fillInDDPHeader(
    rheader: Uint8Array,
    start: number,
    startChannel: number,
    dataLength: number,
    push: boolean,
    seqnum: number,
    timecode?: number,
) {
    const header = toDataView(rheader);
    // Byte 0...
    //  All packets sent and received have a 10 or 14 byte header followed by optional data.
    //  byte  0: flags: V V x T S R Q P
    //      V V:   2-bits for protocol version number, this document specifies version 1 (01).
    //        x:   reserved
    //        T:   timecode field added to end of header; if T & P are set, Push at specified time
    //        S:   Storage.  If set, data comes from Storage, not data-field.
    //        R:   Reply flag, marks reply to Query packet.
    //                always set when any packet is sent by a Display.
    //                if Reply, Q flag is ignored.
    //        Q:   Query flag, requests len data from ID at offset (no data sent)
    //                if clear, is a Write buffer packet
    //        P:   Push flag, for display synchronization, or marks last packet of Reply
    header.setUint8(0 + start, push ? 0x41 : 0x40); // Flags: Standard DDP with no compression 0b0100000P

    // byte  1:    x x x x n n n n
    //    x: reserved for future use (set to zero)
    // nnnn: sequence number from 1-15, or zero if not used
    //         the sequence number should be incremented with each new packet sent.
    //         a sender can send duplicate packets with the same sequence number and DDP header for redundancy.
    //         a receiver can ignore duplicates received back-to-back.
    //         the sequence number is ignored if zero.
    header.setUint8(1 + start, (seqnum % 15) + 1); // Sequence (auto-incrementing would be better)

    // byte  2:    data type - We are setting this to 1 as the format is pre-agreed with the controller
    //               set to zero if not used or undefined, otherwise:
    //          bits: C R TTT SSS
    //           C is 0 for standard types or 1 for Customer defined
    //           R is reserved and should be 0.
    //           TTT is data type
    //            000 = undefined
    //            001 = RGB
    //            010 = HSL
    //            011 = RGBW
    //            100 = grayscale
    //           SSS is size in bits per pixel element (like just R or G or B data)
    //            0=undefined, 1=1, 2=4, 3=8, 4=16, 5=24, 6=32
    header.setUint8(2 + start, 0);

    // byte  3:    Source or Destination ID
    //    0 = reserved
    //    1 = default output device
    //    Many other things.  We choose 1.
    header.setUint8(3 + start, 1);

    // byte  4-7:  data offset in bytes
    //            32-bit number, MSB first
    header.setUint32(4 + start, startChannel, false); // Start channel (big-endian)

    // byte  8-9:  data length in bytes (size of data field when writing)
    //              16-bit number, MSB first
    /*
  console.log(header.byteLength);
  console.log(header.byteOffset);
  console.log(header.buffer.byteLength);
  */
    header.setUint16(8 + start, dataLength, false); // Data length (big-endian)

    // if T flag, header extended 4 bytes for timecode field (not counted in data length)
    //   byte 10-13: timecode
    if (timecode !== undefined) {
        header.setUint32(10 + start, timecode, false);
    }
}

/**
 * Sends a single DDP packet containing pixel data.
 * @param targetIp - The target device's IP address.
 * @param data - A buffer containing pixel data.
 * @param startChannel - The starting channel for this packet.
 * @param dataLength - The number of bytes to send (defaults to full buffer).
 * @param udpPort - The destination UDP port (default: 4048).
 */
export async function sendDdpPacketUDPv4(
    targetIp: string,
    data: Uint8Array,
    startChannel: number,
    dataLength: number = data.length,
    push: boolean = false,
    seqnum: number,
    timecode: number | undefined,
    udpPort: number = DDP_PORT_DEFAULT,
): Promise<void> {
    if (dataLength <= 0 || dataLength > data.length) {
        throw new Error('Invalid data length.');
    }

    // DDP Header: 10 bytes (14 w/ timecode)
    const header = new Uint8Array(timecode === undefined ? 10 : 14);

    fillInDDPHeader(header, 0, startChannel, dataLength, push, seqnum, timecode);

    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        socket.send([header, data.subarray(0, dataLength)], udpPort, targetIp, (err) => {
            socket.close();
            if (err) reject(err);
            else resolve();
        });
    });
}

export class DDPSender extends UDPSender {
    startChNum: number = 0;
    pushAtEnd: boolean = true;
    useTimecodes: boolean = false;
    channelsPerPacket: number = DDP_MAX_PAYLOAD;
    sendBufSize?: number = undefined;
    headers: Uint8Array[] = []; // Max header size
    pushHeader: Uint8Array = new Uint8Array(10);

    curPacketNum = 0;
    startFrame(): void {
        this.curPacketNum = 0;
    }
    endFrame(): void {
        // This would be a time to push at end?
    }

    // This could throw - if you ignore it, send won't work...
    async connect() {
        if (!this.client) {
            this.client = new UdpClient(
                'udp4',
                this.address,
                DDP_PORT_DEFAULT,
                this.sendBufSize ?? 6_250_000 /*1Gbps 50ms*/,
            );
        }
        if (!this.client.isConnected()) {
            await this.client.connect();
        }
    }

    sendPortion(frame: SendJob, job: SenderJob, state: SendJobSenderState): boolean {
        const connected = this.client?.isConnected();
        if (!this.client || !connected) return true;

        const burst = job.burstSize;
        let rlLeftToSend = burst;

        let bytesThisPacket = 0;
        let packetBufs: Uint8Array[] = [];

        const sendOut = (last: boolean) => {
            if (!bytesThisPacket) return;
            if (this.curPacketNum >= this.headers.length) {
                this.headers.push(new Uint8Array(this.useTimecodes ? 14 : 10));
            }
            const hdr = this.headers[this.curPacketNum];
            fillInDDPHeader(
                hdr,
                0,
                this.startChNum + state.curChNum,
                bytesThisPacket,
                !this.pushAtEnd && last,
                state.nextDDPSeqNum(),
            );
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
                sendOut(false);
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
        sendOut(true);
        return true;
    }

    sendPush(_frame: SendJob, _job: SenderJob, state: SendJobSenderState): void {
        if (this.pushAtEnd) {
            fillInDDPHeader(this.pushHeader, 0, this.startChNum + state.curChNum, 0, true, state.nextDDPSeqNum());
            if (this.client?.isConnected()) {
                this.client?.addSendToBatch(this.pushHeader);
            }
        }
    }
}
