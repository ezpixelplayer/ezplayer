import { CombinedPlayerStatus } from '@ezplayer/ezplayer-core';
import { apiGet } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

export const getCloudStatusAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
): Promise<CombinedPlayerStatus> => {
    const response = await apiGet<CombinedPlayerStatus>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.GET_STATUS}${playerIdToken}`,
    );
    return response?.data ?? {};
};
