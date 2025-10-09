import { SequenceRecord } from '@ezplayer/ezplayer-core';
import { apiGet, apiPost } from './api-requests';
import { AxiosInstance } from 'axios';
import { API_ENDPOINTS } from '../ApiEndpoints';

export interface PlayerSequencesContent {
    sequences: SequenceRecord[];
}

export interface PlayerSeqUpload {
    content: PlayerSequencesContent;
    player_token: string;
}

export const getSequencesAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
): Promise<SequenceRecord[]> => {
    const response = await apiGet<PlayerSequencesContent>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.GET_SEQUENCE}${playerIdToken}`,
    );
    return response?.data?.sequences.filter((s) => s.deleted !== true) ?? [];
};

export const postSequencesDataAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerIdToken: string,
    payload: SequenceRecord[],
) => {
    // Get existing
    const uppl = payload.map((r) => {
        return { ...r, updatedAt: Date.now() };
    });

    const userData: PlayerSeqUpload = {
        player_token: playerIdToken,
        content: { sequences: uppl },
    };
    const response = await apiPost<PlayerSequencesContent>(
        inst,
        `${apiServerUrl}${API_ENDPOINTS.UPDATE_SEQUENCE}`,
        userData,
    );
    return response.data.sequences.filter((r) => r.deleted !== true);
};
