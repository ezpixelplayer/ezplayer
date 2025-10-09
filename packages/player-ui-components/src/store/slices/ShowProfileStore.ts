import { ActionReducerMapBuilder, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';

import { EndUserShowSettings } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface ShowProfileState {
    showSettings?: EndUserShowSettings;
    loading: boolean;
    error?: string;
}

export const initialShowProfileState: ShowProfileState = {
    showSettings: undefined,
    loading: false,
    error: undefined,
};

export function createShowProfileSlice(extraReducers: (builder: ActionReducerMapBuilder<ShowProfileState>) => void) {
    return createSlice({
        name: 'showProfile',
        initialState: initialShowProfileState,
        reducers: {
            setShowProfile: (state: ShowProfileState, action: PayloadAction<EndUserShowSettings>) => {
                state.showSettings = action.payload;
            },
        },
        extraReducers,
    });
}

export const fetchShowProfile = createAsyncThunk<EndUserShowSettings, void, { extra: DataStorageAPI }>(
    'showProfile/fetchShowProfile',
    async (_, { extra }) => {
        const response = await extra.getCloudShowProfile();
        return response;
    },
);

export const postShowProfile = createAsyncThunk<EndUserShowSettings, EndUserShowSettings, { extra: DataStorageAPI }>(
    'showProfile/postShowProfile',
    async (showProfile: EndUserShowSettings, { extra }) => {
        return await extra.postCloudShowProfile(showProfile);
    },
);

const showProfileSlice = createShowProfileSlice((builder) => {
    builder
        .addCase(fetchShowProfile.pending, (state) => {
            state.loading = true;
        })
        .addCase(fetchShowProfile.fulfilled, (state, action) => {
            state.loading = false;
            state.showSettings = action.payload;
        })
        .addCase(fetchShowProfile.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postShowProfile.pending, (state, _action) => {
            state.loading = true;
        })
        .addCase(postShowProfile.fulfilled, (state, action) => {
            state.loading = false;
            state.showSettings = action.payload;
        })
        .addCase(postShowProfile.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const { setShowProfile } = showProfileSlice.actions;

export default showProfileSlice.reducer;
