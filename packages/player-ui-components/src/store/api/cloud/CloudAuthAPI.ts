import { UserLoginBody, UserRegisterBody } from '../DataStorageAPI';
import { apiGet, apiPost } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

interface LoginResponse {
    token: string;
}

export const postLoginCall = async (inst: AxiosInstance, apiServerUrl: string, payload: UserLoginBody) => {
    const response = await apiPost<LoginResponse>(inst, `${apiServerUrl}${API_ENDPOINTS.LOGIN}`, payload);

    if (!response.data.token) {
        throw new Error('No token received from login API');
    }

    return response.data.token;
};

export const postRegisterCall = async (inst: AxiosInstance, apiServerUrl: string, payload: UserRegisterBody) => {
    const response = await apiPost<UserRegisterBody>(inst, `${apiServerUrl}${API_ENDPOINTS.REGISTER}`, payload);

    return response.data;
};

export const postRequestPasswordResetCall = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    payload: { email: string },
) => {
    const response = await apiPost<{ message: string }>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.REQUEST_PASSWORD_RESET}`,
        payload,
    );

    return response.data;
};

export const postChangePasswordCall = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    payload: { oldPassword: string; newPassword: string },
) => {
    const response = await apiPost<{ message: string }>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.CHANGE_PASSWORD}`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
                'Content-Type': 'application/json',
            },
        },
    );

    return response.data;
};

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
