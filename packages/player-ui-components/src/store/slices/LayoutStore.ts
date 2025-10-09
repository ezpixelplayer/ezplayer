import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { JSONEditSheet, JSONEditState } from '../../components/layout-edit/types';

export interface LayoutState {
    data: JSONEditSheet | null;
    selections: JSONEditState | null;
    loading: boolean;
    error: string | null;
}

const initialState: LayoutState = {
    data: null,
    selections: null,
    loading: false,
    error: null,
};

export const fetchLayoutOptions = createAsyncThunk<JSONEditSheet | null, void, { extra: DataStorageAPI }>(
    'layout/fetchLayoutOptions',
    async (_, { extra }) => {
        const response = await extra.getLayoutOptions();
        return response;
    },
);

export const uploadLayoutHints = createAsyncThunk<void, { modelEditState: JSONEditState }, { extra: DataStorageAPI }>(
    'layout/uploadLayoutHints',
    async (data, { extra }) => {
        await extra.uploadLayoutHints(data);
    },
);

export const loadLayoutHints = createAsyncThunk<
    { modelEditState: JSONEditState } | null,
    void,
    { extra: DataStorageAPI }
>('layout/loadLayoutHints', async (_, { extra }) => {
    const response = await extra.getLayoutHints();
    return response;
});

const layoutSlice = createSlice({
    name: 'layout',
    initialState,
    reducers: {
        clearLayoutOptions: (state) => {
            state.data = null;
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchLayoutOptions.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchLayoutOptions.fulfilled, (state, action) => {
                state.loading = false;
                state.data = action.payload;
                state.error = null;
            })
            .addCase(fetchLayoutOptions.rejected, (state, action) => {
                state.loading = false;
                state.data = null;
                state.error = action.error.message || 'Failed to fetch layout options';
            })
            .addCase(uploadLayoutHints.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(uploadLayoutHints.fulfilled, (state) => {
                state.loading = false;
                state.error = null;
            })
            .addCase(uploadLayoutHints.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message || 'Failed to upload layout hints';
            })
            .addCase(loadLayoutHints.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(loadLayoutHints.fulfilled, (state, action) => {
                state.loading = false;
                state.selections = action.payload?.modelEditState ?? null;
                state.error = null;
            })
            .addCase(loadLayoutHints.rejected, (state, action) => {
                state.loading = false;
                state.selections = null;
                state.error = action.error.message || 'Failed to load layout hints';
            });
    },
});

export const { clearLayoutOptions } = layoutSlice.actions;
export default layoutSlice.reducer;
