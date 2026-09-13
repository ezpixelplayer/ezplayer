import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AppSettingsCommand, AppSettingsState } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

/** Latest app-global settings pushed from the player (diagnostics consent,
 *  start at sign-in). Null until the first push/snapshot arrives, or on
 *  backends that do not expose them. */
export interface AppSettingsSliceState {
    state: AppSettingsState | null;
}

const initialState: AppSettingsSliceState = { state: null };

const appSettingsSlice = createSlice({
    name: 'appSettings',
    initialState,
    reducers: {
        setAppSettings: (s, action: PayloadAction<AppSettingsState>) => {
            s.state = action.payload;
        },
    },
});

/** Issue an app-settings verb - fire and forget; the new state comes back via
 *  the pushed `appSettings` state. */
export const sendAppSettingsCommand = createAsyncThunk<void, AppSettingsCommand, { extra: DataStorageAPI }>(
    'appSettings/command',
    async (cmd, { extra }) => {
        await extra.issueAppSettingsCommand?.(cmd);
    },
);

export const appSettingsActions = appSettingsSlice.actions;
export default appSettingsSlice.reducer;
