import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CloudStatus } from '@ezplayer/ezplayer-core';
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

/** Trigger an immediate manifest refresh on the player. The actual status updates
 *  arrive asynchronously through the existing cStatus push channel. */
export const triggerCloudSyncNow = createAsyncThunk<void, void, { extra: DataStorageAPI }>(
    'cloud/syncNow',
    async (_arg, { extra }) => {
        await extra.requestCloudSyncNow();
    },
);

export const cloudStatusActions = cloudStatusSlice.actions;
export default cloudStatusSlice.reducer;
