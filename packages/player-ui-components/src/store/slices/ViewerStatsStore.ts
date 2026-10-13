import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ViewerStatsSummary } from '@ezplayer/ezplayer-core';

/** Owner viewer-activity summary, pushed by the player as `viewerStats`. */
export interface ViewerStatsSliceState {
    summary?: ViewerStatsSummary;
}

const initialState: ViewerStatsSliceState = {};

const viewerStatsSlice = createSlice({
    name: 'viewerStats',
    initialState,
    reducers: {
        setViewerStats: (_state, action: PayloadAction<ViewerStatsSummary | undefined>): ViewerStatsSliceState => ({
            summary: action.payload,
        }),
    },
});

export const viewerStatsActions: {
    setViewerStats: (payload: ViewerStatsSummary | undefined) => PayloadAction<ViewerStatsSummary | undefined>;
} = viewerStatsSlice.actions;
export default viewerStatsSlice.reducer;
