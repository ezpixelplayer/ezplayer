import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { apiGet, apiPost } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

export interface PlayerScheduleContent {
    schedule: ScheduledPlaylist[];
}

export interface PlayerScheduleUpload {
    content: PlayerScheduleContent;
    player_token: string;
}

export const getScheduledPlaylistsAPI = async (inst: AxiosInstance, apiServerUrl: string, playerIdToken: string) => {
    try {
        const response = await apiGet<PlayerScheduleContent>(
            inst,
            `${apiServerUrl}${API_ENDPOINTS.GET_SCHEDULE}${playerIdToken}`,
        );
        return response?.data?.schedule?.filter((s) => s.deleted !== true) ?? [];
    } catch (error) {
        console.error('Error fetching scheduled playlists:', error);
        throw error;
    }
};

export const postScheduledPlaylistsAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
    payload: ScheduledPlaylist[],
) => {
    try {
        const uppl = payload.map((r) => {
            return { ...r, updatedAt: Date.now() };
        });

        const upData: PlayerScheduleUpload = {
            player_token: playerIdToken,
            content: { schedule: uppl },
        };

        const response = await apiPost<PlayerScheduleContent>(
            inst,
            `${apiServerUrl}${API_ENDPOINTS.UPDATE_SCHEDULE}`,
            upData,
        );
        return response.data.schedule.filter((r) => r.deleted !== true);
    } catch (error) {
        console.error('Error posting schedule:', error);
        throw error;
    }
};
