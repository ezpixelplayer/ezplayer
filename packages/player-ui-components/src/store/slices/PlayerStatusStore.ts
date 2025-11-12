import { ActionReducerMapBuilder, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import {
    CombinedPlayerStatus,
    PlayerPStatusContent,
    PlaybackStatistics,
    PlayerNStatusContent,
    PlayerCStatusContent,
    EZPlayerCommand,
} from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface PlayerStatusState {
    playerStatus: CombinedPlayerStatus;
    playbackStats?: PlaybackStatistics;

    loading: boolean;
    issuing: boolean;
    error?: string;
}

export const initialStatusState: PlayerStatusState = {
    playerStatus: {},
    loading: false,
    issuing: false,
    error: undefined,
};

export const callImmediateCommand = createAsyncThunk<boolean, EZPlayerCommand, { extra: DataStorageAPI }>(
    'player/immediateCommand',
    async (arg, { extra }) => {
        const response = await extra.issuePlayerCommand(arg);
        return response;
    },
);

export function createPlayerStatusSlice(extraReducers: (builder: ActionReducerMapBuilder<PlayerStatusState>) => void) {
    return createSlice({
        name: 'playerStatus',
        initialState: initialStatusState,
        reducers: {
            setStatus: (state: PlayerStatusState, action: PayloadAction<CombinedPlayerStatus>) => {
                state.playerStatus = action.payload;
            },
            setPStatus: (state: PlayerStatusState, action: PayloadAction<PlayerPStatusContent>) => {
                state.playerStatus = { ...state.playerStatus, player: action.payload, player_updated: Date.now() };
            },
            setCStatus: (state: PlayerStatusState, action: PayloadAction<PlayerCStatusContent>) => {
                state.playerStatus = { ...state.playerStatus, content: action.payload, content_updated: Date.now() };
            },
            setNStatus: (state: PlayerStatusState, action: PayloadAction<PlayerNStatusContent>) => {
                state.playerStatus = {
                    ...state.playerStatus,
                    controller: action.payload,
                    controller_updated: Date.now(),
                };
            },
            setPlaybackStatistics: (state: PlayerStatusState, action: PayloadAction<PlaybackStatistics>) => {
                state.playbackStats = action.payload;
            },
        },
        extraReducers,
    });
}

export const fetchPlayerStatus = createAsyncThunk<CombinedPlayerStatus, void, { extra: DataStorageAPI }>(
    'status/fetchPlayerStatus',
    async (_, { extra }) => {
        const response = await extra.getCloudStatus();
        return response;
    },
);

const playerStatusSlice = createPlayerStatusSlice((builder) => {
    builder
        .addCase(fetchPlayerStatus.pending, (state) => {
            state.loading = true;
        })
        .addCase(fetchPlayerStatus.fulfilled, (state, action) => {
            state.loading = false;
            state.playerStatus = action.payload;
        })
        .addCase(fetchPlayerStatus.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(callImmediateCommand.pending, (state) => {
            state.issuing = true;
        })
        .addCase(callImmediateCommand.fulfilled, (state, action) => {
            state.issuing = false;
        })
        .addCase(callImmediateCommand.rejected, (state, action) => {
            state.issuing = false;
            state.error = action.error.message;
        });
});

export const {
    setStatus: setPlayerStatus,
    setCStatus,
    setNStatus,
    setPStatus,
    setPlaybackStatistics,
} = playerStatusSlice.actions;

export default playerStatusSlice.reducer;
