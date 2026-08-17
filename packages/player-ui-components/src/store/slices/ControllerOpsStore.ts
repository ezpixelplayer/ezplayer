import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { ActionCreatorWithPayload } from '@reduxjs/toolkit';
import type { ControllerOpsState, ControllerCommand } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

const initialState: ControllerOpsState = { interfaces: [], devices: {}, operations: {} };

const controllerOpsSlice = createSlice({
    name: 'controllerOps',
    initialState,
    reducers: {
        // Explicit return type: this replace-style reducer otherwise makes RTK/immer
        // surface an un-nameable draft type in the generated .d.ts (TS4023).
        setControllerOps: (_state, action: PayloadAction<ControllerOpsState>): ControllerOpsState => action.payload,
    },
});

/** Issue a controller op (scan / status / action) — fire and forget; progress
 *  and results come back via the pushed `controllerops` state. */
export const issueControllerCommand = createAsyncThunk<void, ControllerCommand, { extra: DataStorageAPI }>(
    'controllerOps/command',
    async (command, { extra }) => {
        await extra.issueControllerCommand(command);
    },
);

// Explicit type on the export so DTS generation never has to name immer's
// internal draft type for our nested-Record state (TS4023).
export const controllerOpsActions: {
    setControllerOps: ActionCreatorWithPayload<ControllerOpsState>;
} = controllerOpsSlice.actions;
export default controllerOpsSlice.reducer;
