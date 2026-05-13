//import { app } from "electron";
import { fileURLToPath } from 'url';

import * as path from 'path';

import { BrowserWindow, ipcMain } from 'electron';

import { Worker } from 'node:worker_threads';

import {
    loadPlaylistsAPI,
    loadScheduleAPI,
    loadSequencesAPI,
    loadStatusAPI,
    saveSequencesAPI,
    savePlaylistsAPI,
    saveScheduleAPI,
} from './data/FileStorage.js';

import { applySettingsFromRenderer, getSettingsCache, loadSettingsFromDisk } from './data/SettingsStorage.js';
import {
    getCloudConfigCache,
    loadCloudConfigFromDisk,
    updateCloudConfig,
} from './data/CloudConfigStorage.js';
import { atomicWriteFile } from './data/atomicWrite.js';
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
    uploadLayoutNow,
} from './workers/cloudpollparent.js';
import { autoDetectSongFilesFromFseq, extractAudioTagMetadata } from './data/song-file-autodetect.js';

import type {
    CloudCommand,
    CombinedPlayerStatus,
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
export let curFrameBuffer: SharedArrayBuffer | undefined = undefined;
let rpcc: RPCClient<PlayWorkerRPCAPI> | undefined = undefined;

/** Paths of files superseded by a new cloud install. Drained by `runGcSweep` when
 *  the player is idle — versioned filenames mean the new install never overwrites
 *  the old one, but the old one may still be open. Persisted to
 *  `<showFolder>/.ezplayer/cloud/gc-queue.json` so a crash or relaunch doesn't leak. */
const gcQueue: string[] = [];

function gcQueuePath(showFolder: string): string {
    return path.join(showFolder, '.ezplayer', 'cloud', 'gc-queue.json');
}

async function loadGcQueue(showFolder: string): Promise<void> {
    gcQueue.length = 0;
    try {
        const fsp = await import('fs/promises');
        const raw = await fsp.readFile(gcQueuePath(showFolder), 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            for (const p of parsed) {
                if (typeof p === 'string') gcQueue.push(p);
            }
        }
        if (gcQueue.length > 0) {
            console.log(`[cloud-gc] loaded ${gcQueue.length} pending paths`);
        }
    } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== 'ENOENT') console.warn('[cloud-gc] load failed:', e);
    }
}

let gcSaveInFlight: Promise<void> | null = null;
async function saveGcQueue(): Promise<void> {
    const showFolder = getCurrentShowFolder();
    if (!showFolder) return;
    // Coalesce concurrent writes — last call's snapshot wins.
    if (gcSaveInFlight) return gcSaveInFlight;
    gcSaveInFlight = (async () => {
        try {
            const fsp = await import('fs/promises');
            const file = gcQueuePath(showFolder);
            await fsp.mkdir(path.dirname(file), { recursive: true });
            await fsp.writeFile(file, JSON.stringify(gcQueue, null, 2), 'utf-8');
        } catch (e) {
            console.warn('[cloud-gc] save failed:', e);
        } finally {
            gcSaveInFlight = null;
        }
    })();
    return gcSaveInFlight;
}

function isPlayerIdle(): boolean {
    const p = curStatus.player;
    if (!p) return true; // no status yet → safe to delete
    return p.status === 'Stopped' && !p.now_playing;
}

