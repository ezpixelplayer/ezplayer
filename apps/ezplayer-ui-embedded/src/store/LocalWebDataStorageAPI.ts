import type {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    CombinedPlayerStatus,
    EndUserShowSettings,
    EndUser,
    UserPlayer,
    JSONEditSheet,
    JSONEditState,
    EZPlayerCommand,
    PlaybackSettings,
    PlayerWebSocketMessage,
} from '@ezplayer/ezplayer-core';

import type {
    DataStorageAPI,
    UserLoginBody,
    UserRegisterBody,
    CloudLayoutFileUpload,
    CloudFileUploadResponse,
    DownloadFileResponse,
    CloudFileDownloadResponse,
    CloudFileUpload,
} from '@ezplayer/player-ui-components';

import {
    AppDispatch,
    authSliceActions,
    hydratePlaybackSettings,
    setCStatus,
    setEndUser,
    setNStatus,
    setPlaybackStatistics,
    setPlaylists,
    setPStatus,
    setScheduledPlaylists,
    setSequenceData,
    setShowProfile,
} from '@ezplayer/player-ui-components';
import { wsService } from '../services/websocket';

/**
 * LocalWebDataStorageAPI - For web browsers connecting to local Electron Koa server
 * This API communicates with the REST API endpoints exposed by the Electron app's Koa server
 */
export class LocalWebDataStorageAPI implements DataStorageAPI {
    baseUrl: string;
    dispatch?: AppDispatch;
    onDisconnect?: () => void;

    constructor(baseUrl?: string) {
        // Default to localhost with common ports
        this.baseUrl = baseUrl || 'http://localhost:5173';
    }

    get apiUrl() {
        return `${this.baseUrl}/api/`;
    }

    get fileDownloadUrl() {
        return `${this.baseUrl}/`;
    }

    async connect(dispatch: AppDispatch) {
        this.dispatch = dispatch;

        // Subscribe to all WebSocket message types before connecting so we don't miss initial payloads
        const unsubscribeSnapshot = wsService.subscribe('snapshot', (msg: PlayerWebSocketMessage) => {
            if (msg.type !== 'snapshot') return;
            const data = msg.data;
            if (data.showFolder !== undefined) {
                dispatch(authSliceActions.setShowDirectory(data.showFolder));
            }
            if (data.sequences !== undefined) {
                dispatch(setSequenceData(data.sequences));
            }
            if (data.playlists !== undefined) {
                dispatch(setPlaylists(data.playlists));
            }
            if (data.schedule !== undefined) {
                dispatch(setScheduledPlaylists(data.schedule));
            }
            if (data.show !== undefined) {
                dispatch(setShowProfile(data.show));
            }
            if (data.user !== undefined) {
                dispatch(setEndUser(data.user));
            }
            if (data.playbackSettings !== undefined) {
                dispatch(hydratePlaybackSettings(data.playbackSettings));
            }
            if (data.cStatus !== undefined) {
                dispatch(setCStatus(data.cStatus));
            }
            if (data.nStatus !== undefined) {
                dispatch(setNStatus(data.nStatus));
            }
            if (data.pStatus !== undefined) {
                dispatch(setPStatus(data.pStatus));
            }
            if (data.playbackStatistics !== undefined) {
                dispatch(setPlaybackStatistics(data.playbackStatistics));
            }
        });

        const unsubscribePing = wsService.subscribe('ping', (msg)=>{
            if (msg.type === 'ping') {
                wsService.send({type: 'pong', now: Date.now()});
            }
        });

        // Connect will send the initial data
        wsService.connect();

        this.onDisconnect = async () => {
            unsubscribeSnapshot();
            unsubscribePing();
            wsService.disconnect();
        };
    }

    async disconnect() {
        this.dispatch = undefined;
        this.onDisconnect?.();
        return Promise.resolve();
    }

    getPlayerIDToken(): string {
        return 'local-web-player';
    }

