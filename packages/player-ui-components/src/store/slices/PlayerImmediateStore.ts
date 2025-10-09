import { ActionReducerMapBuilder, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface PlayerImmediateState {
    playing?: boolean;

    // TODO: What's playing, etc.?
    // E.g. sequence
    //      background
    //      Overlays / effects / tests
    // Volume / brightness / etc

    loading: boolean;
    error?: string;
}

export const initialImmediateState: PlayerImmediateState = {
    playing: false,
    loading: false,
    error: undefined,
};

export function createPlayerImmediateSlice(
    extraReducers: (builder: ActionReducerMapBuilder<PlayerImmediateState>) => void,
) {
    return createSlice({
        name: 'playerImmediate',
        initialState: initialImmediateState,
        reducers: {
            setPlaying: (state: PlayerImmediateState, action: PayloadAction<boolean>) => {
                state.playing = action.payload;
            },
        },
        extraReducers,
    });
}

export const callImmediatePlay = createAsyncThunk<boolean, { sid: string }, { extra: DataStorageAPI }>(
    'player/immediatePlay',
    async (arg, { extra }) => {
        const response = await extra.requestImmediatePlay({ id: arg.sid });
        return true;
    },
);

const playerImmediateSlice = createPlayerImmediateSlice((builder) => {
    builder
        .addCase(callImmediatePlay.pending, (state) => {
            state.loading = true;
        })
        .addCase(callImmediatePlay.fulfilled, (state, action) => {
            state.loading = false;
            state.playing = action.payload;
        })
        .addCase(callImmediatePlay.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const playerImmediateSliceActions = playerImmediateSlice.actions;

export default playerImmediateSlice.reducer;