async function runGcSweep(): Promise<void> {
    if (gcQueue.length === 0) return;
    if (!isPlayerIdle()) return;
    const fsp = await import('fs/promises');
    const remaining: string[] = [];
    let deleted = 0;
    for (const p of gcQueue) {
        try {
            await fsp.unlink(p);
            deleted += 1;
        } catch (e) {
            const code = (e as { code?: string })?.code;
            if (code === 'ENOENT') {
                // already gone; drop from queue
                deleted += 1;
            } else {
                // EBUSY/EPERM/etc — keep, retry next sweep
                remaining.push(p);
            }
        }
    }
    if (deleted > 0) {
        gcQueue.length = 0;
        gcQueue.push(...remaining);
        console.log(`[cloud-gc] swept ${deleted} files (${gcQueue.length} remaining)`);
        void saveGcQueue();
    }
}

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

    // Reset combined player status at the folder boundary. content / controller /
    // player snapshots are folder-scoped (cloud content, controller config from
    // this show, current playback). Without this, switching to a fresh folder
    // would carry the old folder's cstatus/nstatus/pstatus through `update:combinedstatus`
    // until each writer (cloud worker, playback worker) happens to push a fresh frame.
    curStatus = {};
    curErrors = [];

    // All our JSON lives under `.ezplayer/` in the show folder. Run this BEFORE any
    // loader so that, on first run against an old folder, root-level files are moved
    // into the subdir and the loaders read the migrated copies on this same tick.
    await ensureEzplayerSubdir(showFolder);
    await loadGcQueue(showFolder);

    curSequences = await loadSequencesAPI(showFolder);
    curPlaylists = await loadPlaylistsAPI(showFolder);
    curSchedule = await loadScheduleAPI(showFolder);
    await loadSettingsFromDisk(settingsPath(showFolder, 'playbackSettings.json'));
    const cloudConfig = await loadCloudConfigFromDisk(settingsPath(showFolder, 'cloud-config.json'));
    const cloudActive = cloudConfig.cloudEnabled !== false;
    setCloudWorkerConfig(
        cloudActive ? cloudConfig.cloudServiceUrl : '',
        cloudActive ? cloudConfig.playerIdToken : '',
        showFolder,
        curSequences,
        cloudConfig.layoutMeta,
        cloudConfig.layoutSource,
        {
            registrationIntervalMs: cloudConfig.cloudPollIntervals?.registrationMs,
            manifestIntervalMs: cloudConfig.cloudPollIntervals?.manifestMs,
        },
        cloudConfig.cloudPollMode,
        cloudConfig.cloudPollSchedule,
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
            // Pull the manifest. The worker auto-fetches layout at the head of each
            // manifest tick when in cloud-managed mode (cheap when nothing's stale).
            manifestPollNow();
            break;
        case 'fetchLayoutNow':
            fetchLayoutNow();
            break;
        case 'uploadLayoutNow':
            uploadLayoutNow();
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
        case 'setLayoutSource':
            applyLayoutSource(cmd.mode);
            break;
        case 'setCloudEnabled':
            applyCloudEnabled(cmd.enabled);
            break;
        case 'setCloudPolling':
            applyCloudPolling({
                mode: cmd.mode,
                schedule: cmd.schedule,
                intervals: cmd.intervals,
            });
            break;
        default: {
            const _exhaustive: never = cmd;
            console.warn('[cloud-command] unknown verb', _exhaustive);
        }
    }
}

/** Push the current cloud config to the worker. Wraps the long argument list in
 *  one place so applyXxx helpers don't need to know about every field. */
function reconfigureCloudWorker(cfg: import('@ezplayer/ezplayer-core').CloudConfig) {
    const cloudActive = cfg.cloudEnabled !== false;
    setCloudWorkerConfig(
        cloudActive ? cfg.cloudServiceUrl : '',
        cloudActive ? cfg.playerIdToken : '',
        getCurrentShowFolder() ?? '',
        curSequences,
        cfg.layoutMeta,
        cfg.layoutSource,
        {
            registrationIntervalMs: cfg.cloudPollIntervals?.registrationMs,
            manifestIntervalMs: cfg.cloudPollIntervals?.manifestMs,
        },
        cfg.cloudPollMode,
        cfg.cloudPollSchedule,
    );
}

function broadcastCloudConfig(cfg: import('@ezplayer/ezplayer-core').CloudConfig) {
    updateWindow?.webContents?.send('update:cloudConfig', cfg);
    broadcastToWebSocket('cloudConfig', cfg);
}

/** Update the persisted layout-source mode (`xlights` or `cloud`). Reconfigures the
 *  worker so it knows whether to auto-fetch layout at the head of each manifest tick. */
export function applyLayoutSource(mode: 'xlights' | 'cloud') {
    const cfg = updateCloudConfig({ layoutSource: mode });
    reconfigureCloudWorker(cfg);
    broadcastCloudConfig(cfg);
}

/** Update polling configuration (mode / schedule / intervals). Each field is
 *  optional: omitting preserves the existing value (the user wants to be able
 *  to change one knob without re-sending the others). An empty schedule array
 *  explicitly clears the schedule; `undefined` preserves it. */
export function applyCloudPolling(patch: {
    mode?: 'always' | 'scheduled';
    schedule?: import('@ezplayer/ezplayer-core').CloudPollScheduleEntry[];
    intervals?: { registrationMs?: number; manifestMs?: number };
}) {
    const next: Partial<import('@ezplayer/ezplayer-core').CloudConfig> = {};
    if (patch.mode !== undefined) next.cloudPollMode = patch.mode;
    if (patch.schedule !== undefined) next.cloudPollSchedule = patch.schedule;
    if (patch.intervals !== undefined) next.cloudPollIntervals = patch.intervals;
    const cfg = updateCloudConfig(next);
    reconfigureCloudWorker(cfg);
    broadcastCloudConfig(cfg);
}

