import {
    endBatch,
    endFrame,
    FrameReference,
    lpBusySleep,
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
export async function xbusySleep(nextTime: number, emitWarning: ((s: string) => void) | undefined): Promise<void> {
    while (performance.now() < nextTime) {
        const nt = performance.now();
        if (nt + 0.1 > nextTime) return;
        Atomics.wait(int32USB, 0, 0, 0.1);

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
    state: SendJobState = new SendJobState();
    outstandingFrames: Set<FrameReference> = new Set();
    prevSendBatch: SendBatch[] | undefined = undefined;
    nChannels: number = 0;
    blackFramesEnabled: boolean = true;
    blackFrame: Uint8Array | undefined = undefined;
    mixFrame: Uint8Array | undefined = undefined;
    exportBuffer: LatestFrameRingBuffer | undefined = undefined;
    emitWarning?: (msg: string) => void;
    emitError?: (err: Error) => void;
    private warnedShortFrame = false;
    private warnedLongFrame = false;
    private warnedSendOverrun = false;
    private sendInProgress = false; // Guards SendJobState from concurrent send

    /** Most the paced send may ever claim of a frame interval. Zero disables
     *  pacing entirely (one burst per frame) -- see SendJob.slotFraction for
     *  why that is the default while sending runs on the dispatch loop. */
    maxSlotFraction = 0;
    /** performance.now() when the last send finished, if the next call follows it directly. */
    private lastSendEndPN: number | undefined = undefined;
    /** Decaying max of the dispatch loop's non-send time per frame (ms). */
    private loopOverheadMs = 0;
    /** Decaying max of time spent packetizing and enqueueing sends (ms). */
    private sendActiveMs = 0;

    /**
     * The send holds the dispatch loop, so its slot has to leave room for
     * everything else the loop does per frame (schedule, prefetch, decompress,
     * mix, export). Reserve the measured overhead plus a tenth of the interval
     * and stretch the send across whatever is left.
     *
     * Also reserve the measured active time: the pacer schedules sleeps by
     * bytes/rate alone, so packetizing and handing packets to the socket lands
     * on top of the plan rather than inside it, and the send finishes about
     * that much late. Reserving the active time -- not the resulting overrun,
     * which would chase its own tail, since shrinking the slot cannot shrink
     * the work -- pulls the finish back to where it was aimed.
     */
    private slotFractionFor(frameInterval: number): number {
        if (this.maxSlotFraction <= 0) return 0; // Pacing off: send as one burst
        const iv = Math.max(1, frameInterval);
        const reserve = this.loopOverheadMs + this.sendActiveMs + iv * 0.1;
        return Math.min(this.maxSlotFraction, Math.max(0.05, (iv - reserve) / iv));
    }

    /** Fold the gap since the last send into the overhead estimate. Only valid
     *  between back-to-back frames; idle/black/skipped gaps are not loop work. */
    private noteLoopOverhead(nowPN: number, frameInterval: number) {
        const last = this.lastSendEndPN;
        this.lastSendEndPN = undefined;
        if (last === undefined) return;
        const overhead = nowPN - last;
        if (overhead < 0 || overhead > frameInterval * 2) return;
        this.loopOverheadMs = Math.max(overhead, this.loopOverheadMs * 0.95);
    }

    async sendBlackFrame(args: {
        targetFramePN: number;
        frameInterval?: number;
        playbackStats?: PlaybackStatistics;
        playbackStatsAgg?: OverallFrameSendStats;
        /** Set for idle black frames, which can be disabled */
        onlyIfEnabled?: boolean;
    }) {
        if (!this.blackFramesEnabled && args.onlyIfEnabled) return;
        if (!this.blackFrame || !this.job || !this.state) return;
        if (this.sendInProgress) return; // A send is still running; skip this black frame
        this.releasePrevFrame();
        this.job!.dataBuffers = [this.blackFrame];
        this.job.slotFraction = this.slotFractionFor(args.frameInterval ?? 50);
        this.state.initialize(args.targetFramePN, this.job, args.frameInterval ?? 50);
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
            this.noteLoopOverhead(preSleepPN, args.frameInterval);
            // If target frame PN is way in the future compared to other tasks, go around again.
            if (args.targetFramePN - preSleepPN > args.frameInterval * 2) {
                // Send black (awaited: send shares this.state with the next frame)
                args.playbackStatsAgg.totalIdleTime += args.frameInterval;
                await xbusySleep(preSleepPN + args.frameInterval, this.emitWarning);
                if (this.blackFrame)
                    await this.sendBlackFrame({
                        targetFramePN: preSleepPN + args.frameInterval,
                        frameInterval: args.frameInterval,
                        onlyIfEnabled: true,
                    });
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
                    this.exportBuffer.publishFrom(this.job.dataBuffers[0].slice(0, this.nChannels));
                }

                this.job.slotFraction = this.slotFractionFor(args.frameInterval);
                const res = this.state.initialize(args.targetFramePN, this.job, args.frameInterval);
                args.playbackStats.cframesSkippedDueToDirectiveCumulative += res.skipsDueToReq;
                args.playbackStats.cframesSkippedDueToIncompletePriorCumulative += res.skipsDueToSlowCtrl;
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
        if (this.sendInProgress) {
            this.emitWarning?.('Frame send started while previous frame in progress');
            if (args.playbackStats) ++args.playbackStats.framesSkippedDueToManyOutstandingFramesCumulative;
            args.frame?.release();
            args.frame = undefined;
            return;
        }
        this.sendInProgress = true;
        try {
            const frameref = args.frame;
            if (frameref) {
                this.outstandingFrames.add(frameref);
                args.frame = undefined;
            }
            startFrame(this.state);
            startBatch(this.state);
            const paced = await sendFull(this.state, lpBusySleep);
            const end = endBatch(this.state);
            this.prevSendBatch = end;
            const sendTime = paced.activeMs;
            this.sendActiveMs = Math.max(paced.activeMs, this.sendActiveMs * 0.95);
            if (this.maxSlotFraction > 0 && paced.overrunMs > 1 && !this.warnedSendOverrun) {
                this.warnedSendOverrun = true;
                this.emitWarning?.(
                    `[framesend] paced send overran its slot by ${paced.overrunMs.toFixed(1)}ms; ` +
                        `loop overhead estimate ${this.loopOverheadMs.toFixed(1)}ms`,
                );
            }
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
                args.playbackStatsAgg.totalIdleTime += paced.waitMs;
                ++args.playbackStatsAgg.nSends;
            }
            if (args.playbackStats) {
                args.playbackStats.maxSendTimeHistorical = Math.max(sendTime, args.playbackStats.maxSendTimeHistorical);
                ++args.playbackStats.sentFramesCumulative;
            }
        } catch (e) {
            const err = e as Error;
            this.emitError?.(err);
        } finally {
            this.sendInProgress = false;
            this.lastSendEndPN = performance.now();
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
