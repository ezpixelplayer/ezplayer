import {
    busySleep,
    endBatch,
    endFrame,
    FrameReference,
    SendBatch,
    sendFull,
    SendJob,
    SendJobState,
    startBatch,
    startFrame,
} from '@ezplayer/epp';
import { LatestFrameRingBuffer, PlaybackStatistics } from '@ezplayer/ezplayer-core';
import { snapshotAsyncCounts } from './perfmon';
import { maxUint8 } from '../processing/blend';

////////
// Sleep utilities
const unsharedSharedBuffer = new SharedArrayBuffer(1024);
const int32USB = new Int32Array(unsharedSharedBuffer);
/**
 * Observed overshoot of a timed `Atomics.wait` (e.g. ~15.6 ms on Windows
 * without a 1 ms multimedia timer). The sleep waits coarsely while it can,
 * then spin-yields the final stretch.
 */
let waitOvershootMs = 0.5;
const WAIT_SPIN_MARGIN_MS = 0.3;
let warnedCoarseTimer = false;

export async function xbusySleep(nextTime: number, emitWarning: ((s: string) => void) | undefined): Promise<void> {
    while (true) {
        const nt = performance.now();
        const remaining = nextTime - nt;
        if (remaining <= 0.05) return;

        if (remaining > waitOvershootMs + WAIT_SPIN_MARGIN_MS) {
            const req = Math.min(1, remaining - waitOvershootMs);
            Atomics.wait(int32USB, 0, 0, req);
            const overshoot = Math.max(0, performance.now() - nt - req);
            // Learn the worst case quickly, forget slowly (timer resolution can change).
            waitOvershootMs = overshoot > waitOvershootMs ? overshoot : waitOvershootMs * 0.999 + overshoot * 0.001;
            if (waitOvershootMs > 5 && !warnedCoarseTimer) {
                warnedCoarseTimer = true;
                emitWarning?.(
                    `Coarse timer resolution: a ${req.toFixed(1)} ms wait took ${(req + overshoot).toFixed(1)} ms; ` +
                        `frame timing will spin-wait the last ${waitOvershootMs.toFixed(1)} ms of each frame`,
                );
            }
        }
        // else: spin-yield; setImmediate keeps the event loop serving I/O completions.

        const lastCPU = process.cpuUsage();
        const ps = performance.now();
        await new Promise((resolve) => setImmediate(resolve));
        const nowCPU = process.cpuUsage(lastCPU);
        const pe = performance.now();
        const ahs = snapshotAsyncCounts();
        if (pe - ps > 10) {
            const cpuUserMs = nowCPU.user / 1000;
            const cpuSysMs = nowCPU.system / 1000;
            const cpuTotalMs = cpuUserMs + cpuSysMs;
            emitWarning?.(
                `Hiccup - long setImmediate: ${pe - ps} - CPU ${cpuTotalMs} (${cpuUserMs}+${cpuSysMs}); async counts:`,
            );
            for (const [type, count] of ahs) {
                emitWarning?.(`  ${type}: ${count}`);
            }
        }
    }
}

export interface OverallFrameSendStats {
    nSends: number;
    intervalStart: number;
    totalSendTime: number;
    totalIdleTime: number;
    totalMixTime: number;
}

export function avgFrameSendTime(stats: OverallFrameSendStats) {
    return stats.nSends > 0 ? stats.totalSendTime / stats.nSends : 0;
}

export function resetFrameSendStats(stats: OverallFrameSendStats, pn: number) {
    stats.intervalStart = pn;
    stats.nSends = 0;
    stats.totalSendTime = 0;
    stats.totalIdleTime = 0;
    stats.totalMixTime = 0;
}

export interface ControllerSendStats {
    nSends: number;
    nPackets: number;
    nBytes: number;
    nMissedSendWindow: number;
    lastError?: string;
}

export class FrameSender {
    job: SendJob | undefined = undefined;

    /**
     * Packets every sender discarded before they reached its socket, summed.
     * Cumulative on the clients, so it is assigned rather than accumulated.
     */
    senderDroppedTotal(): number {
        let n = 0;
        for (const sj of this.job?.senders ?? []) {
            const client = (sj.sender as { client?: { nSkipped: number } } | undefined)?.client;
            if (client) n += client.nSkipped;
        }
        return n;
    }

