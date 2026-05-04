import type {
    AudioChunk,
    AudioDevice,
    AutoUpdateStatus,
    CloudConfig,
    CloudStatus,
    EZPElectronAPI,
    FileSelectOptions,
    EZPlayerCommand,
    PlaybackSettings,
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

const launchArgs: string[] = Array.isArray(process.argv) ? process.argv : [];
const shouldShowWelcomeOnLaunch = launchArgs.includes('--show-welcome=true');

contextBridge.exposeInMainWorld('electronAPI', {
    shouldShowWelcomeOnLaunch: () => shouldShowWelcomeOnLaunch,
    selectFiles: (options?: FileSelectOptions) => ipcRenderer.invoke('dialog:openFile', options),
    autoDetectSongFilesFromFseq: (fseqPath: string) => ipcRenderer.invoke('ipcAutoDetectSongFilesFromFseq', fseqPath),
    extractAudioTagMetadata: (audioPath: string) => ipcRenderer.invoke('ipcExtractAudioTagMetadata', audioPath),

    selectDirectory: (options?: Omit<FileSelectOptions, 'types'>) =>
        ipcRenderer.invoke('dialog:openDirectory', options),

    requestChooseShowFolder: async (): Promise<string> => {
        return await ipcRenderer.invoke('ipcUIChooseShowFolder');
    },
    validateShowDirectory: async (
        showDirectory?: string,
    ): Promise<{ valid: boolean; missingFiles: string[]; inaccessibleFiles: string[]; error?: string }> => {
        return await ipcRenderer.invoke('ipcValidateShowDirectory', showDirectory);
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
    getServerStatus() {
        return ipcRenderer.invoke('ipcGetServerStatus');
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
    immediatePlayerCommand(cmd: EZPlayerCommand): Promise<boolean> {
        return ipcRenderer.invoke('ipcImmediatePlayCommand', cmd);
    },
    setPlaybackSettings(s: PlaybackSettings): Promise<boolean> {
        return ipcRenderer.invoke('ipcSetPlaybackSettings', s);
    },

    getCloudConfig(): Promise<CloudConfig> {
        return ipcRenderer.invoke('ipcGetCloudConfig');
    },
    setPlayerIdToken(token: string): Promise<void> {
        return ipcRenderer.invoke('ipcSetPlayerIdToken', token);
    },
    setCloudServiceUrl(url: string): Promise<void> {
        return ipcRenderer.invoke('ipcSetCloudServiceUrl', url);
    },
    onCloudConfigUpdated: (callback: (data: CloudConfig) => void) => {
        ipcRenderer.on('update:cloudConfig', (_event: any, data: CloudConfig) => {
            callback(data);
        });
    },
    getCloudStatus(): Promise<CloudStatus> {
        return ipcRenderer.invoke('ipcGetCloudConnStatus');
    },
    onCloudStatusUpdated: (callback: (data: CloudStatus) => void) => {
        ipcRenderer.on('update:cloudStatus', (_event: any, data: CloudStatus) => {
            callback(data);
        });
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
    onPlaybackSettingsUpdated: (callback: (data: PlaybackSettings) => void) => {
        ipcRenderer.on('update:playbacksettings', (_event: any, data: PlaybackSettings) => {
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

    // Auto-update
    checkForUpdates: () => ipcRenderer.invoke('autoupdate:check'),
    downloadUpdate: () => ipcRenderer.invoke('autoupdate:download'),
    installUpdateNow: () => ipcRenderer.invoke('autoupdate:install-now'),
    installUpdateOnQuit: () => ipcRenderer.invoke('autoupdate:install-on-quit'),
    onAutoUpdateStatus: (callback: (status: AutoUpdateStatus) => void) => {
        ipcRenderer.on('update:autoupdate-status', (_event: any, status: AutoUpdateStatus) => {
            callback(status);
        });
    },
} satisfies EZPElectronAPI);
