import dgram from 'dgram';
import { describe, expect, it } from 'vitest';
import { endBatch, sendFull, startBatch, startFrame } from './SendFrame';
import { Sender, SenderJob, SendJob, SendJobSenderState, SendJobState } from './SenderJob';
import { DDPSender } from './protocols/DDP';
import { busySleep, lpBusySleep } from '../util/Utils';

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
        job.slotFraction = 0.85;

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

    it('flushes the remainder rather than running past the slot deadline', async () => {
        const events: { id: number; t: number; bytes: number }[] = [];
        const senders = [new FakeSender(0, 12000, events)];
        const job = makeFakeJob(senders, 1000);
        // A rate this low would need over a second to place 12000 bytes
        job.senders[0].rateLimit = 10;

        const state = new SendJobState();
        const t0 = performance.now();
        state.initialize(t0, job, 50); // 50ms frame -> 25ms slot
        const res = await sendFull(state, busySleep);
        const elapsed = performance.now() - t0;

        expect(events.length).toBe(12); // everything still went out
        expect(senders[0].pushes).toBe(1);
        expect(elapsed).toBeLessThan(60); // bounded by the slot, not by the rate
        expect(res.overrunMs).toBeGreaterThan(0); // and it says so
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

/** One 512x320 matrix per controller. */
const MATRIX_PIXELS = 512 * 320;
const MATRIX_CHANNELS = MATRIX_PIXELS * 3;

describe('paced send at show scale', () => {
    it('spreads two 512x320 matrices across the slot without bursting', async () => {
        // Both controllers slice one frame buffer, as the real dispatch loop does.
        const frameBuf = new Uint8Array(MATRIX_CHANNELS * 2);
        for (let i = 0; i < frameBuf.length; ++i) frameBuf[i] = (i * 7) & 0xff;

        const receivers: dgram.Socket[] = [];
        const senders: DDPSender[] = [];
        /** Received datagrams, per sender index. Best-effort: loopback drops. */
        const received: { offset: number; payload: Buffer }[][] = [[], []];
        /** Every addSendToBatch, captured as it happens. */
        const sends: { id: number; t: number; offset: number; len: number; push: boolean }[] = [];

        try {
            for (let id = 0; id < 2; ++id) {
                const rx = dgram.createSocket({ type: 'udp4', recvBufferSize: 8 * 1024 * 1024 });
                receivers.push(rx);
                await new Promise<void>((resolve) => rx.bind(0, '127.0.0.1', resolve));
                rx.on('message', (msg) => {
                    received[id].push({ offset: msg.readUInt32BE(4), payload: Buffer.from(msg.subarray(10)) });
                });

                const s = new DDPSender();
                s.address = '127.0.0.1';
                s.port = (rx.address() as { port: number }).port;
                await s.connect();
                senders.push(s);

                // Record sends at the point they are handed to the socket; the
                // header buffers are reused next frame, so read them now.
                const client = s.client!;
                const orig = client.addSendToBatch.bind(client);
                client.addSendToBatch = (data: Uint8Array | Uint8Array[]) => {
                    const parts = Array.isArray(data) ? data : [data];
                    const hdr = parts[0];
                    const hv = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
                    const len = hv.getUint16(8, false);
                    sends.push({ id, t: performance.now(), offset: hv.getUint32(4, false), len, push: len === 0 });
                    orig(data);
                };
            }

            const job = new SendJob();
            job.slotFraction = 0.5;
            job.dataBuffers = [frameBuf];
            for (let id = 0; id < 2; ++id) {
                const sj = new SenderJob();
                sj.sender = senders[id];
                sj.parts.push({ bufIdx: 0, bufStart: id * MATRIX_CHANNELS, bufLen: MATRIX_CHANNELS });
                job.senders.push(sj);
            }

            const frameInterval = 50;
            const slot = frameInterval * job.slotFraction;
            const state = new SendJobState();
            const t0 = performance.now();
            state.initialize(t0, job, frameInterval);
            startFrame(state);
            startBatch(state);
            const paced = await sendFull(state, lpBusySleep);
            const batches = endBatch(state);
            const elapsed = performance.now() - t0;

            // 491520ch @ 1440/packet = 342 packets, plus one push packet each
            const expectedPackets = Math.ceil(MATRIX_CHANNELS / 1440);
            const expectedWire = MATRIX_CHANNELS + expectedPackets * 76 + 76;
            for (let id = 0; id < 2; ++id) {
                const mine = sends.filter((s) => s.id === id);
                expect(mine.length).toBe(expectedPackets + 1);
                expect(state.states[id].wireBytesSent).toBe(expectedWire);
                expect(senders[id].frameWireBytes(job.senders[id])).toBe(expectedWire);

                // Whole matrix covered exactly once, in order, then the push
                const data = mine.filter((s) => !s.push);
                let expectOffset = 0;
                for (const p of data) {
                    expect(p.offset).toBe(expectOffset);
                    expectOffset += p.len;
                }
                expect(expectOffset).toBe(MATRIX_CHANNELS);
                expect(mine[mine.length - 1].push).toBe(true);
                expect(mine[mine.length - 1].offset).toBe(MATRIX_CHANNELS);
            }

            // Interleaved: a burst is 2 packets. These two matrices are the same
            // size, so their nextTimes stay tied and the heap's strict-less-than
            // comparison hands out bursts in alternating pairs -- 4 packets (~6KB)
            // contiguous at worst, which is still far below any switch's buffer.
            let maxRun = 0;
            let run = 0;
            let prev = -1;
            for (const s of sends) {
                if (s.push) continue;
                run = s.id === prev ? run + 1 : 1;
                prev = s.id;
                maxRun = Math.max(maxRun, run);
            }
            expect(maxRun).toBeLessThanOrEqual(4);

            // Spread, not bursted: a burst would finish ~1MB in a few ms.
            expect(elapsed).toBeGreaterThan(slot * 0.5);
            // Bounded: the deadline flush caps how far past the slot it can run.
            expect(elapsed).toBeLessThan(slot * 3);

            // Each sender's packets span the slot rather than landing together.
            for (let id = 0; id < 2; ++id) {
                const ts = sends.filter((s) => s.id === id).map((s) => s.t);
                expect(ts[ts.length - 1] - ts[0]).toBeGreaterThan(slot * 0.5);
            }

            // Not front-loaded either. Only the upper bound is asserted: how much
            // has gone out by any given instant is dominated by host scheduling
            // noise, but "most of the frame is already out" is a real regression.
            const totalBytes = sends.reduce((n, s) => n + s.len, 0);
            const byHalf = sends.filter((s) => s.t <= t0 + slot / 2).reduce((n, s) => n + s.len, 0);
            expect(byHalf / totalBytes).toBeLessThan(0.75);

            // Deliberately NOT awaiting the batch promises: at this point only
            // about half of them have retired, and a sender that waited on the
            // OS here would blow its next frame. Drain on delivery instead.
            expect(batches.length).toBe(2);
            const expectedRx = expectedPackets + 1;
            const rxDeadline = Date.now() + 5000;
            let settled = 0;
            let prevRx = -1;
            while (Date.now() < rxDeadline && settled < 5) {
                await new Promise((r) => setTimeout(r, 20));
                const n = received[0].length + received[1].length;
                settled = n === prevRx ? settled + 1 : 0;
                prevRx = n;
            }

            // This one is partly a measurement, so it reports. A nonzero overrun
            // is not a failure: it means the plan asked for bursts closer together
            // than the sleep can resolve, and the deadline flush cleaned up the tail.
            console.log(
                `[scale] elapsed ${elapsed.toFixed(1)}ms of ${slot}ms slot; ` +
                    `${sends.length} packets, ${totalBytes} bytes, ${((byHalf / totalBytes) * 100).toFixed(0)}% out by halfway; ` +
                    `active ${paced.activeMs.toFixed(1)}ms wait ${paced.waitMs.toFixed(1)}ms overrun ${paced.overrunMs.toFixed(1)}ms; ` +
                    `rx ${received[0].length}+${received[1].length} of ${expectedRx * 2}`,
            );

            // Delivered, and intact -- including the second matrix's slice offset
            // into the shared frame buffer, which nothing send-side would catch.
            for (let id = 0; id < 2; ++id) {
                expect(received[id].length).toBeGreaterThanOrEqual(Math.ceil(expectedRx * 0.95));
                const seen = new Set<number>();
                for (const pkt of received[id]) {
                    seen.add(pkt.offset);
                    if (pkt.payload.length === 0) continue; // push packet
                    const base = id * MATRIX_CHANNELS + pkt.offset;
                    expect(
                        Buffer.compare(pkt.payload, Buffer.from(frameBuf.subarray(base, base + pkt.payload.length))),
                    ).toBe(0);
                }
                expect(seen.size).toBe(received[id].length); // no duplicates
            }
        } finally {
            for (const s of senders) await s.client?.disconnect();
            for (const rx of receivers) await new Promise<void>((resolve) => rx.close(resolve));
        }
    }, 20000);
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