    state: SendJobState = new SendJobState();
    outstandingFrames: Set<FrameReference> = new Set();
    prevSendBatch: SendBatch[] | undefined = undefined;
    nChannels: number = 0;
    /** Gate for every black-frame send (idle/pause/stop/keepalive). Off =
     *  leave the wire untouched so another player can drive the controllers. */
    blackFramesEnabled: boolean = true;
    /** `suppressoutput` gate: off = frames still produced and previewed, but
     *  nothing is sent to controllers. */
    outputEnabled: boolean = true;
    blackFrame: Uint8Array | undefined = undefined;
    mixFrame: Uint8Array | undefined = undefined;
    exportBuffer: LatestFrameRingBuffer | undefined = undefined;
    emitWarning?: (msg: string) => void;
    emitError?: (err: Error) => void;
    private warnedShortFrame = false;
    private warnedLongFrame = false;

    async sendBlackFrame(args: {
        targetFramePN: number;
        playbackStats?: PlaybackStatistics;
        playbackStatsAgg?: OverallFrameSendStats;
        /** Set for idle black frames, which can be disabled */
        onlyIfEnabled?: boolean;
    }) {
        if (!this.blackFramesEnabled && args.onlyIfEnabled) return;
        if (!this.outputEnabled) return;
        if (!this.blackFrame || !this.job || !this.state) return;
        this.releasePrevFrame();
        this.job!.dataBuffers = [this.blackFrame];
        this.state.initialize(args.targetFramePN, this.job);
        await this.doSendFrame({ ...args, frame: undefined });
    }

    /** Return: ms of frame advance */
    async sendNextFrameAt(args: {
        frame: FrameReference | undefined;
        bframe: FrameReference | undefined;
        targetFramePN: number;
        targetFrameNum: number;
        playbackStats: PlaybackStatistics;
        playbackStatsAgg: OverallFrameSendStats;
        frameInterval: number;
        skipFrameIfLateByMoreThan: number;
        dontSleepIfDurationLessThan: number;
    }): Promise<number> {
        try {
            if (!(args.frame?.frame && this.state && this.job)) {
                ++args.playbackStats.missedFramesCumulative;
            }

            const preSleepPN = performance.now();
            // If target frame PN is way in the future compared to other tasks, go around again.
            if (args.targetFramePN - preSleepPN > args.frameInterval * 2) {
                // Send black
                args.playbackStatsAgg.totalIdleTime += args.frameInterval;
                await xbusySleep(preSleepPN + args.frameInterval, this.emitWarning);
                if (this.blackFrame) this.sendBlackFrame({ targetFramePN: preSleepPN, onlyIfEnabled: true });
                return 0;
            }

            const sleep = args.targetFramePN - preSleepPN;
            if (sleep < -args.skipFrameIfLateByMoreThan) {
                ++args.playbackStats.skippedFramesCumulative;
                // TODO increment frame?  Or do we just let calculations establish this from current time?
                return args.frameInterval;
            }

            if (sleep > args.dontSleepIfDurationLessThan) {
                args.playbackStatsAgg.totalIdleTime += sleep;
                //await sleepms(sleep);
                await xbusySleep(args.targetFramePN, this.emitWarning);
            }

            const nowTime = performance.now();

            if (nowTime < args.targetFramePN) {
                args.playbackStats.worstAdvanceHistorical = Math.max(
                    args.playbackStats.worstAdvanceHistorical,
                    args.targetFramePN - nowTime,
                );
            } else {
                args.playbackStats.worstLagHistorical = Math.max(
                    args.playbackStats.worstLagHistorical,
                    nowTime - args.targetFramePN,
                );
            }

            // Actually send the frame
            if (args.frame?.frame && this.state && this.job) {
                this.job.frameNumber = args.targetFrameNum;
                if (this.mixFrame && args.bframe?.frame && args.frame?.frame) {
                    const preMax = performance.now();
                    maxUint8(this.mixFrame, args.frame.frame, args.bframe.frame);
                    const mixTime = performance.now() - preMax;
                    args.playbackStatsAgg.totalMixTime += mixTime;
                    this.job.dataBuffers = [this.mixFrame];
                } else {
                    this.job.dataBuffers = [args.frame.frame];
                }

                // Export frame
                if (this.exportBuffer) {
                    const srcLen = this.job.dataBuffers[0].length;
                    if (srcLen < this.nChannels && !this.warnedShortFrame) {
                        this.warnedShortFrame = true;
                        this.emitWarning?.(
                            `[framesend] export frame shorter than nChannels: ` +
                                `src=${srcLen} nChannels=${this.nChannels} ` +
                                `(trailing ${this.nChannels - srcLen} bytes of each ring-buffer slot will retain stale data)`,
                        );
                    } else if (srcLen > this.nChannels && !this.warnedLongFrame) {
                        this.warnedLongFrame = true;
                        this.emitWarning?.(
                            `[framesend] export frame longer than nChannels (truncating): ` +
                                `src=${srcLen} nChannels=${this.nChannels}`,
                        );
                    }
                    this.exportBuffer.publishFrom(this.job.dataBuffers[0].subarray(0, this.nChannels));
                }

                const res = this.state.initialize(args.targetFramePN, this.job);
                args.playbackStats.cframesSkippedDueToDirectiveCumulative += res.skipsDueToReq;
                args.playbackStats.cframesSkippedDueToIncompletePriorCumulative += res.skipsDueToSlowCtrl;
                args.playbackStats.cpacketsDroppedBySenderCumulative = this.senderDroppedTotal();
                if (this.outstandingFrames.has(args.frame)) {
                    this.emitWarning?.('WARNING: THIS FRAME HANDLE ALREADY BEING SENT');
                    ++args.playbackStats.framesSkippedDueToManyOutstandingFramesCumulative;
                } else if (this.outstandingFrames.size > 10) {
                    ++args.playbackStats.framesSkippedDueToManyOutstandingFramesCumulative;
                } else {
                    await this.doSendFrame(args);
                }
            }
            return args.frameInterval;
        } finally {
            if (args.frame) {
                args.frame.release();
                args.frame = undefined;
            }
            if (args.bframe) {
                args.bframe.release();
                args.bframe = undefined;
            }
        }
    }

