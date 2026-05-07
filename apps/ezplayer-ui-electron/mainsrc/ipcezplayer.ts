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

import { applySettingsFromRenderer, getSettingsCache, loadSettingsFromDisk } from './data/SettingsStorage.js';
import {
    getCloudConfigCache,
    loadCloudConfigFromDisk,
    updateCloudConfig,
} from './data/CloudConfigStorage.js';
import { ensureEzplayerSubdir, settingsPath } from './data/SettingsMigration.js';
import {
    getCurrentCloudStatus,
    getCurrentCStatus,
    fetchLayoutNow,
    manifestPollNow,
    onCloudStatus,
    onCStatus,
    onInstallSequence,
    onLayoutInstalled,
    pollCloudNow,
    setCloudWorkerConfig,
    updateCloudWorkerSequences,
} from './workers/cloudpollparent.js';
import { autoDetectSongFilesFromFseq, extractAudioTagMetadata } from './data/song-file-autodetect.js';

import type {
    CloudCommand,
    CombinedPlayerStatus,
    EndUser,
    EndUserShowSettings,
    FullPlayerState,
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
import {
    getCurrentShowFolder,
    isValidShowDirectory,
    pickAnotherShowFolder,
    pickCloudShowFolder,
} from '../showfolder.js';
import { getServerStatus } from './server-worker-manager.js';
import {
    updateFrameBuffer,
    updateAudioBuffer,
    broadcastToWebSocket,
    pushModelCoordinates,
    clearShowData,
} from './server-worker-manager.js';

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
export let curFrameBuffer: SharedArrayBuffer | undefined = undefined;
let rpcc: RPCClient<PlayWorkerRPCAPI> | undefined = undefined;

export function getSequenceThumbnail(id: string) {
    const seq = curSequences?.find((s) => s.id === id);
    if (seq?.files?.thumb) {
        if (path.isAbsolute(seq.files.thumb)) {
            return seq.files.thumb;
        }
        const sf = getCurrentShowFolder();
        if (sf) {
            return path.join(sf, seq.files.thumb);
        }
        return seq.files.thumb;
    }
    return undefined;
}

export function isScheduleActive(): boolean {
    const player = curStatus.player;
    if (!player || player.status !== 'Playing') return false;
    const nowPlaying = player.now_playing;
    return !!(nowPlaying && nowPlaying.type === 'Scheduled');
}

/**
 * Tell player RPC to stop playing (for shutdown).
 */
export async function stopPlayerPlayback(): Promise<boolean> {
    try {
        const res = await rpcc?.call('stopPlayback', {});
        return !!res;
    } catch (err) {
        console.error(`Failed to stop player playback: ${err}`);
        return false;
    }
}

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
    broadcastToWebSocket('playlists', filtered);
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
    broadcastToWebSocket('schedule', filtered);
    scheduleUpdated();
    return filtered;
}

let updateWindow: BrowserWindow | null = null;
let playWorker: Worker | null = null;

/** Common sequence-upsert path used by both the renderer-driven IPC and the cloud
 *  content sync. Runs `mergeSequences`, persists, broadcasts to renderer + WS, kicks
 *  the playback worker, and refreshes the cloud worker's local-sequences cache. */
async function commitSequenceUpdates(uppl: SequenceRecord[]): Promise<SequenceRecord[]> {
    const showFolder = getCurrentShowFolder();
    const updList = mergeSequences(uppl, curSequences ?? []);
    if (showFolder) {
        await saveSequencesAPI(showFolder, updList);
    }
    curSequences = updList;
    const filtered = updList.filter((r) => r.deleted !== true);
    updateWindow?.webContents?.send('update:sequences', filtered);
    broadcastToWebSocket('sequences', filtered);
    scheduleUpdated();
    updateCloudWorkerSequences(curSequences);
    return filtered;
}

// Passes our current info to the player
//  (We may not always do this, if we do not wish to disrupt the playback)
function scheduleUpdated(forceRestart?: boolean) {
    playWorker?.postMessage({
        type: 'schedupdate',
        seqs: curSequences,
        pls: curPlaylists,
        showFolder: getCurrentShowFolder() ?? '<no show folder yet>',
        sched: curSchedule.filter((e) => !e.deleted),
        forceRestart,
    } satisfies PlayerCommand);
}

