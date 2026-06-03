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

/**
 * Runtime slice — pushed-from-main player status (P / C / N status, playback
 * statistics) plus loading/issuing flags for the fetch and command thunks.
 *
 * Editable persistent settings live in `PlaybackSettingsStore` so the high-cadence
 * status pushes here don't churn settings selectors.
 */
export interface RuntimeState {
    /** Combined P / C / N status, pushed via the cstatus / nstatus / pstatus channels. */
    combined: CombinedPlayerStatus;
    /** Periodically pushed playback statistics. */
    playbackStats?: PlaybackStatistics;

    loading: boolean;
    issuing: boolean;
    error?: string;

    /** Browser↔cloud WS state (cloud view only). `undefined` =
     *  not in cloud view / not yet known; LAN apps don't update this. */
    bridgeConnected?: boolean;
    /** Player↔cloud WS state, reported by the bridge. Same scope
     *  as `bridgeConnected`. */
    playerConnected?: boolean;
}

export const initialRuntimeState: RuntimeState = {
    combined: {},
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

export const fetchPlayerStatus = createAsyncThunk<CombinedPlayerStatus, void, { extra: DataStorageAPI }>(
    'status/fetchPlayerStatus',
    async (_, { extra }) => {
        const response = await extra.getCloudStatus();
        return response;
    },
);

const runtimeSlice = createSlice({
    name: 'runtime',
    initialState: initialRuntimeState,
    reducers: {
        setStatus: (state: RuntimeState, action: PayloadAction<CombinedPlayerStatus>) => {
            state.combined = action.payload;
        },
        setPStatus: (state: RuntimeState, action: PayloadAction<PlayerPStatusContent>) => {
            state.combined = { ...state.combined, player: action.payload, player_updated: Date.now() };
        },
        setCStatus: (state: RuntimeState, action: PayloadAction<PlayerCStatusContent>) => {
            state.combined = { ...state.combined, content: action.payload, content_updated: Date.now() };
        },
        setNStatus: (state: RuntimeState, action: PayloadAction<PlayerNStatusContent>) => {
            state.combined = { ...state.combined, controller: action.payload, controller_updated: Date.now() };
        },
        setPlaybackStatistics: (state: RuntimeState, action: PayloadAction<PlaybackStatistics>) => {
            state.playbackStats = action.payload;
        },
        setBridgeConnected: (state: RuntimeState, action: PayloadAction<boolean>) => {
            state.bridgeConnected = action.payload;
        },
        setPlayerConnected: (state: RuntimeState, action: PayloadAction<boolean>) => {
            state.playerConnected = action.payload;
        },
    },
    extraReducers: (builder: ActionReducerMapBuilder<RuntimeState>) => {
        builder
            .addCase(fetchPlayerStatus.pending, (state) => {
                state.loading = true;
            })
            .addCase(fetchPlayerStatus.fulfilled, (state, action) => {
                state.loading = false;
                state.combined = action.payload;
            })
            .addCase(fetchPlayerStatus.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error.message;
            })
            .addCase(callImmediateCommand.pending, (state) => {
                state.issuing = true;
            })
            .addCase(callImmediateCommand.fulfilled, (state) => {
                state.issuing = false;
            })
            .addCase(callImmediateCommand.rejected, (state, action) => {
                state.issuing = false;
                state.error = action.error.message;
            });
    },
});

export const {
    setStatus: setPlayerStatus,
    setCStatus,
    setNStatus,
    setPStatus,
    setPlaybackStatistics,
    setBridgeConnected,
    setPlayerConnected,
} = runtimeSlice.actions;

export const runtimeActions = runtimeSlice.actions;
export default runtimeSlice.reducer;
