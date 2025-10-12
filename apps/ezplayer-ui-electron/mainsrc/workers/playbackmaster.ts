import * as path from 'path';
import { parentPort, workerData } from 'worker_threads';
import { type Transferable } from 'node:worker_threads';

import type {
    PlayerCommand,
    PlayWorkerRPCAPI,
    MainRPCAPI,
    WorkerToMainMessage,
    PlaybackWorkerData,
} from './playbacktypes';
import { RPCClient, RPCServer } from './rpc';
import { ClockConverter } from '../../sharedsrc/ClockConverter';

import type {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    PlaybackActions,
    PlayAction,
    PlaybackLogDetail,
    PlaybackStatistics,
    PlayerPStatusContent,
    PlayerNStatusContent,
} from '@ezplayer/ezplayer-core';
import { PlayerRunState } from '@ezplayer/ezplayer-core';

if (!parentPort) throw new Error('No parentPort in worker');

import {
    SendJobState,
    sendFull,
    busySleep,
    openControllersForDataSend,
    OpenControllerReport,
    FSeqPrefetchCache,
    SendJob,
    ModelRec,
    ControllerSetup,
    ControllerRec,
    startBatch,
    endBatch,
} from '@ezplayer/epp';
import { MP3PrefetchCache } from './mp3decodecache';
import { AsyncBatchLogger } from './logger';

import { performance } from 'perf_hooks';
import { snapshotAsyncCounts, startAsyncCounts, startELDMonitor, startGCLogging } from './perfmon';

import process from "node:process";

// Helpful header for every line
function tag(msg: string) {
  const name = workerData?.name ?? "unnamed";
  return `[worker ${name}] ${msg}`;
}

// Log lifecycle
console.info(tag("booting"));

// Catch truly fatal programming errors
process.on("uncaughtException", (err) => {
  console.error(tag("uncaughtException"), {
    name: err.name,
    message: err.message,
    stack: err.stack,
    cause: (err as any).cause,
  });
  // Ensure non-zero exit so main 'exit' handler knows it wasn't clean.
  process.exitCode = 1;
});

// Promote unhandled rejections to real failures (or at least log them)
process.on("unhandledRejection", (reason, _promise) => {
  console.error(tag("unhandledRejection"), { reason });
  process.exitCode = 1;
});

// When the event loop is about to go idle; good for final flushes
process.on("beforeExit", (code) => {
  console.warn(tag(`beforeExit code=${code}`));
});

// Always runs right before termination (even after uncaughtException)
process.on("exit", (code) => {
  console.warn(tag(`exit code=${code}`));
});

// Parent port lifecycle (closed if main thread dies or calls worker.terminate())
parentPort.on("close", () => {
  console.warn(tag("parentPort closed"));
});

const playLogger = new AsyncBatchLogger({
    filePath: (workerData as PlaybackWorkerData).logFile,
    maxQueue: 1000,
});

function emitError(msg: string) {
    playbackStats.lastError = msg;
    playLogger.log(msg);
    console.log(msg);
}

function emitWarning(msg: string) {
    playLogger.log(msg);
    console.log(msg);
}

function emitInfo(msg: string) {
    playLogger.log(msg);
    console.log(msg);
}

function emitAudioDebug(msg: string) {
    return;
    playLogger.log(msg);
    console.log(msg);
}

function emitFrameDebug(msg: string) {
    return;
    playLogger.log(msg);
    console.log(msg);
}

////////
// Possibly useful for perf monitoring

const logGargbageCollection = true;
if (logGargbageCollection) {
    startGCLogging((l)=>playLogger.log(l));
}

const logEventLoop = false;
if (logEventLoop) {
    startELDMonitor((l)=>playLogger.log(l));
}

const logAsyncs = false;
if (logAsyncs) {
    startAsyncCounts();
}

