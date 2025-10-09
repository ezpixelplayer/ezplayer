import { AxiosInstance } from 'axios';
import { apiGet, apiPost } from './api-requests';
import { API_ENDPOINTS } from '../ApiEndpoints';
import { CloudFileDownloadResponse, CloudLayoutFileUpload, DownloadFileResponse } from '../DataStorageAPI';

export const postCloudRgbUploadAPI = async (inst: AxiosInstance, apiServerUrl: string) => {
    const response = await apiPost<{
        rec: { file_id: string; file_time: string };
        post: { url: string; fields: Record<string, string> };
    }>(inst, `${apiServerUrl}${API_ENDPOINTS.START_UPLOAD_RGB}`);
    const fileId = response.data.rec.file_id;
    const fileTime = response.data.rec.file_time;
    const post = response.data.post;

    return { fileId, fileTime, post };
};

export const postCloudNetworksUploadAPI = async (inst: AxiosInstance, apiServerUrl: string) => {
    const response = await apiPost<{
        rec: { file_id: string; file_time: string };
        post: { url: string; fields: Record<string, string> };
    }>(inst, `${apiServerUrl}${API_ENDPOINTS.START_UPLOAD_NETWORKS}`);
    const fileId = response.data.rec.file_id;
    const fileTime = response.data.rec.file_time;
    const post = response.data.post;

    return { fileId, fileTime, post };
};

export const postCloudDoneUploadLayoutFilesAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    payload: CloudLayoutFileUpload,
) => {
    const response = await apiPost<{
        rec: { file_id: string; file_time: string };
    }>(inst, `${apiServerUrl}${API_ENDPOINTS.DONE_UPLOAD_LAYOUT_FILES}`, payload);

    return response.data;
};

export const getCloudUploadedFilesAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerApiServerUrl: string,
    playerIdToken: string,
) => {
    const authToken = localStorage.getItem('auth_token');
    if (authToken) {
        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };
        return (
            await apiGet<DownloadFileResponse>(inst, `${apiServerUrl}${API_ENDPOINTS.USER_LIST_SEQFILES}`, { headers })
        ).data;
    }

    const response = await apiGet<DownloadFileResponse>(
        inst,
        `${playerApiServerUrl}${API_ENDPOINTS.GET_UPLOADED_FILES}${playerIdToken}`,
    );

    return response.data;
};

export const getCloudSeqFileAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerApiServerUrl: string,
    playerIdToken: string,
    file_id: string,
) => {
    const authToken = localStorage.getItem('auth_token');
    if (authToken) {
        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };
        return (
            await apiGet<CloudFileDownloadResponse>(
                inst,
                `${apiServerUrl}${API_ENDPOINTS.USER_GET_SEQ_FILE}${file_id}`,
                { headers },
            )
        ).data;
    }

    const response = await apiGet<CloudFileDownloadResponse>(
        inst,
        `${playerApiServerUrl}${API_ENDPOINTS.PLAYER_GET_SEQ_FILE}${playerIdToken}/${file_id}`,
    );

    return response.data;
};

export const getCloudMediaFileAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerApiServerUrl: string,
    playerIdToken: string,
    file_id: string,
) => {
    const authToken = localStorage.getItem('auth_token');
    if (authToken) {
        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };
        return (
            await apiGet<CloudFileDownloadResponse>(
                inst,
                `${apiServerUrl}${API_ENDPOINTS.USER_GET_MEDIA_FILE}${file_id}`,
                { headers },
            )
        ).data;
    }

    const response = await apiGet<CloudFileDownloadResponse>(
        inst,
        `${playerApiServerUrl}${API_ENDPOINTS.PLAYER_GET_MEDIA_FILE}${playerIdToken}/${file_id}`,
    );

    return response.data;
};

export const getCloudXsqzFileAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerApiServerUrl: string,
    playerIdToken: string,
    file_id: string,
) => {
    const authToken = localStorage.getItem('auth_token');
    if (authToken) {
        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };
        return (
            await apiGet<CloudFileDownloadResponse>(
                inst,
                `${apiServerUrl}${API_ENDPOINTS.USER_GET_XSQZ_FILE}${file_id}`,
                { headers },
            )
        ).data;
    }

    const response = await apiGet<CloudFileDownloadResponse>(
        inst,
        `${playerApiServerUrl}${API_ENDPOINTS.PLAYER_GET_XSQZ_FILE}${playerIdToken}/${file_id}`,
    );

    return response.data;
};

export const getCloudPreviewVideoAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    playerApiServerUrl: string,
    playerIdToken: string,
    file_id: string,
) => {
    const authToken = localStorage.getItem('auth_token');
    if (authToken) {
        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };
        return (
            await apiGet<CloudFileDownloadResponse>(
                inst,
                `${apiServerUrl}${API_ENDPOINTS.USER_GET_PREVIEW_VIDEO}${file_id}`,
                { headers },
            )
        ).data;
    }

    const response = await apiGet<CloudFileDownloadResponse>(
        inst,
        `${playerApiServerUrl}${API_ENDPOINTS.PLAYER_GET_PREVIEW_VIDEO}${playerIdToken}/${file_id}`,
    );

    return response.data;
};

export const postCloudZipUploadAPI = async (inst: AxiosInstance, apiServerUrl: string) => {
    const response = await apiPost<{
        rec: { file_id: string; file_time: string };
        post: { url: string; fields: Record<string, string> };
    }>(inst, `${apiServerUrl}${API_ENDPOINTS.START_UPLOAD_LAY_ZIP}`);
    const fileId = response.data.rec.file_id;
    const fileTime = response.data.rec.file_time;
    const post = response.data.post;

    return { fileId, fileTime, post };
};

export const postCloudDoneUploadZipAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
    fileId: string,
    fileTime: string,
) => {
    const response = await apiPost<{
        rec: { file_id: string; file_time: string };
    }>(inst, `${apiServerUrl}${API_ENDPOINTS.DONE_UPLOAD_LAY_ZIP}/${fileId}/${fileTime}`);

    return response.data;
};
