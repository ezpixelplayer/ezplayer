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
    PlayingItem,
    PlayerPStatusContent,
    PlayerNStatusContent,
    PlaybackSettings,
    EZPlayerCommand,
} from '@ezplayer/ezplayer-core';
import { getActiveViewerControlSchedule, PlayerRunState } from '@ezplayer/ezplayer-core';

if (!parentPort) throw new Error('No parentPort in worker');

import {
    openControllersForDataSend,
    FSeqPrefetchCache,
    ModelRec,
    readControllersFromXlights,
    ControllerState,
} from '@ezplayer/epp';
import { MP3PrefetchCache } from './mp3decodecache';
import { AsyncBatchLogger } from './logger';

import { performance } from 'perf_hooks';
import { startAsyncCounts, startELDMonitor, startGCLogging } from './perfmon';

import process from "node:process";
import { avgFrameSendTime, FrameSender, OverallFrameSendStats, resetFrameSendStats } from './framesend';

import { decompressZStdWithWorker, getZstdStats } from './zstdparent';
import { setPingConfig, getLatestPingStats } from './pingparent';

import { sendRFInitiateCheck, setRFConfig, setRFControlEnabled, setRFNowPlaying, setRFPlaylist } from './rfparent';
import { PlaylistSyncItem } from './rfsync';
import { randomUUID } from 'node:crypto';

//import { setThreadAffinity } from '../affinity/affinity.js';
//setThreadAffinity([3]);

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

function playingItemDesc(item?: PlayAction) {
    if (!item?.seqId) return '<Unknown>';
    const nps = foregroundPlayerRunState.sequencesById.get(item.seqId);
    return `${nps?.work?.title} - ${nps?.work?.artist}${nps?.sequence?.vendor ? ' - ' + nps?.sequence?.vendor : ''}`;
}

// TODO: Should this move to the run state?
function actionToPlayingItem(interactive: boolean, pla: PlayAction)
{
    return {
        type: interactive ? 'Immediate' : 'Scheduled',
        item: 'Song', // TODO
        title: playingItemDesc(pla),
        sequence_id: pla.seqId,
        at: foregroundPlayerRunState.currentTime,
        until: foregroundPlayerRunState.currentTime + (pla.durationMS ?? 0)
    } as PlayingItem;
}

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
                playStatus.now_playing = actionToPlayingItem(false, pla);
                playStatus.status = 'Playing';
            } else {
                playStatus.upcoming!.push(actionToPlayingItem(false, pla));
            }
        }
    }
    playStatus.queue = foregroundPlayerRunState.getQueueItems();
    playStatus.upcoming!.push(...foregroundPlayerRunState.getUpcomingSchedules());
    playStatus.suspendedItems = foregroundPlayerRunState.getHeapItems();
    playStatus.preemptedItems = foregroundPlayerRunState.getStackItems();
    send({ type: 'pstatus', status: playStatus });
}

function sendControllerStateUpdate() {
    const stats = getLatestPingStats();
    const cstatus: PlayerNStatusContent = {
        controllers: [],
    };
    cstatus.n_models = modelRecs?.length;
    cstatus.n_channels = Math.max(...(controllerStates ?? []).map((e: ControllerState) => e.setup.startCh + e.setup.nCh));
    for (const c of controllerStates ?? []) {
        const pstat = stats.stats?.[c.setup.address];
        const pss = pstat ? `${pstat.nReplies} out of ${pstat.outOf} pings` : "";
        const connectivity = !c.setup.usable ? "N/A"
            : (!(pstat?.outOf) ? "Pending" :  pstat.nReplies > 0 ? "Up" : "Down");
        cstatus.controllers?.push({
            name: c.setup.name,
            description: c.xlRecord?.description,
            type: c.xlRecord?.type,
            proto: c.setup.proto,
            protoDetails: '',
            model: `${c.xlRecord?.vendor} ${c.xlRecord?.model} ${c.xlRecord?.variant}`,
            address: c.setup.address,
            state: c.xlRecord?.activeState,
            status:  c.setup.skipped ? 'skipped' : (c.setup.usable ? c.report?.status : 'unusable'),
            notices: c.setup.summary ? [c.setup.summary] : [],
            errors: c.report?.error ? [c.report!.error!] : [],
            connectivity,
            pingSummary: pss,
            reported_time: stats.latestUpdate,
        });
    }
    send({ type: 'nstatus', status: cstatus });
}

