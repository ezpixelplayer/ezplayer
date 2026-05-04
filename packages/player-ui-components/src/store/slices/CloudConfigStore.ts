import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { CloudConfig } from '@ezplayer/ezplayer-core';

const initialState: CloudConfig = {
    cloudServiceUrl: '',
    playerIdToken: '',
};

const cloudConfigSlice = createSlice({
    name: 'cloudConfig',
    initialState,
    reducers: {
        setCloudServiceUrl: (state, action: PayloadAction<string>) => {
            state.cloudServiceUrl = action.payload;
        },
        setPlayerIdToken: (state, action: PayloadAction<string>) => {
            state.playerIdToken = action.payload;
        },
        setCloudConfig: (_state, action: PayloadAction<CloudConfig>) => action.payload,
    },
});

export const cloudConfigActions = cloudConfigSlice.actions;
export default cloudConfigSlice.reducer;
