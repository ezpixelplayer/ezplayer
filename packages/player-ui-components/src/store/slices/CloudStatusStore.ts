import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CloudCommand, CloudStatus } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

const initialState: CloudStatus = {
    playerIdIsRegistered: false,
};

const cloudStatusSlice = createSlice({
    name: 'cloudStatus',
    initialState,
    reducers: {
        setCloudStatus: (_state, action: PayloadAction<CloudStatus>) => action.payload,
    },
});

/** Single thunk for any cloud-worker verb. Status updates come back via the existing
 *  cStatus / cloudStatus / cloudConfig push channels — fire and forget. */
export const issueCloudCommand = createAsyncThunk<void, CloudCommand, { extra: DataStorageAPI }>(
    'cloud/command',
    async (cmd, { extra }) => {
        await extra.issueCloudCommand(cmd);
    },
);

export const cloudStatusActions = cloudStatusSlice.actions;
export default cloudStatusSlice.reducer;