let lastRFCheck: number = Date.now();
function sendRemoteUpdate() {
    const settings = latestSettings;
    if (!settings || !settings.viewerControl?.remoteFalconToken) {
        //emitInfo("No RF token");
        return;
    }
    const rfStat = getActiveViewerControlSchedule(settings.viewerControl);
    if (!rfStat) {
        //emitInfo('Disable RF');
        setRFControlEnabled(false);
        return;
    }
    else {
        //emitInfo('Enable RF');
        setRFControlEnabled(true);
    }
    const ps = foregroundPlayerRunState.getUpcomingItems(600_000, 24 * 3600 * 1000);
    let now_playing: PlayingItem | undefined = undefined;
    let upcoming: PlayingItem | undefined = undefined;
    if (ps.curPLActions?.actions?.length) {
        for (const pla of ps.curPLActions.actions) {
            if (pla.end) continue;
            if (!now_playing) {
                now_playing = actionToPlayingItem(false, pla);
            } else {
                upcoming = actionToPlayingItem(false, pla);
                break;
            }
        }
    }
    //emitInfo("Set RF Now Playing");
    setRFNowPlaying(now_playing?.title, upcoming?.title);
    const pl = curPlaylists?.find((p)=>p.title.toLowerCase() === rfStat?.playlist.toLowerCase());
    const items : PlaylistSyncItem[] = [];
    if (pl) {
        for (const i of pl.items) {
            const s = foregroundPlayerRunState.sequencesById.get(i.id);
            if (!s) continue;
            items.push({
                playlistType: 'SEQUENCE',
                playlistDuration: s.work.length,
                playlistIndex: i.sequence,
                playlistName: `${s.work.title} - ${s.work.artist}${s.sequence?.vendor ? ' - '+s.sequence.vendor: ''}`,
            });
        }
        //emitInfo(`Set RF Now Playlists ${JSON.stringify(items)}`);
        setRFPlaylist(items);
    }
    if (now_playing) {
        const diff = (now_playing.until ?? 0) - foregroundPlayerRunState.currentTime;
        if (diff >= 3000 && diff < 4000) {
            //emitInfo("Initiate while-playing RF check");
            sendRFInitiateCheck();
        }
    }
    else {
        const dn = Date.now();
        if (dn - lastRFCheck > 5000) {
            lastRFCheck = dn;
            //emitInfo("Initiate idle RF check");
            sendRFInitiateCheck();
        }
    }
}

/////////
// Inbound messages
function processCommand(cmd: EZPlayerCommand) {
    switch (cmd.command) {
        case 'playsong': {
            emitInfo(`PLAY CMD: ${cmd?.command}: ${cmd?.songId}`);
            const seq = curSequences?.find((s) => s.id === cmd.songId);
            if (!seq) {
                emitError(`Unable to identify sequence ${cmd.songId}`);
                return false;
            }
            foregroundPlayerRunState.addInteractiveCommand({
                immediate: cmd.immediate,
                requestId: cmd.requestId,
                startTime: Date.now() + playbackParams.interactiveCommandPrefetchDelay,
                seqId: cmd.songId,
            });
            audioPlayerRunState.addInteractiveCommand({
                immediate: cmd.immediate,
                requestId: cmd.requestId,
                startTime: Date.now() + playbackParams.interactiveCommandPrefetchDelay,
                seqId: cmd.songId,
            });
            emitInfo(`Enqueue: Current length ${foregroundPlayerRunState.interactiveQueue.length}`);
            sendPlayerStateUpdate();
            if (!running) {
                running = processQueue(); // kick off first song
            }
        }
        break;
        case 'deleterequest': {
            emitInfo(`Delete ${cmd.requestId}`);
            foregroundPlayerRunState.removeInteractiveCommand(cmd.requestId);
            audioPlayerRunState.removeInteractiveCommand(cmd.requestId);
            break;
        }
        case 'clearrequests': {
            foregroundPlayerRunState.removeInteractiveCommands();
            audioPlayerRunState.removeInteractiveCommands();
            break;
        }
        // lots of TODOs here...
        case 'pause':
            isPaused = true;
            break;
        case 'resume':
            isPaused = false;
            break;
        case 'activateoutput': break;
        case 'suppressoutput': break;
        case 'playplaylist': break;
        case 'reloadcontrollers': break;
        case 'resetplayback': break;
        case 'stopgraceful': break;
        case 'stopnow': break;
    }
}

