import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { SettingsLink } from '@ezplayer/ezplayer-core';

/** Extra link tiles the player was launched with (--settings-link). */
export interface SettingsLinksState {
    links: SettingsLink[];
}

const initialState: SettingsLinksState = { links: [] };

const settingsLinksSlice = createSlice({
    name: 'settingsLinks',
    initialState,
    reducers: {
        setSettingsLinks: (_state, action: PayloadAction<SettingsLink[] | undefined>) => ({
            links: Array.isArray(action.payload) ? action.payload : [],
        }),
    },
});

export const settingsLinksActions = settingsLinksSlice.actions;
export default settingsLinksSlice.reducer;
