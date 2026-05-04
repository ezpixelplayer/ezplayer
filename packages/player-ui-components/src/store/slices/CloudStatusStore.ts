import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CloudStatus } from '@ezplayer/ezplayer-core';

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

export const cloudStatusActions = cloudStatusSlice.actions;
export default cloudStatusSlice.reducer;
