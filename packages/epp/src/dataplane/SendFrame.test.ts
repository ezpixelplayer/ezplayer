import dgram from 'dgram';
import { describe, expect, it } from 'vitest';
import { sendFull } from './SendFrame';
import { Sender, SenderJob, SendJob, SendJobSenderState, SendJobState } from './SenderJob';
import { DDPSender } from './protocols/DDP';
import { busySleep } from '../util/Utils';

/** Minimal Sender that "sends" bursts of abstract wire bytes and records when. */
class FakeSender implements Sender {
    pushes = 0;
    constructor(
        readonly id: number,
        readonly totalBytes: number,
        readonly events: { id: number; t: number; bytes: number }[],
    ) {}
    startFrame() {}
    endFrame() {}
    startBatch() {}
    endBatch() {
        return undefined;
    }
    suspend() {}
    resume() {}
    minFrameTime() {
        return 0;
    }
    isCurrentlySending() {
        return false;
    }
    frameWireBytes(_job: SenderJob) {
        return this.totalBytes;
    }
    sendPortion(_frame: SendJob, job: SenderJob, state: SendJobSenderState): boolean {
        const n = Math.min(job.burstSize, this.totalBytes - state.wireBytesSent);
        state.wireBytesSent += n;
        this.events.push({ id: this.id, t: performance.now(), bytes: n });
        return state.wireBytesSent >= this.totalBytes;
    }
    sendPush() {
        ++this.pushes;
    }
}

function makeFakeJob(senders: FakeSender[], burstSize: number): SendJob {
    const job = new SendJob();
    for (const s of senders) {
        const sj = new SenderJob();
        sj.sender = s;
        sj.burstSize = burstSize;
        sj.parts.push({ bufIdx: 0, bufStart: 0, bufLen: s.totalBytes });
        job.senders.push(sj);
    }
    return job;
}

describe('paced frame sending', () => {
    it('interleaves senders and stretches sends across the slot', async () => {
        const events: { id: number; t: number; bytes: number }[] = [];
        const senders = [new FakeSender(0, 12000, events), new FakeSender(1, 12000, events)];
        const job = makeFakeJob(senders, 1000);

        const state = new SendJobState();
        const t0 = performance.now();
        state.initialize(t0, job, 100); // 100ms frame -> 85ms usable slot
        await sendFull(state, busySleep);
        const elapsed = performance.now() - t0;

        // 12 bursts per sender, everything delivered, one push each
        expect(events.filter((e) => e.id === 0).length).toBe(12);
        expect(events.filter((e) => e.id === 1).length).toBe(12);
        expect(senders[0].pushes).toBe(1);
        expect(senders[1].pushes).toBe(1);

        // Stretched: the sends span most of the slot instead of bursting up front
        expect(elapsed).toBeGreaterThan(50);
        expect(elapsed).toBeLessThan(300);
        for (const id of [0, 1]) {
            const ts = events.filter((e) => e.id === id).map((e) => e.t);
            expect(ts[ts.length - 1] - ts[0]).toBeGreaterThan(50);
        }

        // Interleaved: neither sender monopolizes the wire
        let maxRun = 0;
        let run = 0;
        let prev = -1;
        for (const e of events) {
            run = e.id === prev ? run + 1 : 1;
            prev = e.id;
            maxRun = Math.max(maxRun, run);
        }
        expect(maxRun).toBeLessThanOrEqual(2);
    });

    it('sends immediately when the slot deadline has already passed', async () => {
        const events: { id: number; t: number; bytes: number }[] = [];
        const senders = [new FakeSender(0, 12000, events)];
        const job = makeFakeJob(senders, 1000);

        const state = new SendJobState();
        const t0 = performance.now();
        state.initialize(t0 - 200, job, 50); // deadline long gone
        await sendFull(state, busySleep);
        const elapsed = performance.now() - t0;

        expect(events.length).toBe(12);
        expect(elapsed).toBeLessThan(50);
    });

    it('skipping senders are left out of the pacing heap', () => {
        const events: { id: number; t: number; bytes: number }[] = [];
        const senders = [new FakeSender(0, 1000, events), new FakeSender(1, 1000, events)];
        const job = makeFakeJob(senders, 1000);

        const state = new SendJobState();
        const t0 = performance.now();
        state.initialize(t0, job, 50);
        // Simulate a controller that demands a slower frame rate
        state.states[1].lastSendTime = t0 + 1000;
        const res = state.initialize(t0, job, 50);
        expect(res.skipsDueToReq).toBe(1);
        expect(state.sendHeap.size).toBe(1);
        expect(state.sendHeap.top?.senderIdx).toBe(0);
    });
});

describe('DDP burst budget', () => {
    it('stops at packet boundaries when the burst budget is spent and resumes', async () => {
        const received: Buffer[] = [];
        const receiver = dgram.createSocket('udp4');
        await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve));
        receiver.on('message', (msg) => received.push(Buffer.from(msg)));
        const port = (receiver.address() as { port: number }).port;

        const sender = new DDPSender();
        sender.address = '127.0.0.1';
        sender.port = port;
        try {
            await sender.connect();

            const job = new SendJob();
            const sj = new SenderJob();
            sj.sender = sender;
            sj.burstSize = 2880; // wire bytes: fits one 1440ch packet, spills into a second
            sj.parts.push({ bufIdx: 0, bufStart: 0, bufLen: 5000 });
            job.senders.push(sj);
            job.dataBuffers = [new Uint8Array(5000).fill(7)];

            const state = new SendJobSenderState();
            sender.startFrame();
            sender.startBatch();

            // 5000ch @ 1440/packet = 4 packets; budget of ~2 packets per call
            expect(sender.sendPortion(job, sj, state)).toBe(false);
            const afterFirst = sender.client!.nSent;
            expect(afterFirst).toBe(2);
            expect(sender.sendPortion(job, sj, state)).toBe(true);
            expect(sender.client!.nSent).toBe(4);
            sender.sendPush(job, sj, state); // pushAtEnd defaults true -> separate push packet
            expect(sender.client!.nSent).toBe(5);

            const batch = sender.endBatch();
            await batch?.promise;

            // Wire byte accounting: payload + (10+66) per data packet + push packet
            expect(state.wireBytesSent).toBe(5000 + 4 * 76 + 76);
            expect(sender.frameWireBytes(sj)).toBe(5000 + 4 * 76 + 76);

            // Wait for delivery and verify offsets cover the whole range in order
            const deadline = Date.now() + 2000;
            while (received.length < 5 && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 10));
            }
            expect(received.length).toBe(5);
            const offsets = received.map((b) => b.readUInt32BE(4));
            expect(offsets).toEqual([0, 1440, 2880, 4320, 5000]);
            const lengths = received.map((b) => b.readUInt16BE(8));
            expect(lengths).toEqual([1440, 1440, 1440, 680, 0]);
            // Push flag only on the final (push) packet
            expect(received.map((b) => b[0] & 0x01)).toEqual([0, 0, 0, 0, 1]);
        } finally {
            await new Promise<void>((resolve) => receiver.close(resolve));
            await sender.client?.disconnect();
        }
    });
});
