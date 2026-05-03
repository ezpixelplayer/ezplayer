import { apiGet, apiPost } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

/**
 * Player-side auth helpers — registration check and player-token registration. Account
 * login, registration, password reset, and password change live in show-builder's
 * `BuilderCloudAuthAPI` and are dispatched only from the show-builder UI.
 */

export const isPlayerRegisteredCall = async (inst: AxiosInstance, apiServerUrl: string, playerId: string) => {
    const response = await apiGet<{ registered: boolean; version: string }>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.IS_PLAYER_REGISTERED}${playerId}`,
    );

    return response.data;
};

export const postRegisterPlayerCall = async (inst: AxiosInstance, apiServerUrl: string, playerId: string) => {
    const response = await apiPost<{ message: string }>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.REGISTER_PLAYER}`,
        { player_token: playerId },
        {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
                'Content-Type': 'application/json',
            },
        },
    );

    return response.data;
};
