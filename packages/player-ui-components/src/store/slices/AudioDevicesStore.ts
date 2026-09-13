import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AudioDevice } from '@ezplayer/ezplayer-core';
import { isPhysicalAudioOutput } from '@ezplayer/ezplayer-core';

/** Physical audio outputs on the player machine; null until the player reports them. */
export interface AudioDevicesState {
    outputs: AudioDevice[] | null;
}

const initialState: AudioDevicesState = { outputs: null };

const audioDevicesSlice = createSlice({
    name: 'audioDevices',
    initialState,
    reducers: {
        setAudioOutputDevices(state, action: PayloadAction<AudioDevice[]>) {
            state.outputs = action.payload.filter(isPhysicalAudioOutput);
        },
    },
});

export const audioDevicesActions = audioDevicesSlice.actions;
export default audioDevicesSlice.reducer;
