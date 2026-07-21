import type {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    CombinedPlayerStatus,
    CloudCommand,
    EZPlayerCommand,
    PlaybackSettings,
    PlayerWebSocketMessage,
} from '@ezplayer/ezplayer-core';

import type { DataStorageAPI, UserLoginBody, UserRegisterBody } from '@ezplayer/player-ui-components';

import {
    AppDispatch,
    authSliceActions,
    cloudConfigActions,
    cloudStatusActions,
    hydratePlaybackSettings,
    setCStatus,
    setNStatus,
    setPlaybackStatistics,
    setPlayerConnected,
    setPlaylists,
    setPStatus,
    setScheduledPlaylists,
    setSequenceData,
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
            if (data.versions !== undefined) {
                dispatch(authSliceActions.setPlayerVersion(data.versions));
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
            if (data.cloudConfig !== undefined) {
                dispatch(cloudConfigActions.setCloudConfig(data.cloudConfig));
            }
            if (data.cloudStatus !== undefined) {
                dispatch(cloudStatusActions.setCloudStatus(data.cloudStatus));
            }
        });

        const unsubscribePing = wsService.subscribe('ping', (msg) => {
            if (msg.type === 'ping') {
                wsService.send({ type: 'pong', now: Date.now() });
            }
        });

        // Drive the lost-connection overlay off the WS connection state.
        // LAN has a single hop, so we map it onto `playerConnected` and leave
        // `bridgeConnected` undefined (treated as up).
        const unsubscribeWsConnect = wsService.onConnect(() => dispatch(setPlayerConnected(true)));
        const unsubscribeWsDisconnect = wsService.onDisconnect(() => dispatch(setPlayerConnected(false)));

        // Connect will send the initial data
        wsService.connect();

        this.onDisconnect = async () => {
            unsubscribeSnapshot();
            unsubscribePing();
            unsubscribeWsConnect();
            unsubscribeWsDisconnect();
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

    // Player commands - POST to /api/ezp/player-command
    async issuePlayerCommand(req: EZPlayerCommand): Promise<boolean> {
        try {
            const response = await fetch(`${this.apiUrl}ezp/player-command`, {
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
            const response = await fetch(`${this.apiUrl}ezp/playback-settings`, {
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

    // Cloud config writes route over the WebSocket: koa worker forwards to main, main
    // updates the file and reconfigures the poller, status echoes back as a snapshot.

    async refreshAll() {
        return Promise.resolve();
    }

    async getCloudSequences(): Promise<SequenceRecord[]> {
        return [];
    }

    async postCloudSequences(data: SequenceRecord[]): Promise<SequenceRecord[]> {
        const response = await fetch(`${this.apiUrl}ezp/sequences`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`Failed to update sequences: ${response.statusText}`);
        }

        const result = await response.json();
        return result.sequences || [];
    }

    async autodetectShowSequence(fseqName: string) {
        const response = await fetch(`${this.apiUrl}ezp/sequences/autodetect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fseq: fseqName }),
        });
        if (!response.ok) throw new Error(`Autodetect failed: ${response.statusText}`);
        return await response.json();
    }

    async extractShowAudioMetadata(audioName: string) {
        const response = await fetch(`${this.apiUrl}ezp/sequences/audio-metadata`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: audioName }),
        });
        if (!response.ok) throw new Error(`Audio metadata failed: ${response.statusText}`);
        return await response.json();
    }

    async listShowFiles(dir: string): Promise<string[]> {
        const res = await fetch(`${this.apiUrl}files/${encodeURIComponent(dir)}?nameOnly=1`);
        if (!res.ok) throw new Error(`Failed to list ${dir}: ${res.statusText}`);
        return (await res.json()) as string[];
    }

    /** Push a file's bytes into the show folder via the file-management API.
     *  Chunked (FPP-style PATCH) above 16MB so big fseqs don't ride one request. */
    async uploadShowFile(fileName: string, data: Blob): Promise<void> {
        const ext = fileName.toLowerCase().split('.').pop() ?? '';
        const dir =
            ext === 'fseq'
                ? 'sequences'
                : ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'].includes(ext)
                  ? 'music'
                  : 'uploads';

        const CHUNK = 8 * 1024 * 1024;
        if (data.size <= CHUNK * 2) {
            const res = await fetch(`${this.apiUrl}file/${dir}/${encodeURIComponent(fileName)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: data,
            });
            if (!res.ok) throw new Error(`Upload of ${fileName} failed: ${res.statusText}`);
            return;
        }
        for (let off = 0; off < data.size; off += CHUNK) {
            const res = await fetch(`${this.apiUrl}file/${dir}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/offset+octet-stream',
                    'Upload-Name': fileName,
                    'Upload-Offset': String(off),
                    'Upload-Length': String(data.size),
                },
                body: data.slice(off, Math.min(off + CHUNK, data.size)),
            });
            if (!res.ok) throw new Error(`Chunk upload of ${fileName} failed: ${res.statusText}`);
        }
    }

    async getCloudPlaylists(): Promise<PlaylistRecord[]> {
        return [];
    }

    async postCloudPlaylists(data: PlaylistRecord[]): Promise<PlaylistRecord[]> {
        try {
            const response = await fetch(`${this.apiUrl}ezp/playlists`, {
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
            const response = await fetch(`${this.apiUrl}ezp/schedules`, {
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

    async issueCloudCommand(cmd: CloudCommand): Promise<void> {
        wsService.send({ type: 'cloudCommand', cmd });
    }

    async postRegisterPlayer(_data: { playerId: string }): Promise<{ message: string }> {
        return { message: 'Player registration not needed in local web mode' };
    }
}
