import * as path from 'path';
import fsp from 'fs/promises';
import { parentPort, workerData } from 'worker_threads';
import { type Transferable } from 'node:worker_threads';

import type {
    PlayerCommand,
    PlayWorkerRPCAPI,
    MainRPCAPI,
    WorkerToMainMessage,
    PlaybackWorkerData,
    ViewObject,
    LayoutSettings,
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
    PrefetchCacheStats,
    PlaybackStatistics,
    PlayingItem,
    PlayerPStatusContent,
    PlayerNStatusContent,
    PlaybackSettings,
    EZPlayerCommand,
} from '@ezplayer/ezplayer-core';
import {
    getActiveViewerControlSchedule,
    getActiveVolumeSchedule,
    LatestFrameRingBuffer,
    PlayerRunState,
} from '@ezplayer/ezplayer-core';

if (!parentPort) throw new Error('No parentPort in worker');

import {
    openControllersForDataSend,
    FSeqPrefetchCache,
    ModelRec,
    readControllersFromXlights,
    ControllerState,
    FrameReference,
    CacheStats,
    loadXmlFile,
    getNumAttrDef,
} from '@ezplayer/epp';

import { getAllModelCoordinates, GetNodeResult } from 'xllayoutcalcs';

import { buildInterleavedAudioChunkFromSegments, MP3PrefetchCache } from './mp3decodecache';
import { AsyncBatchLogger } from './logger';

import { performance } from 'perf_hooks';
import { startAsyncCounts, startELDMonitor, startGCLogging } from './perfmon';

import process from 'node:process';
import { avgFrameSendTime, FrameSender, OverallFrameSendStats, resetFrameSendStats } from './framesend';

import { decompressZStdWithWorker, getZstdStats, resetZstdStats } from './zstdparent';
import { setPingConfig, getLatestPingStats, stopPing } from './pingparent';

import { sendRFInitiateCheck, setRFConfig, setRFControlEnabled, setRFNowPlaying, setRFPlaylist } from './rfparent';
import { PlaylistSyncItem } from './rfsync';
import { randomUUID } from 'node:crypto';
import { getAttrDef, getBoolAttrDef, getElementByTag, XMLConstants } from '@ezplayer/epp';

//import { setThreadAffinity } from '../affinity/affinity.js';
//setThreadAffinity([3]);

// Helpful header for every line
function tag(msg: string) {
    const name = workerData?.name ?? 'unnamed';
    return `[worker ${name}] ${msg}`;
}

// Log lifecycle
console.info(tag('booting'));

// Catch truly fatal programming errors
process.on('uncaughtException', (err) => {
    console.error(tag('uncaughtException'), {
        name: err.name,
        message: err.message,
        stack: err.stack,
        cause: (err as any).cause,
    });
    // Ensure non-zero exit so main 'exit' handler knows it wasn't clean.
    process.exitCode = 1;
});

// Promote unhandled rejections to real failures (or at least log them)
process.on('unhandledRejection', (reason, _promise) => {
    console.error(tag('unhandledRejection'), { reason });
    process.exitCode = 1;
});

// When the event loop is about to go idle; good for final flushes
process.on('beforeExit', (code) => {
    console.warn(tag(`beforeExit code=${code}`));
});

// Always runs right before termination (even after uncaughtException)
process.on('exit', (code) => {
    console.warn(tag(`exit code=${code}`));
});

// Parent port lifecycle (closed if main thread dies or calls worker.terminate())
parentPort.on('close', () => {
    console.warn(tag('parentPort closed'));
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
    startGCLogging((l) => playLogger.log(l));
}

const logEventLoop = false;
if (logEventLoop) {
    startELDMonitor((l) => playLogger.log(l));
}

const logAsyncs = false;
if (logAsyncs) {
    startAsyncCounts();
}

const sleepms = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sleepUntil(dn: number) {
    const cur = Date.now();
    const st = Math.max(dn - cur, 0);
    await sleepms(st);
}

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
    stopPlayback: async (_args: {}) => {
        // Send black frame once as part of shutdown behavior
        isStopped = true;
        await stopPing(); // Cleanly shut down native pinger before exit
        return true;
    },
    getModelCoordinates: async (_args: {}) => {
        const coords: Record<string, GetNodeResult> = {};
        if (modelCoordinates) {
            for (const [name, coord] of modelCoordinates.entries()) {
                coords[name] = coord;
            }
        }
        return coords;
    },
    getModelCoordinates2D: async (_args: {}) => {
        const coords: Record<string, GetNodeResult> = {};
        if (modelCoordinates2D) {
            for (const [name, coord] of modelCoordinates2D.entries()) {
                coords[name] = coord;
            }
        }
        return coords;
    },
    getFrameExportBuffer: async () => {
        return frameExportBuffer;
    },
};

function playingItemDesc(item?: PlayAction) {
    if (!item?.seqId) return '<Unknown>';
    const nps = foregroundPlayerRunState.sequencesById.get(item.seqId);
    return `${nps?.work?.title} - ${nps?.work?.artist}${nps?.sequence?.vendor ? ' - ' + nps?.sequence?.vendor : ''}`;
}

// TODO: Should this move to the run state?
function actionToPlayingItem(interactive: boolean, pla: PlayAction) {
    return {
        type: interactive ? 'Immediate' : 'Scheduled',
        item: 'Song', // TODO
        title: playingItemDesc(pla),
        sequence_id: pla.seqId,
        at: pla.atTime,
        until: pla.atTime + (pla.durationMS ?? 0),
    } as PlayingItem;
}

