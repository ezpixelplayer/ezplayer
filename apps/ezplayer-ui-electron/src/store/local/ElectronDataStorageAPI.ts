import type {
    AudioDevice,
    AudioTimeSyncM2R,
    CombinedPlayerStatus,
    EndUser,
    EndUserShowSettings,
    EZPlayerCommand,
    PlaylistRecord,
    ScheduledPlaylist,
    SequenceRecord,
    PlaybackStatistics,
    PlayerPStatusContent,
    PlayerNStatusContent,
    PlayerCStatusContent,
} from '@ezplayer/ezplayer-core';

import {
    AppDispatch,
    CloudDataStorageAPI,
    setEndUser,
    setPlayerStatus,
    setPlaybackStatistics,
    setPlaylists,
    setScheduledPlaylists,
    setSequenceData,
    setShowProfile,
    setCStatus,
    setNStatus,
    setPStatus,
    authSliceActions,
} from '@ezplayer/player-ui-components';

export class ElectronDataStorageAPI extends CloudDataStorageAPI {
    constructor(baseUrl: string) {
        super(baseUrl);
        window.electronAPI!.onShowFolderUpdated((data: string) => {
            if (this.dispatch) {
                this.dispatch(authSliceActions.setShowDirectory(data));
            }
        });
        window.electronAPI!.onSequencesUpdated((data: SequenceRecord[]) => {
            if (this.dispatch) {
                this.dispatch(setSequenceData(data));
            }
        });
        window.electronAPI!.onPlaylistsUpdated((data: PlaylistRecord[]) => {
            if (this.dispatch) {
                this.dispatch(setPlaylists(data));
            }
        });
        window.electronAPI!.onScheduleUpdated((data: ScheduledPlaylist[]) => {
            if (this.dispatch) {
                this.dispatch(setScheduledPlaylists(data));
            }
        });
        window.electronAPI!.onShowUpdated((data: EndUserShowSettings) => {
            if (this.dispatch) {
                this.dispatch(setShowProfile(data));
            }
        });
        window.electronAPI!.onUserUpdated((data: EndUser) => {
            if (this.dispatch) {
                this.dispatch(setEndUser(data));
            }
        });
        window.electronAPI!.onStatusUpdated((data: CombinedPlayerStatus) => {
            if (this.dispatch) {
                this.dispatch(setPlayerStatus(data));
            }
        });
        window.electronAPI!.ipcRequestAudioDevices(async () => {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices
                .filter((d) => d.kind === 'audiooutput')
                .map(
                    (d) =>
                        ({
                            label: d.label,
                            deviceId: d.deviceId,
                            kind: d.kind,
                            groupId: d.groupId,
                        }) satisfies AudioDevice,
                );
        });
        window.electronAPI!.ipcGetAudioSyncTime((_mSync: AudioTimeSyncM2R) => {
            const act = this.audioCtx?.currentTime;

            return {
                audioCtxTime: act !== undefined ? act * 1000 : -1, // TODO should we send this at all?
                perfNowTime: performance.now(),
                incarnation: this.audioCtxIncarnation,
                latency: this.audioCtx?.outputLatency ?? this.audioCtx?.baseLatency,
            };
        });
        window.electronAPI!.onAudioChunk(({ sampleRate, channels, startTime, buffer, incarnation }) => {
            if (!this.audioCtx || incarnation !== this.audioCtxIncarnation) return;

            const floatArray = new Float32Array(buffer);
            const numSamples = floatArray.length / channels;
            const audioBuffer = this.audioCtx.createBuffer(channels, numSamples, sampleRate);

            for (let ch = 0; ch < channels; ch++) {
                const channelData = audioBuffer.getChannelData(ch);
                for (let i = 0; i < numSamples; i++) {
                    channelData[i] = floatArray[i * channels + ch]; // deinterleave
                }
            }

            const source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioCtx.destination);
            source.start(startTime / 1000);
        });
        window.electronAPI!.onStatsUpdated((data: PlaybackStatistics) => {
            if (this.dispatch) {
                this.dispatch(setPlaybackStatistics(data));
            }
        });
        window.electronAPI!.onCStatusUpdated((data: PlayerCStatusContent) => {
            if (this.dispatch) {
                this.dispatch(setCStatus(data));
            }
        });
        window.electronAPI!.onNStatusUpdated((data: PlayerNStatusContent) => {
            if (this.dispatch) {
                this.dispatch(setNStatus(data));
            }
        });
        window.electronAPI!.onPStatusUpdated((data: PlayerPStatusContent) => {
            if (this.dispatch) {
                this.dispatch(setPStatus(data));
            }
        });
    }
    // TODO: Pull stuff down, etc.
    dispatch?: AppDispatch = undefined;

    override async getCloudSequences(): Promise<SequenceRecord[]> {
        return await window.electronAPI!.getSequences();
    }
    override async postCloudSequences(recs: SequenceRecord[]): Promise<SequenceRecord[]> {
        return await window.electronAPI!.putSequences(recs);
    }

    override async getCloudPlaylists(): Promise<PlaylistRecord[]> {
        return await window.electronAPI!.getPlaylists();
    }
    override async postCloudPlaylists(recs: PlaylistRecord[]): Promise<PlaylistRecord[]> {
        return await window.electronAPI!.putPlaylists(recs);
    }

    override async getCloudSchedule(): Promise<ScheduledPlaylist[]> {
        return await window.electronAPI!.getSchedule();
    }
    override async postCloudSchedule(recs: ScheduledPlaylist[]): Promise<ScheduledPlaylist[]> {
        return await window.electronAPI!.putSchedule(recs);
    }

    override async getCloudStatus(): Promise<CombinedPlayerStatus> {
        return await window.electronAPI!.getCombinedStatus();
    }

    override async getCloudShowProfile(): Promise<EndUserShowSettings> {
        return await window.electronAPI!.getShowProfile();
    }

    override async postCloudShowProfile(data: EndUserShowSettings): Promise<EndUserShowSettings> {
        return await window.electronAPI!.putShowProfile(data);
    }

    override async getCloudUserProfile(): Promise<EndUser> {
        return await window.electronAPI!.getUserProfile();
    }

    override async postCloudUserProfile(data: Partial<EndUser>): Promise<EndUser> {
        return await window.electronAPI!.putUserProfile(data);
    }

    override async issuePlayerCommand(req: EZPlayerCommand) {
        await window.electronAPI!.immediatePlayerCommand(req);
        return true;
    }

    override async connect(dispatch: AppDispatch): Promise<void> {
        this.dispatch = dispatch;
        await window.electronAPI!.connect();
        this.audioCtx = new AudioContext();
        ++this.audioCtxIncarnation;
        this.heartbeater = setInterval(() => this.sendAudioTimeHeartbeat(), 100);
    }

    override async disconnect(): Promise<void> {
        if (this.heartbeater) {
            this.heartbeater = undefined;
            clearInterval(this.heartbeater);
        }
        await window.electronAPI!.disconnect();
    }

    audioCtx?: AudioContext;
    audioCtxIncarnation: number = 1;
    heartbeater?: NodeJS.Timeout;
    async sendAudioTimeHeartbeat() {
        const pn1 = performance.now();
        const theirTime = await window.electronAPI!.getMainSyncTime();
        const pn2 = performance.now();
        if (pn2 - pn1 > 2) return; // Invalid sample...

        const act = this.audioCtx?.currentTime;

        await window.electronAPI!.sendAudioSyncTime({
            audioCtxTime: act !== undefined ? act * 1000 : -1, // TODO should we send this at all?
            perfNowTime: theirTime.perfNowTime + (pn2 - pn1) / 2,
            incarnation: this.audioCtx ? this.audioCtxIncarnation : -1,
            latency: this.audioCtx?.outputLatency ?? this.audioCtx?.baseLatency,
        });
    }

    /*
    // TODO CRAZ
    // Set up for data connectivity

    requestChangeServerUrl: (data: {cloudURL: string}) => Promise<void>;

    requestLoginToken: (data: UserLoginBody) => Promise<string>;
    requestLogout: () => Promise<void>;

    postCloudRegister: (data: UserRegisterBody) => Promise<UserRegisterBody>;

    postRequestPasswordReset: (data: {
        email: string;
    }) => Promise<{ message: string }>;

    postChangePassword: (data: {
        oldPassword: string;
        newPassword: string;
    }) => Promise<{ message: string }>;

    requestSetPlayerIdToken: (data: {playerIdToken?: string})
        => Promise<{message: string}>;
  
    postRegisterPlayer: (data: {
        playerId: string;
    }) => Promise<{ message: string }>;

    getUserPlayers: () => Promise<UserPlayer[]>;

    // EZSeq integration
    postCloudRgbUpload: () => Promise<CloudFileUpload>;

    postCloudNetworksUpload: () => Promise<CloudFileUpload>;

    postCloudDoneUploadLayoutFiles: (
        data: CloudLayoutFileUpload
    ) => Promise<CloudFileUploadResponse>;

    getCloudUploadedFiles: () => Promise<DownloadFileResponse>;

    getCloudSeqFile: (fileId: string) => Promise<CloudFileDownloadResponse>;
    getCloudMediaFile: (fileId: string) => Promise<CloudFileDownloadResponse>;
    getCloudXsqzFile: (fileId: string) => Promise<CloudFileDownloadResponse>;
*/
}
