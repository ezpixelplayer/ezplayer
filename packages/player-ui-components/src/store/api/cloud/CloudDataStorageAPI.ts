import {
    DataStorageAPI,
    getOrInitializePlayerId,
    setOrGeneratePlayerIdToken,
} from '../DataStorageAPI';

import {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    CombinedPlayerStatus,
    EZPlayerCommand,
    PlaybackSettings,
} from '@ezplayer/ezplayer-core';

import {
    AppDispatch,
    fetchPlayerStatus,
    fetchPlaylists,
    fetchScheduledPlaylists,
    fetchSequences,
    authSliceActions,
    cloudConfigActions,
    cloudStatusActions,
} from '../../..';

import { AxiosInstance } from 'axios';
import { createAxiosInstance } from './axios-instance';
import { getSequencesAPI, postSequencesDataAPI } from './CloudSequenceAPI';
import { getPlaylistsAPI, postPlaylistsDataAPI } from './CloudPlaylistAPI';
import { getScheduledPlaylistsAPI, postScheduledPlaylistsAPI } from './CloudScheduleAPI';
import { getCloudStatusAPI } from './CloudStatusAPI';
import { isPlayerRegisteredCall } from './CloudAuthAPI';

/**
 * Cloud client implementing `DataStorageAPI` — connectivity, auth identity,
 * sequence/playlist/schedule sync, and status.
 */
export class CloudDataStorageAPI implements DataStorageAPI {
    baseUrl: string;
    axiosInstance: AxiosInstance;
    playerIdToken: string;
    dispatch?: AppDispatch;

    constructor(baseUrl?: string) {
        // TODO CRAZ support NO cloud URL
        this.baseUrl = localStorage.getItem('cloudBaseUrl') || baseUrl || CloudDataStorageAPI.EZP_BASE_URL_DEFAULT;
        this.playerIdToken = getOrInitializePlayerId();
        this.axiosInstance = createAxiosInstance(this.baseUrl);
    }

    get fileDownloadUrl() {
        return `${this.baseUrl}fppapi/`;
    }
    get apiUrl() {
        return `${this.baseUrl}api/`;
    }

    async connect(dispatch: AppDispatch) {
        this.dispatch = dispatch;
        await this.refreshAll();
    }

    async requestChangeServerUrl(data: { cloudURL: string }) {
        this.baseUrl = data.cloudURL;
        localStorage.setItem('cloudBaseUrl', this.baseUrl);
        localStorage.removeItem('auth_token'); // Clear this off as it came from another server
        return await this.refreshAll();
    }

    async refreshAll() {
        let isregistered = false;
        let ver = 'unknown';
        let isconnected = true; // Has net access
        try {
            const res = await isPlayerRegisteredCall(this.axiosInstance, this.apiUrl, this.playerIdToken);
            isregistered = res.registered;
            ver = res.version;
        } catch (e) {
            console.warn(e);
            isconnected = false;
        }

        const dispatch = this.dispatch;
        if (!dispatch) return;

        const token = localStorage.getItem('auth_token');
        dispatch(authSliceActions.setCloudIsReachable(isconnected));
        dispatch(authSliceActions.setSupportsLogin(true));
        dispatch(authSliceActions.setSupportsToken(true));
        dispatch(authSliceActions.setUserToken(token));
        dispatch(
            cloudConfigActions.setCloudConfig({
                cloudServiceUrl: this.baseUrl,
                playerIdToken: this.playerIdToken,
            }),
        );
        dispatch(
            cloudStatusActions.setCloudStatus({
                playerIdIsRegistered: isregistered,
                cloudVersion: ver,
                lastCheckedAt: Date.now(),
            }),
        );
        await dispatch(fetchSequences()).unwrap();
        await dispatch(fetchPlaylists()).unwrap();
        await dispatch(fetchScheduledPlaylists()).unwrap();
        await dispatch(fetchPlayerStatus()).unwrap();
    }

    async disconnect() {
        this.dispatch = undefined;
        return Promise.resolve();
    }


    getPlayerIDToken(): string {
        return this.playerIdToken;
    }

    // Player immediate
    async issuePlayerCommand(_req: EZPlayerCommand) {
        return false;
    }
    async setPlayerSettings(_s: PlaybackSettings) {
        return false;
    }

    static EZP_BASE_URL_DEFAULT = (window as any).__APP_CONFIG__?.API_BASE ?? 'https://api.ezplayer.dev/';

    async getCloudSequences(): Promise<SequenceRecord[]> {
        return await getSequencesAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken());
    }

    async postCloudSequences(data: SequenceRecord[]): Promise<SequenceRecord[]> {
        return await postSequencesDataAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken(), data);
    }

    async getCloudPlaylists(): Promise<PlaylistRecord[]> {
        return await getPlaylistsAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken());
    }

    async postCloudPlaylists(data: PlaylistRecord[]): Promise<PlaylistRecord[]> {
        return await postPlaylistsDataAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken(), data);
    }

    async getCloudSchedule(): Promise<ScheduledPlaylist[]> {
        return await getScheduledPlaylistsAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken());
    }

    async postCloudSchedule(data: ScheduledPlaylist[]): Promise<ScheduledPlaylist[]> {
        return await postScheduledPlaylistsAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken(), data);
    }

    async getCloudStatus(): Promise<CombinedPlayerStatus> {
        // CRAZ TODO: This is wrong, wrong, wrong...
        //  If there is no player API
        try {
            return await getCloudStatusAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken());
        } catch (_e) {
            // If not logged in & no registered token, not really much to do.
            return Promise.resolve({});
        }
    }

    async requestSetPlayerIdToken(data: { playerIdToken?: string }): Promise<{ message: string }> {
        const newtoken = setOrGeneratePlayerIdToken(data.playerIdToken);
        this.playerIdToken = newtoken;
        this.dispatch?.(cloudConfigActions.setPlayerIdToken(newtoken));
        await this.refreshAll();
        return {
            message: 'Player ID set',
        };
    }

    async isPlayerRegistered(playerId: string): Promise<boolean> {
        const res = await isPlayerRegisteredCall(this.axiosInstance, this.apiUrl, playerId);
        return res.registered;
    }
}
