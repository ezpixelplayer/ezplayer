/*
 * Output worker: owns the controller sockets. It watches the frame pool,
 * encodes each new canonical frame through the Output Map into per-output
 * wire buffers, publishes the legacy channel-space export for previews, and
 * runs the paced send. The conductor never touches a socket.
 */

import { parentPort } from 'node:worker_threads';
import {
    applyOutput,
    FramePool,
    FRAME_FLAG_IDLE,
    lpBusySleep,
    openControllerForDataSend,
    openControllersForDataSend,
    SendJob,
    SendJobState,
    sendFull,
    StatsBlock,
    startBatch,
    startFrame,
    endBatch,
    endFrame,
    type CompiledOutput,
    type ControllerState,
    type SendBatch,
    type SenderJob,
    type SenderStats,
} from '@ezplayer/epp';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { xbusySleep } from './framesend';
import {
    OUTPUT_STATS_COUNTERS,
    OUTPUT_STATS_GAUGES,
    type OutputWorkerInMsg,
    type OutputWorkerOpenMsg,
    type OutputWorkerOutMsg,
    type SerializedOutput,
} from './outputprotocol';

if (!parentPort) throw new Error('outputworker needs a parentPort');
const port = parentPort;

function post(msg: OutputWorkerOutMsg) {
    port.postMessage(msg);
}
const log = (level: 'info' | 'warn' | 'error', msg: string) => post({ type: 'log', level, msg });

function toOutput(s: SerializedOutput): CompiledOutput {
    return { id: s.id, wireBytes: s.wireBytes, ops: s.ops, luts: s.luts, perms: s.perms, policy: s.policy };
}

class OutputLoop {
    pool: FramePool;
    stats: StatsBlock;
    outputs: CompiledOutput[];
    wire: Uint8Array[];
    legacy?: { ring: LatestFrameRingBuffer; output: CompiledOutput };
    job = new SendJob();
    state = new SendJobState();
    controllers: ControllerState[] = [];
    openOpts: OutputWorkerOpenMsg['opts'] = {};
    senderOutput: number[] = [];
    statsTimer?: NodeJS.Timeout;
    outputEnabled: boolean;
    blackFramesEnabled: boolean;
    maxSlotFraction: number;
    closing = false;
    prevBatch: SendBatch[] | undefined;
    encodeMs = 0;
    sendActiveMs = 0;
    warnedOverrun = false;

    // counters
    cSent: number;
    cStale: number;
    cIdleDropped: number;
    cSkipDirective: number;
    cSkipIncomplete: number;
    cSendErrors: number;
    cEncoded: number;
    gMaxSend: number;
    gLastSend: number;
    gEncode: number;
    gActiveTotal: number;
    gWaitTotal: number;
    gDropped: number;
    gOverrun: number;

    constructor(msg: OutputWorkerOpenMsg) {
        this.pool = new FramePool(msg.pool);
        this.stats = new StatsBlock(msg.stats, OUTPUT_STATS_COUNTERS, OUTPUT_STATS_GAUGES);
        this.outputs = msg.outputs.map(toOutput);
        this.wire = this.outputs.map((o) => new Uint8Array(Math.max(4, o.wireBytes)));
        if (msg.legacy) {
            this.legacy = {
                ring: new LatestFrameRingBuffer({ buffer: msg.legacy.ring, frameSize: 0, slotCount: 0, isWriter: false }),
                output: toOutput(msg.legacy.output),
            };
        }
        this.outputEnabled = msg.settings.outputEnabled;
        this.blackFramesEnabled = msg.settings.blackFramesEnabled;
        this.maxSlotFraction = msg.settings.maxSlotFraction;
        const c = (n: string) => this.stats.counter(n);
        const g = (n: string) => this.stats.gauge(n);
        this.cSent = c('framesSent');
        this.cStale = c('framesSkippedStale');
        this.cIdleDropped = c('idleFramesDropped');
        this.cSkipDirective = c('cframesSkippedDirective');
        this.cSkipIncomplete = c('cframesSkippedIncompletePrior');
        this.cSendErrors = c('sendErrors');
        this.cEncoded = c('framesEncoded');
        this.gMaxSend = g('maxSendMs');
        this.gLastSend = g('lastSendMs');
        this.gEncode = g('encodeMs');
        this.gActiveTotal = g('sendActiveMsTotal');
        this.gWaitTotal = g('sendWaitMsTotal');
        this.gDropped = g('packetsDroppedBySender');
        this.gOverrun = g('sendOverrunMs');
    }

