import { ActionReducerMapBuilder, createAsyncThunk, createSlice, PayloadAction, Slice } from '@reduxjs/toolkit';
import {
    CloudFileDownloadResponse,
    CloudFileUploadResponse,
    CloudLayoutFileUpload,
    DataStorageAPI,
    DownloadFile,
    DownloadFileResponse,
} from '../api/DataStorageAPI';
import { RootState } from '../Store';

export interface HomeState {
    rgbFileType: boolean;
    networksFileType: boolean;
    rgbFileContent: boolean;
    networksFileContent: boolean;
    xrgbFileName: string;
    networksFileName: string;
    rgbFile: {
        name: string;
        size: number;
        lastModified: number;
        file: File;
    } | null;
    networksFile: {
        name: string;
        size: number;
        lastModified: number;
        file: File;
    } | null;
    rgbFileId: string;
    networksFileId: string;
    rgbFileTime: string;
    networksFileTime: string;
    downloadedFiles: DownloadFile[];
    rgbFileDownload: CloudFileDownloadResponse | null;
    networksFileDownload: CloudFileDownloadResponse | null;
    loading: boolean;
    error?: string;
    zipFile: {
        name: string;
        size: number;
        lastModified: number;
    } | null;
    zipFileId: string;
    zipFileTime: string;
}

export function createHomeSlice(
    extraReducers: (builder: ActionReducerMapBuilder<HomeState>) => void,
): Slice<HomeState> {
    const initialHomeState: HomeState = {
        rgbFileType: false,
        networksFileType: false,
        rgbFileContent: false,
        networksFileContent: false,
        xrgbFileName: '',
        networksFileName: '',
        rgbFileId: '',
        networksFileId: '',
        rgbFileTime: '',
        networksFileTime: '',
        rgbFile: null,
        networksFile: null,
        downloadedFiles: [],
        rgbFileDownload: null,
        networksFileDownload: null,
        loading: false,
        error: undefined,
        zipFile: null,
        zipFileId: '',
        zipFileTime: '',
    };

    return createSlice({
        name: 'homeStore',
        initialState: initialHomeState,
        reducers: {
            uploadRgbFileName: (state, action: PayloadAction<string>) => {
                state.xrgbFileName = action.payload;
            },
            uploadNetworksFileName: (state, action: PayloadAction<string>) => {
                state.networksFileName = action.payload;
            },
            uploadRgbFile: (
                state,
                action: PayloadAction<{
                    name: string;
                    size: number;
                    lastModified: number;
                    file: File;
                }>,
            ) => {
                state.rgbFile = action.payload;
            },
            uploadNetworksFile: (
                state,
                action: PayloadAction<{
                    name: string;
                    size: number;
                    lastModified: number;
                    file: File;
                }>,
            ) => {
                state.networksFile = action.payload;
            },
            validRgbFileType: (state, action: PayloadAction<boolean>) => {
                state.rgbFileType = action.payload;
            },
            validNetworksFileType: (state, action: PayloadAction<boolean>) => {
                state.networksFileType = action.payload;
            },
            validRgbFileContent: (state, action: PayloadAction<boolean>) => {
                state.rgbFileContent = action.payload;
            },
            validNetworksFileContent: (state, action: PayloadAction<boolean>) => {
                state.networksFileContent = action.payload;
            },
            uploadRgbFileId: (state, action: PayloadAction<string>) => {
                state.rgbFileId = action.payload;
            },
            uploadNetworksFileId: (state, action: PayloadAction<string>) => {
                state.networksFileId = action.payload;
            },
            uploadRgbFileTime: (state, action: PayloadAction<string>) => {
                state.rgbFileTime = action.payload;
            },
            uploadNetworksFileTime: (state, action: PayloadAction<string>) => {
                state.networksFileTime = action.payload;
            },
            uploadZipFile: (
                state,
                action: PayloadAction<{
                    name: string;
                    size: number;
                    lastModified: number;
                }>,
            ) => {
                state.zipFile = action.payload;
            },
            uploadZipFileId: (state, action: PayloadAction<string>) => {
                state.zipFileId = action.payload;
            },
            uploadZipFileTime: (state, action: PayloadAction<string>) => {
                state.zipFileTime = action.payload;
            },
        },
        extraReducers,
    });
}

export const postRgbFileUpload = createAsyncThunk<
    { fileId: string; fileTime: string; post: { url: string; fields: Record<string, string> } },
    void,
    { state: RootState; extra: DataStorageAPI }
>('fileUpload/postRgbUploadData', async (_, { extra }) => {
    const response = await extra.postCloudRgbUpload();
    return response;
});

export const postNetworksFileUpload = createAsyncThunk<
    { fileId: string; fileTime: string; post: { url: string; fields: Record<string, string> } },
    void,
    { state: RootState; extra: DataStorageAPI }
>('fileUpload/postNetworksUploadData', async (_, { extra }) => {
    const response = await extra.postCloudNetworksUpload();
    return response;
});

export const postDoneUploadLayoutFiles = createAsyncThunk<
    CloudFileUploadResponse,
    CloudLayoutFileUpload,
    { extra: DataStorageAPI }