/** Pause/resume the cloud worker. Pausing keeps URL/token saved but parks all polling
 *  and downloads. Implemented by passing empty url/token to the worker — the worker
 *  already short-circuits everything on either being empty. */
export function applyCloudEnabled(enabled: boolean) {
    const cfg = updateCloudConfig({ cloudEnabled: enabled });
    reconfigureCloudWorker(cfg);
    broadcastCloudConfig(cfg);
}

/** Update the persisted player ID token and reconfigure the cloud poller. Called from
 *  the renderer (electron IPC) and from the embedded UI (koa worker → RPC). */
export function applyPlayerIdToken(token: string) {
    const cfg = updateCloudConfig({ playerIdToken: token ?? '' });
    reconfigureCloudWorker(cfg);
    broadcastCloudConfig(cfg);
}

/** Update the persisted cloud service URL and reconfigure the cloud poller. */
export function applyCloudServiceUrl(url: string) {
    const cfg = updateCloudConfig({ cloudServiceUrl: url ?? '' });
    reconfigureCloudWorker(cfg);
    broadcastCloudConfig(cfg);
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
    ipcMain.handle(
        'ipcUIChooseCloudShowFolder',
        async (_event): Promise<{ folder: string; existingInstall: boolean }> => {
            const result = await pickCloudShowFolder();
            if (!result.folder) return { folder: '', existingInstall: false };
            const sf = result.folder;
            await ensureEzplayerSubdir(sf);
            // If the folder already has a cloud-config (existingInstall), obey it —
            // don't silently flip its layoutSource and don't trigger a layout fetch
            // that would overwrite their files. Only seed `layoutSource: 'cloud'`
            // on a fresh seed.
            //
            // Seed via a direct atomic write rather than going through the
            // load-then-update-then-await-loadShowFolder dance: that path raced
            // its own scheduleWrites against `loadShowFolder`'s second
            // `loadCloudConfigFromDisk` and sometimes left the file on disk
            // showing `layoutSource: 'xlights'` despite the user picking Cloud.
            // Writing the seed file synchronously up front means
            // `loadShowFolder` reads what we intended.
            if (!result.existingInstall) {
                const seedPath = settingsPath(sf, 'cloud-config.json');
                const seed = {
                    cloudServiceUrl: '',
                    playerIdToken: '',
                    layoutSource: 'cloud' as const,
                };
                await atomicWriteFile(seedPath, JSON.stringify(seed, null, 2));
            }
            await loadShowFolder();
            return { folder: sf, existingInstall: result.existingInstall };
        },
    );
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
        // Opportunistic gc — runs whenever the worker reports back, no-op when
        // queue is empty or player isn't idle.
        void runGcSweep();
    });

    onLayoutInstalled((layoutMeta) => {
        // Persist the cloud meta so future fetches can short-circuit when nothing
        // has changed (the worker uses this on the next setConfig).
        const cfg = updateCloudConfig({ layoutMeta });
        updateWindow?.webContents?.send('update:cloudConfig', cfg);
        broadcastToWebSocket('cloudConfig', cfg);

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
        // Versioned filenames mean the new install lands at a different path; the
        // old file is orphaned. Don't delete now — playback may still be reading the
        // old bytes. Queue the path; the gc sweep will retry on each cStatus tick
        // when the player is idle. Persist so a crash doesn't leak.
        if (superseded.length > 0) {
            let added = 0;
            for (const p of superseded) {
                if (!gcQueue.includes(p)) {
                    gcQueue.push(p);
                    added += 1;
                }
            }
            if (added > 0) {
                console.log(`[cloud-install] queued ${added} files for gc (queue size ${gcQueue.length})`);
                void saveGcQueue();
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
                // Merge so any second writer's fields on curStatus.controller (e.g.
                // cross-source controller info) survive playback's pushes.
                const merged = { ...(curStatus.controller ?? {}), ...msg.status };
                curStatus = { ...curStatus, controller: merged, controller_updated: Date.now() };
                mainWindow?.webContents.send('playback:nstatus', merged);
                broadcastToWebSocket('nStatus', merged);
                break;
            }
            case 'pstatus': {
                // Merge so any second writer's fields on curStatus.player survive
                // playback's pushes.
                const merged = { ...(curStatus.player ?? {}), ...msg.status };
                curStatus = { ...curStatus, player: merged, player_updated: Date.now() };
                mainWindow?.webContents.send('playback:pstatus', merged);
                broadcastToWebSocket('pStatus', merged);
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
        pStatus: curStatus.player,
        cStatus: curStatus.content,
        nStatus: curStatus.controller,
    };
}