    // Player commands - POST to /api/player-command
    async issuePlayerCommand(req: EZPlayerCommand): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiUrl}player-command`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(req),
            });

            if (!response.ok) {
                console.error('Failed to issue player command:', response.statusText);
                return false;
            }

            const result = await response.json();
            return result.success === true;
        } catch (error) {
            console.error('Error issuing player command:', error);
            return false;
        }
    }

    async setPlayerSettings(s: PlaybackSettings): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiUrl}playback-settings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(s),
            });

            if (!response.ok) {
                throw new Error(`Failed to update playback settings: ${response.statusText}`);
            }

            const result = await response.json();
            return result.success || false;
        } catch (error) {
            console.error('Error posting playback settings to Electron:', error);
            return false;
        }
    }

    // The following methods are not used by the web app when connected locally
    // Data is synced via WebSocket instead
    async requestChangeServerUrl(_data: { cloudURL: string }) {
        throw new Error('Not supported in local web mode');
    }

    async refreshAll() {
        return Promise.resolve();
    }

    async getCloudSequences(): Promise<SequenceRecord[]> {
        return [];
    }

    async postCloudSequences(data: SequenceRecord[]): Promise<SequenceRecord[]> {
        return data;
    }

    async getCloudPlaylists(): Promise<PlaylistRecord[]> {
        return [];
    }

    async postCloudPlaylists(data: PlaylistRecord[]): Promise<PlaylistRecord[]> {
        try {
            const response = await fetch(`${this.apiUrl}playlists`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error(`Failed to update playlists: ${response.statusText}`);
            }

            const result = await response.json();
            return result.playlists || [];
        } catch (error) {
            console.error('Error posting playlists to Electron:', error);
            throw error;
        }
    }

    async getCloudSchedule(): Promise<ScheduledPlaylist[]> {
        return [];
    }

    async postCloudSchedule(data: ScheduledPlaylist[]): Promise<ScheduledPlaylist[]> {
        try {
            const response = await fetch(`${this.apiUrl}schedules`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error(`Failed to update schedules: ${response.statusText}`);
            }

            const result = await response.json();
            return result.schedules || [];
        } catch (error) {
            console.error('Error posting schedules to Electron:', error);
            throw error;
        }
    }

    async getCloudStatus(): Promise<CombinedPlayerStatus> {
        return {};
    }

    async getCloudShowProfile(): Promise<EndUserShowSettings> {
        return {} as EndUserShowSettings;
    }

    async postCloudShowProfile(data: EndUserShowSettings): Promise<EndUserShowSettings> {
        return data;
    }

    async getCloudUserProfile(): Promise<EndUser> {
        return {} as EndUser;
    }

    async getUserPlayers(): Promise<UserPlayer[]> {
        return [];
    }

    async postCloudUserProfile(data: Partial<EndUser>): Promise<EndUser> {
        return data as EndUser;
    }

    async requestLoginToken(_data: UserLoginBody): Promise<string> {
        throw new Error('Authentication not supported in local web mode');
    }

    async requestLogout(): Promise<void> {
        return;
    }

    async postCloudRegister(_data: UserRegisterBody): Promise<UserRegisterBody> {
        throw new Error('Registration not supported in local web mode');
    }

    async postRequestPasswordReset(_data: { email: string }): Promise<{ message: string }> {
        throw new Error('Password reset not supported in local web mode');
    }

    async postChangePassword(_data: { oldPassword: string; newPassword: string }): Promise<{ message: string }> {
        throw new Error('Password change not supported in local web mode');
    }

    async requestSetPlayerIdToken(_data: { playerIdToken?: string }): Promise<{ message: string }> {
        return {
            message: 'Player ID management not needed in local web mode',
        };
    }

    async postRegisterPlayer(_data: { playerId: string }): Promise<{ message: string }> {
        return { message: 'Player registration not needed in local web mode' };
    }

    async postCloudRgbUpload(): Promise<CloudFileUpload> {
        throw new Error('File upload not supported in local web mode');
    }

    async postCloudNetworksUpload(): Promise<CloudFileUpload> {
        throw new Error('File upload not supported in local web mode');
    }

    async postCloudZipUpload(): Promise<CloudFileUpload> {
        throw new Error('File upload not supported in local web mode');
    }

    async postCloudDoneUploadLayoutFiles(_data: CloudLayoutFileUpload): Promise<CloudFileUploadResponse> {
        throw new Error('File upload not supported in local web mode');
    }

    async postCloudDoneUploadZip(_fileId: string, _fileTime: string): Promise<CloudFileUploadResponse> {
        throw new Error('File upload not supported in local web mode');
    }

    async getCloudUploadedFiles(): Promise<DownloadFileResponse> {
        return { sequences: [] };
    }

    async getCloudSeqFile(_fileId: string): Promise<CloudFileDownloadResponse> {
        throw new Error('File download not implemented in local web mode');
    }

    async getCloudMediaFile(_fileId: string): Promise<CloudFileDownloadResponse> {
        throw new Error('File download not implemented in local web mode');
    }

    async getCloudXsqzFile(_fileId: string): Promise<CloudFileDownloadResponse> {
        throw new Error('File download not implemented in local web mode');
    }

    async getCloudPreviewVideo(_fileId: string): Promise<CloudFileDownloadResponse> {
        throw new Error('File download not implemented in local web mode');
    }

    async isPlayerRegistered(_playerId: string): Promise<boolean> {
        return true;
    }

    async getLayoutOptions(): Promise<JSONEditSheet | null> {
        return null;
    }

    async uploadLayoutHints(_data: any): Promise<void> {
        throw new Error('Layout hints upload not supported in local web mode');
    }

    async getLayoutHints(): Promise<{ modelEditState: JSONEditState } | null> {
        return null;
    }
}
