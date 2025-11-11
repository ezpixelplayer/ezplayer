import type {
    AudioChunk,
    AudioDevice,
    AudioTimeSyncM2R,
    AudioTimeSyncR2M,
    EZPElectronAPI,
    FileSelectOptions,
    EZPlayerCommand,
} from '@ezplayer/ezplayer-core';

import type {
    CombinedPlayerStatus,
    EndUser,
    EndUserShowSettings,
    PlaylistRecord,
    ScheduledPlaylist,
    SequenceRecord,
    PlaybackStatistics,
    PlayerCStatusContent,
    PlayerNStatusContent,
    PlayerPStatusContent,
} from '@ezplayer/ezplayer-core';

export interface M2RIPC<Payload> {
    reqid: number;
    req: Payload;
}

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFiles: (options?: FileSelectOptions) => ipcRenderer.invoke('dialog:openFile', options),

    selectDirectory: (options?: Omit<FileSelectOptions, 'types'>) =>
        ipcRenderer.invoke('dialog:openDirectory', options),

    requestChooseShowFolder: async (): Promise<string> => {
        return await ipcRenderer.invoke('ipcUIChooseShowFolder');
    },

    openExternal: (url: string) => ipcRenderer.invoke('open-external-url', url),

    getVersions: () => ipcRenderer.invoke('getVersions'),

    writeFile: async (filename: string, content: string): Promise<string> => {
        return ipcRenderer.invoke('write-file', filename, content);
    },
    readFile: async (filename: string): Promise<string> => {
        return ipcRenderer.invoke('read-file', filename);
    },

    connect() {
        return ipcRenderer.invoke('ipcUIConnect');
    },
    disconnect() {
        return ipcRenderer.invoke('ipcUIDisconnect');
    },

    getSequences() {
        return ipcRenderer.invoke('ipcGetCloudSequences');
    },
    putSequences(recs: SequenceRecord[]) {
        return ipcRenderer.invoke('ipcPutCloudSequences', recs);
    },
    getPlaylists() {
        return ipcRenderer.invoke('ipcGetCloudPlaylists');
    },
    putPlaylists(recs: PlaylistRecord[]) {
        return ipcRenderer.invoke('ipcPutCloudPlaylists', recs);
    },
    getSchedule() {
        return ipcRenderer.invoke('ipcGetCloudSchedule');
    },
    putSchedule(recs: ScheduledPlaylist[]) {
        return ipcRenderer.invoke('ipcPutCloudSchedule', recs);
    },
    getCombinedStatus() {
        return ipcRenderer.invoke('ipcGetCloudStatus');
    },
    getShowProfile() {
        return ipcRenderer.invoke('ipcGetCloudShowProfile');
    },
    putShowProfile(data: EndUserShowSettings) {
        return ipcRenderer.invoke('ipcPutCloudShowProfile', data);
    },
    getUserProfile() {
        return ipcRenderer.invoke('ipcGetCloudUserProfile');
    },
    putUserProfile(data: Partial<EndUser>) {
        return ipcRenderer.invoke('ipcPutCloudUserProfile', data);
    },
    immediatePlayCommand(cmd: EZPlayerCommand) {
        return ipcRenderer.invoke('ipcImmediatePlayCommand', cmd);
    },

    onShowFolderUpdated: (callback: (data: string) => void) => {
        ipcRenderer.on('update:showFolder', (_event: any, data: string) => {
            callback(data);
        });
    },
    onSequencesUpdated: (callback: (data: SequenceRecord[]) => void) => {
        ipcRenderer.on('update:sequences', (_event: any, data: SequenceRecord[]) => {
            callback(data);
        });
    },
    onPlaylistsUpdated: (callback: (data: PlaylistRecord[]) => void) => {
        ipcRenderer.on('update:playlist', (_event: any, data: PlaylistRecord[]) => {
            callback(data);
        });
    },
    onScheduleUpdated: (callback: (data: ScheduledPlaylist[]) => void) => {
        ipcRenderer.on('update:schedule', (_event: any, data: ScheduledPlaylist[]) => {
            callback(data);
        });
    },
    onUserUpdated: (callback: (data: EndUser) => void) => {
        ipcRenderer.on('update:user', (_event: any, data: EndUser) => {
            callback(data);
        });
    },
    onShowUpdated: (callback: (data: EndUserShowSettings) => void) => {
        ipcRenderer.on('update:show', (_event: any, data: EndUserShowSettings) => {
            callback(data);
        });
    },
    onStatusUpdated: (callback: (data: CombinedPlayerStatus) => void) => {
        ipcRenderer.on('update:combinedstatus', (_event: any, data: CombinedPlayerStatus) => {
            callback(data);
        });
    },

    ipcRequestAudioDevices: (callback: () => Promise<AudioDevice[]>) => {
        ipcRenderer.on('audio:get-devices', async (_event: any, req: M2RIPC<void>) => {
            const devices = await callback();
            const respch = `audio:get-devices-response#${req.reqid}`;
            ipcRenderer.send(respch, devices);
        });
    },

    sendAudioSyncTime(sync: AudioTimeSyncR2M): Promise<void> {
        return ipcRenderer.invoke('audio:syncr2m', sync);
    },
    getMainSyncTime(): Promise<AudioTimeSyncM2R> {
        return ipcRenderer.invoke('audio:getm2r');
    },

    ipcGetAudioSyncTime: (callback: (mSync: AudioTimeSyncM2R) => AudioTimeSyncR2M) => {
        ipcRenderer.on('audio:syncm2r', (_event: any, req: M2RIPC<AudioTimeSyncM2R>) => {
            const ct = callback(req.req);
            ipcRenderer.send(`audio:syncm2r-response#${req.reqid}`, ct);
        });
    },
    onAudioChunk: (callback: (data: AudioChunk) => void) => {
        ipcRenderer.on('audio:chunk', (_event: any, data: AudioChunk) => {
            callback(data);
        });
    },
    onStatsUpdated: (callback: (data: PlaybackStatistics) => void) => {
        ipcRenderer.on('playback:stats', (_event: any, data: PlaybackStatistics) => {
            callback(data);
        });
    },
    onCStatusUpdated: (callback: (data: PlayerCStatusContent) => void) => {
        ipcRenderer.on('playback:cstatus', (_event: any, data: PlayerCStatusContent) => {
            callback(data);
        });
    },
    onNStatusUpdated: (callback: (data: PlayerNStatusContent) => void) => {
        ipcRenderer.on('playback:nstatus', (_event: any, data: PlayerNStatusContent) => {
            callback(data);
        });
    },
    onPStatusUpdated: (callback: (data: PlayerPStatusContent) => void) => {
        ipcRenderer.on('playback:pstatus', (_event: any, data: PlayerPStatusContent) => {
            callback(data);
        });
    },
} satisfies EZPElectronAPI);
