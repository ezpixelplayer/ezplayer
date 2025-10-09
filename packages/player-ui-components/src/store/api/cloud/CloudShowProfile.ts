import { EndUserShowSettings } from '@ezplayer/ezplayer-core';
import { apiGet, apiPost } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

export const getCloudShowProfileAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
): Promise<EndUserShowSettings> => {
    const authToken = localStorage.getItem('auth_token');
    const url = authToken
        ? `${apiServerUrl}${API_ENDPOINTS.GET_SHOW_PROFILE}`
        : `${apiServerUrl}${API_ENDPOINTS.GET_SHOW_PROFILE_TOKEN}${playerIdToken}`;

    const headers = authToken
        ? {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
          }
        : {
              'Content-Type': 'application/json',
          };
    const response = await apiGet<EndUserShowSettings>(inst, url, {
        headers,
    });
    return response?.data ?? {};
};

export const postCloudShowProfileAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
    profile: EndUserShowSettings,
): Promise<EndUserShowSettings> => {
    const authToken = localStorage.getItem('auth_token');
    const url = authToken
        ? `${apiServerUrl}${API_ENDPOINTS.UPDATE_SHOW_PROFILE}`
        : `${apiServerUrl}${API_ENDPOINTS.SET_SHOW_PROFILE_TOKEN}${playerIdToken}`;

    const headers = authToken
        ? {
              Authorization: `Bearer ${authToken}`,
              'Content-Type': 'application/json',
          }
        : {
              'Content-Type': 'application/json',
          };

    const payload = authToken
        ? {
              show: profile,
          }
        : {
              profile: profile,
          };

    const response = await apiPost<EndUserShowSettings>(
        inst,
        url,
        payload,

        {
            headers,
        },
    );
    return response?.data ?? profile;
};
