import { busySleep, endBatch, endFrame, FrameReference, SendBatch, sendFull, SendJob, SendJobState, startBatch, startFrame } from "@ezplayer/epp";
import { PlaybackStatistics } from "@ezplayer/ezplayer-core";
import { snapshotAsyncCounts } from "./perfmon";
import { emitWarning } from "process";

////////
// Sleep utilities
const unsharedSharedBuffer = new SharedArrayBuffer(1024);
const int32USB = new Int32Array(unsharedSharedBuffer);
export async function xbusySleep(nextTime: number, emitWarning: (s: string)=>void): Promise<void> {
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
            emitWarning(`Hiccup - long setImmediate: ${pe - ps} - CPU ${cpuTotalMs} (${cpuUserMs}+${cpuSysMs}); async counts:`);
            for (const [type, count] of ahs) {
                emitWarning(`  ${type}: ${count}`);
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
    prevFrameRef: FrameReference | undefined = undefined;
    prevSendBatch: SendBatch[] | undefined = undefined;

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
            emitWarning: (msg: string)=>void,
            emitError: (err: Error)=>void,
        }
    ): Promise<number> {
        try {
            if (args.frame?.frame && this.state && this.job) {
                this.job.frameNumber = args.targetFrameNum;
                this.job.dataBuffers = [args.frame.frame];
                this.state.initialize(this.job);
            } else {
                ++args.playbackStats.missedFrames;
            }

            const preSleepPN = performance.now();
            // If target frame PN is way in the future compared to other tasks, go around again.
            if (args.targetFramePN - preSleepPN > args.frameInterval * 2) {
                // TODO We should send black
                args.playbackStatsAgg.totalIdleTime += args.frameInterval;
                await xbusySleep(preSleepPN + args.frameInterval, emitWarning);
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
                await xbusySleep(args.targetFramePN, emitWarning);
            }

            const nowTime = performance.now();

            if (nowTime < args.targetFramePN) {
                args.playbackStats.worstAdvance = Math.max(args.playbackStats.worstAdvance, args.targetFramePN - nowTime);
            } else {
                args.playbackStats.worstLag = Math.max(args.playbackStats.worstLag, nowTime - args.targetFramePN);
            }

            if (this.prevSendBatch) {
                for (const s of this.prevSendBatch) {
                    if (!s.isComplete()) {
                        //args.emitWarning(`Sender for ${s.sender.address} missed the deadline`);
                    }
                    if (s.err) {
                        //args.emitWarning(`Send error for ${s.sender.address}: ${s.err}`);
                    }
                }
                this.prevSendBatch = undefined;
            }

            if (this.prevFrameRef) {
                this.prevFrameRef.release();
                this.prevFrameRef = undefined;
            }

            // Actually send the frame
            if (args.frame?.frame && this.state && this.job) {
                this.prevFrameRef = args.frame;
                args.frame = undefined;
                try {
                    startFrame(this.state);
                    startBatch(this.state);
                    await sendFull(this.state, busySleep);
                    const end = endBatch(this.state);
                    this.prevSendBatch = end;
                    const sendTime = performance.now() - nowTime;
                    Promise.allSettled(end.map((s)=>s.promise)).then(()=>{
                        for (const sb of end) {
                            if (sb.nECBs > 0) {
                                args.emitWarning(`Suspending IP ${sb.sender.address}`);
                                sb.sender.suspend();
                            }
                        }
                    });
                    args.playbackStatsAgg.totalSendTime += sendTime;
                    ++args.playbackStatsAgg.nSends;
                    args.playbackStats.maxSendTime = Math.max(sendTime, args.playbackStats.maxSendTime);
                    ++args.playbackStats.sentFrames;
                }
                catch (e) {
                    const err = e as Error;
                    args.emitError(err)
                }
                endFrame(this.state);
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

    close() {
        this.prevFrameRef?.release();
        this.prevFrameRef = undefined;
    }
}