import type {
    AudioDevice,
    AutoUpdateStatus,
    CloudConfig,
    CloudStatus,
    CombinedPlayerStatus,
    EZPlayerCommand,
    PlaylistRecord,
    ScheduledPlaylist,
    SequenceRecord,
    PlaybackStatistics,
    PlayerPStatusContent,
    PlayerNStatusContent,
    PlayerCStatusContent,
    PlaybackSettings,
} from '@ezplayer/ezplayer-core';

import {
    AppDispatch,
    CloudDataStorageAPI,
    setPlayerStatus,
    setPlaybackStatistics,
    setPlaylists,
    hydratePlaybackSettings,
    setScheduledPlaylists,
    setSequenceData,
    setCStatus,
    setNStatus,
    setPStatus,
    authSliceActions,
    cloudConfigActions,
    cloudStatusActions,
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
        window.electronAPI!.onStatusUpdated((data: CombinedPlayerStatus) => {
            if (this.dispatch) {
                this.dispatch(setPlayerStatus(data));
            }
        });
        window.electronAPI!.onPlaybackSettingsUpdated((data: PlaybackSettings) => {
            if (this.dispatch) {
                this.dispatch(hydratePlaybackSettings(data));
            }
        });
        window.electronAPI!.onCloudConfigUpdated((data: CloudConfig) => {
            if (!this.dispatch) return;
            this.dispatch(cloudConfigActions.setCloudConfig(data));
        });
        window.electronAPI!.onCloudStatusUpdated((data: CloudStatus) => {
            if (!this.dispatch) return;
            this.dispatch(cloudStatusActions.setCloudStatus(data));
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
        window.electronAPI!.onAudioChunk(({ incarnation, playAtRealTime, sampleRate, channels, buffer }) => {
            if (!this.audioCtx) return;

            const floatArray = new Float32Array(buffer);
            const numSamples = floatArray.length / channels;
            const audioLenMs = (1000 * numSamples) / sampleRate;
            const dn = Math.round(Date.now());
            const act = Math.round(this.audioCtx.currentTime * 1000);

            let startTime: number | undefined = undefined;
            // See if this is a fresh song or otherwise no history
            if (incarnation !== this.audioCleanBreakInterval || playAtRealTime !== this.audioPlayAtNextRealTime) {
                //console.log(`Starting new song/audio segment`);
                this.audioCleanBreakInterval = incarnation;
                this.audioPlayAtNextRealTime = playAtRealTime;
                startTime = act + (playAtRealTime - dn);
                this.audioPlayAtNextACT = startTime;
            } else {
                startTime = this.audioPlayAtNextACT;
            }

            // See if this is wildly off ... who knows why, maybe we ought to tally it
            if (Math.abs(startTime! - (act + (playAtRealTime - dn))) > 50) {
                console.log(`Start time way off: ${startTime} vs ${act + (playAtRealTime - dn)}`);
                startTime = act + (playAtRealTime - dn);
                this.audioPlayAtNextRealTime = playAtRealTime;
                this.audioPlayAtNextACT = startTime;
            }

            this.audioPlayAtNextRealTime += audioLenMs;
            this.audioPlayAtNextACT = startTime! + audioLenMs;

            if (playAtRealTime < dn) return; // Too late TODO STAT

            // deinterleave
            const audioBuffer = this.audioCtx.createBuffer(channels, numSamples, sampleRate);
            for (let ch = 0; ch < channels; ch++) {
                const channelData = audioBuffer.getChannelData(ch);
                for (let i = 0; i < numSamples; i++) {
                    channelData[i] = floatArray[i * channels + ch];
                }
            }

            const source = this.audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.audioCtx.destination);
            source.start(startTime! / 1000);
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
        window.electronAPI!.onAutoUpdateStatus((status: AutoUpdateStatus) => {
            // Single-line log; full status object would render as "[object Object]"
            // and obscure the actual state/version/message.
            const detail =
                status.state === 'available' || status.state === 'downloaded' || status.state === 'not-available'
                    ? ` v${status.version}`
                    : status.state === 'downloading'
                        ? ` ${status.percent.toFixed(0)}% (${(status.bytesPerSecond / 1024).toFixed(0)} KB/s)`
                        : status.state === 'error'
                            ? `: ${status.message}`
                            : '';
            console.log(`[AutoUpdate] ${status.state}${detail}`);
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

    override async issuePlayerCommand(req: EZPlayerCommand) {
        return await window.electronAPI!.immediatePlayerCommand(req);
    }

    override async setPlayerSettings(s: PlaybackSettings) {
        return await window.electronAPI!.setPlaybackSettings(s);
    }

    /**
     * Cloud config writes route through main, which persists to the show folder and
     * reconfigures the cloud-poll worker. The slice is updated when main echoes via
     * `update:cloudConfig`, not synchronously here.
     */
    override async requestSetPlayerIdToken(data: { playerIdToken?: string }): Promise<{ message: string }> {
        await window.electronAPI!.setPlayerIdToken(data.playerIdToken ?? '');
        return { message: 'ok' };
    }

    override async requestChangeServerUrl(data: { cloudURL: string }): Promise<void> {
        await window.electronAPI!.setCloudServiceUrl(data.cloudURL ?? '');
    }

    override async requestCloudSyncNow(): Promise<void> {
        await window.electronAPI!.cloudSyncNow();
    }


    override async connect(dispatch: AppDispatch): Promise<void> {
        this.dispatch = dispatch;
        await window.electronAPI!.connect();
        this.audioCtx = new AudioContext();
        ++this.audioCtxIncarnation;
        this.audioCleanBreakInterval = undefined;
        this.audioPlayAtNextRealTime = undefined;
        this.audioPlayAtNextACT = undefined;
        this.heartbeater = setInterval(() => this.compareAudioAndRealTimes(), 1000);
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
    // Keeps track of whether audio should be played contiguously with the previous chunk
    //  (vs having a fresh start time calculated)
    // If audioCleanBreak interval changes, we've switched songs, fine to recalibrate.
    //  Otherwise, if audioPlayAtNextRealTime == the time of the chunk, play exactly at
    //  audioPlayAtNextCT
    audioCleanBreakInterval: number | undefined = undefined;
    audioPlayAtNextRealTime: number | undefined = undefined;
    audioPlayAtNextACT: number | undefined = undefined;
    heartbeater?: NodeJS.Timeout;
    async compareAudioAndRealTimes() {
        // TODO something with this data to estimate clock drift
        // const pn1 = performance.now();
        // const act = this.audioCtx?.currentTime;
    }
}
