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
    PlayAction,
    PlaybackLogDetail,
    PrefetchCacheStats,
    PlaybackStatistics,
    PlayingItem,
    PlayerPStatusContent,
    PlayerNStatusContent,
    PlaybackSettings,
    EZPlayerCommand,
    VcSong,
    VcPlayingItem,
    VcScheduleEntry,
} from '@ezplayer/ezplayer-core';
import {
    AudioChunkRingBuffer,
    getActiveViewerControlSchedule,
    getActiveVolumeSchedule,
    getScheduleTimes,
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
    resolveShowAssetPath,
} from '@ezplayer/epp';

import {
    getAllLayoutGroups,
    getAllModelCoordinates,
    getAllMovingHeads,
    getAllViewObjects,
    getAllViewpoints,
    getLayoutSettings,
    GetNodeResult,
    type MhFixtureInfo,
    type ModelParseOptions,
    migrateToFormat,
} from 'xllayoutcalcs';

// xllayoutcalcs warns about XML attributes the model parser ignored — useful
// during in-tree development, but actionable only by xllayoutcalcs maintainers,
// so silence it in the shipped player.
const PARSE_OPTS: ModelParseOptions = { warnUnusedAttrs: false };

import { buildInterleavedAudioChunkFromSegments, MP3PrefetchCache } from './mp3decodecache';
import { AsyncBatchLogger } from './logger';

import { performance } from 'perf_hooks';
import { startAsyncCounts, startELDMonitor, startGCLogging } from './perfmon';

import process from 'node:process';
import { totalmem } from 'node:os';
import { avgFrameSendTime, FrameSender, OverallFrameSendStats, resetFrameSendStats } from './framesend';

import { decompressZStdWithWorker, getZstdStats, resetZstdStats } from './zstdparent';
import { setPingConfig, getLatestPingStats, stopPing } from './pingparent';