parentPort.on('message', (command: PlayerCommand) => {
    switch (command.type) {
        case 'schedupdate': {
            emitInfo(
                `Given a new schedule... ${command.seqs.length} seqs, ${command.pls.length} pls, ${command.sched.length} scheds`,
            );
            pendingSchedule = command;
            if (!running) {
                running = processQueue(); // kick off first song
            }
            break;
        }
        case 'frontendcmd': {
            const cmd = command.cmd;
            processCommand(cmd);
            break;
        }
        case 'settings': {
            const settings = command.settings;
            dispatchSettings(settings);
            break;
        }
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

let latestSettings: PlaybackSettings | undefined = undefined;

function dispatchSettings(settings: PlaybackSettings) {
    latestSettings = settings;
    playbackParams.audioTimeAdjMs = settings.audioSyncAdjust ?? 0;
    setRFConfig({
        remoteToken: settings.viewerControl.remoteFalconToken,
    },
    (next) => {
        const settings = latestSettings;
        if (!settings) return;
        const rfc = getActiveViewerControlSchedule(settings.viewerControl);
        if (!rfc) return;
        const pl = curPlaylists?.find((pl)=>pl.title.toLowerCase() === rfc?.playlist.toLowerCase());
        if (!pl) return;
        const s = pl.items.find((seq)=>seq.sequence === next.playlistIndex);
        if (!s) return;
        processCommand({command: 'playsong', immediate: false, songId: s.id, requestId: randomUUID(), priority: 3});
    });
}

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
    framesSkippedDueToManyOutstandingFrames: 0,
    sentAudioChunks: 0,
    skippedAudioChunks: 0,
    cframesSkippedDueToDirective: 0,
    cframesSkippedDueToIncompletePrior: 0,
    lastError: undefined as string | undefined,

    measurementPeriod: 0,
    totalIdle: 0,
    totalSend: 0,

    audioDecode: {
        fileReadTime: 0,
        decodeTime: 0,
    },

    // Sequence Decompress
    sequenceDecompress: {
        fileReadTime: 0,
        decompressTime: 0,
    }
};

const playbackStatsAgg: OverallFrameSendStats = {
    nSends: 0,
    intervalStart: 0,
    totalSendTime: 0,
    totalIdleTime: 0,
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
let controllerStates: ControllerState[] | undefined = undefined;

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
            decompZstd: decompressZStdWithWorker,
        });
    }

    const sender: FrameSender = new FrameSender();
    sender.emitError = (e)=>emitError(e.message);
    sender.emitWarning = emitWarning;

    try {
        const { controllers, models } = await readControllersFromXlights(showFolder!);
        const sendJob = await openControllersForDataSend(controllers);
        setPingConfig({
            hosts: controllers.filter((c)=>c.setup.usable).map((c)=>c.setup.address),
            concurrency: 10,
            maxSamples: 10,
            intervalS: 5,
        })
        sender.job = sendJob;
        modelRecs = models;
        controllerStates = controllers;
        for (const c of controllers) {
            const xc = c.xlRecord;
            const cs = c.setup;
            const r = c.report;
            emitInfo(
                `Controller: ${xc?.name} ${xc?.address} ${xc?.activeState} ${xc?.type} ${xc?.universeNumbers} ${xc?.universeSizes} ${xc?.keepChannelNumbers}`,
            );
            emitInfo(`Setup: ${cs.usable ? 'Usable' : 'Unusable'} ${cs.name} - ${cs.address} - ${cs?.proto} - ${cs?.nCh}@${cs?.startCh}; ${c.sender?.minFrameTime()} ms frame time`);
            emitInfo(`Status: ${r?.name}: ${r?.status}(${r?.error})`);
            emitInfo('');
        }
        const nChannels = Math.max(...(controllers ?? []).map((e) => e.setup.startCh + e.setup.nCh));
        sender.nChannels = nChannels;
        sender.blackFrame = new Uint8Array(nChannels);
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
    let lastRFUpdate = clockBasePN;

    try
    {
        while (true) {
            ++iteration;

            const curPerfNow = performance.now();
            const curPerfNowTime = curPerfNow - clockBasePN + clockBaseTime; // rtcConverter.computeTime(curPerfNow);

            if (curPerfNow - lastStatsUpdate >= 1000 && iteration % 4 === 0) {
                const astat = mp3Cache.getStats();
                playbackStats.audioDecode = {
                    fileReadTime: astat.fileReadTime,
                    decodeTime: astat.decodeTime,
                }
                const fseqStats = fseqCache.getStats();
                playbackStats.sequenceDecompress = {
                    decompressTime: getZstdStats().decompTime,
                    fileReadTime: fseqStats.fileReadTime,
                }
                send({ type: 'stats', stats: playbackStats });
                lastStatsUpdate += 1000 * Math.floor((curPerfNow - lastStatsUpdate) / 1000);
            }
            if (curPerfNow - lastPStatusUpdate >= 1000 && iteration % 4 === 1) {
                playbackStats.iteration = iteration;
                playbackStats.avgSendTime = avgFrameSendTime(playbackStatsAgg);
                playbackStats.measurementPeriod = curPerfNow - playbackStatsAgg.intervalStart;
                playbackStats.totalIdle = playbackStatsAgg.totalIdleTime;
                playbackStats.totalSend = playbackStatsAgg.totalSendTime;
                sendPlayerStateUpdate();
                playbackStats.maxSendTime = 0;
                resetFrameSendStats(playbackStatsAgg, curPerfNow);
                lastPStatusUpdate += 1000 * Math.floor((curPerfNow - lastPStatusUpdate) / 1000);
            }
            if (curPerfNow - lastNStatusUpdate >= 1000 && iteration % 4 === 2) {
                sendControllerStateUpdate();
                lastNStatusUpdate += 1000 * Math.floor((curPerfNow - lastNStatusUpdate) / 1000);
            }
            if (curPerfNow - lastRFUpdate >= 1000 && iteration % 4 === 3) {
                sendRemoteUpdate();
                lastRFUpdate += 1000 * Math.floor((curPerfNow - lastRFUpdate) / 1000);
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
                await sender.sendBlackFrame({targetFramePN});
                targetFramePN += playbackParams.idleSleepInterval;
                await sleepms(playbackParams.idleSleepInterval);
                continue;
            }
            const foregroundAction = upcomingForeground.curPLActions?.actions[0];
            // TODO: Something else here that accommodates background and other things
            if (isPaused || !foregroundAction?.seqId) {
                if (!isPaused) {
                    await sender.sendBlackFrame({targetFramePN});
                }
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
            targetFramePN = await sender.sendNextFrameAt({
                frame: frameRef?.ref,
                targetFramePN,
                targetFrameNum,
                playbackStats,
                playbackStatsAgg,
                frameInterval,
                skipFrameIfLateByMoreThan: playbackParams.skipFrameIfLateByMoreThan,
                dontSleepIfDurationLessThan: playbackParams.dontSleepIfDurationLessThan,
            });
        }
    }
    finally {
        sender.close();
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
