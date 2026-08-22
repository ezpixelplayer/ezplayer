import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AutoUpdateOpsState, UpdateCommand } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

/** Latest software-update snapshot pushed from the player. Null until the
 *  first push/snapshot arrives (or on backends without update control). */
export interface AutoUpdateState {
    ops: AutoUpdateOpsState | null;
}

const initialState: AutoUpdateState = { ops: null };

const autoUpdateSlice = createSlice({
    name: 'autoUpdate',
    initialState,
    reducers: {
        setOps: (state, action: PayloadAction<AutoUpdateOpsState>) => {
            state.ops = action.payload;
        },
    },
});

/** Issue a software-update verb — fire and forget; results and progress come
 *  back via the pushed `autoUpdateOps` state. */
export const sendUpdateCommand = createAsyncThunk<void, UpdateCommand, { extra: DataStorageAPI }>(
    'autoUpdate/command',
    async (cmd, { extra }) => {
        await extra.issueUpdateCommand?.(cmd);
    },
);

export const autoUpdateActions = autoUpdateSlice.actions;
export default autoUpdateSlice.reducer;
