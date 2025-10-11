import { SendBatch } from "./protocols/UDP";
import { SchedulerHeapItem, SchedulerMinHeap } from "./SchedulerHeap";

export interface Sender {
    startBatch() : void;
    endBatch(): SendBatch | undefined;
    sendPortion(frame: SendJob, job: SenderJob, state: SendJobSenderState): boolean;
    sendPush(frame: SendJob, job: SenderJob, state: SendJobSenderState): void;
}

// What's in here?  The description of the job, containing:
// Buffers
// Controllers config
// Controllers scatter-gather lists (fixed instructions)
// Whether to send each controller or skip it
export class SenderJobPart {
    bufIdx : number = -1; // Which buffer
    bufStart : number = -1; // 
    bufLen : number = -1;
}

export class SenderJob {
    parts: SenderJobPart[] = [];
    rateLimit: number = 1000000000; // bytes per millisecond
    burstSize: number = 10000; // bytes per send batch

    // Sender + settings
    sender?: Sender;
}

export class SendJob {
    dataBuffers: Uint8Array[] = [];
    senders: SenderJob[] = [];

    frameNumber: number = -1;
}

export class SendJobSenderState implements SchedulerHeapItem {
    senderIdx: number = 0;

    curPart: number = 0;
    curOffset: number = 0;
    nextTime: number = 0;

    curChNum: number = 0;

    curDDPSeqNum: number = 1; // E131 uses low bits.
    getDDPSeqNum() {return this.curDDPSeqNum;}
    nextDDPSeqNum() {const rv = this.curDDPSeqNum; ++this.curDDPSeqNum; if (this.curDDPSeqNum > 15) this.curDDPSeqNum = 1; return rv;}

    curE131SeqNum: number = 0; // DDP uses this as 1-15; E131 uses low bits.
    getE131SeqNum() {return this.curE131SeqNum & 0xFF;}
    nextE131SeqNum() {const rv = this.curE131SeqNum; ++this.curE131SeqNum; return rv & 0xFF;}

    sendPacketNumber: number = 0;
    sendPacketNum() {const rv = this.sendPacketNumber; ++this.sendPacketNumber; return rv;}

    reset() {
        this.curPart = 0;
        this.curOffset = 0;
        this.nextTime = 0;
        this.curChNum = 0;
        this.sendPacketNumber = 0;
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

    initialize(job: SendJob) {
        this.job = job;
        while (this.states.length < job.senders.length) {
            const s = new SendJobSenderState();
            s.senderIdx = this.states.length;
            this.states.push(s);
            this.sendHeap.insert(s);
        }
        for (const s of this.states) s.reset();
    }
}