function sendPlayerStateUpdate() {
    const ps = foregroundPlayerRunState.getUpcomingItems(600_000, 24 * 3600 * 1000);
    const playStatus: PlayerPStatusContent = {
        ptype: 'EZP',
        status: 'Stopped',
        reported_time: Date.now(),
        upcoming: [],
        volume: {
            level: volume,
            muted,
        },
    };
    if (ps.curPLActions?.actions?.length) {
        for (const pla of ps.curPLActions.actions) {
            if (pla.end) continue;
            if (!playStatus.now_playing) {
                playStatus.now_playing = actionToPlayingItem(false, pla);
                playStatus.status = isPaused ? 'Paused' : 'Playing';
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
    cstatus.n_channels = Math.max(
        ...(controllerStates ?? []).map((e: ControllerState) => e.setup.startCh + e.setup.nCh),
    );
    for (const c of controllerStates ?? []) {
        const pstat = stats.stats?.[c.setup.address];
        const pss = pstat ? `${pstat.nReplies} out of ${pstat.outOf} pings` : '';
        const connectivity = !c.setup.usable ? 'N/A' : !pstat?.outOf ? 'Pending' : pstat.nReplies > 0 ? 'Up' : 'Down';
        cstatus.controllers?.push({
            name: c.setup.name,
            description: c.xlRecord?.description,
            type: c.xlRecord?.type,
            proto: c.setup.proto,
            protoDetails: '',
            model: `${c.xlRecord?.vendor} ${c.xlRecord?.model} ${c.xlRecord?.variant}`,
            address: c.setup.address,
            state: c.xlRecord?.activeState,
            status: c.setup.skipped ? 'skipped' : c.setup.usable ? c.report?.status : 'unusable',
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
    } else {
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
    const pl = curPlaylists?.find((p) => p.title.toLowerCase() === rfStat?.playlist.toLowerCase());
    const items: PlaylistSyncItem[] = [];
    if (pl) {
        for (const i of pl.items) {
            const s = foregroundPlayerRunState.sequencesById.get(i.id);
            if (!s) continue;
            items.push({
                playlistType: 'SEQUENCE',
                playlistDuration: s.work.length,
                playlistIndex: i.sequence,
                playlistName: `${s.work.title} - ${s.work.artist}${s.sequence?.vendor ? ' - ' + s.sequence.vendor : ''}`,
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
    } else {
        const dn = Date.now();
        if (dn - lastRFCheck > 5000) {
            lastRFCheck = dn;
            //emitInfo("Initiate idle RF check");
            sendRFInitiateCheck();
        }
    }
}

let lastVolCheck: number = Date.now();
function doVolumeAdjust(dn: number) {
    if (dn - lastVolCheck < 10) return;
    lastVolCheck = dn;
    const settings = latestSettings;
    if (!settings || !settings.volumeControl) {
        return;
    }
    const volsched = getActiveVolumeSchedule(settings.volumeControl);
    let tgtvol = settings.volumeControl.defaultVolume ?? 100;
    if (volsched) {
        tgtvol = volsched.volumeLevel;
    }

    // Change 1% at a time toward target
    if (tgtvol > volume) ++volume;
    if (tgtvol < volume) --volume;
    volumeSF = muted ? 0 : volume / 100;
}

/////////
// Inbound messages
function processCommand(cmd: EZPlayerCommand) {
    switch (cmd.command) {
        case 'playsong':
            {
                emitInfo(`PLAY CMD: ${cmd?.command}: ${cmd?.songId}`);
                const seq = curSequences?.find((s) => s.id === cmd.songId);
                if (!seq) {
                    emitError(`Unable to identify sequence ${cmd.songId}`);
                    return false;
                }
                const startTime = foregroundPlayerRunState.currentTime + playbackParams.interactiveCommandPrefetchDelay;
                foregroundPlayerRunState.addInteractiveCommand({
                    immediate: cmd.immediate,
                    requestId: cmd.requestId,
                    startTime,
                    seqId: cmd.songId,
                });

                if (cmd.immediate) {
                    audioPlayerRunTime = Math.min(audioPlayerRunTime, startTime); // Possibly overlap audio
                }

                emitInfo(`Enqueue: Current length ${foregroundPlayerRunState.interactiveQueue.length}`);
                sendPlayerStateUpdate();
                if (!running) {
                    running = processQueue(); // kick off first song
                }
            }
            break;
        case 'endsong': {
            emitInfo('Skip command received');
            foregroundPlayerRunState.skipCurrentSequence(cmd.songId, foregroundPlayerRunState.currentTime);
            audioPlayerRunTime = foregroundPlayerRunState.currentTime;
            ++curAudioSyncNum;
            break;
        }
        case 'deleterequest': {
            emitInfo(`Delete ${cmd.requestId}`);
            foregroundPlayerRunState.removeInteractiveCommand(cmd.requestId);
            break;
        }
        case 'clearrequests': {
            foregroundPlayerRunState.removeInteractiveCommands();
            break;
        }
        case 'setvolume': {
            if (cmd?.volume !== undefined) {
                volume = cmd.volume;
            }
            if (cmd.mute !== undefined) {
                muted = cmd.mute;
            }
            volumeSF = muted ? 0 : volume / 100;
            break;
        }
        case 'pause': {
            if (!isPaused) {
                isPaused = true;
                foregroundPlayerRunState.pause(foregroundPlayerRunState.currentTime);
                ++curAudioSyncNum;
                sendPlayerStateUpdate();
                emitInfo('Paused');
            }
            break;
        }
        case 'resume': {
            if (isPaused) {
                isPaused = false;
                foregroundPlayerRunState.resume(targetFrameRTC);
                audioPlayerRunTime = foregroundPlayerRunState.currentTime;
                ++curAudioSyncNum;
                sendPlayerStateUpdate();
                emitInfo('Resumed');
            }
            break;
        }
        case 'resetstats': {
            resetCumulativeCounters();
            break;
        }
        case 'activateoutput':
            break;
        case 'suppressoutput':
            break;
        case 'playplaylist':
            break;
        case 'reloadcontrollers':
            break;
        case 'resetplayback':
            break;
        case 'stopgraceful': {
            emitInfo('Stop graceful command received');
            foregroundPlayerRunState.stopGracefully(foregroundPlayerRunState.currentTime);
            sendPlayerStateUpdate();
            break;
        }
        case 'stopnow': {
            emitInfo('Stop now command received');
            foregroundPlayerRunState.stopImmediately(foregroundPlayerRunState.currentTime);
            audioPlayerRunTime = foregroundPlayerRunState.currentTime;
            ++curAudioSyncNum;
            sendPlayerStateUpdate();
            break;
        }
    }
}

parentPort.on('message', async (command: PlayerCommand) => {
    switch (command.type) {
        case 'schedupdate': {
            pendingSchedule = command;
            const folderChanged =
                command.showFolder &&
                command.showFolder !== '<no show folder yet>' &&
                command.showFolder !== showFolder;

            if (command.showFolder && command.showFolder !== '<no show folder yet>') {
                showFolder = command.showFolder;
            }

            if (folderChanged) {
                // Load XML coordinates eagerly — resolve all file paths,
                // parse models, and push data to the server worker NOW so
                // that none of this work happens during playback.
                try {
                    await loadXmlCoordinates();
                } catch (err) {
                    emitError(`[Worker Message] Failed to load XML coordinates: ${err}`);
                }

                // If processQueue is already running we need to restart it
                // so it re-reads controllers and reallocates the frame buffer
                // for the new show.
                if (running) {
                    shouldRestart = true;
                    await running; // wait for loop to exit
                    running = undefined;
                }
            }

            if (!running) {
                shouldRestart = false;
                running = processQueue();
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

send({ type: 'ready' });

const rpcs = new RPCServer<PlayWorkerRPCAPI>(parentPort, handlers);
const rpcc = new RPCClient<MainRPCAPI>(parentPort);

///////
// Playback params
const playbackParams = {
    audioTimeAdjMs: 0, // If > 0, push music into future; if < 0, pull it in
    sendAudioInAdvanceMs: 200,
    sendAudioChunkMs: 100, // Should be a multiple of 10 because of 44100kHz
    mp3CacheSeconds: 3600, // We reuse the memory in ~5s chunks
    audioPrefetchTime: 24 * 3600 * 1000,
    maxAudioPrefetchItems: 100,
    fseqSpace: 1_000_000_000,
    idleSleepInterval: 200,
    interactiveCommandPrefetchDelay: 500,
    timePollInterval: 200,
    scheduleLoadTime: 25 * 3600 * 1000,
    foregroundFseqPrefetchTime: 2 * 1000,
    backgroundFseqPrefetchTime: 2 * 1000,
    dontSleepIfDurationLessThan: 2,
    skipFrameIfLateByMoreThan: 5,
};

let latestSettings: PlaybackSettings | undefined = undefined;

function dispatchSettings(settings: PlaybackSettings) {
    latestSettings = settings;
    const nasa = settings.audioSyncAdjust ?? 0;
    if (nasa != playbackParams.audioTimeAdjMs) {
        playbackParams.audioTimeAdjMs = nasa;
        ++curAudioSyncNum;
    }
    setRFConfig(
        {
            remoteToken: settings.viewerControl.remoteFalconToken,
        },
        (next) => {
            const settings = latestSettings;
            if (!settings) return;
            const rfc = getActiveViewerControlSchedule(settings.viewerControl);
            if (!rfc) return;
            const pl = curPlaylists?.find((pl) => pl.title.toLowerCase() === rfc?.playlist.toLowerCase());
            if (!pl) return;
            const s = pl.items.find((seq) => seq.sequence === next.playlistIndex);
            if (!s) return;
            processCommand({
                command: 'playsong',
                immediate: false,
                songId: s.id,
                requestId: randomUUID(),
                priority: 3,
            });
        },
    );
}

////////
// Playback stats
const playbackStats: PlaybackStatistics = {
    iteration: 0,
    sentFramesCumulative: 0,
    worstLagHistorical: 0,
    worstAdvanceHistorical: 0,
    avgSendTime: 0,
    maxSendTimeHistorical: 0,
    missedFramesCumulative: 0,
    missedHeadersCumulative: 0,
    skippedFramesCumulative: 0,
    missedBackgroundFramesCumulative: 0,
    framesSkippedDueToManyOutstandingFramesCumulative: 0,
    sentAudioChunksCumulative: 0,
    skippedAudioChunksCumulative: 0,
    cframesSkippedDueToDirectiveCumulative: 0,
    cframesSkippedDueToIncompletePriorCumulative: 0,
    lastError: undefined as string | undefined,

    measurementPeriod: 0,
    idleTimePeriod: 0,
    sendTimePeriod: 0,

    audioDecode: {
        fileReadTimeCumulative: 0,
        decodeTimeCumulative: 0,
    },

    // Sequence Decompress
    sequenceDecompress: {
        fileReadTimeCumulative: 0,
        decompressTimeCumulative: 0,
    },

    // Effects Processing
    effectsProcessing: {
        backgroundBlendTimePeriod: 0,
    },
};

function resetCumulativeCounters() {
    playbackStats.iteration = 0;
    playbackStats.worstAdvanceHistorical = 0;
    playbackStats.worstLagHistorical = 0;
    playbackStats.maxSendTimeHistorical = 0;

    playbackStats.missedHeadersCumulative = 0;
    playbackStats.missedBackgroundFramesCumulative = 0;
    playbackStats.missedFramesCumulative = 0;

    playbackStats.sentFramesCumulative = 0;
    playbackStats.skippedFramesCumulative = 0;
    playbackStats.framesSkippedDueToManyOutstandingFramesCumulative = 0;

    playbackStats.cframesSkippedDueToDirectiveCumulative = 0;
    playbackStats.cframesSkippedDueToIncompletePriorCumulative = 0;

    playbackStats.sentAudioChunksCumulative = 0;
    playbackStats.skippedAudioChunksCumulative = 0;

    playbackStats.lastError = undefined;

    resetZstdStats();

    // Temp diagnostic
    const fsstats = fseqCache?.getStats();
    emitInfo(`Logging out the FSEQ backing pool...`);
    if (fsstats) {
        for (const dpi of fsstats.decompPool) {
            emitInfo(
                `Decomp Pool: size: ${dpi.size}, count: ${dpi.total}, used: ${dpi.inUse}; ${dpi.size * dpi.total} footprint`,
            );
        }
    }
    fseqCache?.resetStats();
    mp3Cache?.resetStats();
}

const playbackStatsAgg: OverallFrameSendStats = {
    nSends: 0,
    intervalStart: 0,
    totalSendTime: 0,
    totalIdleTime: 0,
    totalMixTime: 0,
};

///////
// Clockkeeping
const rtcConverter = new ClockConverter('mrtc', 0, performance.now());

const _pollTimes = setInterval(async () => {
    const pn = performance.now();
    const realTime = Date.now();
    rtcConverter.addSample(realTime, pn);
}, playbackParams.timePollInterval);

///////
// The actual variables here
let showFolder: string | undefined = undefined;
let isPaused = false;
let volume = 100;
let muted = false;
let curAudioSyncNum = 1;
let pendingSchedule: PlayerCommand | undefined = undefined;
let curSequences: SequenceRecord[] | undefined = undefined;
let curPlaylists: PlaylistRecord[] | undefined = undefined;
let curSchedule: ScheduledPlaylist[] | undefined = undefined;
let modelRecs: ModelRec[] | undefined = undefined;
let controllerStates: ControllerState[] | undefined = undefined;
let modelCoordinates: Map<string, GetNodeResult> | undefined = undefined;
let modelCoordinates2D: Map<string, GetNodeResult> | undefined = undefined;

let viewObjects: ViewObject[] = [];
let layoutSettings: LayoutSettings = {};

let backgroundPlayerRunState: PlayerRunState = new PlayerRunState(Date.now());
let foregroundPlayerRunState: PlayerRunState = new PlayerRunState(Date.now());
// Separate time (within foregroundPlayerRunState)... we will front-run the audio a bit.
//  Audio up to this time has already been sent out.
//  If you send this back in time (say to pick up the start of an immediate play) audio will overlap.  C'est la vie.
let audioPlayerRunTime: number = foregroundPlayerRunState.currentTime;
let targetFrameRTC: number = foregroundPlayerRunState.currentTime;

let volumeSF = 1.0; // Most representations are 0-100, not this one

// Thread-safe stop flag to prevent further frame sending after stop
let isStopped = false;
// Set when the show folder changes while processQueue is running.
// processQueue detects this, breaks out of its loop, and the handler
// starts a fresh processQueue that reinitializes controllers & frame buffer.
let shouldRestart = false;

let mp3Cache: MP3PrefetchCache | undefined = undefined;
let fseqCache: FSeqPrefetchCache | undefined = undefined;

/////
// Update time variables
let lastPRSSchedUpdate: number = 0;

////////
// Build a filename index of the show folder tree in a single pass.
// Returns a Map from lowercase filename to show-folder-relative path (forward slashes).
// When multiple files share the same name, the shallowest one wins.
////////
async function buildShowFolderIndex(
    folder: string,
    maxDepth = 5,
): Promise<Map<string, string>> {
    const index = new Map<string, string>();

    async function scan(dir: string, depth: number): Promise<void> {
        if (depth > maxDepth) return;
        let entries: import('fs').Dirent[];
        try {
            entries = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        const subdirs: string[] = [];
        for (const entry of entries) {
            if (entry.isFile()) {
                const key = entry.name.toLowerCase();
                // Shallowest wins — don't overwrite if already found at a higher level
                if (!index.has(key)) {
                    const abs = path.join(dir, entry.name);
                    index.set(key, path.relative(folder, abs).replace(/\\/g, '/'));
                }
            } else if (entry.isDirectory()) {
                subdirs.push(path.join(dir, entry.name));
            }
        }
        // Recurse into subdirectories (breadth-first by level)
        for (const sub of subdirs) {
            await scan(sub, depth + 1);
        }
    }

    await scan(folder, 0);
    return index;
}

/**
 * Resolve a file path from the XML to a show-folder-relative path.
 * If the path is already relative, normalises slashes and returns it.
 * If absolute and inside the show folder, strips the prefix.
 * Otherwise looks up the basename in the pre-built file index.
 */
function resolveFilePathFromIndex(
    filePath: string,
    resolvedShow: string,
    fileIndex: Map<string, string>,
): string | undefined {
    if (!path.isAbsolute(filePath)) {
        return filePath.replace(/\\/g, '/');
    }
    const resolvedFile = path.resolve(filePath);
    if (
        resolvedFile.toLowerCase().startsWith(resolvedShow.toLowerCase() + path.sep.toLowerCase()) ||
        resolvedFile.toLowerCase() === resolvedShow.toLowerCase()
    ) {
        return path.relative(resolvedShow, resolvedFile).replace(/\\/g, '/');
    }
    // Fall back to index lookup by basename
    const basename = path.basename(filePath);
    return fileIndex.get(basename.toLowerCase());
}

////////
// Load XML coordinates independently (can be called before processQueue)
////////
async function loadXmlCoordinates() {
    if (!showFolder) {
        emitWarning(`[loadXmlCoordinates] showFolder not set, skipping XML load`);
        return;
    }

    const xmlPath = path.join(showFolder, `xlights_rgbeffects.xml`);
    const netPath = path.join(showFolder, `xlights_networks.xml`);

    let xrgb;
    let xnet;
    try {
        xrgb = await loadXmlFile(xmlPath);
        xnet = await loadXmlFile(netPath);
    } catch (err) {
        emitError(`[loadXmlCoordinates] Failed to load XML file: ${err}`);
        xrgb = null;
        xnet = null;
    }

    modelCoordinates = new Map<string, GetNodeResult>();
    modelCoordinates2D = new Map<string, GetNodeResult>();

    if (xrgb && xnet) {
        const gmc2d = getAllModelCoordinates(xrgb, xnet, true);
        const gmc3d = getAllModelCoordinates(xrgb, xnet, false);

        if (xrgb.documentElement.tagName !== 'xrgb') {
            emitError(`[loadXmlCoordinates] XML root element is not 'xrgb', got: ${xrgb.documentElement.tagName}`);
        } else {
            try {
                const xmodels = getElementByTag(xrgb.documentElement, 'models');

                let activeModelCount = 0;
                let processedModelCount = 0;

                for (let im = 0; im < xmodels.childNodes.length; ++im) {
                    const n = xmodels.childNodes[im];
                    if (n.nodeType !== XMLConstants.ELEMENT_NODE) continue;
                    const model = n as Element;
                    if (model.tagName !== 'model') continue;

                    const name = getAttrDef(model, 'name', '');
                    const active = getBoolAttrDef(model, 'Active', true);

                    processedModelCount++;

                    if (!active) {
                        continue;
                    }

                    activeModelCount++;
                    try {
                        // Get 3D coordinates (for 3D viewer)
                        const nr3d = gmc3d.models.get(name)?.nodeResult;
                        if (nr3d) {
                            modelCoordinates.set(name, nr3d);
                        }

                        // Get 2D coordinates (for 2D viewer with perspective projection)
                        const nr2d = gmc2d.models.get(name)?.nodeResult;
                        if (nr2d) {
                            modelCoordinates2D.set(name, nr2d);
                        }
                    } catch (coordErr) {
                        emitError(`[loadXmlCoordinates] Error extracting coordinates for "${name}": ${coordErr}`);
                    }
                }

                emitInfo(
                    `[loadXmlCoordinates] Loaded ${modelCoordinates.size} models with 3D coordinates and ${modelCoordinates2D.size} models with 2D coordinates`,
                );
            } catch (parseErr) {
                emitError(`[loadXmlCoordinates] Error parsing models element: ${parseErr}`);
            }

            // Build a file index of the show folder tree once, up front.
            // This replaces N separate recursive directory scans with a single pass.
            const resolvedShow = showFolder ? path.resolve(showFolder) : '';
            let fileIndex = new Map<string, string>();
            if (resolvedShow) {
                try {
                    fileIndex = await buildShowFolderIndex(resolvedShow);
                    emitInfo(`[loadXmlCoordinates] Built file index: ${fileIndex.size} files`);
                } catch (indexErr) {
                    emitWarning(`[loadXmlCoordinates] Failed to build file index: ${indexErr}`);
                }
            }

            // Parse view_objects (meshes like house models)
            try {
                const xviewObjects = getElementByTag(xrgb.documentElement, 'view_objects');
                viewObjects = [];

                if (xviewObjects) {
                    for (let iv = 0; iv < xviewObjects.childNodes.length; ++iv) {
                        const n = xviewObjects.childNodes[iv];
                        if (n.nodeType !== XMLConstants.ELEMENT_NODE) continue;
                        const viewObj = n as Element;
                        if (viewObj.tagName !== 'view_object') continue;

                        const name = getAttrDef(viewObj, 'name', '');
                        const displayAs = getAttrDef(viewObj, 'DisplayAs', '');
                        const objFile = getAttrDef(viewObj, 'ObjFile', '');
                        const active = getBoolAttrDef(viewObj, 'Active', true);

                        // Process Mesh objects with OBJ files
                        if (displayAs === 'Mesh' && objFile && active) {
                            // Parse transform attributes
                            const worldPosX = parseFloat(getAttrDef(viewObj, 'WorldPosX', '0'));
                            const worldPosY = parseFloat(getAttrDef(viewObj, 'WorldPosY', '0'));
                            const worldPosZ = parseFloat(getAttrDef(viewObj, 'WorldPosZ', '0'));
                            const scaleX = parseFloat(getAttrDef(viewObj, 'ScaleX', '1'));
                            const scaleY = parseFloat(getAttrDef(viewObj, 'ScaleY', '1'));
                            const scaleZ = parseFloat(getAttrDef(viewObj, 'ScaleZ', '1'));
                            const rotateX = parseFloat(getAttrDef(viewObj, 'RotateX', '0'));
                            const rotateY = parseFloat(getAttrDef(viewObj, 'RotateY', '0'));
                            const rotateZ = parseFloat(getAttrDef(viewObj, 'RotateZ', '0'));

                            let brightness = getNumAttrDef(viewObj, 'Brightness', 100);

                            const resolvedObjFile = resolveFilePathFromIndex(objFile, resolvedShow, fileIndex);
                            if (!resolvedObjFile) {
                                emitWarning(`[loadXmlCoordinates] Could not resolve "${objFile}" for view object "${name}"`);
                                continue;
                            }

                            viewObjects.push({
                                name,
                                displayAs,
                                objFile: resolvedObjFile,
                                worldPosX,
                                worldPosY,
                                worldPosZ,
                                scaleX,
                                scaleY,
                                scaleZ,
                                rotateX,
                                rotateY,
                                rotateZ,
                                brightness,
                                active,
                            });
                        } else if (displayAs === 'Image' && active) {
                            // Process Image view objects (textured planes)
                            const imageFile = getAttrDef(viewObj, 'Image', '');
                            if (!imageFile) continue;

                            const transparency = parseFloat(getAttrDef(viewObj, 'Transparency', '0'));

                            const worldPosX = parseFloat(getAttrDef(viewObj, 'WorldPosX', '0'));
                            const worldPosY = parseFloat(getAttrDef(viewObj, 'WorldPosY', '0'));
                            const worldPosZ = parseFloat(getAttrDef(viewObj, 'WorldPosZ', '0'));
                            const scaleX = parseFloat(getAttrDef(viewObj, 'ScaleX', '1'));
                            const scaleY = parseFloat(getAttrDef(viewObj, 'ScaleY', '1'));
                            const scaleZ = parseFloat(getAttrDef(viewObj, 'ScaleZ', '1'));
                            const rotateX = parseFloat(getAttrDef(viewObj, 'RotateX', '0'));
                            const rotateY = parseFloat(getAttrDef(viewObj, 'RotateY', '0'));
                            const rotateZ = parseFloat(getAttrDef(viewObj, 'RotateZ', '0'));

                            let brightness = getNumAttrDef(viewObj, 'Brightness', 100);

                            const resolvedImageFile = resolveFilePathFromIndex(imageFile, resolvedShow, fileIndex);
                            if (!resolvedImageFile) {
                                emitWarning(`[loadXmlCoordinates] Could not resolve image "${imageFile}" for view object "${name}"`);
                                continue;
                            }

                            viewObjects.push({
                                name,
                                displayAs,
                                imageFile: resolvedImageFile,
                                worldPosX,
                                worldPosY,
                                worldPosZ,
                                scaleX,
                                scaleY,
                                scaleZ,
                                rotateX,
                                rotateY,
                                rotateZ,
                                brightness,
                                transparency: isNaN(transparency) ? 0 : transparency,
                                active,
                            });
                        }
                    }
                }

                emitInfo(`[loadXmlCoordinates] Loaded ${viewObjects.length} view objects (meshes + images)`);
            } catch (parseErr) {
                emitError(`[loadXmlCoordinates] Error parsing view_objects element: ${parseErr}`);
            }

            // Parse layout <settings> element (backgroundImage, previewWidth, etc.)
            try {
                const xsettings = getElementByTag(xrgb.documentElement, 'settings');
                layoutSettings = {};

                if (xsettings) {
                    for (let is = 0; is < xsettings.childNodes.length; ++is) {
                        const n = xsettings.childNodes[is];
                        if (n.nodeType !== XMLConstants.ELEMENT_NODE) continue;
                        const el = n as Element;
                        const val = getAttrDef(el, 'value', '');
                        if (!val) continue;

                        switch (el.tagName) {
                            case 'backgroundImage': {
                                const resolved = resolveFilePathFromIndex(val, resolvedShow, fileIndex);
                                if (resolved) {
                                    layoutSettings.backgroundImage = resolved;
                                } else {
                                    emitWarning(`[loadXmlCoordinates] Could not resolve backgroundImage "${val}"`);
                                }
                                break;
                            }
                            case 'backgroundBrightness':
                                layoutSettings.backgroundBrightness = parseInt(val, 10);
                                break;
                            case 'previewWidth':
                                layoutSettings.previewWidth = parseInt(val, 10);
                                break;
                            case 'previewHeight':
                                layoutSettings.previewHeight = parseInt(val, 10);
                                break;
                        }
                    }

                    if (layoutSettings.backgroundImage) {
                        emitInfo(`[loadXmlCoordinates] Layout settings: bg="${layoutSettings.backgroundImage}" brightness=${layoutSettings.backgroundBrightness} preview=${layoutSettings.previewWidth}x${layoutSettings.previewHeight}`);
                    }
                }
            } catch (parseErr) {
                emitError(`[loadXmlCoordinates] Error parsing settings element: ${parseErr}`);
            }
        }
    }

    // Push loaded coordinates to main thread so server worker cache stays current
    const coords3D: Record<string, GetNodeResult> = {};
    for (const [name, coord] of modelCoordinates.entries()) {
        coords3D[name] = coord;
    }
    const coords2D: Record<string, GetNodeResult> = {};
    for (const [name, coord] of modelCoordinates2D.entries()) {
        coords2D[name] = coord;
    }
    send({ type: 'modelCoordinates', coords3D, coords2D, viewObjects, layoutSettings });
}

let frameExportBuffer: SharedArrayBuffer | undefined = undefined;
let frameExportRing: LatestFrameRingBuffer | undefined = undefined;

////////
// Actual logic loops
////////
async function processQueue() {
    if (!showFolder && pendingSchedule?.type === 'schedupdate') {
        showFolder = pendingSchedule.showFolder;
    }

    if (!showFolder) {
        emitError(`[processQueue] showFolder is not set! Cannot proceed.`);
        return;
    }

    if (!mp3Cache) {
        mp3Cache = new MP3PrefetchCache({
            log: emitInfo,
            now: rtcConverter.computeTime(performance.now()),
            mp3SpaceSeconds: playbackParams.mp3CacheSeconds,
        });
    }

    if (!fseqCache) {
        fseqCache = new FSeqPrefetchCache(
            {
                now: performance.now(),
                fseqSpace: playbackParams.fseqSpace,
                decompZstd: decompressZStdWithWorker,
            },
            emitError,
        );
    }

    const sender: FrameSender = new FrameSender();
    sender.emitError = (e) => emitError(e.message);
    sender.emitWarning = emitWarning;

    try {
        const { controllers, models } = await readControllersFromXlights(showFolder!);

        // Load XML coordinates if not already loaded
        if (!modelCoordinates || modelCoordinates.size === 0) {
            await loadXmlCoordinates();
        }

        const sendJob = await openControllersForDataSend(controllers);
        setPingConfig({
            hosts: controllers.filter((c) => c.setup.usable).map((c) => c.setup.address),
            concurrency: 10,
            maxSamples: 10,
            intervalS: 5,
        });
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
            emitInfo(
                `Setup: ${cs.usable ? 'Usable' : 'Unusable'} ${cs.name} - ${cs.address} - ${cs?.proto} - ${cs?.nCh}@${cs?.startCh}; ${c.sender?.minFrameTime()} ms frame time`,
            );
            emitInfo(`Status: ${r?.name}: ${r?.status}(${r?.error})`);
            emitInfo('');
        }
        const nChannels = Math.max(...(controllers ?? []).map((e) => e.setup.startCh + e.setup.nCh));
        sender.nChannels = nChannels;
        sender.blackFrame = new Uint8Array(nChannels);
        sender.mixFrame = new Uint8Array(nChannels);
        frameExportBuffer = LatestFrameRingBuffer.allocate(nChannels, 4, true) as SharedArrayBuffer;
        frameExportRing = new LatestFrameRingBuffer({
            buffer: frameExportBuffer,
            frameSize: nChannels,
            slotCount: 4,
            isWriter: true,
        });
        sender.exportBuffer = frameExportRing;
        send({ type: 'pixelbuffer', buffer: frameExportBuffer });
    } catch (e) {
        const err = e as Error;
        emitError(`[processQueue] CRITICAL ERROR in processQueue: ${err.message}`);
        emitError(`[processQueue] Error name: ${err.name}`);
        emitError(`[processQueue] Error stack: ${err.stack}`);
        console.error(`[processQueue] Full error object:`, e);
        playbackStats.lastError = err.message;
    }

    emitInfo(`Player running`);

    let iteration = -1;

    // We have a conceptual real time that we follow; this typically follows RTC.
    //  But we use perf.now() to get times because it is higher resolution
    // The schedule time is kept in the player run states
    const initialPN = performance.now();
    const initialRTC = rtcConverter.computeTime(initialPN);

    targetFrameRTC = initialRTC;

    let lastStatsUpdatePN = initialPN;
    let lastPStatusUpdatePN = initialPN;
    let lastNStatusUpdatePN = initialPN;
    let lastRFUpdatePN = initialPN;

    try {
        while (true) {
            // Check if playback has been stopped - exit loop to prevent further frame sending
            if (isStopped) {
                await sleepms(60); // TODO clean shutdown
                sender?.sendBlackFrame({ targetFramePN: rtcConverter.computePerfNow(targetFrameRTC) });
                emitInfo('Playback stopped - exiting playback loop');
                break;
            }

            // Show folder changed — break so the handler can start a fresh
            // processQueue with new controllers and frame buffer.
            if (shouldRestart) {
                emitInfo('Show folder changed - restarting processQueue');
                break;
            }

            ++iteration;

            const curPN = performance.now();

            if (curPN - lastStatsUpdatePN >= 1000 && iteration % 4 === 0) {
                function toCacheStat(s: CacheStats): PrefetchCacheStats {
                    return {
                        totalItems: s.totalItems,
                        referencedItems: s.referencedItems,
                        readyItems: s.readyItems,
                        pendingItems: s.pendingItems,
                        errorItems: s.erroredItems,
                        inProgressItems: s.fetchesInProgress,

                        budget: s.totalBudgetLimit,
                        used: s.prefetchBudgetUsed + s.cacheBudgetUsed,

                        refHitsCumulative: s.refHits,
                        refMissesCumulative: s.refMisses,
                        expiredItemsCumulative: s.expiredItems,
                        evictedItemsCumulative: s.evictedItems,

                        completedRequestsCumulative: s.completedRequests,
                        erroredRequestsCumulative: s.erroredRequests,
                    };
                }
                const astat = mp3Cache.getStats();
                playbackStats.audioDecode = {
                    fileReadTimeCumulative: astat.fileReadTimeCumulative,
                    decodeTimeCumulative: astat.decodeTimeCumulative,
                };
                playbackStats.audioPrefetch = { decodeCache: toCacheStat(astat.mp3Prefetch) };
                const fseqStats = fseqCache.getStats();
                playbackStats.sequenceDecompress = {
                    decompressTimeCumulative: getZstdStats().decompTime,
                    fileReadTimeCumulative: fseqStats.fileReadTimeCumulative,
                };
                playbackStats.fseqPrefetch = {
                    totalMem: fseqStats.totalDecompMem,
                    headerCache: toCacheStat(fseqStats.headerPrefetch),
                    chunkCache: toCacheStat(fseqStats.decompPrefetch),
                };
                playbackStats.effectsProcessing = {
                    backgroundBlendTimePeriod: playbackStatsAgg.totalMixTime,
                };
                send({ type: 'stats', stats: playbackStats });
                lastStatsUpdatePN += 1000 * Math.floor((curPN - lastStatsUpdatePN) / 1000);
            }
            if (curPN - lastPStatusUpdatePN >= 1000 && iteration % 4 === 1) {
                playbackStats.iteration = iteration;
                playbackStats.avgSendTime = avgFrameSendTime(playbackStatsAgg);
                playbackStats.measurementPeriod = curPN - playbackStatsAgg.intervalStart;
                playbackStats.idleTimePeriod = playbackStatsAgg.totalIdleTime;
                playbackStats.sendTimePeriod = playbackStatsAgg.totalSendTime;
                sendPlayerStateUpdate();
                playbackStats.maxSendTimeHistorical = 0;
                resetFrameSendStats(playbackStatsAgg, curPN);
                lastPStatusUpdatePN += 1000 * Math.floor((curPN - lastPStatusUpdatePN) / 1000);
            }
            if (curPN - lastNStatusUpdatePN >= 1000 && iteration % 4 === 2) {
                sendControllerStateUpdate();
                lastNStatusUpdatePN += 1000 * Math.floor((curPN - lastNStatusUpdatePN) / 1000);
            }
            if (iteration % 4 === 3) {
                doVolumeAdjust(Date.now());
                if (curPN - lastRFUpdatePN >= 1000) {
                    sendRemoteUpdate();
                    lastRFUpdatePN += 1000 * Math.floor((curPN - lastRFUpdatePN) / 1000);
                }
            }

            // See if a schedule update has been passed in.  If so, do something.
            if (installNewSchedule()) {
                emitInfo(`New schedule installed`);
                const initializeTime = rtcConverter.computeTime(curPN); // MoC - Review
                const preserveFGFseqTime = foregroundPlayerRunState?.currentTime || initializeTime;
                const preserveBGFseqTime = backgroundPlayerRunState?.currentTime || initializeTime;
                foregroundPlayerRunState = new PlayerRunState(initializeTime);
                backgroundPlayerRunState = new PlayerRunState(initializeTime);
                const errs: string[] = [];
                foregroundPlayerRunState.setUpSequences(
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
                    initializeTime,
                    initializeTime + playbackParams.scheduleLoadTime,
                );
                backgroundPlayerRunState.addTimeRangeToSchedule(
                    initializeTime,
                    initializeTime + playbackParams.scheduleLoadTime,
                );

                lastPRSSchedUpdate = initializeTime + playbackParams.scheduleLoadTime;
                if (errs.length) {
                    emitError(`New schedule install errors: ${errs.join('\n')}`);
                }

                // Make these caught up to the correct times from the last trip through...
                foregroundPlayerRunState.runUntil(preserveFGFseqTime);
                backgroundPlayerRunState.runUntil(preserveBGFseqTime);

                sendPlayerStateUpdate();
            }

            // Make sure we see a day in advance
            if (lastPRSSchedUpdate < targetFrameRTC + (playbackParams.scheduleLoadTime * 24) / 25) {
                foregroundPlayerRunState.addTimeRangeToSchedule(
                    lastPRSSchedUpdate,
                    targetFrameRTC + playbackParams.scheduleLoadTime,
                );
                backgroundPlayerRunState.addTimeRangeToSchedule(
                    lastPRSSchedUpdate,
                    targetFrameRTC + playbackParams.scheduleLoadTime,
                );
                lastPRSSchedUpdate = targetFrameRTC + playbackParams.scheduleLoadTime;
            }

            // TODO: Divvy up the tasks so they are not all on each iteration: music, fseq, bg, status update to FE
            const doAudioPrefetch = true;
            const doFseqPrefetch = true;

            if (doAudioPrefetch) {
                // Issue MP3 prefetches
                function prefetchActionMedia(actions?: PlaybackActions) {
                    if (!actions) return;

                    for (const action of actions?.actions ?? []) {
                        if (action.atTime > targetFrameRTC + playbackParams.audioPrefetchTime) break;
                        if (action.end) continue;

                        if (action.seqId) {
                            emitAudioDebug(`Do prefetch of ${action.seqId}`);
                            const seq = foregroundPlayerRunState.sequencesById.get(action.seqId);
                            let saf = seq?.files?.audio;
                            if (saf && !path.isAbsolute(saf)) saf = path.join(showFolder!, saf);
                            if (saf) {
                                emitAudioDebug(`Prefetch Audio ${saf}`);
                                mp3Cache!.prefetchMP3({
                                    mp3file: saf,
                                    needByTime: action.atTime,
                                    neededThroughTime: action.atTime + (action.durationMS ?? 600000),
                                    expiry: targetFrameRTC + 7 * 24 * 3600_000,
                                });
                            }
                        }
                    }
                }

                const upcomingAudio = foregroundPlayerRunState?.snapshot()?.getUpcomingItems(
                    playbackParams.audioPrefetchTime,
                    playbackParams.scheduleLoadTime,
                    playbackParams.maxAudioPrefetchItems,
                );

                mp3Cache.setNow(targetFrameRTC);
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
                const upcomingBackground = backgroundPlayerRunState?.getUpcomingItems(
                    playbackParams.backgroundFseqPrefetchTime,
                    playbackParams.scheduleLoadTime,
                );

                // Issue FSEQ prefetches
                function prefetchActionFseq(runState: PlayerRunState, actions?: PlaybackActions) {
                    if (!actions) return;

                    for (const action of actions?.actions ?? []) {
                        if (!action.seqId) continue;
                        if (action.end) continue;
                        const actStart = action.atTime;
                        const seq = runState.sequencesById.get(action.seqId);
                        if (!seq) continue;
                        // Always fetch header
                        let fsf = seq.files?.fseq;
                        if (fsf && !path.isAbsolute(fsf)) fsf = path.join(showFolder!, fsf);
                        if (fsf) {
                            fseqCache!.prefetchSeqMetadata({ fseqfile: fsf, needByTime: actStart });
                        }

                        // Be less aggressive about fetching the frames
                        if (actStart >= targetFrameRTC + playbackParams.foregroundFseqPrefetchTime) continue;
                        let ourDur = targetFrameRTC + playbackParams.foregroundFseqPrefetchTime - actStart;
                        if (action.durationMS !== undefined) ourDur = Math.min(ourDur, action.durationMS);
                        if (action.seqId) {
                            emitFrameDebug(`Do fseq prefetch of ${action.seqId}`);
                            if (fsf) {
                                emitFrameDebug(
                                    `Prefetch FSEQ ${fsf} @${action.offsetMS}:${ourDur}ms (${actStart} vs ${targetFrameRTC})`,
                                );
                                fseqCache!.prefetchSeqTimes({
                                    fseqfile: fsf,
                                    needByTime: actStart,
                                    startTime: action.offsetMS ?? 0,
                                    durationms: ourDur,
                                });
                            }
                        }
                    }
                }

                fseqCache.setNow(targetFrameRTC);
                prefetchActionFseq(foregroundPlayerRunState, upcomingForeground.curPLActions);
                upcomingForeground.stackedPLActions?.forEach((s) => prefetchActionFseq(foregroundPlayerRunState, s));
                upcomingForeground.upcomingSchedules?.forEach((s) => prefetchActionFseq(foregroundPlayerRunState, s));
                upcomingForeground.interactive?.forEach((s) => prefetchActionFseq(foregroundPlayerRunState, s));
                upcomingForeground.heapSchedules?.forEach((s) => prefetchActionFseq(foregroundPlayerRunState, s));

                prefetchActionFseq(backgroundPlayerRunState, upcomingBackground.curPLActions);
                upcomingBackground.stackedPLActions?.forEach((s) => prefetchActionFseq(backgroundPlayerRunState, s));
                upcomingBackground.upcomingSchedules?.forEach((s) => prefetchActionFseq(backgroundPlayerRunState, s));
                upcomingBackground.interactive?.forEach((s) => prefetchActionFseq(backgroundPlayerRunState, s));
                upcomingBackground.heapSchedules?.forEach((s) => prefetchActionFseq(backgroundPlayerRunState, s));

                fseqCache.dispatch();
            }

            //emitFrameDebug(`${iteration} - Fseq prefetched`);

            function sendSilence(startTime: number, ms: number) {
                if (ms <= 0) return;
                if (ms > playbackParams.sendAudioChunkMs) {
                    ms = playbackParams.sendAudioChunkMs;
                }
                ms = Math.ceil(ms);
                const quiet = new Float32Array(ms * 48).fill(0, ms * 48);
                send(
                    {
                        type: 'audioChunk',
                        chunk: {
                            sampleRate: 48000,
                            channels: 1,
                            buffer: quiet.buffer,
                            playAtRealTime: startTime,
                            incarnation: curAudioSyncNum,
                        },
                    },
                    [quiet.buffer],
                );
            }

            // Send out audio in advance (at least sendAudioInAdvanceMs at all times)
            // Skip audio entirely while paused
            if (!isPaused) emitAudioDebug(
                `Send audio time: ${audioPlayerRunTime} vs ${targetFrameRTC + playbackParams.sendAudioInAdvanceMs}`,
            );
            // Take one snapshot and advance it as audioPlayerRunTime progresses
            const audioSnapshot = !isPaused ? foregroundPlayerRunState?.snapshot() : undefined;
            let aiter = 0;
            while (!isPaused && audioSnapshot && audioPlayerRunTime <= targetFrameRTC + playbackParams.sendAudioInAdvanceMs) {
                ++aiter;
                if (aiter > 100) {
                    emitError(`Way too many audio iterations!`);
                    break;
                }

                let startTime = Math.floor(audioPlayerRunTime + playbackParams.audioTimeAdjMs);

                audioSnapshot.runUntil(audioPlayerRunTime);
                const upcomingAudio = audioSnapshot.getUpcomingItems(
                    playbackParams.sendAudioInAdvanceMs,
                    playbackParams.scheduleLoadTime,
                );
                let audioAction: PlayAction | undefined = upcomingAudio?.curPLActions?.actions[0];
                if (audioAction?.end) {
                    sendSilence(startTime, audioAction.atTime - audioPlayerRunTime);
                    audioPlayerRunTime = audioAction.atTime;
                    continue;
                }
                if (!audioAction?.seqId) {
                    const etime = Math.max(audioPlayerRunTime, targetFrameRTC);
                    sendSilence(startTime, etime - audioPlayerRunTime); // TODO AUDIO - This is not a front-run; look at remaining action time and front-run
                    audioPlayerRunTime = etime;
                    break;
                }
                if (Math.floor(audioAction.offsetMS ?? 0) === 0) {
                    curAudioSyncNum++;
                }

                let audioref: ReturnType<MP3PrefetchCache['getMp3']> | undefined = undefined;
                try {
                    const curAudioSeq = foregroundPlayerRunState.sequencesById.get(audioAction.seqId);
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
                            const sampleOffset = Math.floor(
                                (Math.floor(audioAction.offsetMS ?? 0) * sampleRate) / 1000,
                            );
                            const msToSend = Math.min(playbackParams.sendAudioChunkMs);
                            const nSamplesToSend = Math.floor((msToSend * audio.sampleRate) / 1000);

                            const chunk = buildInterleavedAudioChunkFromSegments({
                                channelData: audio.channelData,
                                nSamplesInAudio: audio.nSamples,
                                sampleOffset,
                                nSamples: nSamplesToSend,
                                volumeSF,
                            });

                            const playAtRealTime = Math.floor(
                                audioPlayerRunTime + (playbackParams?.audioTimeAdjMs ?? 0),
                            );

                            if (audioPlayerRunTime >= targetFrameRTC) {
                                send(
                                    {
                                        type: 'audioChunk',
                                        chunk: {
                                            sampleRate: audio.sampleRate,
                                            channels,
                                            buffer: chunk.buffer,
                                            playAtRealTime,
                                            incarnation: curAudioSyncNum,
                                        },
                                    },
                                    [chunk.buffer],
                                );
                            } else {
                                ++playbackStats.skippedAudioChunksCumulative;
                            }

                            audioPlayerRunTime += msToSend;
                        }
                    } else {
                        const msToSend = Math.min(
                            audioAction.durationMS ?? playbackParams.sendAudioInAdvanceMs,
                            playbackParams.sendAudioInAdvanceMs,
                        );
                        audioPlayerRunTime += msToSend;
                    }
                } finally {
                    audioref?.ref?.release();
                }
            }

            // Run to target PN, see if anything happened, then get a readout
            //emitFrameDebug(`${iteration} - get foreground player ready`);

            // Don't advance foreground schedule while paused — it will slip behind real time
            if (!isPaused) {
                while (true) {
                    const plog: PlaybackLogDetail[] = [];
                    // Really want to run until time or something interesting
                    foregroundPlayerRunState.runUntil(targetFrameRTC, 1, plog);
                    let foundTime = plog.length === 0;
                    for (const l of plog) {
                        if (l.eventType === 'Sequence Ended') {
                            // TODO - Could reset clock base here.
                        } else if (l.eventType === 'Sequence Started' || l.eventType === 'Sequence Resumed') {
                            targetFrameRTC = foregroundPlayerRunState.currentTime;
                            emitInfo(`Sequence start in ${targetFrameRTC - Date.now()}`);
                            foundTime = true;
                            break;
                        }
                    }
                    if (foundTime) break;
                }
            }

            //emitFrameDebug(`${iteration} - runUntil done`);

            // Get the background frame
            while (true) {
                backgroundPlayerRunState.runUntil(targetFrameRTC);
                break;
            }

            const upcomingForeground = foregroundPlayerRunState?.getUpcomingItems(
                playbackParams.foregroundFseqPrefetchTime,
                playbackParams.scheduleLoadTime,
            );
            // TODO change this check to look at all the things
            if (!upcomingForeground.curPLActions?.actions?.length) {
                emitFrameDebug(
                    `No foreground actions ${targetFrameRTC - Date.now()} ${foregroundPlayerRunState.currentTime - Date.now()}`,
                );
                await sender.sendBlackFrame({ targetFramePN: rtcConverter.computePerfNow(targetFrameRTC) });
                targetFrameRTC += playbackParams.idleSleepInterval;

                await sleepUntil(targetFrameRTC - 50);
                continue;
            }
            const foregroundAction = upcomingForeground.curPLActions?.actions[0];
            // TODO: Something else here that accommodates background and other things
            if (isPaused || !foregroundAction?.seqId) {
                emitFrameDebug(isPaused ? `Paused - sending black` : `No foreground action seq`);
                await sender.sendBlackFrame({ targetFramePN: rtcConverter.computePerfNow(targetFrameRTC) });
                targetFrameRTC += playbackParams.idleSleepInterval;
                await sleepUntil(targetFrameRTC - 50);
                continue;
            }

            const curForegroundSeq = foregroundPlayerRunState.sequencesById.get(foregroundAction.seqId);
            let fsf = curForegroundSeq?.files?.fseq;
            if (fsf && !path.isAbsolute(fsf)) fsf = path.join(showFolder!, fsf);
            if (!fsf) {
                emitError(`Error: No FSEQ in scheduled item`);
                targetFrameRTC += playbackParams.idleSleepInterval;
                await sleepUntil(targetFrameRTC - 50);
                continue;
            }

            const frameTimeOffset = foregroundAction.offsetMS ?? 0;
            const header = fseqCache.getHeaderInfo({ fseqfile: fsf });
            if (!header?.ref) {
                emitError(`Sequence header for ${fsf} was not ready.`);
                ++playbackStats.missedHeadersCumulative;
                targetFrameRTC += playbackParams.idleSleepInterval;
                await sleepUntil(targetFrameRTC - 50);
                continue;
            }

            const frameInterval = header.ref.header.msperframe;
            const targetFrameNum = Math.floor(frameTimeOffset / frameInterval);

            const upcomingBackground = backgroundPlayerRunState?.getUpcomingItems(
                playbackParams.backgroundFseqPrefetchTime,
                playbackParams.scheduleLoadTime,
            );
            const backgroundAction = upcomingBackground.curPLActions?.actions[0];
            let bframeRef: FrameReference | undefined = undefined;
            if (backgroundAction?.seqId) {
                const curBackgroundSeq = backgroundPlayerRunState.sequencesById.get(backgroundAction.seqId);
                let bsf = curBackgroundSeq?.files?.fseq;
                if (bsf && !path.isAbsolute(bsf)) bsf = path.join(showFolder!, bsf);
                if (!bsf) {
                    emitError(`Error: No FSEQ in scheduled background item`);
                } else {
                    const bframeTimeOffset = backgroundAction.offsetMS ?? 0;
                    const header = fseqCache.getHeaderInfo({ fseqfile: bsf });
                    if (!header?.ref) {
                        emitError(`Sequence header for ${bsf} was not ready.`);
                        ++playbackStats.missedHeadersCumulative;
                    } else {
                        const bres = fseqCache.getFrame(bsf, { time: bframeTimeOffset });
                        bframeRef = bres?.ref;
                        if (!bres?.ref?.frame) {
                            ++playbackStats.missedBackgroundFramesCumulative;
                        }
                    }
                }
            }

            // At this point, all housekeeping is done.
            // Let's see if we're in time to spit out a frame, or if we have to skip
            //emitFrameDebug(`${iteration} - play the frame?`);
            const frameRef = fseqCache.getFrame(fsf, { num: targetFrameNum });
            targetFrameRTC += await sender.sendNextFrameAt({
                frame: frameRef?.ref,
                bframe: bframeRef,
                targetFramePN: rtcConverter.computePerfNow(targetFrameRTC),
                targetFrameNum,
                playbackStats,
                playbackStatsAgg,
                frameInterval,
                skipFrameIfLateByMoreThan: playbackParams.skipFrameIfLateByMoreThan,
                dontSleepIfDurationLessThan: playbackParams.dontSleepIfDurationLessThan,
            });
        }
    } finally {
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