export async function loadShowFolder(forceRestart?: boolean) {
    const showFolder = getCurrentShowFolder();
    if (!showFolder) {
        return;
    }

    // Immediately clear cached show data in the server worker so stale
    // model coordinates, view objects, layout settings, and frame buffers
    // from the previous show folder are never served to the frontend.
    clearShowData();

    // All our JSON lives under `.ezplayer/` in the show folder. Run this BEFORE any
    // loader so that, on first run against an old folder, root-level files are moved
    // into the subdir and the loaders read the migrated copies on this same tick.
    await ensureEzplayerSubdir(showFolder);

    curSequences = await loadSequencesAPI(showFolder);
    curPlaylists = await loadPlaylistsAPI(showFolder);
    curSchedule = await loadScheduleAPI(showFolder);
    curShow = await loadShowProfileAPI(showFolder);
    curUser = await loadUserProfileAPI(showFolder);
    await loadSettingsFromDisk(settingsPath(showFolder, 'playbackSettings.json'));
    const cloudConfig = await loadCloudConfigFromDisk(settingsPath(showFolder, 'cloud-config.json'));
    setCloudWorkerConfig(
        cloudConfig.cloudServiceUrl,
        cloudConfig.playerIdToken,
        showFolder,
        curSequences,
    );

    updateWindow?.webContents?.send('update:cloudConfig', cloudConfig);
    updateWindow?.webContents?.send('update:cloudStatus', getCurrentCloudStatus());
    broadcastToWebSocket('cloudConfig', cloudConfig);
    broadcastToWebSocket('cloudStatus', getCurrentCloudStatus());

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
    broadcastToWebSocket('showFolder', showFolder);
    broadcastToWebSocket(
        'sequences',
        curSequences.filter((s) => !s.deleted),
    );
    broadcastToWebSocket(
        'playlists',
        curPlaylists.filter((s) => !s.deleted),
    );
    broadcastToWebSocket(
        'schedule',
        curSchedule.filter((s) => !s.deleted),
    );
    if (curUser) broadcastToWebSocket('user', curUser);
    if (curShow) broadcastToWebSocket('show', curShow);
    broadcastToWebSocket('cStatus', curStatus.content);
    broadcastToWebSocket('nStatus', curStatus.controller);
    broadcastToWebSocket('pStatus', curStatus.player);

    const settings = getSettingsCache();
    if (settings) {
        playWorker?.postMessage({
            type: 'settings',
            settings,
        } as PlayerCommand);
        broadcastToWebSocket('playbackSettings', settings);
    }
    scheduleUpdated(forceRestart);
}

const handlers: MainRPCAPI = {
    add: ({ a, b }) => a + b,
    fail: ({ msg }) => {
        throw new Error(msg);
    },
};

/** Single dispatcher for renderer-issued cloud commands. New verbs only need a
 *  variant on `CloudCommand` and a case here. The renderer hits this via either
 *  `ipcCloudCommand` (electron) or the koa server-worker's RPC route (embedded). */
export function dispatchCloudCommand(cmd: CloudCommand): void {
    switch (cmd.type) {
        case 'syncNow':
            manifestPollNow();
            break;
        case 'fetchLayoutNow':
            fetchLayoutNow();
            break;
        case 'pollNow':
            pollCloudNow();
            break;
        case 'setPlayerIdToken':
            applyPlayerIdToken(cmd.token);
            break;
        case 'setCloudServiceUrl':
            applyCloudServiceUrl(cmd.url);
            break;
        default: {
            const _exhaustive: never = cmd;
            console.warn('[cloud-command] unknown verb', _exhaustive);
        }
    }
}

/** Update the persisted player ID token and reconfigure the cloud poller. Called from
 *  the renderer (electron IPC) and from the embedded UI (koa worker → RPC). */
export function applyPlayerIdToken(token: string) {
    const cfg = updateCloudConfig({ playerIdToken: token ?? '' });
    setCloudWorkerConfig(
        cfg.cloudServiceUrl,
        cfg.playerIdToken,
        getCurrentShowFolder() ?? '',
        curSequences,
    );
    updateWindow?.webContents?.send('update:cloudConfig', cfg);
    broadcastToWebSocket('cloudConfig', cfg);
}

