import { OpenControllerReport } from '../controllers/controllertypes';
import { ControllerRec } from '../xlcompat/XLXmlUtil';
import { ControllerSetup } from '../controllers/controllertypes';
import { SendBatch } from './protocols/UDP';
import { SchedulerHeapItem, SchedulerMinHeap } from './SchedulerHeap';

export interface Sender {
    controllerSetup?: ControllerSetup;
    controllerReport?: OpenControllerReport;
    controllerRecord?: ControllerRec;

    startFrame(): void;
    endFrame(): void;
    startBatch(): void;
    endBatch(): SendBatch | undefined;
    sendPortion(frame: SendJob, job: SenderJob, state: SendJobSenderState): boolean;
    sendPush(frame: SendJob, job: SenderJob, state: SendJobSenderState): void;
    suspend(): void;
    resume(): void;
    minFrameTime(): number;
    isCurrentlySending(): boolean;
    /** Estimated on-the-wire bytes (payload + protocol + UDP/IP/eth overhead) for one whole frame of this job. */
    frameWireBytes(job: SenderJob): number;
}

// What's in here?  The description of the job, containing:
// Buffers
// Controllers config
// Controllers scatter-gather lists (fixed instructions)
// Whether to send each controller or skip it
export class SenderJobPart {
    bufIdx: number = -1; // Which buffer
    bufStart: number = -1; //
    bufLen: number = -1;
}

export class SenderJob {
    parts: SenderJobPart[] = [];
    rateLimit: number = 1000000000; // Max wire bytes per millisecond to this controller
    burstSize: number = 2880; // Wire bytes per sendPortion burst (~2 DDP packets)

    // Sender + settings
    sender?: Sender;
}

export class SendJob {
    dataBuffers: Uint8Array[] = [];
    senders: SenderJob[] = [];

    /** Fraction of the frame interval to stretch sends across; the rest is
     *  headroom for the push packet, socket callbacks, and next-frame prep.
     * TODO: This is temporary until the send pipeline is fixed in .7
     */
    slotFraction: number = 0.85;

    frameNumber: number = -1;
}

export class SendJobSenderState implements SchedulerHeapItem {
    senderIdx: number = 0;

    curPart: number = 0;
    curOffset: number = 0;
    nextTime: number = 0;

    curChNum: number = 0;

    /** Wire bytes sent so far this frame (payload + protocol + UDP/IP/eth overhead). */
    wireBytesSent: number = 0;
    /** Pacing rate for this frame, wire bytes per millisecond. */
    sendRate: number = 0;

    skippingThisFrame: boolean = false;
    lastSendTime: number = 0;

    curDDPSeqNum: number = 1; // E131 uses low bits.
    getDDPSeqNum() {
        return this.curDDPSeqNum;
    }
    nextDDPSeqNum() {
        const rv = this.curDDPSeqNum;
        ++this.curDDPSeqNum;
        if (this.curDDPSeqNum > 15) this.curDDPSeqNum = 1;
        return rv;
    }

    curE131SeqNum: number = 0; // DDP uses this as 1-15; E131 uses low bits.
    getE131SeqNum() {
        return this.curE131SeqNum & 0xff;
    }
    nextE131SeqNum() {
        const rv = this.curE131SeqNum;
        ++this.curE131SeqNum;
        return rv & 0xff;
    }

    sendPacketNumber: number = 0;
    sendPacketNum() {
        const rv = this.sendPacketNumber;
        ++this.sendPacketNumber;
        return rv;
    }

    reset() {
        this.curPart = 0;
        this.curOffset = 0;
        this.nextTime = 0;
        this.curChNum = 0;
        this.sendPacketNumber = 0;
        this.wireBytesSent = 0;
    }
}

// Sender job status
// For each controller, how far along it is
// It's token bucket
// Job scheduler heap
export class SendJobState {
    states: SendJobSenderState[] = [];
    job?: SendJob;
    sendHeap: SchedulerMinHeap<SendJobSenderState> = new SchedulerMinHeap();

    /**
     * Set up per-sender progress and the pacing plan for one frame.
     *
     * Each non-skipped sender gets a send rate that stretches its frame data
     * across the usable slot (frameIntervalMs * job.slotFraction, measured from
     * sendTime), capped by its rateLimit. The scheduler heap is rebuilt with all
     * active senders due at slot start; interleaving across controllers then
     * falls out of the heap ordering as each sender's nextTime advances by
     * bytesSent / sendRate.
     */
    initialize(sendTime: number, job: SendJob, frameIntervalMs: number = 50) {
        let skipsDueToReq = 0;
        let skipsDueToSlowCtrl = 0;

        this.job = job;
        while (this.states.length < job.senders.length) {
            const s = new SendJobSenderState();
            s.senderIdx = this.states.length;
            this.states.push(s);
        }
        let i = 0;
        for (const s of this.states) {
            s.reset();
            const frameTime = job.senders[i].sender?.minFrameTime() ?? 0;
            if (sendTime < s.lastSendTime + frameTime - 0.1) {
                s.skippingThisFrame = true;
                ++skipsDueToReq;
            } else if (job.senders[i].sender?.isCurrentlySending()) {
                s.skippingThisFrame = true;
                ++skipsDueToSlowCtrl;
            } else {
                s.skippingThisFrame = false;
                if (sendTime - s.lastSendTime >= frameTime * 2) {
                    s.lastSendTime = sendTime;
                } else {
                    // This allows interop of 40FPS and 100FPS, say, by bringing it up 25ms instead of 30
                    //  But some things can't deal with it.
                    // s.lastSendTime += frameTime;
                    s.lastSendTime = sendTime;
                }
            }
            ++i;
        }

        // Build the pacing plan. If we're starting late, the window shrinks so
        // the frame still lands by its deadline (down to an immediate burst).
        this.sendHeap.clear();
        const startNow = performance.now();
        const slotStart = Math.max(sendTime, startNow);
        const deadline = sendTime + Math.max(1, frameIntervalMs) * job.slotFraction;
        const window = Math.max(1, deadline - slotStart);
        for (const s of this.states) {
            if (s.skippingThisFrame || s.senderIdx >= job.senders.length) continue;
            const senderJob = job.senders[s.senderIdx];
            if (!senderJob.sender) continue;
            const wireBytes = senderJob.sender.frameWireBytes(senderJob);
            if (wireBytes <= 0) continue;
            s.sendRate = Math.min(wireBytes / window, senderJob.rateLimit);
            s.nextTime = slotStart;
            this.sendHeap.insert(s);
        }

        return { skipsDueToReq, skipsDueToSlowCtrl };
    }
}