////////
// Sleep utilities
const unsharedSharedBuffer = new SharedArrayBuffer(1024);
const int32USB = new Int32Array(unsharedSharedBuffer);
export async function xbusySleep(nextTime: number): Promise<void> {
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

const sleepms = (ms: number) => new Promise((r) => setTimeout(r, ms));

///////
// That there is one instance going
let running: Promise<void> | undefined;

///////
// IPC
function send(msg: WorkerToMainMessage, buffers?: Transferable[]) {
    parentPort!.postMessage(msg, buffers);
}

const handlers: PlayWorkerRPCAPI = {
    add: ({ a, b }) => a + b,
    fail: ({ msg }) => {
        throw new Error(msg);
    },
};

// TODO Send better player status
function sendPlayerStateUpdate() {
    const ps = foregroundPlayerRunState.getUpcomingItems(600_000, 24 * 3600 * 1000);
    const playStatus: PlayerPStatusContent = {
        ptype: 'EZP',
        status: 'Stopped',
        reported_time: Date.now(),
        upcoming: [],
    };
    if (ps.curPLActions?.actions?.length) {
        for (const pla of ps.curPLActions.actions) {
            if (pla.end) continue;
            if (!playStatus.now_playing) {
                ((playStatus.now_playing =
                    foregroundPlayerRunState.sequencesById.get(pla.seqId ?? '')?.work?.title ?? pla.seqId),
                    (playStatus.now_playing_until =
                        foregroundPlayerRunState.currentTime + (ps.curPLActions.actions[0].durationMS ?? 0)));
                playStatus.status = 'Playing';
            } else {
                playStatus.upcoming!.push({
                    title:
                        foregroundPlayerRunState.sequencesById.get(pla.seqId ?? '')?.work?.title ??
                        pla.seqId ??
                        '<unknown>',
                    at: pla.atTime,
                });
            }
        }
    }
    if (ps.heapSchedules?.[0]?.actions?.length) {
        //console.log(`Player Status Heap: ${ps.heapSchedules[0].scheduleId} / ${new Date(ps.heapSchedules[0].actions[0].atTime).toISOString()}`);
    }
    if (ps.upcomingSchedules?.length && ps.upcomingSchedules[0].type === 'scheduled') {
        //console.log(`Player Schedule Upcoming: ${ps.upcomingSchedules[0].scheduleId} / ${new Date(ps.upcomingSchedules[0].schedStart)}`);
        playStatus.upcoming!.push({
            title: foregroundPlayerRunState.schedulesById.get(ps.upcomingSchedules[0].scheduleId)?.title ?? 'Schedule',
            at: ps.upcomingSchedules[0].actions[0]?.atTime,
        });
    }
    if (ps.interactive?.[0]?.actions?.length) {
        //console.log(`Player Interactive: ${ps.interactive[0].scheduleId} / ${new Date(ps.interactive[0].actions[0].atTime).toISOString()}`);
    }
    // TODO this is really confusing it.  send({ type: 'queueUpdate',  queue: []});
    send({ type: 'pstatus', status: playStatus });
}

function sendControllerStateUpdate() {
    const cstatus: PlayerNStatusContent = {
        controllers: [],
    };
    cstatus.n_models = modelRecs?.length;
    cstatus.n_channels = Math.max(...(controllerSetups ?? []).map((e: ControllerSetup) => e.startCh + e.nCh));
    for (let i = 0; i < (controllerReport?.length ?? 0); ++i) {
        cstatus.controllers?.push({
            name: controllerRecs?.[i]?.name,
            description: controllerRecs?.[i]?.description,
            type: controllerRecs?.[i]?.type,
            proto: controllerRecs?.[i]?.protocol,
            protoDetails: '',
            model: `${controllerRecs?.[i]?.vendor} ${controllerRecs?.[i]?.model} ${controllerRecs?.[i]?.variant}`,
            address: controllerRecs?.[i]?.address,
            state: controllerRecs?.[i]?.activeState,
            status: controllerReport?.[i]?.status,
            notices: [],
            errors: controllerReport?.[i]?.error ? [controllerReport![i]!.error!] : [],
            connectivity: '<unknown>',
            reported_time: Date.now(),
        });
    }
    send({ type: 'nstatus', status: cstatus });
}

/////////
// Inbound messages
parentPort.on('message', (command: PlayerCommand) => {
    switch (command.type) {
        case 'schedupdate':
            {
                emitInfo(
                    `Given a new schedule... ${command.seqs.length} seqs, ${command.pls.length} pls, ${command.sched.length} scheds`,
                );
                pendingSchedule = command;
            }
            if (!running) {
                running = processQueue(); // kick off first song
            }
            break;
        case 'enqueue':
            foregroundPlayerRunState.addInteractiveCommand({
                commandId: `${command.cmd.entry.cmdseq}`,
                startTime: Date.now() + playbackParams.interactiveCommandPrefetchDelay,
                seqId: command.cmd.entry.seqid,
            });
            emitInfo(`Enqueue: Current length ${foregroundPlayerRunState.interactiveQueue.length}`);
            sendPlayerStateUpdate();
            if (!running) {
                running = processQueue(); // kick off first song
            }
            break;
        case 'dequeue':
            foregroundPlayerRunState.removeInteractiveCommand(`${command.cmdseq}`);
            sendPlayerStateUpdate();
            break;
        case 'pause':
            isPaused = true;
            break;
        case 'resume':
            isPaused = false;
            break;
        case 'rpc':
            rpcs.dispatchRequest(command.rpc).catch((e) => {
                emitError(`THIS SHOULD NOT HAPPEN - RPC should SEND ERROR BACK - ${e}`);
            });
            break;
        case 'rpc-response':
            rpcc.dispatchResponse(command.response);
            break;
    }
});

send({type: 'ready'});

const rpcs = new RPCServer<PlayWorkerRPCAPI>(parentPort, handlers);
const rpcc = new RPCClient<MainRPCAPI>(parentPort);

///////
// Playback params
const playbackParams = {
    audioTimeAdjMs: 0, // If > 0, push music into future; if < 0, pull it in
    sendAudioInAdvanceMs: 200,
    sendAudioChunkMs: 100, // Should be a multiple of 10 because of 44100kHz
    mp3CacheSpace: 16384_000_000,
    audioPrefetchTime: 24 * 3600 * 1000,
    maxAudioPrefetchItems: 100,
    fseqSpace: 500_000_000,
    idleSleepInterval: 200,
    interactiveCommandPrefetchDelay: 200,
    timePollInterval: 200,
    scheduleLoadTime: 25 * 3600 * 1000,
    foregroundFseqPrefetchTime: 5 * 1000,
    backgroundFseqPrefetchTime: 5 * 1000,
    dontSleepIfDurationLessThan: 2,
    skipFrameIfLateByMoreThan: 5,
};

////////
// Playback stats
const playbackStats: PlaybackStatistics = {
    iteration: 0,
    sentFrames: 0,
    worstLag: 0,
    worstAdvance: 0,
    avgSendTime: 0,
    maxSendTime: 0,
    missedFrames: 0,
    missedHeaders: 0,
    skippedFrames: 0,
    sentAudioChunks: 0,
    skippedAudioChunks: 0,
    lastError: undefined as string | undefined,

    measurementPeriod: 0,
    totalIdle: 0,
    totalSend: 0,
};

const playbackStatsAgg = {
    nSends: 0,
    intervalStart: 0,
    totalSendTime: 0,
    totalIdleTime: 0,
    avgSendTime() {
        return this.nSends > 0 ? this.totalSendTime / this.nSends : 0;
    },
    reset(pn: number) {
        this.intervalStart = pn;
        this.nSends = 0;
        this.totalSendTime = 0;
        this.totalIdleTime = 0;
    },
};

///////
// Clockkeeping
const audioConverter = new ClockConverter('maudio', 0, performance.now());
const rtcConverter = new ClockConverter('mrtc', 0, performance.now());

let perfNowDelta: number = 0;

const _pollTimes = setInterval(async () => {
    const spn = performance.now();
    const pt = await rpcc.call('timesync', {});
    const epn = performance.now();
    if (epn - spn <= 2) {
        const pn = (epn + spn) / 2;
        const cpnDelta = pn - pt.perfNowTime;
        if (Math.abs(cpnDelta - perfNowDelta) > 2) perfNowDelta = cpnDelta;
        if (pt.audioCtxIncarnation !== undefined && pt.audioCtxTime !== undefined) {
            audioConverter.setTime(pt.audioCtxTime, pn, pt.audioCtxIncarnation);
        }
        if (pt.realTime !== undefined) {
            rtcConverter.addSample(pt.realTime, pn);
        }
    }
}, playbackParams.timePollInterval);

///////
// The actual variables here
let showFolder: string | undefined = undefined;
let isPaused = false;
let pendingSchedule: PlayerCommand | undefined = undefined;
let curSequences: SequenceRecord[] | undefined = undefined;
let curPlaylists: PlaylistRecord[] | undefined = undefined;
let curSchedule: ScheduledPlaylist[] | undefined = undefined;
let modelRecs: ModelRec[] | undefined = undefined;
let controllerReport: OpenControllerReport[] | undefined = undefined;
let controllerSetups: ControllerSetup[] | undefined = undefined;
let controllerRecs: ControllerRec[] | undefined = undefined;

let backgroundPlayerRunState: PlayerRunState = new PlayerRunState(Date.now());
let foregroundPlayerRunState: PlayerRunState = new PlayerRunState(Date.now());

// Kept separate, as we will run it in advance
//  Say, we run it 100ms in advance, we're giving it audio for 100-200ms out.
// We will use its current time as the target and try to keep it out in front
let audioPlayerRunState: PlayerRunState = new PlayerRunState(Date.now());

let mp3Cache: MP3PrefetchCache | undefined = undefined;
let fseqCache: FSeqPrefetchCache | undefined = undefined;

/////
// Update time variables
let lastPRSSchedUpdate: number = 0;

////////
// Actual logic loops
////////
async function processQueue() {
    // TODO SHOWFOLDER
    if (!showFolder && pendingSchedule?.type === 'schedupdate') {
        showFolder = pendingSchedule.showFolder;
    }

    if (!mp3Cache) {
        mp3Cache = new MP3PrefetchCache({
            log: emitInfo,
            now: rtcConverter.computeTime(performance.now()),
            mp3Space: playbackParams.mp3CacheSpace,
        });
    }

    if (!fseqCache) {
        fseqCache = new FSeqPrefetchCache({
            now: performance.now(),
            fseqSpace: playbackParams.fseqSpace,
        });
    }

    const state = new SendJobState();

    let job: SendJob | undefined = undefined;
    try {
        const {
            sendJob,
            report,
            controllerSetups: csetups,
            controllers,
            models,
        } = await openControllersForDataSend(showFolder!);
        job = sendJob;
        modelRecs = models;
        controllerRecs = controllers;
        controllerSetups = csetups;
        controllerReport = report;
        for (let i = 0; i < controllers.length; ++i) {
            const xc = controllers[i];
            const c = controllerSetups[i];
            const r = report[i];
            emitInfo(
                `Controller: ${xc.name} ${xc.address} ${xc.activeState} ${xc.type} ${xc.universeNumbers} ${xc.universeSizes} ${xc?.keepChannelNumbers}`,
            );
            emitInfo(`Setup: ${c?.name} - ${c?.address} - ${c?.proto} - ${c?.nCh}@${c?.startCh}`);
            emitInfo(`Status: ${r?.name}: ${r?.status}(${r?.error})`);
            emitInfo('');
        }
    } catch (e) {
        const err = e as Error;
        playbackStats.lastError = err.message;
    }

    emitInfo(`Player running`);

    let iteration = -1;

    // OK - all the clocks are sync to perf.now.  But we can skew to that.
    // TODO: For now, let us just set the time once.  We can move to per song.
    const clockBasePN = Math.ceil(performance.now());
    const clockBaseTime = Math.ceil(rtcConverter.computeTime(clockBasePN));
    let audioBaseTime = Math.ceil(audioConverter.computeTime(clockBasePN));
    let audioBasePN = clockBasePN;
    // The schedule time is kept in the player run states
    // These should really be base times / detect when the song changes...
    let targetFramePN = clockBasePN;
    let lastStatsUpdate = clockBasePN;
    let lastPStatusUpdate = clockBasePN;
    let lastNStatusUpdate = clockBasePN;

    while (true) {
        ++iteration;

        const curPerfNow = performance.now();
        const curPerfNowTime = curPerfNow - clockBasePN + clockBaseTime; // rtcConverter.computeTime(curPerfNow);

        if (curPerfNow - lastStatsUpdate >= 1000 && iteration % 4 === 0) {
            send({ type: 'stats', stats: playbackStats });
            lastStatsUpdate += 1000 * Math.floor((curPerfNow - lastStatsUpdate) / 1000);
        }
        if (curPerfNow - lastPStatusUpdate >= 1000 && iteration % 4 === 1) {
            playbackStats.iteration = iteration;
            playbackStats.avgSendTime = playbackStatsAgg.avgSendTime();
            playbackStats.measurementPeriod = curPerfNow - playbackStatsAgg.intervalStart;
            playbackStats.totalIdle = playbackStatsAgg.totalIdleTime;
            playbackStats.totalSend = playbackStatsAgg.totalSendTime;
            sendPlayerStateUpdate();
            playbackStats.maxSendTime = 0;
            playbackStatsAgg.reset(curPerfNow);
            lastPStatusUpdate += 1000 * Math.floor((curPerfNow - lastPStatusUpdate) / 1000);
        }
        if (curPerfNow - lastNStatusUpdate >= 1000 && iteration % 4 === 2) {
            sendControllerStateUpdate();
            lastNStatusUpdate += 1000 * Math.floor((curPerfNow - lastNStatusUpdate) / 1000);
        }

        // See if a schedule update has been passed in.  If so, do something.
        if (installNewSchedule()) {
            emitInfo(`New schedule installed`);
            const preserveAudioTime = audioPlayerRunState?.currentTime || curPerfNowTime;
            const preserveFGFseqTime = foregroundPlayerRunState?.currentTime || curPerfNowTime;
            const preserveBGFseqTime = backgroundPlayerRunState?.currentTime || curPerfNowTime;
            foregroundPlayerRunState = new PlayerRunState(curPerfNowTime);
            audioPlayerRunState = new PlayerRunState(curPerfNowTime);
            backgroundPlayerRunState = new PlayerRunState(curPerfNowTime);
            const errs: string[] = [];
            foregroundPlayerRunState.setUpSequences(
                curSequences ?? [],
                curPlaylists ?? [],
                (curSchedule ?? []).filter((s) => s.scheduleType === 'main'),
                errs,
            );
            audioPlayerRunState.setUpSequences(
                curSequences ?? [],
                curPlaylists ?? [],
                (curSchedule ?? []).filter((s) => s.scheduleType === 'main'),
                errs,
            );
            backgroundPlayerRunState.setUpSequences(
                curSequences ?? [],
                curPlaylists ?? [],
                (curSchedule ?? []).filter((s) => s.scheduleType === 'background'),
                errs,
            );
            foregroundPlayerRunState.addTimeRangeToSchedule(
                curPerfNowTime,
                curPerfNowTime + playbackParams.scheduleLoadTime,
            );
            audioPlayerRunState.addTimeRangeToSchedule(
                curPerfNowTime,
                curPerfNowTime + playbackParams.scheduleLoadTime,
            );
            backgroundPlayerRunState.addTimeRangeToSchedule(
                curPerfNowTime,
                curPerfNowTime + playbackParams.scheduleLoadTime,
            );

            lastPRSSchedUpdate = curPerfNowTime + playbackParams.scheduleLoadTime;
            if (errs.length) {
                emitError(`New schedule install errors: ${errs.join('\n')}`);
            }

            // Make these caught up to the correct times from the last trip through...
            foregroundPlayerRunState.runUntil(preserveFGFseqTime);
            backgroundPlayerRunState.runUntil(preserveBGFseqTime);
            audioPlayerRunState.runUntil(preserveAudioTime);

            sendPlayerStateUpdate();
        }

        // Make sure we see a day in advance
        if (lastPRSSchedUpdate < curPerfNowTime + (playbackParams.scheduleLoadTime * 24) / 25) {
            foregroundPlayerRunState.addTimeRangeToSchedule(
                lastPRSSchedUpdate,
                curPerfNowTime + playbackParams.scheduleLoadTime,
            );
            audioPlayerRunState.addTimeRangeToSchedule(
                lastPRSSchedUpdate,
                curPerfNowTime + playbackParams.scheduleLoadTime,
            );
            backgroundPlayerRunState.addTimeRangeToSchedule(
                lastPRSSchedUpdate,
                curPerfNowTime + playbackParams.scheduleLoadTime,
            );
            lastPRSSchedUpdate = curPerfNowTime + playbackParams.scheduleLoadTime;
        }

        // TODO: Divvy up the tasks so they are not all on each iteration: music, fseq, bg, status update to FE
        const doAudioPrefetch = true;
        const doFseqPrefetch = true;

        if (doAudioPrefetch) {
            // Issue MP3 prefetches
            function prefetchActionMedia(actions?: PlaybackActions) {
                if (!actions) return;

                for (const action of actions?.actions ?? []) {
                    if (action.atTime > curPerfNowTime + playbackParams.audioPrefetchTime) break;
                    if (action.end) continue;

                    if (action.seqId) {
                        emitAudioDebug(`Do prefetch of ${action.seqId}`);
                        const seq = audioPlayerRunState.sequencesById.get(action.seqId);
                        let saf = seq?.files?.audio;
                        if (saf && !path.isAbsolute(saf)) saf = path.join(showFolder!, saf);
                        if (saf) {
                            emitAudioDebug(`Prefetch Audio ${saf}`);
                            mp3Cache!.prefetchMP3({
                                mp3file: saf,
                                needByTime: action.atTime,
                                expiry: curPerfNowTime + 7 * 24 * 3600_000,
                            });
                        }
                    }
                }
            }

            const upcomingAudio = audioPlayerRunState?.getUpcomingItems(
                playbackParams.audioPrefetchTime,
                playbackParams.scheduleLoadTime,
                playbackParams.maxAudioPrefetchItems,
            );

            mp3Cache.setNow(curPerfNowTime);
            prefetchActionMedia(upcomingAudio.curPLActions);
            upcomingAudio.stackedPLActions?.forEach((s) => prefetchActionMedia(s));
            upcomingAudio.upcomingSchedules?.forEach((s) => prefetchActionMedia(s));
            upcomingAudio.interactive?.forEach((s) => prefetchActionMedia(s));
            upcomingAudio.heapSchedules?.forEach((s) => prefetchActionMedia(s));
            mp3Cache.dispatch();
        }

        if (doFseqPrefetch) {
            // See if there's anything coming up
            const upcomingForeground = foregroundPlayerRunState?.getUpcomingItems(
                playbackParams.foregroundFseqPrefetchTime,
                playbackParams.scheduleLoadTime,
            );
            const _upcomingBackground = backgroundPlayerRunState?.getUpcomingItems(
                playbackParams.backgroundFseqPrefetchTime,
                playbackParams.scheduleLoadTime,
            );

            // Issue FSEQ prefetches
            function prefetchActionFseq(actions?: PlaybackActions) {
                if (!actions) return;

                for (const action of actions?.actions ?? []) {
                    if (!action.seqId) continue;
                    if (action.end) continue;
                    const actStart = action.atTime;
                    const seq = foregroundPlayerRunState.sequencesById.get(action.seqId);
                    if (!seq) continue;
                    // Always fetch header
                    let fsf = seq.files?.fseq;
                    if (fsf && !path.isAbsolute(fsf)) fsf = path.join(showFolder!, fsf);
                    if (fsf) {
                        fseqCache!.prefetchSeqMetadata({ fseqfile: fsf, needByTime: actStart });
                    }

                    // Be less aggressive about fetching the frames
                    if (actStart >= curPerfNowTime + playbackParams.foregroundFseqPrefetchTime) continue;
                    let ourDur = curPerfNowTime + playbackParams.foregroundFseqPrefetchTime - actStart;
                    if (action.durationMS !== undefined) ourDur = Math.min(ourDur, action.durationMS);
                    if (action.seqId) {
                        emitFrameDebug(`Do fseq prefetch of ${action.seqId}`);
                        if (fsf) {
                            emitFrameDebug(
                                `Prefetch FSEQ ${fsf} @${action.offsetMS}:${ourDur}ms (${actStart} vs ${curPerfNowTime})`,
                            );
                            fseqCache!.prefetchSeqTimes({
                                fseqfile: fsf,
                                needByTime: action.atTime,
                                startTime: action.offsetMS ?? 0,
                                durationms: ourDur,
                            });
                        }
                    }
                }
            }

            fseqCache.setNow(curPerfNowTime);
            prefetchActionFseq(upcomingForeground.curPLActions);
            upcomingForeground.stackedPLActions?.forEach((s) => prefetchActionFseq(s));
            upcomingForeground.upcomingSchedules?.forEach((s) => prefetchActionFseq(s));
            upcomingForeground.interactive?.forEach((s) => prefetchActionFseq(s));
            upcomingForeground.heapSchedules?.forEach((s) => prefetchActionFseq(s));
            fseqCache.dispatch();
        }

        //emitFrameDebug(`${iteration} - Fseq prefetched`);

        // Send out audio in advance
        emitAudioDebug(
            `Send audio time: ${audioPlayerRunState.currentTime} vs ${curPerfNowTime + playbackParams.sendAudioInAdvanceMs}`,
        );
        let aiter = 0;
        while (audioPlayerRunState.currentTime <= curPerfNowTime + playbackParams.sendAudioInAdvanceMs) {
            ++aiter;
            if (aiter > 100) {
                emitError(`Way too many audio iterations!`);
                break;
            }

            const upcomingAudio = audioPlayerRunState?.getUpcomingItems(
                playbackParams.sendAudioInAdvanceMs,
                playbackParams.scheduleLoadTime,
            );
            let audioAction: PlayAction | undefined = upcomingAudio?.curPLActions?.actions[0];
            if (audioAction?.end) {
                audioPlayerRunState.runUntil(audioAction.atTime);
                continue;
            }
            if (!audioAction?.seqId) {
                audioPlayerRunState.runUntil(Math.max(audioPlayerRunState.currentTime, curPerfNowTime));
                break;
            }
            if (Math.floor(audioAction.offsetMS ?? 0) === 0) {
                audioBasePN = curPerfNow;
                audioBaseTime = audioConverter.computeTime(audioBasePN);
            }

            let audioref: ReturnType<MP3PrefetchCache['getMp3']> | undefined = undefined;
            try {
                const curAudioSeq = audioPlayerRunState.sequencesById.get(audioAction.seqId);
                let saf = curAudioSeq?.files?.audio;
                if (saf && !path.isAbsolute(saf)) saf = path.join(showFolder!, saf);
                if (saf) {
                    audioref = mp3Cache.getMp3(saf);
                    if (!audioref) {
                        emitError(`Audio ${saf} not ready.`);
                        break;
                    } else {
                        if (audioref.err) {
                            emitError(`Audio error for ${saf}: ${audioref.err.message}.`);
                            break;
                        } else if (!audioref.ref) {
                            emitError(`Audio unknown condition ${saf}.`);
                            break;
                        }
                    }

                    const audio = audioref?.ref?.v?.decompAudio;
                    const channels = audio?.channelData?.length ?? 2;
                    const sampleRate = audio?.sampleRate ?? 48000;
                    if (audio) {
                        // Send audio
                        const sampleOffset = Math.floor((Math.floor(audioAction.offsetMS ?? 0) * sampleRate) / 1000);
                        const msToSend = Math.min(playbackParams.sendAudioChunkMs);
                        const nSamplesToSend = Math.floor((msToSend * audio.sampleRate) / 1000);

                        const chunk = new Float32Array(nSamplesToSend * channels);

                        for (let ch = 0; ch < channels; ch++) {
                            const adata = audio.channelData[ch];
                            for (let i = 0; i < nSamplesToSend; i++) {
                                chunk[i * channels + ch] = adata[i + sampleOffset] ?? 0;
                            }
                        }

                        const startTime = Math.floor(
                            audioPlayerRunState.currentTime -
                                clockBaseTime +
                                clockBasePN +
                                audioBaseTime -
                                audioBasePN +
                                playbackParams.audioTimeAdjMs,
                        );
                        const audioContextEstTime = audioConverter.computeTime(
                            audioPlayerRunState.currentTime -
                                clockBaseTime +
                                clockBasePN +
                                playbackParams.audioTimeAdjMs,
                        );
                        if (Math.abs(audioContextEstTime - startTime) > 100) {
                            emitWarning(
                                `Audio time adjust: Sending ${msToSend}(${nSamplesToSend})@${sampleOffset}; ${audioPlayerRunState.currentTime} / ${startTime} ${startTime - audioContextEstTime}`,
                            );
                            audioBasePN = curPerfNow;
                            audioBaseTime = audioConverter.computeTime(audioBasePN);
                        }

                        if (audioPlayerRunState.currentTime >= curPerfNowTime) {
                            send(
                                {
                                    type: 'audioChunk',
                                    chunk: {
                                        sampleRate: audio.sampleRate,
                                        channels,
                                        buffer: chunk.buffer,
                                        // TODO let the dog wag the tail
                                        startTime,
                                        incarnation: audioConverter.curIncarnation,
                                    },
                                },
                                [chunk.buffer],
                            );
                        } else {
                            ++playbackStats.skippedAudioChunks;
                        }

                        audioPlayerRunState.runUntil(audioPlayerRunState.currentTime + msToSend);
                    }
                } else {
                    const msToSend = Math.min(
                        audioAction.durationMS ?? playbackParams.sendAudioInAdvanceMs,
                        playbackParams.sendAudioInAdvanceMs,
                    );
                    audioPlayerRunState.runUntil(audioPlayerRunState.currentTime + msToSend);
                }
            } finally {
                audioref?.ref?.release();
            }
        }

        // Run to target PN, see if anything happened, then get a readout
        //emitFrameDebug(`${iteration} - get foreground player ready`);

        while (true) {
            const plog: PlaybackLogDetail[] = [];
            foregroundPlayerRunState.runUntil(targetFramePN - clockBasePN + clockBaseTime, 1, plog);
            let foundTime = plog.length === 0;
            for (const l of plog) {
                if (l.eventType === 'Sequence Ended') {
                    // TODO - Could reset clock base here.
                } else if (l.eventType === 'Sequence Started') {
                    targetFramePN = foregroundPlayerRunState.currentTime - clockBaseTime + clockBasePN;
                    foundTime = true;
                    break;
                }
            }
            if (foundTime) break;
        }

        //emitFrameDebug(`${iteration} - runUntil done`);

        // Get the background frame, for future
        while (true) {
            backgroundPlayerRunState.runUntil(targetFramePN - clockBasePN + clockBaseTime);
            break;
        }

        const upcomingForeground = foregroundPlayerRunState?.getUpcomingItems(
            playbackParams.foregroundFseqPrefetchTime,
            playbackParams.scheduleLoadTime,
        );
        // TODO change this check to look at all the things
        if (!upcomingForeground.curPLActions?.actions?.length) {
            targetFramePN += playbackParams.idleSleepInterval;
            await sleepms(playbackParams.idleSleepInterval);
            continue;
        }
        const foregroundAction = upcomingForeground.curPLActions?.actions[0];
        // TODO: Something else here that accommodates background and other things
        if (isPaused || !foregroundAction?.seqId) {
            targetFramePN += playbackParams.idleSleepInterval;
            await sleepms(playbackParams.idleSleepInterval);
            continue;
        }

        const curForegroundSeq = foregroundPlayerRunState.sequencesById.get(foregroundAction.seqId);
        let fsf = curForegroundSeq?.files?.fseq;
        if (fsf && !path.isAbsolute(fsf)) fsf = path.join(showFolder!, fsf);
        if (!fsf) {
            emitError(`Error: No FSEQ in scheduled item`);
            targetFramePN += playbackParams.idleSleepInterval;
            await sleepms(playbackParams.idleSleepInterval);
            continue;
        }

        const frameTimeOffset = foregroundAction.offsetMS ?? 0;
        const header = fseqCache.getHeaderInfo({ fseqfile: fsf });
        if (!header?.ref) {
            emitError(`Sequence header for ${fsf} was not ready.`);
            ++playbackStats.missedHeaders;
            targetFramePN += playbackParams.idleSleepInterval;
            await sleepms(playbackParams.idleSleepInterval);
            continue;
        }

        const frameInterval = header.ref.header.msperframe;
        const targetFrameNum = Math.floor(frameTimeOffset / frameInterval);

        // At this point, all housekeeping is done.
        // Let's see if we're in time to spit out a frame, or if we have to skip
        //emitFrameDebug(`${iteration} - play the frame?`);
        const frameRef = fseqCache.getFrame(fsf, { num: targetFrameNum });
        try {
            if (frameRef?.ref?.frame && state && job) {
                job.frameNumber = targetFrameNum;
                job.dataBuffers = [frameRef.ref.frame];
                state.initialize(job);
            } else {
                ++playbackStats.missedFrames;
            }

            const preSleepPN = performance.now();
            // If target frame PN is way in the future compared to other tasks, go around again.
            if (targetFramePN - preSleepPN > frameInterval) {
                playbackStatsAgg.totalIdleTime += frameInterval;
                await xbusySleep(preSleepPN + frameInterval);
                continue;
            }

            const sleep = targetFramePN - preSleepPN;
            if (sleep < -playbackParams.skipFrameIfLateByMoreThan) {
                ++playbackStats.skippedFrames;
                // TODO increment frame?  Or do we just let calculations establish this from current time?
                targetFramePN += frameInterval;
                continue;
            }

            if (sleep > playbackParams.dontSleepIfDurationLessThan) {
                playbackStatsAgg.totalIdleTime += sleep;
                //await sleepms(sleep);
                await xbusySleep(targetFramePN);
            }

            const nowTime = performance.now();

            if (nowTime < targetFramePN) {
                playbackStats.worstAdvance = Math.max(playbackStats.worstAdvance, targetFramePN - nowTime);
            } else {
                playbackStats.worstLag = Math.max(playbackStats.worstLag, nowTime - targetFramePN);
            }

            targetFramePN += frameInterval;

            // Actually send the frame
            if (frameRef?.ref?.frame && state && job) {
                try {
                    startBatch(state);
                    await sendFull(state, busySleep);
                    const end = endBatch(state);
                    const sendTime = performance.now() - nowTime;
                    Promise.allSettled(end.map((s)=>s.promise)).then(()=>{
                        for (const sb of end) {
                            if (sb.nECBs > 0) {
                                emitWarning(`Suspending IP ${sb.sender.address}`);
                                sb.sender.suspend();
                            }
                        }
                    });
                    playbackStatsAgg.totalSendTime += sendTime;
                    ++playbackStatsAgg.nSends;
                    playbackStats.maxSendTime = Math.max(sendTime, playbackStats.maxSendTime);
                    ++playbackStats.sentFrames;
                }
                catch (e) {
                    const err = e as Error;
                    console.error(e);
                    playLogger.log(err.message);
                }
            }
        } finally {
            frameRef?.ref?.release();
        }
    }
}

function installNewSchedule(): boolean {
    if (!pendingSchedule || pendingSchedule.type !== 'schedupdate') return false;
    showFolder = pendingSchedule.showFolder || showFolder;
    curSequences = pendingSchedule.seqs;
    curPlaylists = pendingSchedule.pls;
    curSchedule = pendingSchedule.sched;
    pendingSchedule = undefined;
    return true;
}
