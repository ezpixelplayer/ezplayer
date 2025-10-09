import { ToastMsgs } from '@ezplayer/shared-ui-components';
import { AxiosInstance } from 'axios';
import { JSONEditState } from '@ezplayer/ezplayer-core';
import { API_ENDPOINTS } from '../ApiEndpoints';
import { apiPost } from './api-requests';

interface LayoutOptionsResponse {
    url: string;
}

export const getLayoutOptionsAPI = async (inst: AxiosInstance, apiServerUrl: string): Promise<JSONEditState | null> => {
    try {
        const authToken = localStorage.getItem('auth_token');
        const headers = authToken
            ? {
                  Authorization: `Bearer ${authToken}`,
                  'Content-Type': 'application/json',
              }
            : {
                  'Content-Type': 'application/json',
              };

        // First get the file URL
        const urlResponse = await apiPost<LayoutOptionsResponse>(
            inst,
            `${apiServerUrl}${API_ENDPOINTS.DOWNLOAD_LAYOUT_OPTIONS}`,
            { headers },
        );

        if (!urlResponse?.data?.url) {
            console.error('No URL received from layout options API');
            return null;
        }

        // Then fetch the actual file content
        const fileResponse = await fetch(urlResponse.data.url);
        if (!fileResponse.ok) {
            throw new Error(`Failed to fetch layout options file: ${fileResponse.statusText}`);
        }

        const jsonData = await fileResponse.json();
        return jsonData;
    } catch (error) {
        console.error('Error fetching layout options:', error);
        return null;
    }
};

export const getLayoutHintsAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
): Promise<{ modelEditState: JSONEditState } | null> => {
    try {
        const authToken = localStorage.getItem('auth_token');
        const headers = authToken
            ? {
                  Authorization: `Bearer ${authToken}`,
                  'Content-Type': 'application/json',
              }
            : {
                  'Content-Type': 'application/json',
              };

        // Get the hints file URL
        const urlResponse = await apiPost<LayoutOptionsResponse>(
            inst,
            `${apiServerUrl}${API_ENDPOINTS.DOWNLOAD_LAYOUT_HINTS}`,
            {},
            { headers },
        );

        if (!urlResponse?.data?.url) {
            console.log('No saved layout hints available');
            return null;
        }

        // Fetch the actual file content
        const fileResponse = await fetch(urlResponse.data.url);
        if (!fileResponse.ok) {
            if (fileResponse.status === 404) {
                // No hints exist yet, return null to indicate this is a valid state
                console.log('No layout hints file exists yet');
                return null;
            }
            throw new Error(`Failed to fetch layout hints file: ${fileResponse.statusText}`);
        }

        const jsonData = await fileResponse.json();
        return jsonData;
    } catch (error: any) {
        console.error('Error fetching layout hints:', error);
        ToastMsgs.showWarningMessage('Oops! No previous layout found. Start updating your layout.', {
            theme: 'colored',
            position: 'bottom-right',
            autoClose: 2000,
        });
        if (
            error.response &&
            error.response.status === 500 &&
            error.response.data?.message?.includes('Layout file not found')
        ) {
            return null;
        }
        throw error; // Let the thunk handle the error
    }
};

export const startLayoutHintsUploadAPI = async (
    inst: AxiosInstance,
    apiServerUrl: string,
): Promise<{ fileId: string; fileTime: string; post: any }> => {
    try {
        const authToken = localStorage.getItem('auth_token');
        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };

        const response = await apiPost<{
            rec: { file_id: string; file_time: string };
            post: any;
        }>(inst, `${apiServerUrl}${API_ENDPOINTS.START_UPLOAD_LAYOUT_HINTS}`, {}, { headers });

        if (!response?.data?.rec || !response?.data?.post) {
            throw new Error('Invalid response from start upload API');
        }

        return {
            fileId: response.data.rec.file_id,
            fileTime: response.data.rec.file_time,
            post: response.data.post,
        };
    } catch (error) {
        console.error('Error starting layout hints upload:', error);
        throw error;
    }
};

export const uploadLayoutHintsFileAPI = async (
    fileId: string,
    fileTime: string,
    data: any,
    inst: AxiosInstance,
    apiServerUrl: string,
    post: any,
): Promise<void> => {
    try {
        // First upload to S3 using the post object
        const formData = new FormData();

        // Add all fields from the post object to the form data
        Object.entries(post.fields).forEach(([key, value]) => {
            formData.append(key, value as string);
        });

        // Add the file content as the last field
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        formData.append('file', blob);

        // Upload to S3
        const s3Response = await fetch(post.url, {
            method: 'POST',
            body: formData,
        });

        if (!s3Response.ok) {
            throw new Error(`Failed to upload to S3: ${s3Response.statusText}`);
        }

        // After successful S3 upload, call the done endpoint
        const authToken = localStorage.getItem('auth_token');
        const headers = {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        };

        await apiPost(
            inst,
            `${apiServerUrl}${API_ENDPOINTS.DONE_UPLOAD_LAYOUT_HINTS}/${fileId}/${fileTime}`,
            {},
            { headers },
        );
    } catch (error) {
        console.error('Error uploading layout hints file:', error);
        throw error;
    }
};