import { sendRFInitiateCheck, setRFConfig, setRFControlEnabled, setRFNowPlaying, setRFPlaylist } from './rfparent';
import { PlaylistSyncItem } from './rfsync';
import {
    sendEzvcInitiateCheck,
    setEzvcCatalog,
    setEzvcConfig,
    setEzvcControlEnabled,
    setEzvcPlaylist,
    setEzvcResyncCallback,
    setEzvcPlaying,
    setEzvcSchedule,
} from './ezvcparent';
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
            // Only "now playing" if it has actually started; a not-yet-started action
            // (within the readahead window) is upcoming, not playing.
            if (!playStatus.now_playing && pla.atTime <= foregroundPlayerRunState.currentTime) {
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

    const referencedFiles = new Set<string>();
    for (const f of foregroundPlayerRunState.referencedFileCounts().keys()) referencedFiles.add(f);
    for (const f of backgroundPlayerRunState.referencedFileCounts().keys()) referencedFiles.add(f);
    playStatus.referencedFiles = [...referencedFiles];

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
            startCh: c.setup.startCh,
            nCh: c.setup.nCh,
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
            // Only "now playing" if it has actually started; otherwise it's upcoming.
            if (!now_playing && pla.atTime <= foregroundPlayerRunState.currentTime) {
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

// ---- EZPlayer viewer control (ViewerControlState.type === 'ezplayer') ------
// The schedule gating is shared (`getActiveViewerControlSchedule`); only the
// backend differs. The cloud owns the mode/policy, so the suggestion is a
// sequence id we can play directly — no index mapping needed.
let ezvcCloudUrl: string | undefined = undefined;
let ezvcPlayerToken: string | undefined = undefined;
let ezvcConfigInitialized = false;
let lastEzvcKey: string | undefined = undefined;
let lastEzvcCheck: number = Date.now();
let lastEzvcPlayingKey: string | undefined = undefined;

/** ScheduleDays → JS day numbers (0=Sun .. 6=Sat) for the request-window
 *  feed. Best-effort; the calendar UI interprets. */
const SCHEDULE_DAYS_TO_NUMS: Record<string, number[]> = {
    all: [0, 1, 2, 3, 4, 5, 6],
    'weekend-fri-sat': [5, 6],
    'weekend-sat-sun': [6, 0],
    'weekday-mon-fri': [1, 2, 3, 4, 5],
    'weekday-sun-thu': [0, 1, 2, 3, 4],
    sunday: [0],
    monday: [1],
    tuesday: [2],
    wednesday: [3],
    thursday: [4],
    friday: [5],
    saturday: [6],
};

function configureEzvc() {
    if (!ezvcCloudUrl || !ezvcPlayerToken) return;
    const key = `${ezvcCloudUrl}|${ezvcPlayerToken}`;
    if (ezvcConfigInitialized && key === lastEzvcKey) return;
    ezvcConfigInitialized = true;
    lastEzvcKey = key;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setEzvcConfig({ cloudUrl: ezvcCloudUrl, playerToken: ezvcPlayerToken, tz }, (next) => {
        if (!next.songId) return;
        processCommand({
            command: 'playsong',
            immediate: false,
            songId: next.songId,
            requestId: randomUUID(),
            priority: 3,
        });
    });
    setEzvcResyncCallback(() => {
        // Reset our own dedup so sendEzvcUpdate() pushes the full snapshot.
        // The worker has already cleared its hash caches.
        lastEzvcPlayingKey = undefined;
        sendEzvcUpdate();
    });
}

// Jukebox eligibility — duplicate of jukeboxFilter (the worker can't pull a
// React package). 'nojukebox' is always excluded; excluded tags veto; included
// tags (when non-empty) are required as any-match. Tags trimmed + lowercased.
const JUKEBOX_ALWAYS_EXCLUDED = ['nojukebox'];
function normalizeTagList(tags: string[] | undefined): string[] {
    return (tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
}
function songMatchesAnyTag(songTags: string[] | undefined, list: string[]): boolean {
    if (!songTags || songTags.length === 0 || list.length === 0) return false;
    const set = new Set(normalizeTagList(songTags));
    return list.some((t) => set.has(t));
}
function isSongAllowedForJukebox(
    songTags: string[] | undefined,
    excludedTags: string[] | undefined,
    includedTags: string[] | undefined,
): boolean {
    const excluded = Array.from(new Set([...JUKEBOX_ALWAYS_EXCLUDED, ...normalizeTagList(excludedTags)]));
    const included = normalizeTagList(includedTags);
    if (songMatchesAnyTag(songTags, excluded)) return false;
    if (included.length === 0) return true;
    return songMatchesAnyTag(songTags, included);
}

function sendEzvcUpdate() {
    const settings = latestSettings;
    if (!settings) return;
    if (!ezvcCloudUrl || !ezvcPlayerToken) return;

    // Display feeds report for any cloud-connected player; interactive control
    // runs only when type === 'ezplayer' and its schedule window is open.
    const vc = settings.viewerControl;
    const ezWindow = vc?.type === 'ezplayer' ? getActiveViewerControlSchedule(vc) : null;
    setEzvcControlEnabled(!!ezWindow);

    // ---- now-playing + the upcoming song lineup ("what's coming") ---------
    const ps = foregroundPlayerRunState.getUpcomingItems(600_000, 24 * 3600 * 1000);
    let now_playing: PlayingItem | undefined = undefined;
    const upcomingItems: PlayingItem[] = [];
    if (ps.curPLActions?.actions?.length) {
        for (const pla of ps.curPLActions.actions) {
            if (pla.end) continue;
            const pi = actionToPlayingItem(false, pla);
            // Only "now playing" if it has actually started; otherwise it's upcoming.
            if (!now_playing && pla.atTime <= foregroundPlayerRunState.currentTime) now_playing = pi;
            else if (upcomingItems.length < 12) upcomingItems.push(pi);
            else break;
        }
    }
    const toVc = (pi: PlayingItem | undefined): VcPlayingItem | undefined =>
        pi ? { songId: pi.sequence_id, title: pi.title, at: pi.at, until: pi.until } : undefined;
    const upcomingVc = upcomingItems.map((p) => toVc(p)).filter((x): x is VcPlayingItem => x !== undefined);

    // Push on lineup-identity change, not per-tick timestamp drift; the page
    // interpolates between pushes.
    const lineupKey = `${now_playing?.sequence_id ?? ''}|` + upcomingVc.map((u) => u.songId ?? '').join(',');
    if (lineupKey !== lastEzvcPlayingKey) {
        lastEzvcPlayingKey = lineupKey;
        setEzvcPlaying({
            nowPlaying: now_playing?.sequence_id ?? undefined,
            nextScheduled: upcomingItems[0]?.sequence_id ?? undefined,
            now: toVc(now_playing),
            upcoming: upcomingVc,
        });
    }

    // Operating hours come from `curSchedule` (the calendar's source of truth),
    // not the playback engine's horizon-bounded lookahead — so future
    // occurrences days/weeks out still surface. Future-only, soonest first.
    const nowMs = Date.now();
    const showWindows: VcScheduleEntry[] = (curSchedule ?? [])
        .filter((s) => s.scheduleType !== 'background' && !s.deleted && s.enabled !== false)
        .map((s) => {
            const { startTimeMS, endTimeMS } = getScheduleTimes(s);
            return { s, startTimeMS, endTimeMS };
        })
        .filter((x) => Number.isFinite(x.endTimeMS) && x.endTimeMS >= nowMs)
        .sort((a, b) => a.startTimeMS - b.startTimeMS)
        .slice(0, 60)
        .map((x) => ({
            title: x.s.playlistTitle || x.s.title || 'Show',
            start: new Date(x.startTimeMS).toISOString(),
            end: new Date(x.endTimeMS).toISOString(),
        }));
    // Request windows: exactly the viewer-control schedule entries.
    const reqWindows: VcScheduleEntry[] = (vc?.type === 'ezplayer' ? (vc.schedule ?? []) : []).map((e) => ({
        title: e.playlist,
        start: e.startTime,
        end: e.endTime,
        daysOfWeek: SCHEDULE_DAYS_TO_NUMS[e.days],
    }));
    setEzvcSchedule(showWindows, reqWindows);

    // ---- static catalog: jukebox-filtered sequences ----------------------
    // Artwork is resolved cloud-side via per-song proxy; no local paths here.
    const jukebox = settings.jukebox;
    const catalog: VcSong[] = (curSequences ?? [])
        .filter((seq) => !seq.deleted && seq.render_enabled !== false)
        .filter((seq) => isSongAllowedForJukebox(seq.settings?.tags, jukebox?.excludedTags, jukebox?.includedTags))
        .map((seq) => ({
            id: seq.id,
            title: seq.work?.title || seq.id,
            artist: seq.work?.artist || undefined,
            vendor: seq.sequence?.vendor || undefined,
            durationMs: seq.work?.length ? seq.work.length * 1000 : undefined,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    setEzvcCatalog(catalog);

    // ---- interactive-only: needs the active window's playlist ------------
    if (!ezWindow) return;

    const pl = curPlaylists?.find((p) => p.title.toLowerCase() === ezWindow.playlist.toLowerCase());
    if (pl) {
        const songs: VcSong[] = [];
        for (const i of pl.items) {
            const s = foregroundPlayerRunState.sequencesById.get(i.id);
            if (!s) continue;
            songs.push({
                id: i.id,
                title: s.work.title,
                artist: s.work.artist,
                // SongDetails.length is seconds; the wire wants ms.
                durationMs: s.work.length * 1000,
            });
        }
        setEzvcPlaylist(songs);
    }

    if (now_playing) {
        const diff = (now_playing.until ?? 0) - foregroundPlayerRunState.currentTime;
        if (diff >= 3000 && diff < 4000) {
            sendEzvcInitiateCheck();
        }
    } else {
        const dn = Date.now();
        if (dn - lastEzvcCheck > 5000) {
            lastEzvcCheck = dn;
            sendEzvcInitiateCheck();
        }
    }
}

// Max volume slew rate: ramp 1% per this many ms toward the target. The playback
// loop cadence varies wildly (tight while a show runs, much slower when idle), so
// we scale the step to elapsed time rather than moving a fixed 1% per call — that
// way the UI never crawls when the loop is slow, while staying gentle on the ear:
// a 200ms gap moves ~20%, a 50ms gap ~5%, and a full 0-100 swing takes ~1s.
const VOLUME_SLEW_INTERVAL_MS = 10;
let lastVolCheck: number = Date.now();

/** Manual volume set (setvolume command from UI/API/FPP-compat). Holds against
 *  the settings-driven target until either new settings arrive or a volume
 *  schedule entry (re)activates — scheduled volume wins at its boundary, but a
 *  manual set DURING a scheduled window sticks for that window. Without this,
 *  the slew loop walks every setvolume straight back to defaultVolume. */
let interactiveVolume: number | undefined = undefined;
let lastActiveVolSchedId: string | undefined = undefined;

function doVolumeAdjust(dn: number) {
    const settings = latestSettings;
    if (!settings || !settings.volumeControl) {
        lastVolCheck = dn; // unconfigured: keep the slew clock fresh, don't bank credit
        return;
    }
    const volsched = getActiveVolumeSchedule(settings.volumeControl);
    if (volsched?.id !== lastActiveVolSchedId) {
        lastActiveVolSchedId = volsched?.id;
        if (volsched) interactiveVolume = undefined; // schedule boundary overrides a manual set
    }
    let tgtvol = interactiveVolume ?? settings.volumeControl.defaultVolume ?? 100;
    if (volsched && interactiveVolume === undefined) {
        tgtvol = volsched.volumeLevel;
    }

    const diff = tgtvol - volume;
    if (diff === 0) {
        lastVolCheck = dn; // at target: reset so a future change starts from now
        return;
    }

    const elapsed = dn - lastVolCheck;
    if (elapsed < VOLUME_SLEW_INTERVAL_MS) return; // throttle: at most 1% per interval

    // One 1% step per whole interval elapsed, capped by the remaining distance.
    const maxSteps = Math.floor(elapsed / VOLUME_SLEW_INTERVAL_MS);
    const step = Math.min(Math.abs(diff), maxSteps);
    volume += Math.sign(diff) * step;
    // Consume only the time we used so a sub-interval remainder carries forward.
    lastVolCheck += step * VOLUME_SLEW_INTERVAL_MS;
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
                interactiveVolume = cmd.volume; // hold against the settings slew target
            }
            if (cmd.mute !== undefined) {
                muted = cmd.mute;
            }
            volumeSF = muted ? 0 : volume / 100;
            sendPlayerStateUpdate(); // keep pStatus.volume fresh for status polls
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
            {
                emitInfo(`PLAY CMD: ${cmd?.command}: ${cmd?.playlistId}`);
                const pl = curPlaylists?.find((p) => p.id === cmd.playlistId);
                if (!pl) {
                    emitError(`Unable to identify playlist ${cmd.playlistId}`);
                    return false;
                }
                const startTime = foregroundPlayerRunState.currentTime + playbackParams.interactiveCommandPrefetchDelay;
                foregroundPlayerRunState.addInteractiveCommand({
                    immediate: cmd.immediate,
                    requestId: cmd.requestId,
                    startTime,
                    playlistId: cmd.playlistId,
                    loop: cmd.loop,
                });

                if (cmd.immediate) {
                    audioPlayerRunTime = Math.min(audioPlayerRunTime, startTime); // Possibly overlap audio
                }

                emitInfo(`Enqueue playlist: Current length ${foregroundPlayerRunState.interactiveQueue.length}`);
                sendPlayerStateUpdate();
                if (!running) {
                    running = processQueue(); // kick off first song
                }
            }
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
            const folderChanged =
                command.showFolder &&
                command.showFolder !== '<no show folder yet>' &&
                command.showFolder !== showFolder;

            if (command.showFolder && command.showFolder !== '<no show folder yet>') {
                showFolder = command.showFolder;
            }

            const fullRestart = folderChanged || command.forceRestart;

            if (fullRestart) {
                pendingFullRebuild = true;
                if (running) {
                    shouldRestart = true;
                    await running; // wait for loop to exit
                    running = undefined;
                }

                // Load XML coordinates eagerly and push to server
                try {
                    await loadXmlCoordinates();
                } catch (err) {
                    emitError(`[Worker Message] Failed to load XML coordinates: ${err}`);
                }
            }

            // Set pendingSchedule after old loop has exited
            pendingSchedule = command;

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
        case 'cloudidentity': {
            // Fall back to cloudUrl when no election has happened yet.
            ezvcCloudUrl = command.liveUrl || command.cloudUrl || undefined;
            ezvcPlayerToken = command.playerIdToken || undefined;
            configureEzvc();
            break;
        }
        case 'vcResync': {
            // Cloud has no live viewer-control state for us (it restarted).
            // Forget the ezvc dedup keys and re-arm so the next sendEzvcUpdate
            // re-pushes the full snapshot. `lastEzvcKey = undefined` bypasses
            // configureEzvc's same-key guard; the re-config makes the ezvc
            // worker clear its own per-call hashes (handleSetConfig resets them).
            lastEzvcPlayingKey = undefined;
            lastEzvcKey = undefined;
            configureEzvc();
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
    sendAudioInAdvanceMs: 300, // audio generation lead (all consumers); modest margin for cloud/network jitter
    sendAudioChunkMs: 100, // The "hop": how far each chunk advances. Multiple of 10 for 44100kHz.
    audioCrossfadeMs: 10, // Trailing overlap appended to each music chunk; ramped to crossfade seams.
    mp3CacheSeconds: 3600, // We reuse the memory in ~5s chunks
    audioPrefetchTime: 30_000, // forward-run horizon for audio; decode is fast, beyond this is margins
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

type ResolvedPlay = {
    seqId: string;
    seq?: SequenceRecord;
    atTime: number;
    offsetMS: number;
    durationMS?: number;
};

/** Prefetch confidence tiers (lower = higher priority). */
const PREFETCH_TIER = { HAPPY: 0, BACKGROUND: 1, SPECULATIVE: 2 } as const;

// Speculative branches (skip / down-stack) only need the immediate target ready, not
// the whole post-skip timeline — look just a few seconds ahead, never beyond the
// committed horizon.
const SPECULATIVE_HORIZON_MS = 5000;

/**
 * Run a fork of the player state forward over `horizon` and return the sequences it
 * actually plays — the current play plus future starts, with preemptions resolved by
 * the run itself. This is the prefetch "generation": the concrete near-future play
 * list, instead of the union of every schedule/stack/queue source.
 *
 * `mutate` applies a hypothetical command (skip, stop) to the fork first, so the same
 * enumerator yields the speculative "what would play if they skipped" branches.
 */
function enumerateResolvedPlays(
    runState: PlayerRunState | undefined,
    fromTime: number,
    horizon: number,
    schedahead: number,
    mutate?: (snap: PlayerRunState, at: number) => void,
): ResolvedPlay[] {
    if (!runState) return [];
    const plays: ResolvedPlay[] = [];
    const seen = new Set<string>();
    try {
        const snap = runState.snapshot();
        if (mutate) mutate(snap, fromTime);

        // The current play started before `fromTime`, so it isn't a future log event —
        // take it from the resolved current action.
        const cur = snap.getUpcomingItems(horizon, schedahead, 1)?.curPLActions?.actions?.[0];
        if (cur && !cur.end && cur.seqId && cur.seq) {
            plays.push({
                seqId: cur.seqId,
                seq: cur.seq,
                atTime: cur.atTime,
                offsetMS: cur.offsetMS ?? 0,
                durationMS: cur.durationMS,
            });
            seen.add(`${cur.seqId}@${cur.atTime}`);
        }

        // Future starts within the horizon, resolved (preemptions and all) by the run.
        const log = snap.readOutScheduleUntil(fromTime + horizon, 200);
        const starts = log.filter(
            (l) => (l.eventType === 'Sequence Started' || l.eventType === 'Sequence Resumed') && !!l.sequenceId,
        );
        for (let i = 0; i < starts.length; i++) {
            const s = starts[i];
            const key = `${s.sequenceId}@${s.eventTime}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const seq = snap.sequencesById.get(s.sequenceId!);
            const nextTime = i + 1 < starts.length ? starts[i + 1].eventTime : fromTime + horizon;
            const durationMS = seq?.work?.length ? seq.work.length * 1000 : nextTime - s.eventTime;
            plays.push({ seqId: s.sequenceId!, seq, atTime: s.eventTime, offsetMS: s.timeIntoSeqMS ?? 0, durationMS });
        }
    } catch (e) {
        emitError(`enumerateResolvedPlays failed: ${(e as Error).message}`);
    }
    return plays;
}

let latestSettings: PlaybackSettings | undefined = undefined;
let lastRfRemoteToken: string | undefined = undefined;
let rfConfigInitialized = false;

function dispatchSettings(settings: PlaybackSettings) {
    latestSettings = settings;
    interactiveVolume = undefined; // explicit settings change reclaims volume control
    const nasa = settings.audioSyncAdjust ?? 0;
    if (nasa != playbackParams.audioTimeAdjMs) {
        playbackParams.audioTimeAdjMs = nasa;
        ++curAudioSyncNum;
    }
    // Only reconfigure the RF worker when the input it cares about actually
    // changes. Settings get pushed on every auto-save (often), and each call
    // would otherwise reset the RF worker's cached state and log.
    const nextToken = settings.viewerControl.remoteFalconToken;
    if (!rfConfigInitialized || nextToken !== lastRfRemoteToken) {
        rfConfigInitialized = true;
        lastRfRemoteToken = nextToken;
        setRFConfig(
            {
                remoteToken: nextToken,
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

// Scale cache budgets to available RAM so we fit on smaller devices. The defaults
// above suit 8 GB+ boards; trim on ~4 GB boards, and warn (surfaced to the UI via
// playbackStats.lastError) on memory too small to run reliably (~2 GB and below).
{
    const totalMemGB = totalmem() / 1e9;
    if (totalMemGB < 6) {
        playbackParams.mp3CacheSeconds = 1000; // ~380 MB of 48 kHz stereo audio
        playbackParams.fseqSpace = 256_000_000; // 256 MB of decompressed frames
    }
    emitInfo(
        `System RAM ${totalMemGB.toFixed(1)} GB → mp3 cache ${playbackParams.mp3CacheSeconds}s, ` +
            `fseq cache ${Math.round(playbackParams.fseqSpace / 1e6)} MB`,
    );
    if (totalMemGB < 2.5) {
        emitError(
            `Low system memory: ${totalMemGB.toFixed(1)} GB. EZPlayer recommends at least 4 GB; ` +
                `audio/FSEQ caches were reduced and playback may be unstable.`,
        );
    }
}

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
let movingHeads: MhFixtureInfo[] = [];

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

// Set when the next installNewSchedule() must do a full rebuild of the run states
// (folder change or an explicit forceRestart / "reload" from the UI) rather than a
// nondisruptive reconcile. This is the nuclear path: it discards live runtime state
// (interactive queue, immediate item, stopped schedules, exact cursor position).
let pendingFullRebuild = false;

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
async function buildShowFolderIndex(folder: string, maxDepth = 5): Promise<Map<string, string>> {
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

// Resolve a file path from the XML to a show-folder-relative path.
// resolveShowAssetPath (epp) handles foreign-platform absolute paths too —
// a layout authored on Windows and copied to a Linux player carries C:\...
// refs that POSIX path.isAbsolute doesn't recognize as absolute.
const resolveFilePathFromIndex = resolveShowAssetPath;

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
        migrateToFormat(xrgb, 'x2026_3');
        xnet = await loadXmlFile(netPath);
    } catch (err) {
        emitError(`[loadXmlCoordinates] Failed to load XML file: ${err}`);
        xrgb = null;
        xnet = null;
    }

    modelCoordinates = new Map<string, GetNodeResult>();
    modelCoordinates2D = new Map<string, GetNodeResult>();
    movingHeads = [];
    layoutSettings = {};

    if (xrgb && xnet) {
        const gmc2d = getAllModelCoordinates(xrgb, xnet, true, PARSE_OPTS);
        const gmc3d = getAllModelCoordinates(xrgb, xnet, false, PARSE_OPTS);

        // Extract moving head fixture definitions
        try {
            movingHeads = getAllMovingHeads(xrgb, xnet, PARSE_OPTS);
            emitInfo(`[loadXmlCoordinates] Found ${movingHeads.length} moving head fixture(s)`);
        } catch (mhErr) {
            emitWarning(`[loadXmlCoordinates] Error extracting moving heads: ${mhErr}`);
        }

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
                viewObjects = [];

                for (const vo of getAllViewObjects(xrgb)) {
                    // Process Mesh objects with OBJ files
                    if (vo.displayAs === 'Mesh' && vo.objFile && vo.active) {
                        const resolvedObjFile = resolveFilePathFromIndex(vo.objFile, resolvedShow, fileIndex);
                        if (!resolvedObjFile) {
                            emitWarning(
                                `[loadXmlCoordinates] Could not resolve "${vo.objFile}" for view object "${vo.name}"`,
                            );
                            continue;
                        }

                        viewObjects.push({
                            name: vo.name,
                            displayAs: vo.displayAs,
                            objFile: resolvedObjFile,
                            worldPosX: vo.worldPosX,
                            worldPosY: vo.worldPosY,
                            worldPosZ: vo.worldPosZ,
                            scaleX: vo.scaleX,
                            scaleY: vo.scaleY,
                            scaleZ: vo.scaleZ,
                            rotateX: vo.rotateX,
                            rotateY: vo.rotateY,
                            rotateZ: vo.rotateZ,
                            brightness: vo.brightness,
                            active: vo.active,
                        });
                    } else if (vo.displayAs === 'Image' && vo.imageFile && vo.active) {
                        // Process Image view objects (textured planes)
                        const resolvedImageFile = resolveFilePathFromIndex(vo.imageFile, resolvedShow, fileIndex);
                        if (!resolvedImageFile) {
                            emitWarning(
                                `[loadXmlCoordinates] Could not resolve image "${vo.imageFile}" for view object "${vo.name}"`,
                            );
                            continue;
                        }

                        viewObjects.push({
                            name: vo.name,
                            displayAs: vo.displayAs,
                            imageFile: resolvedImageFile,
                            worldPosX: vo.worldPosX,
                            worldPosY: vo.worldPosY,
                            worldPosZ: vo.worldPosZ,
                            scaleX: vo.scaleX,
                            scaleY: vo.scaleY,
                            scaleZ: vo.scaleZ,
                            rotateX: vo.rotateX,
                            rotateY: vo.rotateY,
                            rotateZ: vo.rotateZ,
                            brightness: vo.brightness,
                            transparency: vo.transparency,
                            active: vo.active,
                        });
                    }
                }

                // Surface Image *models* as ImagePlane view objects too.  The
                // model carries imageInfo (path, off-brightness, white-as-alpha,
                // custom tint) and a world transform matrix that already encodes
                // position/rotation/scale in xLights units, so we pass the matrix
                // through verbatim and let the renderer apply it.
                let imageModelCount = 0;
                for (const [modelName, modelEntry] of gmc3d.models.entries()) {
                    const nr = modelEntry.nodeResult;
                    if (!nr.imageInfo) continue;
                    const resolvedImageFile = resolveFilePathFromIndex(nr.imageInfo.imageFile, resolvedShow, fileIndex);
                    if (!resolvedImageFile) {
                        emitWarning(
                            `[loadXmlCoordinates] Could not resolve image "${nr.imageInfo.imageFile}" for image model "${modelName}"`,
                        );
                        continue;
                    }
                    viewObjects.push({
                        name: modelName,
                        displayAs: 'Image',
                        imageFile: resolvedImageFile,
                        // Identity placeholders — the renderer uses worldMatrix instead.
                        worldPosX: 0,
                        worldPosY: 0,
                        worldPosZ: 0,
                        scaleX: 1,
                        scaleY: 1,
                        scaleZ: 1,
                        rotateX: 0,
                        rotateY: 0,
                        rotateZ: 0,
                        active: true,
                        startChannel: modelEntry.channelMapping.firstChannel,
                        channelsPerNode: modelEntry.channelMapping.channelsPerNode,
                        nodeCount: modelEntry.channelMapping.totalNodes,
                        modelName,
                        imageInfo: nr.imageInfo,
                        worldMatrix: Array.from(nr.toWorldCoords as Float32Array),
                    });
                    imageModelCount++;
                }

                emitInfo(
                    `[loadXmlCoordinates] Loaded ${viewObjects.length} view objects (meshes + images${imageModelCount ? ` incl. ${imageModelCount} image model${imageModelCount === 1 ? '' : 's'}` : ''})`,
                );
            } catch (parseErr) {
                emitError(`[loadXmlCoordinates] Error parsing view_objects element: ${parseErr}`);
            }

            // Parse layout <settings> element (backgroundImage, previewWidth, etc.)
            try {
                const parsedSettings = getLayoutSettings(xrgb);

                if (parsedSettings.backgroundImage) {
                    const resolved = resolveFilePathFromIndex(parsedSettings.backgroundImage, resolvedShow, fileIndex);
                    if (resolved) {
                        layoutSettings.backgroundImage = resolved;
                    } else {
                        emitWarning(
                            `[loadXmlCoordinates] Could not resolve backgroundImage "${parsedSettings.backgroundImage}"`,
                        );
                    }
                }
                if (parsedSettings.backgroundBrightness !== undefined) {
                    layoutSettings.backgroundBrightness = parsedSettings.backgroundBrightness;
                }
                if (parsedSettings.previewWidth !== undefined) {
                    layoutSettings.previewWidth = parsedSettings.previewWidth;
                }
                if (parsedSettings.previewHeight !== undefined) {
                    layoutSettings.previewHeight = parsedSettings.previewHeight;
                }

                if (layoutSettings.backgroundImage) {
                    emitInfo(
                        `[loadXmlCoordinates] Layout settings: bg="${layoutSettings.backgroundImage}" brightness=${layoutSettings.backgroundBrightness} preview=${layoutSettings.previewWidth}x${layoutSettings.previewHeight}`,
                    );
                }
            } catch (parseErr) {
                emitError(`[loadXmlCoordinates] Error parsing settings element: ${parseErr}`);
            }

            // Layout groups — xllayoutcalcs parses the <layoutGroups> section; we resolve
            // show-folder-relative backgroundImage paths here since that part is Electron-side.
            try {
                const parsedGroups = getAllLayoutGroups(xrgb);
                if (parsedGroups.length > 0) {
                    layoutSettings.layoutGroups = parsedGroups.map((g) => ({
                        name: g.name,
                        backgroundImage: g.backgroundImage
                            ? resolveFilePathFromIndex(g.backgroundImage, resolvedShow, fileIndex) || undefined
                            : undefined,
                        posX: g.posX,
                        posY: g.posY,
                        paneWidth: g.paneWidth,
                        paneHeight: g.paneHeight,
                        backgroundBrightness: g.backgroundBrightness,
                        backgroundAlpha: g.backgroundAlpha,
                    }));

                    const names = parsedGroups
                        .slice(0, 8)
                        .map((g) => g.name)
                        .join(', ');
                    emitInfo(
                        `[loadXmlCoordinates] layoutGroups parsed: ${parsedGroups.length}` +
                            (names ? `; groups=[${names}]` : ''),
                    );
                } else {
                    emitWarning('[loadXmlCoordinates] No <layoutGroups> section found in xlights_rgbeffects.xml');
                }
            } catch (parseErr) {
                emitError(`[loadXmlCoordinates] Error parsing layoutGroups element: ${parseErr}`);
            }

            // Named viewpoints (saved 3D camera poses) — surfaced for the Preview3D viewpoint chooser.
            try {
                const vpResult = getAllViewpoints(xrgb);
                if (vpResult.viewpoints.length > 0 || vpResult.default2D || vpResult.default3D) {
                    layoutSettings.viewpoints = vpResult;
                    emitInfo(
                        `[loadXmlCoordinates] viewpoints parsed: ${vpResult.viewpoints.length}` +
                            (vpResult.default3D ? '; has default3D' : '') +
                            (vpResult.default2D ? '; has default2D' : ''),
                    );
                }
            } catch (parseErr) {
                emitError(`[loadXmlCoordinates] Error parsing Viewpoints element: ${parseErr}`);
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
    send({ type: 'modelCoordinates', coords3D, coords2D, viewObjects, layoutSettings, movingHeads });
}

let frameExportBuffer: SharedArrayBuffer | undefined = undefined;
let frameExportRing: LatestFrameRingBuffer | undefined = undefined;

let audioExportBuffer: SharedArrayBuffer | undefined = undefined;
let audioExportRing: AudioChunkRingBuffer | undefined = undefined;

/**
 * Apply a complementary raised-cosine ramp to the first and last `overlapFrames`
 * frames of an interleaved buffer, in place. Adjacent chunks share `overlapFrames`
 * of identical audio scheduled at the same time; the rising head of one and the
 * falling tail of the previous sum to unity, so the seam reconstructs exactly while
 * the per-buffer resampling edge artifact is weighted to zero. Mutates `interleaved`.
 */
function applyCrossfadeRamp(interleaved: Float32Array, channels: number, overlapFrames: number) {
    const totalFrames = interleaved.length / channels;
    if (overlapFrames <= 0 || totalFrames < overlapFrames * 2) return;
    for (let k = 0; k < overlapFrames; k++) {
        const theta = (Math.PI * (k + 0.5)) / overlapFrames;
        const rise = 0.5 - 0.5 * Math.cos(theta); // 0 -> 1 across the head
        const fall = 0.5 + 0.5 * Math.cos(theta); // 1 -> 0 across the tail (rise + fall === 1)
        const headBase = k * channels;
        const tailBase = (totalFrames - overlapFrames + k) * channels;
        for (let ch = 0; ch < channels; ch++) {
            interleaved[headBase + ch] *= rise;
            interleaved[tailBase + ch] *= fall;
        }
    }
}

/** Publish to the ring buffer (for web clients) then send via IPC (for Electron audio window). */
function sendAudioChunk(
    samples: Float32Array,
    playAtRealTime: number,
    incarnation: number,
    sampleRate: number,
    channels: number,
    advanceSamples: number,
) {
    audioExportRing?.publish(samples, playAtRealTime, incarnation, sampleRate, channels, advanceSamples);
    const buf = samples.buffer as ArrayBuffer;
    send(
        {
            type: 'audioChunk',
            chunk: {
                sampleRate,
                channels,
                buffer: buf,
                playAtRealTime,
                incarnation,
                advanceSamples,
            },
        },
        [buf],
    );
}

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
            emitWarning,
            emitInfo,
        );
    }

    const sender: FrameSender = new FrameSender();
    sender.emitError = (e) => emitError(e.message);
    sender.emitWarning = emitWarning;

    try {
        const { controllers, models } = await readControllersFromXlights(showFolder!, {
            warnUnusedAttrs: false,
            // Surface library-side skips (unknown model types, unresolvable
            // start channels) in the player's warning log instead of console.
            logger: (msg) => emitWarning(msg),
        });

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
        // Start with the channel ceiling implied by the configured DMX controllers.
        let nChannels = Math.max(0, ...(controllers ?? []).map((e) => e.setup.startCh + e.setup.nCh));

        // Extend to cover every model's actual channel extent.
        //   This handles models not yet wired to a controller
        let modelChannelMax = 0;
        for (const coord of modelCoordinates?.values() ?? []) {
            const last = coord.channelMapping?.lastChannel;
            if (last != null && last >= 0) modelChannelMax = Math.max(modelChannelMax, last + 1);
        }

        // MH fixtures may not appear in modelCoordinates if DmxMovingHead models
        // carry no renderable 3D nodes, so include them explicitly.
        // MOC - TODO REMOVE - what is the point?  Should work in above loop.
        for (const mh of movingHeads) {
            modelChannelMax = Math.max(modelChannelMax, mh.channelOffset + mh.numChannels);
        }

        if (modelChannelMax > nChannels) {
            emitInfo(
                `[processQueue] Frame buffer extended: ${nChannels} → ${modelChannelMax} ch` +
                    ` (models use channels beyond controller range)`,
            );
            nChannels = modelChannelMax;
        }

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

        // Allocate audio ring buffer: 50 slots × 12000 max samples ≈ 2.3 MB
        audioExportBuffer = AudioChunkRingBuffer.allocate(50, 12000);
        audioExportRing = new AudioChunkRingBuffer(audioExportBuffer, true);
        send({ type: 'audiobuffer', buffer: audioExportBuffer });
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
                    sendEzvcUpdate();
                    lastRFUpdatePN += 1000 * Math.floor((curPN - lastRFUpdatePN) / 1000);
                }
            }

            // See if a schedule update has been passed in.  If so, do something.
            if (installNewSchedule()) {
                const initializeTime = rtcConverter.computeTime(curPN); // MoC - Review
                const mainSched = (curSchedule ?? []).filter((s) => s.scheduleType === 'main');
                const bgSched = (curSchedule ?? []).filter((s) => s.scheduleType === 'background');
                const errs: string[] = [];

                // Rebuild when forced (reload / folder change) or when nothing is
                // playing, since there is nothing to disturb. Otherwise reconcile the
                // update into the running state so unrelated edits don't interrupt it.
                const playing = foregroundPlayerRunState.isPlaying || backgroundPlayerRunState.isPlaying;

                if (pendingFullRebuild || !playing) {
                    pendingFullRebuild = false;
                    emitInfo(`New schedule installed (rebuild)`);
                    const preserveFGFseqTime = foregroundPlayerRunState?.currentTime || initializeTime;
                    const preserveBGFseqTime = backgroundPlayerRunState?.currentTime || initializeTime;
                    foregroundPlayerRunState = new PlayerRunState(initializeTime);
                    backgroundPlayerRunState = new PlayerRunState(initializeTime);
                    foregroundPlayerRunState.setUpSequences(curSequences ?? [], curPlaylists ?? [], mainSched, errs);
                    backgroundPlayerRunState.setUpSequences(curSequences ?? [], curPlaylists ?? [], bgSched, errs);
                    foregroundPlayerRunState.addTimeRangeToSchedule(
                        initializeTime,
                        initializeTime + playbackParams.scheduleLoadTime,
                    );
                    backgroundPlayerRunState.addTimeRangeToSchedule(
                        initializeTime,
                        initializeTime + playbackParams.scheduleLoadTime,
                    );
                    lastPRSSchedUpdate = initializeTime + playbackParams.scheduleLoadTime;

                    // Make these caught up to the correct times from the last trip through...
                    foregroundPlayerRunState.runUntil(preserveFGFseqTime);
                    backgroundPlayerRunState.runUntil(preserveBGFseqTime);
                } else {
                    emitInfo(`New schedule installed (reconcile)`);
                    // Rebuild heap/upcoming over the window already loaded ahead of now.
                    const refillEnd = Math.max(lastPRSSchedUpdate, initializeTime);
                    foregroundPlayerRunState.applyDataUpdate(
                        curSequences ?? [],
                        curPlaylists ?? [],
                        mainSched,
                        errs,
                        initializeTime,
                        refillEnd,
                    );
                    backgroundPlayerRunState.applyDataUpdate(
                        curSequences ?? [],
                        curPlaylists ?? [],
                        bgSched,
                        errs,
                        initializeTime,
                        refillEnd,
                    );
                }

                if (errs.length) {
                    emitError(`New schedule install errors: ${errs.join('\n')}`);
                }

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
                mp3Cache.setNow(targetFrameRTC);
                mp3Cache.beginGeneration(); // new prefetch pass: items requested below are "live"
                const audioH = playbackParams.audioPrefetchTime;
                const sched = playbackParams.scheduleLoadTime;
                const prefetchAudio = (plays: ResolvedPlay[], tier: number) => {
                    for (const play of plays) {
                        let saf = play.seq?.files?.audio;
                        if (saf && !path.isAbsolute(saf)) saf = path.join(showFolder!, saf);
                        if (!saf) continue;
                        mp3Cache!.prefetchMP3({
                            mp3file: saf,
                            needByTime: play.atTime,
                            neededThroughTime: play.atTime + (play.durationMS ?? 600000),
                            estDurationSec: play.durationMS ? play.durationMS / 1000 : undefined,
                            tier,
                            expiry: targetFrameRTC + 7 * 24 * 3600_000,
                        });
                    }
                };
                // Audio is foreground-only: happy path + speculative skip / down-stack branches.
                const specH = Math.min(audioH, SPECULATIVE_HORIZON_MS);
                prefetchAudio(
                    enumerateResolvedPlays(foregroundPlayerRunState, targetFrameRTC, audioH, sched),
                    PREFETCH_TIER.HAPPY,
                );
                prefetchAudio(
                    enumerateResolvedPlays(foregroundPlayerRunState, targetFrameRTC, specH, sched, (s, at) =>
                        s.skipCurrentSequence(undefined, at),
                    ),
                    PREFETCH_TIER.SPECULATIVE,
                );
                prefetchAudio(
                    enumerateResolvedPlays(foregroundPlayerRunState, targetFrameRTC, specH, sched, (s, at) =>
                        s.stopImmediately(at),
                    ),
                    PREFETCH_TIER.SPECULATIVE,
                );
                mp3Cache.dispatch();
            }

            if (doFseqPrefetch) {
                fseqCache.setNow(targetFrameRTC);
                fseqCache.beginGeneration(); // new prefetch pass (covers fg + bg): requested items are "live"
                const sched = playbackParams.scheduleLoadTime;
                const fgH = playbackParams.foregroundFseqPrefetchTime;
                const bgH = playbackParams.backgroundFseqPrefetchTime;
                const frameGate = targetFrameRTC + playbackParams.foregroundFseqPrefetchTime;
                const prefetchFseq = (plays: ResolvedPlay[], tier: number) => {
                    for (const play of plays) {
                        let fsf = play.seq?.files?.fseq;
                        if (fsf && !path.isAbsolute(fsf)) fsf = path.join(showFolder!, fsf);
                        if (!fsf) continue;
                        // Always fetch the header.
                        fseqCache!.prefetchSeqMetadata({ fseqfile: fsf, needByTime: play.atTime, tier });
                        // Frames only for the imminent window.
                        if (play.atTime >= frameGate) continue;
                        let ourDur = frameGate - play.atTime;
                        if (play.durationMS !== undefined) ourDur = Math.min(ourDur, play.durationMS);
                        fseqCache!.prefetchSeqTimes({
                            fseqfile: fsf,
                            needByTime: play.atTime,
                            startTime: play.offsetMS,
                            durationms: ourDur,
                            tier,
                        });
                    }
                };
                // Foreground happy path, then background, then speculative skip / down-stack of fg.
                prefetchFseq(
                    enumerateResolvedPlays(foregroundPlayerRunState, targetFrameRTC, fgH, sched),
                    PREFETCH_TIER.HAPPY,
                );
                prefetchFseq(
                    enumerateResolvedPlays(backgroundPlayerRunState, targetFrameRTC, bgH, sched),
                    PREFETCH_TIER.BACKGROUND,
                );
                const specH = Math.min(fgH, SPECULATIVE_HORIZON_MS);
                prefetchFseq(
                    enumerateResolvedPlays(foregroundPlayerRunState, targetFrameRTC, specH, sched, (s, at) =>
                        s.skipCurrentSequence(undefined, at),
                    ),
                    PREFETCH_TIER.SPECULATIVE,
                );
                prefetchFseq(
                    enumerateResolvedPlays(foregroundPlayerRunState, targetFrameRTC, specH, sched, (s, at) =>
                        s.stopImmediately(at),
                    ),
                    PREFETCH_TIER.SPECULATIVE,
                );
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
                // Silence carries no overlap: advance by its full length. Transitions to/from
                // music fade naturally against the music chunk's ramped edge.
                sendAudioChunk(quiet, startTime, curAudioSyncNum, 48000, 1, quiet.length);
            }

            // Send out audio in advance (at least sendAudioInAdvanceMs at all times)
            // Skip audio entirely while paused
            if (!isPaused)
                emitAudioDebug(
                    `Send audio time: ${audioPlayerRunTime} vs ${targetFrameRTC + playbackParams.sendAudioInAdvanceMs}`,
                );
            // Take one snapshot and advance it as audioPlayerRunTime progresses
            const audioSnapshot = !isPaused ? foregroundPlayerRunState?.snapshot() : undefined;
            let aiter = 0;
            while (
                !isPaused &&
                audioSnapshot &&
                audioPlayerRunTime <= targetFrameRTC + playbackParams.sendAudioInAdvanceMs
            ) {
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
                    const curAudioSeq = audioAction.seq;
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
                            const msToSend = playbackParams.sendAudioChunkMs; // hop
                            const hopFrames = Math.round((msToSend * audio.sampleRate) / 1000);
                            const overlapFrames = Math.round(
                                (playbackParams.audioCrossfadeMs * audio.sampleRate) / 1000,
                            );
                            // Window = hop + overlap. The trailing overlap reads ahead into the
                            // next hop's audio (out-of-range past end reads as 0), and is ramped
                            // down so it crossfades with the next chunk's ramped-up head.
                            const windowFrames = hopFrames + overlapFrames;

                            const chunk = buildInterleavedAudioChunkFromSegments({
                                channelData: audio.channelData,
                                nSamplesInAudio: audio.nSamples,
                                sampleOffset,
                                nSamples: windowFrames,
                                volumeSF,
                            });
                            applyCrossfadeRamp(chunk, channels, overlapFrames);

                            const playAtRealTime = Math.floor(
                                audioPlayerRunTime + (playbackParams?.audioTimeAdjMs ?? 0),
                            );

                            if (audioPlayerRunTime >= targetFrameRTC) {
                                sendAudioChunk(
                                    chunk,
                                    playAtRealTime,
                                    curAudioSyncNum,
                                    audio.sampleRate,
                                    channels,
                                    hopFrames * channels,
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

            const curForegroundSeq = foregroundAction.seq;
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
                const curBackgroundSeq = backgroundAction.seq;
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