    private async doSendFrame(args: {
        playbackStats?: PlaybackStatistics;
        playbackStatsAgg?: OverallFrameSendStats;
        frame: FrameReference | undefined;
    }) {
        try {
            const frameref = args.frame;
            if (!this.outputEnabled) {
                // Suppressed: the frame counts as delivered; nothing on the wire.
                if (args.playbackStats) ++args.playbackStats.sentFramesCumulative;
                if (args.playbackStatsAgg) ++args.playbackStatsAgg.nSends;
                return;
            }
            if (frameref) {
                this.outstandingFrames.add(frameref);
                args.frame = undefined;
            }
            const startSendTime = performance.now();
            startFrame(this.state);
            startBatch(this.state);
            await sendFull(this.state, busySleep);
            const end = endBatch(this.state);
            this.prevSendBatch = end;
            const sendTime = performance.now() - startSendTime;
            Promise.allSettled(end.map((s) => s.promise)).then(() => {
                for (const sb of end) {
                    if (sb.nECBs > 0) {
                        //this.emitWarning?.(`Suspending IP ${sb.sender.address}`);
                        //sb.sender.suspend();
                    }
                }
                if (frameref) {
                    if (!this.outstandingFrames.has(frameref)) {
                        this.emitWarning?.('FRAME REFERENCE GOT REMOVED ALREADY');
                    }
                    frameref.release();
                    this.outstandingFrames.delete(frameref);
                }
            });
            if (args.playbackStatsAgg) {
                args.playbackStatsAgg.totalSendTime += sendTime;
                ++args.playbackStatsAgg.nSends;
            }
            if (args.playbackStats) {
                args.playbackStats.maxSendTimeHistorical = Math.max(sendTime, args.playbackStats.maxSendTimeHistorical);
                ++args.playbackStats.sentFramesCumulative;
            }
        } catch (e) {
            const err = e as Error;
            this.emitError?.(err);
        }
        endFrame(this.state);
    }

    private releasePrevFrame() {
        if (this.prevSendBatch) {
            for (const s of this.prevSendBatch) {
                if (!s.isComplete()) {
                    //this.emitWarning?.(`Sender for ${s.sender.address} missed the deadline`);
                }
                if (s.err) {
                    this.emitWarning?.(`Send error for ${s.sender.address}: ${s.err}`);
                }
            }
            this.prevSendBatch = undefined;
        }
    }

    close() {
        for (const fr of this.outstandingFrames) {
            fr.release();
        }
        this.outstandingFrames.clear();
    }
}