/** Update the persisted cloud service URL and reconfigure the cloud poller. */
export function applyCloudServiceUrl(url: string) {
    const cfg = updateCloudConfig({ cloudServiceUrl: url ?? '' });
    setCloudWorkerConfig(
        cfg.cloudServiceUrl,
        cfg.playerIdToken,
        getCurrentShowFolder() ?? '',
        curSequences,
    );
    updateWindow?.webContents?.send('update:cloudConfig', cfg);
    broadcastToWebSocket('cloudConfig', cfg);
}

export async function registerContentHandlers(
    mainWindow: BrowserWindow | null,
    audioWindow: BrowserWindow | null,
    nPlayWorker: Worker,
) {
    updateWindow = mainWindow;
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
    ipcMain.handle('ipcUIChooseCloudShowFolder', async (_event): Promise<string> => {
        const sf = await pickCloudShowFolder();
        if (!sf) return '';
        // Seed `.ezplayer/cloud-config.json` with `layoutSource: 'cloud'` BEFORE
        // loadShowFolder runs, so the loaded config reflects cloud mode immediately.
        await ensureEzplayerSubdir(sf);
        const seedPath = settingsPath(sf, 'cloud-config.json');
        const existing = await loadCloudConfigFromDisk(seedPath);
        updateCloudConfig({
            // Preserve any URL/token already there (e.g. from a previous bootstrap attempt).
            cloudServiceUrl: existing.cloudServiceUrl,
            playerIdToken: existing.playerIdToken,
            layoutSource: 'cloud',
        });
        await loadShowFolder();
        return sf;
    });
    ipcMain.handle('ipcValidateShowDirectory', async (_event, showDirectory?: string) => {
        return await isValidShowDirectory(showDirectory ?? getCurrentShowFolder());
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
        return await commitSequenceUpdates(uppl);
    });

    ipcMain.handle('ipcAutoDetectSongFilesFromFseq', async (_event, fseqPath: string) => {
        return autoDetectSongFilesFromFseq(fseqPath);
    });
    ipcMain.handle('ipcExtractAudioTagMetadata', async (_event, audioPath: string) => {
        return extractAudioTagMetadata(audioPath);
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
            broadcastToWebSocket('show', curShow);
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
        broadcastToWebSocket('user', curUser);
        return ndata;
    });
    ipcMain.handle('ipcImmediatePlayCommand', async (_event, cmd: EZPlayerCommand): Promise<Boolean> => {
        if (cmd.command === 'resetplayback') {
            await loadShowFolder(true);
            return true;
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
        if (showFolder) applySettingsFromRenderer(settingsPath(showFolder, 'playbackSettings.json'), settings);
        playWorker?.postMessage({
            type: 'settings',
            settings,
        } as PlayerCommand);
        // Broadcast to all clients (Electron renderer and web app)
        updateWindow?.webContents?.send('update:playbacksettings', settings);
        broadcastToWebSocket('playbackSettings', settings);
        return true;
    });

    ipcMain.handle('ipcGetServerStatus', async (_event) => {
        return getServerStatus();
    });

    // Cloud config / status
    ipcMain.handle('ipcGetCloudConfig', async (_event) => {
        return getCloudConfigCache();
    });
    ipcMain.handle('ipcCloudCommand', async (_event, cmd: CloudCommand) => {
        dispatchCloudCommand(cmd);
    });
    ipcMain.handle('ipcGetCloudConnStatus', async (_event) => {
        return getCurrentCloudStatus();
    });

    onCloudStatus((status) => {
        updateWindow?.webContents?.send('update:cloudStatus', status);
        broadcastToWebSocket('cloudStatus', status);
    });

    onCStatus((cStatus) => {
        // Merge the cloud worker's content view into curStatus.content so the
        // renderer's "usual channel" (playback:cstatus / setCStatus) picks it up.
        curStatus.content = { ...(curStatus.content ?? {}), ...cStatus };
        updateWindow?.webContents?.send('playback:cstatus', curStatus.content);
        broadcastToWebSocket('cStatus', curStatus.content);
    });

    onLayoutInstalled(() => {
        // Layout files (xlights_rgbeffects.xml / xlights_networks.xml plus anything
        // unpacked from the layout zip) just changed under us. Re-run the same
        // pipeline a "set show folder" runs: re-read all show JSON, broadcast,
        // push schedupdate to playback so models/coords get recomputed. Force
        // restart so any in-flight playback picks up the new layout.
        console.log('[cloud-install] layout changed — reloading show folder');
        void loadShowFolder(true);
    });

    onInstallSequence(async (record, superseded) => {
        // If the cloud didn't provide a thumb but did give us audio, extract embedded
        // cover art the same way Add Song does. Writes a sibling image file in the show
        // folder root and stamps `cloud.thumb` so future manifest ticks don't loop.
        if (!record.files?.thumb && record.files?.audio) {
            try {
                const meta = await extractAudioTagMetadata(record.files.audio);
                if (meta.imageFile) {
                    record.files = { ...record.files, thumb: meta.imageFile };
                    record.cloud = {
                        ...(record.cloud ?? {}),
                        thumb: { file_id: `mp3:${path.basename(meta.imageFile)}`, file_time: Date.now() },
                    };
                }
            } catch (e) {
                console.warn('[cloud-install] cover-art extract failed:', e);
            }
        }
        // Same code path the renderer uses when it adds a song.
        try {
            await commitSequenceUpdates([record]);
        } catch (e) {
            console.error('[cloud-install] commit failed:', e);
            return;
        }
        // After install, delete superseded files. Best-effort; missing/locked
        // files just get logged.
        for (const p of superseded) {
            try {
                await import('fs/promises').then((fsp) => fsp.unlink(p));
            } catch (e) {
                console.warn('[cloud-install] failed to delete superseded file', p, e);
            }
        }
    });

    /// Connection from player worker thread

    const rpcs = new RPCServer<MainRPCAPI>(playWorker, handlers);
    rpcc = new RPCClient<PlayWorkerRPCAPI>(playWorker);

    playWorker.on('message', (msg: WorkerToMainMessage) => {
        switch (msg.type) {
            case 'audioChunk': {
                //mainWindow?.webContents.send('audio:chunk', msg.chunk);
                audioWindow?.webContents.send('audio:chunk', msg.chunk, [msg.chunk.buffer]);
                break;
            }
            case 'pixelbuffer': {
                curFrameBuffer = msg.buffer;
                // Update server worker with new frame buffer
                if (msg.buffer) {
                    updateFrameBuffer(msg.buffer);
                }
                break;
            }
            case 'audiobuffer': {
                updateAudioBuffer(msg.buffer);
                break;
            }
            case 'stats': {
                mainWindow?.webContents.send('playback:stats', msg.stats);
                broadcastToWebSocket('playbackStatistics', msg.stats);
                break;
            }
            case 'cstatus': {
                // Merge instead of replace so cloud-content fields (files map, etc.) on
                // curStatus.content survive playback's status updates.
                const merged = { ...(curStatus.content ?? {}), ...msg.status };
                curStatus = { ...curStatus, content: merged, content_updated: Date.now() };
                mainWindow?.webContents.send('playback:cstatus', merged);
                broadcastToWebSocket('cStatus', merged);
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
                broadcastToWebSocket('nStatus', msg.status);
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
                broadcastToWebSocket('pStatus', msg.status);
                break;
            }
            case 'modelCoordinates': {
                pushModelCoordinates(msg.coords3D, msg.coords2D, msg.viewObjects, msg.layoutSettings, msg.movingHeads);
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
export function getCurrentShowData(): FullPlayerState {
    return {
        showFolder: getCurrentShowFolder() || undefined,
        sequences: curSequences.filter((seq) => !seq.deleted),
        playlists: curPlaylists.filter((pl) => !pl.deleted),
        schedule: curSchedule.filter((item) => !item.deleted),
        user: curUser,
        show: curShow,
        pStatus: curStatus.player,
        cStatus: curStatus.content,
        nStatus: curStatus.controller,
    };
}
