import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { RemoteAccessAvailability } from '@ezplayer/ezplayer-core';

/**
 * Which password-gated remote-access tiles this player offers.
 *
 * A feature is on only when a password for it was set with the CLI on the
 * player machine — no UI can turn one on. Defaults to everything off so the
 * tiles stay invisible until the player explicitly says otherwise.
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
