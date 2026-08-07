import { createSlice, PayloadAction } from '@reduxjs/toolkit';

/**
 * Whether this player offers a remote shell. True only when a password has been
 * set with the `EZPlayer shell` CLI on the player machine — there is no UI that
 * can turn it on. Defaults to false so the feature stays invisible until the
 * player explicitly says otherwise.
 */
const shellAvailabilitySlice = createSlice({
    name: 'shellAvailable',
    initialState: false,
    reducers: {
        setShellAvailable: (_state, action: PayloadAction<boolean>) => action.payload,
    },
});

export const shellAvailabilityActions = shellAvailabilitySlice.actions;
export default shellAvailabilitySlice.reducer;
