import { apiGet } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

export const isPlayerRegisteredCall = async (inst: AxiosInstance, apiServerUrl: string, playerId: string) => {
    const response = await apiGet<{ registered: boolean; version: string }>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.IS_PLAYER_REGISTERED}${playerId}`,
    );

    return response.data;
};