>('fileUpload/postDoneUploadLayoutFiles', async (data, { extra }) => {
    const response = await extra.postCloudDoneUploadLayoutFiles(data);
    return response;
});

export const getCloudUploadedFiles = createAsyncThunk<DownloadFileResponse, void, { extra: DataStorageAPI }>(
    'fileUpload/getCloudUploadedFiles',
    async (_, { extra }) => {
        const response = await extra.getCloudUploadedFiles();
        return response;
    },
);

export const getCloudSeqFile = createAsyncThunk<CloudFileDownloadResponse, string, { extra: DataStorageAPI }>(
    'fileUpload/getCloudSeqFile',
    async (fileId, { extra }) => {
        const response = await extra.getCloudSeqFile(fileId);
        return response;
    },
);

export const getCloudMediaFile = createAsyncThunk<CloudFileDownloadResponse, string, { extra: DataStorageAPI }>(
    'fileUpload/getCloudMediaFile',
    async (fileId, { extra }) => {
        const response = await extra.getCloudMediaFile(fileId);
        return response;
    },
);

export const getCloudXsqzFile = createAsyncThunk<CloudFileDownloadResponse, string, { extra: DataStorageAPI }>(
    'homeStore/getCloudXsqzFile',
    async (fileId, { extra }) => {
        const response = await extra.getCloudXsqzFile(fileId);
        return response;
    },
);

export const getCloudPreviewVideo = createAsyncThunk<CloudFileDownloadResponse, string, { extra: DataStorageAPI }>(
    'homeStore/getCloudPreviewVideo',
    async (fileId, { extra }) => {
        const response = await extra.getCloudPreviewVideo(fileId);
        return response;
    },
);

export const postZipFileUpload = createAsyncThunk<
    { fileId: string; fileTime: string; post: { url: string; fields: Record<string, string> } },
    void,
    { state: RootState; extra: DataStorageAPI }
>('fileUpload/postZipUploadData', async (_, { extra }) => {
    const response = await extra.postCloudZipUpload();
    return response;
});

export const postDoneUploadZip = createAsyncThunk<
    CloudFileUploadResponse,
    { fileId: string; fileTime: string },
    { extra: DataStorageAPI }
>('fileUpload/postDoneUploadZip', async (data, { extra }) => {
    const response = await extra.postCloudDoneUploadZip(data.fileId, data.fileTime);
    return response;
});

const homeSlice = createHomeSlice((builder) => {
    builder
        .addCase(postRgbFileUpload.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postRgbFileUpload.fulfilled, (state, action) => {
            state.loading = false;
            state.rgbFileId = action.payload.fileId;
            state.rgbFileTime = action.payload.fileTime;
        })
        .addCase(postRgbFileUpload.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postNetworksFileUpload.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postNetworksFileUpload.fulfilled, (state, action) => {
            state.loading = false;
            state.networksFileId = action.payload.fileId;
            state.networksFileTime = action.payload.fileTime;
        })
        .addCase(postNetworksFileUpload.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postDoneUploadLayoutFiles.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postDoneUploadLayoutFiles.fulfilled, (state) => {
            state.loading = false;
        })
        .addCase(postDoneUploadLayoutFiles.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(getCloudUploadedFiles.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(getCloudUploadedFiles.fulfilled, (state, action) => {
            state.loading = false;
            state.downloadedFiles = action.payload.sequences;
        })
        .addCase(getCloudUploadedFiles.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(getCloudSeqFile.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(getCloudSeqFile.fulfilled, (state, action) => {
            state.loading = false;
            state.rgbFileDownload = action.payload;
        })
        .addCase(getCloudSeqFile.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(getCloudMediaFile.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(getCloudMediaFile.fulfilled, (state, action) => {
            state.loading = false;
            state.networksFileDownload = action.payload;
        })
        .addCase(getCloudMediaFile.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(getCloudXsqzFile.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(getCloudXsqzFile.fulfilled, (state, action) => {
            state.loading = false;
            state.rgbFileDownload = action.payload; // This looks wrong
        })
        .addCase(getCloudXsqzFile.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(getCloudPreviewVideo.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(getCloudPreviewVideo.fulfilled, (state, action) => {
            state.loading = false;
            state.rgbFileDownload = action.payload;
        })
        .addCase(getCloudPreviewVideo.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postZipFileUpload.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postZipFileUpload.fulfilled, (state, action) => {
            state.loading = false;
            state.zipFileId = action.payload.fileId;
            state.zipFileTime = action.payload.fileTime;
        })
        .addCase(postZipFileUpload.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postDoneUploadZip.pending, (state) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postDoneUploadZip.fulfilled, (state) => {
            state.loading = false;
        })
        .addCase(postDoneUploadZip.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const {
    validRgbFileType,
    validNetworksFileType,
    validRgbFileContent,
    validNetworksFileContent,
    uploadRgbFileName,
    uploadNetworksFileName,
    uploadRgbFile,
    uploadNetworksFile,
    uploadRgbFileId,
    uploadNetworksFileId,
    uploadRgbFileTime,
    uploadNetworksFileTime,
    uploadZipFile,
    uploadZipFileId,
    uploadZipFileTime,
} = homeSlice.actions;

export default homeSlice.reducer;
