import { EndUser } from '@ezplayer/ezplayer-core';
import { apiGet, apiPost } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

export const getCloudUserProfileAPI = async (inst: AxiosInstance, apiServerUrl: string): Promise<EndUser> => {
    const authToken = localStorage.getItem('auth_token');
    const response = await apiGet<EndUser>(inst, `${apiServerUrl}${API_ENDPOINTS.GET_USER_PROFILE}`, {
        headers: {
            Authorization: `Bearer ${authToken}`,
        },
    });
    return response?.data ?? {};
};

export const postCloudUserProfileAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    profile: Partial<EndUser>,
): Promise<EndUser> => {
    const authToken = localStorage.getItem('auth_token');
    const response = await apiPost<EndUser>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.UPDATE_USER_PROFILE}`,
        {
            user: profile,
        },
        {
            headers: {
                Authorization: `Bearer ${authToken}`,
                'Content-Type': 'application/json',
            },
        },
    );
    return response?.data ?? profile;
};