    async open(msg: OutputWorkerOpenMsg) {
        this.controllers = msg.controllers;
        this.openOpts = msg.opts;
        this.senderOutput = msg.senderOutput;
        const job = await openControllersForDataSend(this.controllers, msg.opts);
        this.controllers.forEach((c, i) => {
            const sj = job.senders.find((s) => s.sender === c.sender);
            if (sj) this.assignParts(sj, i);
        });
        this.job = job;
        this.job.dataBuffers = this.wire;
        post({ type: 'opened', reports: this.controllers.map((c) => c.report) });
        this.statsTimer = setInterval(() => this.postSenderStats(), 1000);
    }

    /** Each sender reads its whole wire buffer; the Output Map already put it in port order. */
    private assignParts(sj: SenderJob, controllerIndex: number) {
        const outIdx = this.senderOutput[controllerIndex] ?? -1;
        const out = outIdx >= 0 ? this.outputs[outIdx] : undefined;
        sj.parts = out ? [{ bufIdx: outIdx, bufStart: 0, bufLen: out.wireBytes }] : [];
    }

    /**
     * Open a controller that never opened, or replace the sender of one that
     * came back, on the same terms as the rest of the show. The scheduler sizes
     * its per-sender state from the job each frame, so the change takes on the next.
     */
    async reopen(indices: number[]) {
        const results: { index: number; report: ControllerState['report'] }[] = [];
        for (const index of indices) {
            const c = this.controllers[index];
            if (!c) continue;
            const previous = c.sender;
            try {
                const jobSender = await openControllerForDataSend(c, this.openOpts);
                if (jobSender) {
                    this.assignParts(jobSender, index);
                    const at = previous ? this.job.senders.findIndex((js) => js.sender === previous) : -1;
                    if (at >= 0) this.job.senders[at] = jobSender;
                    else this.job.senders.push(jobSender);
                    // Drop the old socket once nothing is sending on it any more.
                    if (previous && previous !== c.sender) void previous.disconnect?.().catch(() => undefined);
                }
            } catch (e) {
                log('warn', `[output] reopen of ${c.setup.name} failed: ${(e as Error).message}`);
            }
            results.push({ index, report: c.report });
        }
        post({ type: 'reopened', results });
    }

    private postSenderStats() {
        const stats: Record<string, SenderStats> = {};
        for (const c of this.controllers) {
            const s = c.sender?.stats?.();
            if (s) stats[c.setup.name] = s;
        }
        post({ type: 'senderStats', stats });
    }

    /** Leave room in the interval for the next frame's encode and the packetizing itself. */
    private slotFractionFor(interval: number): number {
        if (this.maxSlotFraction <= 0) return 0;
        const iv = Math.max(1, interval);
        const reserve = this.encodeMs * 1.2 + this.sendActiveMs + iv * 0.1;
        return Math.min(this.maxSlotFraction, Math.max(0.05, (iv - reserve) / iv));
    }

    private encode(bytes: Uint8Array): void {
        const t0 = performance.now();
        const stride = this.pool.pixelStride;
        for (let i = 0; i < this.outputs.length; ++i) {
            applyOutput(this.outputs[i], stride, bytes, 0, this.wire[i]);
        }
        if (this.legacy) {
            const { ring, output } = this.legacy;
            ring.publishWithFill((dst) => {
                applyOutput(output, stride, bytes, 0, dst);
                return Math.min(dst.length, output.wireBytes);
            });
        }
        const ms = performance.now() - t0;
        this.encodeMs = Math.max(ms, this.encodeMs * 0.95);
        this.stats.setGauge(this.gEncode, ms);
        this.stats.inc(this.cEncoded);
    }

    private senderDroppedTotal(): number {
        let n = 0;
        for (const sj of this.job.senders) {
            const client = (sj.sender as { client?: { nSkipped: number } } | undefined)?.client;
            if (client) n += client.nSkipped;
        }
        return n;
    }

    private reportPrevBatch() {
        if (!this.prevBatch) return;
        for (const s of this.prevBatch) {
            if (s.err) {
                this.stats.inc(this.cSendErrors);
                log('warn', `Send error for ${s.sender.address}: ${s.err.message}`);
            }
        }
        this.prevBatch = undefined;
    }

