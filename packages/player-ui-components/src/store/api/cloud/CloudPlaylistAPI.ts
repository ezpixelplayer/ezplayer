import { AxiosInstance } from 'axios';
import { PlaylistRecord } from '@ezplayer/ezplayer-core';
import { apiGet, apiPost } from './api-requests';
import { API_ENDPOINTS } from '../ApiEndpoints';

export interface PlayerPlaylistsContent {
    playlists: PlaylistRecord[];
}

export interface PlayerPlaylistsUpload {
    content: PlayerPlaylistsContent;
    player_token: string;
}

export const getPlaylistsAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
): Promise<PlaylistRecord[]> => {
    try {
        const response = await apiGet<PlayerPlaylistsContent>(
            inst,
            `${apiServerUrl}${API_ENDPOINTS.GET_PLAYLIST}${playerIdToken}`,
        );
        return response.data.playlists?.filter((r) => r.deleted !== true) ?? [];
    } catch (error) {
        console.error('Error fetching playlists data:', error);
        throw error;
    }
};

export const postPlaylistsDataAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
    payload: PlaylistRecord[],
) => {
    const uppl: PlaylistRecord[] = payload.map((r) => {
        return { ...r, updatedAt: Date.now() };
    });

    const updata: PlayerPlaylistsUpload = {
        player_token: playerIdToken,
        content: { playlists: uppl },
    };

    const response = await apiPost<PlayerPlaylistsContent>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.UPDATE_PLAYLIST}`,
        updata,
    );
    return response.data.playlists.filter((r) => r.deleted !== true);
};
