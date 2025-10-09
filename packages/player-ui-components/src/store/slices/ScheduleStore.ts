import { ActionReducerMapBuilder, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface ScheduleState {
    scheduledPlaylists?: ScheduledPlaylist[];
    loading: boolean;
    error?: string;
}

export const initialScheduleState: ScheduleState = {
    scheduledPlaylists: undefined,
    loading: false,
    error: undefined,
};

export function createScheduleSlice(extraReducers: (builder: ActionReducerMapBuilder<ScheduleState>) => void) {
    return createSlice({
        name: 'schedule',
        initialState: initialScheduleState,
        reducers: {
            setScheduledPlaylists: (state: ScheduleState, action: PayloadAction<ScheduledPlaylist[]>) => {
                state.scheduledPlaylists = action.payload;
            },
        },
        extraReducers,
    });
}

export const fetchScheduledPlaylists = createAsyncThunk<ScheduledPlaylist[], void, { extra: DataStorageAPI }>(
    'schedule/fetchScheduledPlaylists',
    async (_, { extra }) => {
        const response = await extra.getCloudSchedule();
        return response;
    },
);

export const postScheduledPlaylists = createAsyncThunk<
    ScheduledPlaylist[],
    ScheduledPlaylist[],
    { extra: DataStorageAPI }
>('schedule/postScheduledPlaylists', async (scheduledPlaylists: ScheduledPlaylist[], { extra }) => {
    return await extra.postCloudSchedule(scheduledPlaylists);
});

const scheduleSlice = createScheduleSlice((builder) => {
    builder
        .addCase(fetchScheduledPlaylists.pending, (state) => {
            state.loading = true;
        })
        .addCase(fetchScheduledPlaylists.fulfilled, (state, action) => {
            console.log(`Thunk returns.  Setting ${action.payload.length} scheduled playlists.`);
            state.loading = false;
            state.scheduledPlaylists = action.payload;
        })
        .addCase(fetchScheduledPlaylists.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postScheduledPlaylists.pending, (state, _action) => {
            state.loading = true;
        })
        .addCase(postScheduledPlaylists.fulfilled, (state, action) => {
            state.loading = false;
            state.scheduledPlaylists = action.payload;
        })
        .addCase(postScheduledPlaylists.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const { setScheduledPlaylists } = scheduleSlice.actions;

export default scheduleSlice.reducer;
