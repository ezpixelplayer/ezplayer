import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AutoUpdateStatus } from '@ezplayer/ezplayer-core';

/** Latest auto-update status pushed from main (Electron only; stays null elsewhere). */
export interface AutoUpdateState {
    status: AutoUpdateStatus | null;
}

const initialState: AutoUpdateState = { status: null };

const autoUpdateSlice = createSlice({
    name: 'autoUpdate',
    initialState,
    reducers: {
        setStatus: (state, action: PayloadAction<AutoUpdateStatus>) => {
            state.status = action.payload;
        },
    },
});

export const autoUpdateActions = autoUpdateSlice.actions;
export default autoUpdateSlice.reducer;