    async run() {
        let lastSeq = 0;
        while (!this.closing) {
            const seq = await this.pool.waitForSeq(lastSeq, 250);
            if (this.closing) break;
            if (seq === lastSeq) continue;
            const f = this.pool.acquireLatest(lastSeq);
            if (!f) continue;
            lastSeq = f.seq;
            const meta = f.meta;
            try {
                this.encode(f.bytes);
            } finally {
                this.pool.release(f.slot);
            }

            if (meta.flags! & FRAME_FLAG_IDLE && !this.blackFramesEnabled) {
                this.stats.inc(this.cIdleDropped);
                continue;
            }
            if (!this.outputEnabled) {
                // Suppressed: the frame counts as delivered; nothing on the wire.
                this.stats.inc(this.cSent);
                continue;
            }

            const interval = meta.frameIntervalMs && meta.frameIntervalMs > 0 ? meta.frameIntervalMs : 50;
            // Target time crosses the thread boundary as wall clock; convert locally.
            const targetPN = performance.now() + (meta.timeMs - Date.now());
            const now = performance.now();
            if (targetPN > now + 1) {
                const t0 = performance.now();
                await xbusySleep(targetPN, (m) => log('warn', m));
                this.stats.setGauge(this.gWaitTotal, this.stats.getGauge(this.gWaitTotal) + (performance.now() - t0));
            }
            // The next frame normally lands right at this one's send time (the
            // conductor composes one interval ahead), so a newer frame alone is
            // not staleness. Skip only when that newer frame is itself already due.
            if (this.pool.latestSeq() !== lastSeq) {
                const newer = this.pool.metaOf(this.pool.latestSlot());
                if (newer.timeMs <= Date.now()) {
                    this.stats.inc(this.cStale);
                    continue;
                }
            }

            this.reportPrevBatch();
            this.job.frameNumber = meta.frameNumber;
            this.job.slotFraction = this.slotFractionFor(interval);
            const res = this.state.initialize(targetPN, this.job, interval);
            this.stats.inc(this.cSkipDirective, res.skipsDueToReq);
            this.stats.inc(this.cSkipIncomplete, res.skipsDueToSlowCtrl);
            try {
                startFrame(this.state);
                startBatch(this.state);
                const paced = await sendFull(this.state, lpBusySleep);
                this.prevBatch = endBatch(this.state);
                endFrame(this.state);
                this.sendActiveMs = Math.max(paced.activeMs, this.sendActiveMs * 0.95);
                this.stats.setGauge(this.gLastSend, paced.activeMs);
                this.stats.maxGauge(this.gMaxSend, paced.activeMs);
                this.stats.setGauge(this.gActiveTotal, this.stats.getGauge(this.gActiveTotal) + paced.activeMs);
                this.stats.setGauge(this.gWaitTotal, this.stats.getGauge(this.gWaitTotal) + paced.waitMs);
                this.stats.maxGauge(this.gOverrun, paced.overrunMs);
                if (this.maxSlotFraction > 0 && paced.overrunMs > 1 && !this.warnedOverrun) {
                    this.warnedOverrun = true;
                    log('warn', `[output] paced send overran its slot by ${paced.overrunMs.toFixed(1)}ms; encode estimate ${this.encodeMs.toFixed(1)}ms`);
                }
                this.stats.inc(this.cSent);
                this.stats.setGauge(this.gDropped, this.senderDroppedTotal());
            } catch (e) {
                this.stats.inc(this.cSendErrors);
                log('error', `[output] send failed: ${(e as Error).message}`);
            }
        }
        if (this.statsTimer) clearInterval(this.statsTimer);
        // Final black so controllers do not hold the last frame.
        await this.sendBlackNow();
        post({ type: 'closed' });
    }

    /** Immediate black frame on every output (shutdown). */
    async sendBlackNow() {
        if (!this.outputEnabled) return;
        for (const w of this.wire) w.fill(0);
        this.job.slotFraction = 0;
        this.state.initialize(performance.now(), this.job, 50);
        try {
            startFrame(this.state);
            startBatch(this.state);
            await sendFull(this.state, lpBusySleep);
            const end = endBatch(this.state);
            endFrame(this.state);
            await Promise.allSettled(end.map((s) => s.promise));
        } catch (e) {
            log('warn', `[output] final black failed: ${(e as Error).message}`);
        }
    }
}

let loop: OutputLoop | undefined;

port.on('message', async (msg: OutputWorkerInMsg) => {
    switch (msg.type) {
        case 'open': {
            if (loop) {
                log('warn', 'output worker already open');
                return;
            }
            try {
                loop = new OutputLoop(msg);
                await loop.open(msg);
                void loop.run();
            } catch (e) {
                log('error', `[output] open failed: ${(e as Error).message}`);
                post({ type: 'opened', reports: msg.controllers.map(() => undefined) });
            }
            break;
        }
        case 'reopen': {
            if (!loop) {
                post({ type: 'reopened', results: msg.indices.map((index) => ({ index, report: undefined })) });
                return;
            }
            await loop.reopen(msg.indices);
            break;
        }
        case 'settings': {
            if (!loop) return;
            if (msg.outputEnabled !== undefined) loop.outputEnabled = msg.outputEnabled;
            if (msg.blackFramesEnabled !== undefined) loop.blackFramesEnabled = msg.blackFramesEnabled;
            if (msg.maxSlotFraction !== undefined) loop.maxSlotFraction = msg.maxSlotFraction;
            break;
        }
        case 'close': {
            if (loop) loop.closing = true;
            else post({ type: 'closed' });
            break;
        }
    }
});

post({ type: 'ready' });
