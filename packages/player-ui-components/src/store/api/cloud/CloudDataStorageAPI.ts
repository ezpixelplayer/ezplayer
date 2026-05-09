import {
    DataStorageAPI,
    getOrInitializePlayerId,
    setOrGeneratePlayerIdToken,
} from '../DataStorageAPI';

import {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    CloudCommand,
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

    async refreshAll() {
        let isregistered = false;
        let ver = 'unknown';
        let lastError: string | undefined;
        try {
            const res = await isPlayerRegisteredCall(this.axiosInstance, this.apiUrl, this.playerIdToken);
            isregistered = res.registered;
            ver = res.version;
        } catch (e) {
            console.warn(e);
            lastError = e instanceof Error ? e.message : 'cloud call failed';
        }

        const dispatch = this.dispatch;
        if (!dispatch) return;

        const token = localStorage.getItem('auth_token');
        dispatch(authSliceActions.setUserToken(token));
        dispatch(
            cloudConfigActions.setCloudConfig({
                cloudServiceUrl: this.baseUrl,
                playerIdToken: this.playerIdToken,
            }),
        );
        // `lastError` carries reachability now: undefined = reachable, string = no.
        // Consumers (e.g. ConnectivityStatus) derive `cloudIsReachable` from this.
        dispatch(
            cloudStatusActions.setCloudStatus({
                playerIdIsRegistered: isregistered,
                cloudVersion: ver,
                lastCheckedAt: Date.now(),
                lastError,
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

    async isPlayerRegistered(playerId: string): Promise<boolean> {
        const res = await isPlayerRegisteredCall(this.axiosInstance, this.apiUrl, playerId);
        return res.registered;
    }

    /** Cloud-app surfaces don't run a local cloud-content worker. The worker-targeted
     *  verbs (syncNow, fetchLayoutNow, pollNow) are no-ops here; the config-mutating
     *  verbs run their cloud-app-local equivalents (in-memory state + refreshAll). */
    async issueCloudCommand(cmd: CloudCommand): Promise<void> {
        switch (cmd.type) {
            case 'setPlayerIdToken': {
                const newtoken = setOrGeneratePlayerIdToken(cmd.token);
                this.playerIdToken = newtoken;
                this.dispatch?.(cloudConfigActions.setPlayerIdToken(newtoken));
                await this.refreshAll();
                return;
            }
            case 'setCloudServiceUrl': {
                this.baseUrl = cmd.url;
                localStorage.setItem('cloudBaseUrl', this.baseUrl);
                localStorage.removeItem('auth_token'); // came from another server
                await this.refreshAll();
                return;
            }
            // syncNow / fetchLayoutNow / pollNow: no local cloud worker on this surface.
            default:
                return;
        }
    }
}
