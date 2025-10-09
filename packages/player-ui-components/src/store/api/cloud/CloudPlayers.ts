import { AxiosInstance } from 'axios';
import { UserPlayer } from '@ezplayer/ezplayer-core';
import { apiGet } from './api-requests';
import { API_ENDPOINTS } from '../ApiEndpoints';

export interface UserPlayersContent {
    players: UserPlayer[];
}

export const getPlayersAPI = async (inst: AxiosInstance, apiServerUrl: string): Promise<UserPlayer[]> => {
    try {
        const authToken = localStorage.getItem('auth_token');
        const url = `${apiServerUrl}${API_ENDPOINTS.USER_PLAYER}`;
        if (!authToken) return [];

        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };
        const response = await apiGet<UserPlayersContent>(inst, url, { headers });
        return response.data.players ?? [];
    } catch (error) {
        console.error('Error fetching players for user:', error);
        throw error;
    }
};
