import {
    CloudLayoutFileUpload,
    CloudFileUploadResponse,
    DataStorageAPI,
    DownloadFileResponse,
    CloudFileDownloadResponse,
    getOrInitializePlayerId,
    setOrGeneratePlayerIdToken,
    CloudFileUpload,
} from '../DataStorageAPI';

import {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    CombinedPlayerStatus,
    EndUser,
    EndUserShowSettings,
    UserPlayer,
} from '@ezplayer/ezplayer-core';

import {
    AppDispatch,
    fetchPlayerStatus,
    fetchPlaylists,
    fetchScheduledPlaylists,
    fetchSequences,
    fetchShowProfile,
    getCloudUploadedFiles,
    authSliceActions,
    fetchUserProfile,
} from '../../..';

import { AxiosInstance } from 'axios';
import { createAxiosInstance } from './axios-instance';
import { getSequencesAPI, postSequencesDataAPI } from './CloudSequenceAPI';
import { getPlaylistsAPI, postPlaylistsDataAPI } from './CloudPlaylistAPI';
import { getScheduledPlaylistsAPI, postScheduledPlaylistsAPI } from './CloudScheduleAPI';
import { getCloudStatusAPI } from './CloudStatusAPI';
import { getCloudUserProfileAPI, postCloudUserProfileAPI } from './CloudUserProfileAPI';
import { getCloudShowProfileAPI, postCloudShowProfileAPI } from './CloudShowProfile';
import {
    postLoginCall,
    postRegisterCall,
    postRequestPasswordResetCall,
    postChangePasswordCall,
    postRegisterPlayerCall,
    isPlayerRegisteredCall,
} from './CloudAuthAPI';
import { UserLoginBody, UserRegisterBody } from '../DataStorageAPI';
import {
    postCloudNetworksUploadAPI,
    postCloudRgbUploadAPI,
    postCloudDoneUploadLayoutFilesAPI,
    getCloudUploadedFilesAPI,
    getCloudSeqFileAPI,
    getCloudMediaFileAPI,
    getCloudXsqzFileAPI,
    getCloudPreviewVideoAPI,
    postCloudZipUploadAPI,
    postCloudDoneUploadZipAPI,
} from './CloudFileUploadAPI';
import { getPlayersAPI } from './CloudPlayers';
import {
    getLayoutOptionsAPI,
    startLayoutHintsUploadAPI,
    uploadLayoutHintsFileAPI,
    getLayoutHintsAPI,
} from './CloudLayoutAPI';
import { JSONEditSheet, JSONEditState } from '../../../components/layout-edit/types';

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
        dispatch(authSliceActions.setCloudVersion(ver));
        dispatch(authSliceActions.setPlayerIsRegistered(isregistered));
        dispatch(authSliceActions.setSupportsLogin(true));
        dispatch(authSliceActions.setSupportsToken(true));
        dispatch(authSliceActions.setCloudServiceUrl(this.baseUrl));
        dispatch(authSliceActions.setPlayerIdToken(this.playerIdToken));
        dispatch(authSliceActions.setUserToken(token));
        if (token) {
            await dispatch(fetchUserProfile()).unwrap();
        }
        await dispatch(fetchSequences()).unwrap();
        await dispatch(fetchPlaylists()).unwrap();
        await dispatch(fetchScheduledPlaylists()).unwrap();
        await dispatch(fetchShowProfile()).unwrap();
        await dispatch(fetchPlayerStatus()).unwrap();
        await dispatch(getCloudUploadedFiles()).unwrap();
    }

    async disconnect() {
        this.dispatch = undefined;
        return Promise.resolve();
    }

    getPlayerIDToken(): string {
        return this.playerIdToken;
    }

    // Player immediate
    async requestImmediatePlay(req: { id: string }) {
        console.log(`GET http://fpprgb1.local/api/command/Trigger+Command+Preset/${req.id}`);
        await fetch(`http://fpprgb1.local/api/command/Trigger+Command+Preset/${req.id}`, { method: 'GET' });
        return true;
    }

    static EZP_BASE_URL_DEFAULT =
        (window as any).__APP_CONFIG__?.API_BASE ?? 'https://webmaster-ezplay-cloud-endpoint.cloud.dbos.dev/';

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

    async getCloudShowProfile(): Promise<EndUserShowSettings> {
        return await getCloudShowProfileAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken());
    }

    async postCloudShowProfile(data: EndUserShowSettings): Promise<EndUserShowSettings> {
        return await postCloudShowProfileAPI(this.axiosInstance, this.apiUrl, this.getPlayerIDToken(), data);
    }

    async getCloudUserProfile(): Promise<EndUser> {
        return await getCloudUserProfileAPI(
            this.axiosInstance,
            this.apiUrl,
            // this.EZP_SERVER_API_TOKEN
        );
    }

    async getUserPlayers(): Promise<UserPlayer[]> {
        const response = await getPlayersAPI(this.axiosInstance, this.apiUrl);
        return response;
    }

    async postCloudUserProfile(data: Partial<EndUser>): Promise<EndUser> {
        return await postCloudUserProfileAPI(
            this.axiosInstance,
            this.apiUrl,
            // this.EZP_SERVER_API_TOKEN,
            data,
        );
    }

    async requestLoginToken(data: UserLoginBody): Promise<string> {
        const res = await postLoginCall(this.axiosInstance, this.apiUrl, data);

        if (res) {
            localStorage.setItem('auth_token', res);
        } else {
            localStorage.removeItem('auth_token');
        }

        await this.refreshAll();
        return res;
    }

    async requestLogout(): Promise<void> {
        localStorage.removeItem('auth_token');
        await this.refreshAll();
        return;
    }

    async postCloudRegister(data: UserRegisterBody): Promise<UserRegisterBody> {
        return await postRegisterCall(this.axiosInstance, this.apiUrl, data);
    }

    async postRequestPasswordReset(data: { email: string }): Promise<{ message: string }> {
        return await postRequestPasswordResetCall(this.axiosInstance, this.apiUrl, data);
    }

    async postChangePassword(data: { oldPassword: string; newPassword: string }): Promise<{ message: string }> {
        return await postChangePasswordCall(this.axiosInstance, this.apiUrl, data);
    }

    async requestSetPlayerIdToken(data: { playerIdToken?: string }): Promise<{ message: string }> {
        const newtoken = setOrGeneratePlayerIdToken(data.playerIdToken);
        this.playerIdToken = newtoken;
        this.dispatch?.(authSliceActions.setPlayerIdToken(newtoken));
        // Set the registration if we're logged in...
        // TODO CRAZ centralize
        if (localStorage.getItem('auth_token')) {
            await this.postRegisterPlayer({ playerId: this.playerIdToken });
        }
        await this.refreshAll(); // May trigger a full refresh
        return {
            message: 'Player ID set',
        };
    }

    async postRegisterPlayer(data: { playerId: string }): Promise<{ message: string }> {
        const res = await postRegisterPlayerCall(this.axiosInstance, this.apiUrl, data.playerId);
        await this.refreshAll();
        return res;
    }
    async postCloudRgbUpload(): Promise<CloudFileUpload> {
        return await postCloudRgbUploadAPI(this.axiosInstance, this.apiUrl);
    }

    async postCloudNetworksUpload(): Promise<CloudFileUpload> {
        return await postCloudNetworksUploadAPI(this.axiosInstance, this.apiUrl);
    }

    async postCloudZipUpload(): Promise<CloudFileUpload> {
        return await postCloudZipUploadAPI(this.axiosInstance, this.apiUrl);
    }

    async postCloudDoneUploadLayoutFiles(data: CloudLayoutFileUpload): Promise<CloudFileUploadResponse> {
        return await postCloudDoneUploadLayoutFilesAPI(this.axiosInstance, this.apiUrl, data);
    }

    async postCloudDoneUploadZip(fileId: string, fileTime: string): Promise<CloudFileUploadResponse> {
        return await postCloudDoneUploadZipAPI(this.axiosInstance, this.apiUrl, fileId, fileTime);
    }

    async getCloudUploadedFiles(): Promise<DownloadFileResponse> {
        try {
            const response = await getCloudUploadedFilesAPI(
                this.axiosInstance,
                this.apiUrl,
                this.fileDownloadUrl,
                this.getPlayerIDToken(),
            );
            // TODO CRAZ Move this
            return response;
        } catch (_e) {
            return { sequences: [] };
        }
    }

    async getCloudSeqFile(fileId: string): Promise<CloudFileDownloadResponse> {
        const response = await getCloudSeqFileAPI(
            this.axiosInstance,
            this.apiUrl,
            this.fileDownloadUrl,
            this.getPlayerIDToken(),
            fileId,
        );
        return response as CloudFileDownloadResponse;
    }
    async getCloudMediaFile(fileId: string): Promise<CloudFileDownloadResponse> {
        const response = await getCloudMediaFileAPI(
            this.axiosInstance,
            this.apiUrl,
            this.fileDownloadUrl,
            this.getPlayerIDToken(),
            fileId,
        );
        return response as CloudFileDownloadResponse;
    }
    async getCloudXsqzFile(fileId: string): Promise<CloudFileDownloadResponse> {
        const response = await getCloudXsqzFileAPI(
            this.axiosInstance,
            this.apiUrl,
            this.fileDownloadUrl,
            this.getPlayerIDToken(),
            fileId,
        );
        return response as CloudFileDownloadResponse;
    }

    async getCloudPreviewVideo(fileId: string): Promise<CloudFileDownloadResponse> {
        const response = await getCloudPreviewVideoAPI(
            this.axiosInstance,
            this.apiUrl,
            this.fileDownloadUrl,
            this.getPlayerIDToken(),
            fileId,
        );
        return response as CloudFileDownloadResponse;
    }

    async isPlayerRegistered(playerId: string): Promise<boolean> {
        const res = await isPlayerRegisteredCall(this.axiosInstance, this.apiUrl, playerId);
        if (res.registered) {
            // Fetch players but don't use the result - this is likely for side effects
            await getPlayersAPI(this.axiosInstance, this.apiUrl);
        }
        return res.registered;
    }

    async getLayoutOptions(): Promise<JSONEditSheet | null> {
        const response = await getLayoutOptionsAPI(this.axiosInstance, this.apiUrl);
        return response as JSONEditSheet | null;
    }

    async uploadLayoutHints(data: any): Promise<void> {
        // First get the upload URL and file info
        const { fileId, fileTime, post } = await startLayoutHintsUploadAPI(this.axiosInstance, this.apiUrl);

        // Then upload the actual file content
        await uploadLayoutHintsFileAPI(fileId, fileTime, data, this.axiosInstance, this.apiUrl, post);
    }

    async getLayoutHints(): Promise<{ modelEditState: JSONEditState } | null> {
        return await getLayoutHintsAPI(this.axiosInstance, this.apiUrl);
    }
}
