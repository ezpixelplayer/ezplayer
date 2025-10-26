import { busySleep, endBatch, endFrame, FrameReference, SendBatch, sendFull, SendJob, SendJobState, startBatch, startFrame } from "@ezplayer/epp";
import { PlaybackStatistics } from "@ezplayer/ezplayer-core";
import { snapshotAsyncCounts } from "./perfmon";

////////
// Sleep utilities
const unsharedSharedBuffer = new SharedArrayBuffer(1024);
const int32USB = new Int32Array(unsharedSharedBuffer);
export async function xbusySleep(nextTime: number, emitWarning: ((s: string)=>void) | undefined): Promise<void> {
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
            emitWarning?.(`Hiccup - long setImmediate: ${pe - ps} - CPU ${cpuTotalMs} (${cpuUserMs}+${cpuSysMs}); async counts:`);
            for (const [type, count] of ahs) {
                emitWarning?.(`  ${type}: ${count}`);
            }
        }
    }
}

export interface OverallFrameSendStats
{
    nSends: number,
    intervalStart: number,
    totalSendTime: number,
    totalIdleTime: number,
}

export function avgFrameSendTime(stats: OverallFrameSendStats) {
    return stats.nSends > 0 ? stats.totalSendTime / stats.nSends : 0;
}

export function resetFrameSendStats(stats: OverallFrameSendStats, pn: number) {
    stats.intervalStart = pn;
    stats.nSends = 0;
    stats.totalSendTime = 0;
    stats.totalIdleTime = 0;
}

export interface ControllerSendStats
{
    nSends: number,
    nPackets: number,
    nBytes: number
    nMissedSendWindow: number,
    lastError?: string,
}

export class FrameSender
{
    job: SendJob | undefined = undefined;
    state: SendJobState = new SendJobState();
    outstandingFrames: Set<FrameReference> = new Set();
    prevSendBatch: SendBatch[] | undefined = undefined;
    nChannels: number = 0;
    blackFrame: Uint8Array | undefined = undefined;
    emitWarning?: (msg: string) => void;
    emitError?: (err: Error) => void;

    async sendBlackFrame(args: {
        targetFramePN: number,
        playbackStats?: PlaybackStatistics;
        playbackStatsAgg?: OverallFrameSendStats;
    }) {
        if (!this.blackFrame || !this.job || !this.state) return;
        this.releasePrevFrame();
        this.job!.dataBuffers = [this.blackFrame];
        this.state.initialize(args.targetFramePN, this.job);
        await this.doSendFrame(performance.now(), {...args, frame: undefined});
    }

    async sendNextFrameAt(
        args: {
            frame: FrameReference | undefined,
            targetFramePN: number,
            targetFrameNum: number,
            playbackStats: PlaybackStatistics,
            playbackStatsAgg: OverallFrameSendStats,
            frameInterval: number,
            skipFrameIfLateByMoreThan: number,
            dontSleepIfDurationLessThan: number,
        }
    ): Promise<number> {
        try {
            if (args.frame?.frame && this.state && this.job) {
            } else {
                ++args.playbackStats.missedFrames;
            }

            const preSleepPN = performance.now();
            // If target frame PN is way in the future compared to other tasks, go around again.
            if (args.targetFramePN - preSleepPN > args.frameInterval * 2) {
                // Send black
                args.playbackStatsAgg.totalIdleTime += args.frameInterval;
                await xbusySleep(preSleepPN + args.frameInterval, this.emitWarning);
                if (this.blackFrame) this.sendBlackFrame({targetFramePN: preSleepPN});
                return args.targetFramePN;
            }

            const sleep = args.targetFramePN - preSleepPN;
            if (sleep < -args.skipFrameIfLateByMoreThan) {
                ++args.playbackStats.skippedFrames;
                // TODO increment frame?  Or do we just let calculations establish this from current time?
                return args.targetFramePN += args.frameInterval;
            }

            if (sleep > args.dontSleepIfDurationLessThan) {
                args.playbackStatsAgg.totalIdleTime += sleep;
                //await sleepms(sleep);
                await xbusySleep(args.targetFramePN, this.emitWarning);
            }

            const nowTime = performance.now();

            if (nowTime < args.targetFramePN) {
                args.playbackStats.worstAdvance = Math.max(args.playbackStats.worstAdvance, args.targetFramePN - nowTime);
            } else {
                args.playbackStats.worstLag = Math.max(args.playbackStats.worstLag, nowTime - args.targetFramePN);
            }

            // Actually send the frame
            if (args.frame?.frame && this.state && this.job) {
                this.job.frameNumber = args.targetFrameNum;
                this.job.dataBuffers = [args.frame.frame];
                const res = this.state.initialize(args.targetFramePN, this.job);
                args.playbackStats.cframesSkippedDueToDirective += res.skipsDueToReq;
                args.playbackStats.cframesSkippedDueToIncompletePrior += res.skipsDueToSlowCtrl;
                if (this.outstandingFrames.has(args.frame)) {
                    this.emitWarning?.("WARNING: THIS FRAME HANDLE ALREADY BEING SENT");
                    ++args.playbackStats.framesSkippedDueToManyOutstandingFrames;
                }
                else if (this.outstandingFrames.size > 10) {
                    ++args.playbackStats.framesSkippedDueToManyOutstandingFrames;
                }
                else {
                    await this.doSendFrame(nowTime, args);
                }
            }
            return args.targetFramePN += args.frameInterval;
        }
        finally {
            if (args.frame) {
                args.frame.release();
                args.frame = undefined;
            }
        }
    }

    private async doSendFrame(nowTime: number, args: {
        playbackStats?: PlaybackStatistics;
        playbackStatsAgg?: OverallFrameSendStats;
        frame: FrameReference | undefined,
    }) {
        try {
            const frameref = args.frame;
            if (frameref) {
                this.outstandingFrames.add(frameref);
                args.frame = undefined;
            }
            startFrame(this.state);
            startBatch(this.state);
            await sendFull(this.state, busySleep);
            const end = endBatch(this.state);
            this.prevSendBatch = end;
            const sendTime = performance.now() - nowTime;
            Promise.allSettled(end.map((s) => s.promise)).then(() => {
                for (const sb of end) {
                    if (sb.nECBs > 0) {
                        //this.emitWarning?.(`Suspending IP ${sb.sender.address}`);
                        //sb.sender.suspend();
                    }
                }
                if (frameref) {
                    if (!this.outstandingFrames.has(frameref)) {
                        this.emitWarning?.("FRAME REFERENCE GOT REMOVED ALREADY");
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
                args.playbackStats.maxSendTime = Math.max(sendTime, args.playbackStats.maxSendTime);
                ++args.playbackStats.sentFrames;
            }
        }
        catch (e) {
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