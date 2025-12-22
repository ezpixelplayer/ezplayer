//import { app } from "electron";
import { fileURLToPath } from 'url';

import * as path from 'path';
import * as fs from 'fs';

import { BrowserWindow, ipcMain } from 'electron';

import { Worker } from 'node:worker_threads';
import fsp from 'fs/promises';
import { randomUUID } from 'crypto';

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
    type SequenceAssetConfig,
} from './data/FileStorage.js';

import { applySettingsFromRenderer, getSettingsCache, loadSettingsFromDisk } from './data/SettingsStorage.js';

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

import type { EZPlayerCommand } from '@ezplayer/ezplayer-core';

import { PlayerCommand, type MainRPCAPI, type PlayWorkerRPCAPI, WorkerToMainMessage } from './workers/playbacktypes.js';
import { RPCClient, RPCServer } from './workers/rpc.js';
import { getCurrentShowFolder, pickAnotherShowFolder } from '../showfolder.js';
import { wsBroadcaster } from './websocket-broadcaster.js';

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

// Exported handler functions that can be called from both IPC and REST endpoints
export async function updatePlaylistsHandler(recs: PlaylistRecord[]): Promise<PlaylistRecord[]> {
    const uppl = recs.map((r) => {
        return { ...r, updatedAt: Date.now() };
    });
    const updList = mergePlaylists(uppl, curPlaylists);
    const showFolder = getCurrentShowFolder();
    if (showFolder) {
        await savePlaylistsAPI(showFolder, updList);
    }
    curPlaylists = updList;
    const filtered = updList.filter((r) => r.deleted !== true);
    updateWindow?.webContents?.send('update:playlist', filtered);
    wsBroadcaster.broadcast('update:playlist', filtered);
    scheduleUpdated();
    return filtered;
}

export async function updateScheduleHandler(recs: ScheduledPlaylist[]): Promise<ScheduledPlaylist[]> {
    const uppl = recs.map((r) => {
        return { ...r, updatedAt: Date.now() };
    });
    const updList = mergeSchedule(uppl, curSchedule);
    const showFolder = getCurrentShowFolder();
    if (showFolder) {
        await saveScheduleAPI(showFolder, updList);
    }
    curSchedule = updList;
    const filtered = updList.filter((r) => r.deleted !== true);
    updateWindow?.webContents?.send('update:schedule', filtered);
    wsBroadcaster.broadcast('update:schedule', filtered);
    scheduleUpdated();
    return filtered;
}

let updateWindow: BrowserWindow | null = null;
let playWorker: Worker | null = null;
let commandSeqNum = 1;
let sequenceAssetsConfig: SequenceAssetConfig | undefined;

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
    curSequences = await loadSequencesAPI(showFolder, sequenceAssetsConfig);
    curPlaylists = await loadPlaylistsAPI(showFolder);
    curSchedule = await loadScheduleAPI(showFolder);
    curShow = await loadShowProfileAPI(showFolder);
    curUser = await loadUserProfileAPI(showFolder);
    await loadSettingsFromDisk(path.join(showFolder, 'playbackSettings.json'));

    let sequenceAssetsUpdated = false;
    for (const seq of curSequences) {
        const mutated = await ensureSequenceThumbAvailability(seq, showFolder);
        sequenceAssetsUpdated = sequenceAssetsUpdated || mutated;
    }
    if (sequenceAssetsUpdated) {
        await saveSequencesAPI(showFolder, curSequences);
    }

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

    // Broadcast via WebSocket (for React web app)
    wsBroadcaster.broadcast('update:showFolder', showFolder);
    wsBroadcaster.broadcast(
        'update:sequences',
        curSequences.filter((s) => !s.deleted),
    );
    wsBroadcaster.broadcast(
        'update:playlist',
        curPlaylists.filter((s) => !s.deleted),
    );
    wsBroadcaster.broadcast(
        'update:schedule',
        curSchedule.filter((s) => !s.deleted),
    );
    if (curUser) wsBroadcaster.broadcast('update:user', curUser);
    if (curShow) wsBroadcaster.broadcast('update:show', curShow);
    wsBroadcaster.broadcast('update:combinedstatus', curStatus);

    const settings = getSettingsCache();
    if (settings) {
        playWorker?.postMessage({
            type: 'settings',
            settings,
        } as PlayerCommand);
    }
    scheduleUpdated();
}

