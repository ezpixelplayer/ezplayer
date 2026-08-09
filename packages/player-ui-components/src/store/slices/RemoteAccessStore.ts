import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RemoteAccessAvailability } from '@ezplayer/ezplayer-core';

/**
 * Which password-gated remote-access tiles this player offers.
 * (A feature is on only when a password for it was set.)
 */
const initialState: RemoteAccessAvailability = { shell: false, files: false };

const remoteAccessSlice = createSlice({
    name: 'remoteAccess',
    initialState,
    reducers: {
        setRemoteAccess: (_state, action: PayloadAction<RemoteAccessAvailability>) => ({
            shell: action.payload?.shell === true,
            files: action.payload?.files === true,
        }),
    },
});

export const remoteAccessActions = remoteAccessSlice.actions;
export default remoteAccessSlice.reducer;
