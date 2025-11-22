//import { app } from "electron";
import { fileURLToPath } from 'url';

import * as path from 'path';

import { BrowserWindow, ipcMain } from 'electron';

import { Worker } from 'node:worker_threads';

import {
    loadPlaylistsAPI,
    loadScheduleAPI,
    loadSequencesAPI,
    loadShowProfileAPI,
    loadStatusAPI,
    loadUserProfileAPI,
    saveSequencesAPI,
    savePlaylistsAPI,
    saveScheduleAPI,
    saveShowProfileAPI,
    saveUserProfileAPI,
    blankShowProfile,
    blankUserProfile,
} from './data/FileStorage.js';

import {
    applySettingsFromRenderer,
    getSettingsCache,
    loadSettingsFromDisk,
} from './data/SettingsStorage.js';

import type {
    CombinedPlayerStatus,
    EndUser,
    EndUserShowSettings,
    PlaybackSettings,
    PlaylistRecord,
    ScheduledPlaylist,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';

import { FSEQReaderAsync } from '@ezplayer/epp';

import { mergePlaylists, mergeSchedule, mergeSequences } from '@ezplayer/ezplayer-core';

import type { AudioTimeSyncM2R, AudioTimeSyncR2M, EZPlayerCommand } from '@ezplayer/ezplayer-core';

import {
    PlayerCommand,
    type MainRPCAPI,
    type PlayWorkerRPCAPI,
    WorkerToMainMessage,
    AudioTimeSyncWorker,
} from './workers/playbacktypes.js';
import { RPCClient, RPCServer } from './workers/rpc.js';
import { ClockConverter } from '../sharedsrc/ClockConverter.js';
import { getCurrentShowFolder, pickAnotherShowFolder } from '../showfolder.js';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// For better or worse, we'll keep the state here, as globals
export let curSequences: SequenceRecord[] = [];
export let curPlaylists: PlaylistRecord[] = [];
export let curSchedule: ScheduledPlaylist[] = [];
export let curStatus: CombinedPlayerStatus = {};
export let curErrors: string[] = [];
export let curShow: EndUserShowSettings | undefined = undefined;
export let curUser: EndUser | undefined = undefined;

let updateWindow: BrowserWindow | null = null;
let playWorker: Worker | null = null;
let commandSeqNum = 1;

// Passes our current info to the player
//  (We may not always do this, if we do not wish to disrupt the playback)
function scheduleUpdated() {
    playWorker?.postMessage({
        type: 'schedupdate',
        seqs: curSequences,
        pls: curPlaylists,
        showFolder: getCurrentShowFolder() ?? '<no show folder yet>',
        sched: curSchedule.filter((e) => !e.deleted),
    } satisfies PlayerCommand);
}

export async function loadShowFolder() {
    const showFolder = getCurrentShowFolder();
    if (!showFolder) {
        return;
    }
    curSequences = await loadSequencesAPI(showFolder);
    curPlaylists = await loadPlaylistsAPI(showFolder);
    curSchedule = await loadScheduleAPI(showFolder);
    curShow = await loadShowProfileAPI(showFolder);
    curUser = await loadUserProfileAPI(showFolder);
    await loadSettingsFromDisk(path.join(showFolder, 'playbackSettings.json'));

    updateWindow?.webContents?.send('update:showFolder', showFolder);
    updateWindow?.webContents?.send(
        'update:sequences',
        curSequences.filter((s) => !s.deleted),
    );
    updateWindow?.webContents?.send(
        'update:playlist',
        curPlaylists.filter((s) => !s.deleted),
    );
    updateWindow?.webContents?.send(
        'update:schedule',
        curSchedule.filter((s) => !s.deleted),
    );
    updateWindow?.webContents?.send('update:user', curUser);
    updateWindow?.webContents?.send('update:show', curShow);
    updateWindow?.webContents?.send('update:combinedstatus', curStatus);
    updateWindow?.webContents?.send('update:playbacksettings', getSettingsCache());

    scheduleUpdated();
}

const audioConverter = new ClockConverter('audio', 0, performance.now());
let lastAudioLatency: number = 10;
let rtConverter: ClockConverter | undefined = undefined;

const handlers: MainRPCAPI = {
    add: ({ a, b }) => a + b,
    fail: ({ msg }) => {
        throw new Error(msg);
    },
    timesync: () => {
        const pn = performance.now();
        return {
            realTime: rtConverter ? rtConverter.computeTime(pn) : undefined,
            perfNowTime: performance.now(),
            audioCtxIncarnation: audioConverter.curIncarnation,
            audioCtxTime: audioConverter.computeTime(),
            latency: lastAudioLatency,
        } satisfies AudioTimeSyncWorker;
    },
};

let rpcc: RPCClient<PlayWorkerRPCAPI> | undefined = undefined;

export async function registerContentHandlers(mainWindow: BrowserWindow | null, realTimeClock: ClockConverter, nPlayWorker: Worker) {
    updateWindow = mainWindow;
    rtConverter = realTimeClock;
    playWorker = nPlayWorker;

    ipcMain.handle('ipcUIConnect', async (_event): Promise<void> => {
        await loadShowFolder();
    });
    ipcMain.handle('ipcUIDisconnect', async (_event): Promise<void> => {
        return Promise.resolve();
    });

    ipcMain.handle('ipcUIChooseShowFolder', async (_event): Promise<string> => {
        const sf = await pickAnotherShowFolder();
        await loadShowFolder();
        return sf!;
    });

    ipcMain.handle('ipcGetCloudSequences', async (_event): Promise<SequenceRecord[]> => {
        return Promise.resolve(curSequences);
    });
    ipcMain.handle('ipcPutCloudSequences', async (_event, recs: SequenceRecord[]): Promise<SequenceRecord[]> => {
        // TODO Cloud sync if that makes sense...
        // TODO calculate any times if needed
        // TODO calculate any effect on the schedule
        const uppl = recs.map((r) => {
            return { ...r, updatedAt: Date.now() };
        });
        for (const ups of uppl) {
            if (!ups?.work?.length && ups.files?.fseq) {
                const fseq = new FSEQReaderAsync(ups.files.fseq);
                await fseq.open();
                const frameTime = fseq.header!.msperframe; // 50 -> 20FPS, 25 -> 40 FPS, 20 -> 50 FPS, 10 -> 100 FPS
                const nframes = fseq.header!.frames;
                ups.work.length = (frameTime * nframes) / 1000;
                await fseq.close();
            }
        }
        const updList = mergeSequences(uppl, curSequences ?? []);
        const showFolder = getCurrentShowFolder();
        if (showFolder) await saveSequencesAPI(showFolder, updList);
        curSequences = updList;
        scheduleUpdated();
        return updList.filter((r) => r.deleted !== true);
    });

    ipcMain.handle('ipcGetCloudPlaylists', async (_event): Promise<PlaylistRecord[]> => {
        return Promise.resolve(curPlaylists);
        //return await loadPlaylistsAPI(showFolder);
    });
    ipcMain.handle('ipcPutCloudPlaylists', async (_event, recs: PlaylistRecord[]): Promise<PlaylistRecord[]> => {
        const uppl = recs.map((r) => {
            return { ...r, updatedAt: Date.now() };
        });
        // TODO Cloud sync if that makes sense...
        const updList = mergePlaylists(uppl, curPlaylists);
        const showFolder = getCurrentShowFolder();
        if (showFolder) await savePlaylistsAPI(showFolder, updList);
        curPlaylists = updList;
        scheduleUpdated();
        return updList.filter((r) => r.deleted !== true);
    });

    ipcMain.handle('ipcGetCloudSchedule', async (_event): Promise<ScheduledPlaylist[]> => {
        return Promise.resolve(curSchedule);
    });
    ipcMain.handle('ipcPutCloudSchedule', async (_event, recs: ScheduledPlaylist[]): Promise<ScheduledPlaylist[]> => {
        const uppl = recs.map((r) => {
            return { ...r, updatedAt: Date.now() };
        });
        const updList = mergeSchedule(uppl, curSchedule);
        const showFolder = getCurrentShowFolder();
        if (showFolder) await saveScheduleAPI(showFolder, updList);
        curSchedule = updList;
        scheduleUpdated();
        return updList.filter((r) => r.deleted !== true);
    });

    ipcMain.handle('ipcGetCloudStatus', async (_event): Promise<CombinedPlayerStatus> => {
        return await loadStatusAPI();
    });

    ipcMain.handle('ipcGetCloudShowProfile', async (_event): Promise<EndUserShowSettings> => {
        return Promise.resolve(curShow ?? blankShowProfile);
    });
    ipcMain.handle(
        'ipcPutCloudShowProfile',
        async (_event, data: EndUserShowSettings): Promise<EndUserShowSettings> => {
            const showFolder = getCurrentShowFolder();
            if (showFolder) await saveShowProfileAPI(showFolder, data);
            curShow = data;
            return Promise.resolve(curShow!);
        },
    );
    ipcMain.handle('ipcGetCloudUserProfile', async (_event): Promise<EndUser> => {
        return Promise.resolve(curUser ?? blankUserProfile);
    });
    ipcMain.handle('ipcPutCloudUserProfile', async (_event, data: Partial<EndUser>): Promise<EndUser> => {
        const ndata = { ...(curUser ?? blankUserProfile), ...data };
        const showFolder = getCurrentShowFolder();
        if (showFolder) await saveUserProfileAPI(showFolder, ndata);
        curUser = ndata;
        return ndata;
    });
    ipcMain.handle('ipcImmediatePlayCommand', async (_event, cmd: EZPlayerCommand): Promise<Boolean> => {
        if (cmd.command === 'resetplayback') {
            loadShowFolder();
        }
        if (!playWorker) {
            console.log(`No player worker`);
            return false;
        }
        playWorker.postMessage({
            type: 'frontendcmd',
            cmd,
        } as PlayerCommand);
        return true;
    });
    ipcMain.handle('ipcSetPlaybackSettings', async (_event, s: PlaybackSettings): Promise<Boolean> => {
        const showFolder = getCurrentShowFolder();
        if (showFolder) applySettingsFromRenderer(path.join(showFolder, 'playbackSettings.json'), s);
        return true;
    });
    ipcMain.handle('audio:syncr2m', (_event, data: AudioTimeSyncR2M): void => {
        audioConverter.setTime(data.audioCtxTime, data.perfNowTime, data.incarnation);
    });
    ipcMain.handle('audio:getm2r', (_event): AudioTimeSyncM2R => {
        return {
            perfNowTime: performance.now(),
            realTime: Date.now(),
        };
    });

    /// Connection from player worker thread

    const rpcs = new RPCServer<MainRPCAPI>(playWorker, handlers);
    rpcc = new RPCClient<PlayWorkerRPCAPI>(playWorker);

    playWorker.on('message', (msg: WorkerToMainMessage) => {
        switch (msg.type) {
            case 'audioChunk': {
                mainWindow?.webContents.send('audio:chunk', msg.chunk);
                break;
            }
            case 'stats': {
                mainWindow?.webContents.send('playback:stats', msg.stats);
                break;
            }
            case 'cstatus': {
                const nstatus: CombinedPlayerStatus = {
                    ...curStatus,
                    content: msg.status,
                    content_updated: Date.now(),
                };
                curStatus = nstatus;
                mainWindow?.webContents.send('playback:cstatus', msg.status);
                break;
            }
            case 'nstatus': {
                const nstatus: CombinedPlayerStatus = {
                    ...curStatus,
                    controller: msg.status,
                    controller_updated: Date.now(),
                };
                curStatus = nstatus;
                mainWindow?.webContents.send('playback:nstatus', msg.status);
                break;
            }
            case 'pstatus': {
                const nstatus: CombinedPlayerStatus = {
                    ...curStatus,
                    player: msg.status,
                    player_updated: Date.now(),
                };
                curStatus = nstatus;
                mainWindow?.webContents.send('playback:pstatus', msg.status);
                break;
            }
            case 'rpc': {
                rpcs.dispatchRequest(msg.rpc).catch((e) => {
                    console.error(`THIS SHOULD NOT HAPPEN - RPC should SEND ERROR BACK - ${e}`);
                });
                break;
            }
            case 'rpc-response': {
                rpcc!.dispatchResponse(msg.response);
                break;
            }
        }
    });
}