const SONG_IMAGE_SUBDIR = path.join('assets', 'song-images');
const DEFAULT_USER_IMAGE_ROUTE = '/api/getimage';

function sanitizeBaseUrl(url?: string): string | undefined {
    if (!url) {
        return undefined;
    }
    const trimmed = url.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed.replace(/\/+$/, '');
}

function normalizePublicRoute(route?: string): string {
    if (!route) {
        return DEFAULT_USER_IMAGE_ROUTE;
    }
    const trimmed = route.trim();
    if (!trimmed) {
        return DEFAULT_USER_IMAGE_ROUTE;
    }
    const ensured = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return ensured.replace(/\/+$/, '');
}

function setSequenceAssetConfig(config?: SequenceAssetConfig) {
    if (!config?.imageStorageRoot) {
        sequenceAssetsConfig = undefined;
        return;
    }
    sequenceAssetsConfig = {
        imageStorageRoot: path.resolve(config.imageStorageRoot),
        imagePublicRoute: normalizePublicRoute(config.imagePublicRoute),
        imagePublicBaseUrl: sanitizeBaseUrl(config.imagePublicBaseUrl),
    };
}

async function ensureSequenceThumbAvailability(seq: SequenceRecord, showFolder: string): Promise<boolean> {
    if (!seq.files) return false;
    let mutated = false;
    const previousPublicUrl = seq.files.thumbPublicUrl;

    if (!seq.files.thumb) {
        if (previousPublicUrl && seq.work?.artwork === previousPublicUrl) {
            delete seq.work.artwork;
            mutated = true;
        }
        if (previousPublicUrl) {
            delete seq.files.thumbPublicUrl;
            mutated = true;
        }
        return mutated;
    }

    // Get sequence ID - use id or instanceId, fallback to generating one
    const baseId = seq.id || seq.instanceId;
    if (!baseId) {
        console.warn(`Sequence missing ID, cannot save image:`, seq);
        return mutated;
    }

    const resolvedShowFolder = path.resolve(showFolder);
    const resolvedThumb = path.resolve(seq.files.thumb);
    const configuredStorageRoot = sequenceAssetsConfig?.imageStorageRoot;
    const storageRoot = configuredStorageRoot ?? path.join(resolvedShowFolder, SONG_IMAGE_SUBDIR);
    const resolvedStorageRoot = path.resolve(storageRoot);
    const publicRoutePrefix = sequenceAssetsConfig?.imagePublicRoute ?? '/api/getimage';
    const storageRootWithSep = resolvedStorageRoot + path.sep;

    // Determine the file extension from the source image
    const ext = path.extname(resolvedThumb) || '.png';
    const sanitizedId = baseId.replace(/[^a-zA-Z0-9-_]/g, '');
    const assetName = `${sanitizedId}${ext}`;
    const destinationPath = path.join(resolvedStorageRoot, assetName);
    const isInsideStorageRoot = resolvedThumb === destinationPath || resolvedThumb.startsWith(storageRootWithSep);

    // If image is not already in the storage root with the correct name, copy it
    if (!isInsideStorageRoot || path.basename(resolvedThumb) !== assetName) {
        try {
            await fsp.access(resolvedThumb, fs.constants.R_OK);
        } catch (err) {
            console.warn(`Unable to access uploaded image ${resolvedThumb}:`, err);
            return mutated;
        }
        await fsp.mkdir(resolvedStorageRoot, { recursive: true });
        await fsp.copyFile(resolvedThumb, destinationPath);
        if (seq.files.thumb !== destinationPath) {
            seq.files.thumb = destinationPath;
            mutated = true;
        }
    }

    // Generate public URL using sequence ID
    const baseUrl = sequenceAssetsConfig?.imagePublicBaseUrl;
    const publicUrl = baseUrl ? `${baseUrl}${publicRoutePrefix}/${sanitizedId}` : `${publicRoutePrefix}/${sanitizedId}`;

    if (seq.files.thumbPublicUrl !== publicUrl) {
        seq.files.thumbPublicUrl = publicUrl;
        mutated = true;
    }
    if (seq.work && (!seq.work.artwork || seq.work.artwork === previousPublicUrl) && seq.work.artwork !== publicUrl) {
        seq.work.artwork = publicUrl;
        mutated = true;
    }

    return mutated;
}

const handlers: MainRPCAPI = {
    add: ({ a, b }) => a + b,
    fail: ({ msg }) => {
        throw new Error(msg);
    },
};

let rpcc: RPCClient<PlayWorkerRPCAPI> | undefined = undefined;

export async function registerContentHandlers(
    mainWindow: BrowserWindow | null,
    nPlayWorker: Worker,
    options?: {
        sequenceAssets?: SequenceAssetConfig;
    },
) {
    updateWindow = mainWindow;
    playWorker = nPlayWorker;
    setSequenceAssetConfig(options?.sequenceAssets);

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
        const showFolder = getCurrentShowFolder();
        if (showFolder) {
            for (const seq of uppl) {
                await ensureSequenceThumbAvailability(seq, showFolder);
            }
        }
        const updList = mergeSequences(uppl, curSequences ?? []);
        if (showFolder) {
            for (const seq of updList) {
                await ensureSequenceThumbAvailability(seq, showFolder);
            }
            await saveSequencesAPI(showFolder, updList);
        }
        curSequences = updList;
        const filtered = updList.filter((r) => r.deleted !== true);
        updateWindow?.webContents?.send('update:sequences', filtered);
        wsBroadcaster.broadcast('update:sequences', filtered);
        scheduleUpdated();
        return filtered;
    });

    ipcMain.handle('ipcGetCloudPlaylists', async (_event): Promise<PlaylistRecord[]> => {
        return Promise.resolve(curPlaylists);
        //return await loadPlaylistsAPI(showFolder);
    });
    ipcMain.handle('ipcPutCloudPlaylists', async (_event, recs: PlaylistRecord[]): Promise<PlaylistRecord[]> => {
        return await updatePlaylistsHandler(recs);
    });

    ipcMain.handle('ipcGetCloudSchedule', async (_event): Promise<ScheduledPlaylist[]> => {
        return Promise.resolve(curSchedule);
    });
    ipcMain.handle('ipcPutCloudSchedule', async (_event, recs: ScheduledPlaylist[]): Promise<ScheduledPlaylist[]> => {
        return await updateScheduleHandler(recs);
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
            updateWindow?.webContents?.send('update:show', curShow);
            wsBroadcaster.broadcast('update:show', curShow);
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
        updateWindow?.webContents?.send('update:user', curUser);
        wsBroadcaster.broadcast('update:user', curUser);
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
    ipcMain.handle('ipcSetPlaybackSettings', async (_event, settings: PlaybackSettings): Promise<Boolean> => {
        const showFolder = getCurrentShowFolder();
        if (showFolder) applySettingsFromRenderer(path.join(showFolder, 'playbackSettings.json'), settings);
        playWorker?.postMessage({
            type: 'settings',
            settings,
        } as PlayerCommand);
        // Broadcast to all clients (Electron renderer and web app)
        updateWindow?.webContents?.send('update:playbacksettings', settings);
        wsBroadcaster.broadcast('update:playbacksettings', settings);
        return true;
    });

    /// Connection from player worker thread

    const rpcs = new RPCServer<MainRPCAPI>(playWorker, handlers);
    rpcc = new RPCClient<PlayWorkerRPCAPI>(playWorker);

    playWorker.on('message', (msg: WorkerToMainMessage) => {
        switch (msg.type) {
            case 'audioChunk': {
                mainWindow?.webContents.send('audio:chunk', msg.chunk);
                wsBroadcaster.broadcast('audio:chunk', msg.chunk);
                break;
            }
            case 'stats': {
                mainWindow?.webContents.send('playback:stats', msg.stats);
                wsBroadcaster.broadcast('playback:stats', msg.stats);
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
                wsBroadcaster.broadcast('playback:cstatus', msg.status);
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
                wsBroadcaster.broadcast('playback:nstatus', msg.status);
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
                wsBroadcaster.broadcast('playback:pstatus', msg.status);
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

/**
 * Get current show data for sending to newly connected WebSocket clients
 * This allows the React web app to receive all existing data on first connection
 */
export function getCurrentShowData() {
    return {
        showFolder: getCurrentShowFolder(),
        sequences: curSequences.filter((seq) => !seq.deleted),
        playlists: curPlaylists.filter((pl) => !pl.deleted),
        schedule: curSchedule.filter((item) => !item.deleted),
        user: curUser,
        show: curShow,
        status: curStatus,
    };
}
