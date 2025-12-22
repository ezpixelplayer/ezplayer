import { ActionReducerMapBuilder, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import {
    CombinedPlayerStatus,
    PlayerPStatusContent,
    PlaybackStatistics,
    PlayerNStatusContent,
    PlayerCStatusContent,
    EZPlayerCommand,
    PlaybackSettings,
    ViewerControlScheduleEntry,
    VolumeScheduleEntry,
} from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { RootState } from '../Store';

export interface PlayerStatusState {
    playerStatus: CombinedPlayerStatus;
    playbackStats?: PlaybackStatistics;
    playbackSettings: PlaybackSettings;

    loading: boolean;
    issuing: boolean;
    settingsSaving: boolean;
    error?: string;
}

export const initialStatusState: PlayerStatusState = {
    playerStatus: {},
    loading: false,
    issuing: false,
    settingsSaving: false,
    error: undefined,
    playbackSettings: {
        audioSyncAdjust: 0,
        backgroundSequence: 'overlay',
        viewerControl: {
            enabled: false,
            type: 'disabled',
            remoteFalconToken: undefined,
            schedule: [],
        },
        volumeControl: {
            defaultVolume: 100,
            schedule: [],
        },
    },
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

            // Simple setters
            hydratePlaybackSettings(state, action: PayloadAction<PlaybackSettings>) {
                state.playbackSettings = action.payload;
            },
            setAudioSyncAdjust(state, action: PayloadAction<number>) {
                state.playbackSettings.audioSyncAdjust = action.payload;
            },
            setBackgroundSequence(state, action: PayloadAction<'overlay' | 'underlay'>) {
                state.playbackSettings.backgroundSequence = action.payload;
            },

            // Viewer control
            setViewerControlEnabled(state, action: PayloadAction<boolean>) {
                state.playbackSettings.viewerControl.enabled = action.payload;
                if (!action.payload) {
                    state.playbackSettings.viewerControl.type = 'disabled';
                }
            },
            setViewerControlType(state, action: PayloadAction<'disabled' | 'remote-falcon'>) {
                state.playbackSettings.viewerControl.type = action.payload;
                state.playbackSettings.viewerControl.enabled = action.payload !== 'disabled';
            },
            setRemoteFalconToken(state, action: PayloadAction<string>) {
                state.playbackSettings.viewerControl.remoteFalconToken = action.payload;
            },

            addViewerControlScheduleEntry(state, action: PayloadAction<ViewerControlScheduleEntry>) {
                state.playbackSettings.viewerControl.schedule.push(action.payload);
            },
            removeViewerControlScheduleEntry(state, action: PayloadAction<string>) {
                state.playbackSettings.viewerControl.schedule = state.playbackSettings.viewerControl.schedule.filter(
                    (e) => e.id !== action.payload,
                );
            },

            // Volume control
            setDefaultVolume(state, action: PayloadAction<number>) {
                state.playbackSettings.volumeControl.defaultVolume = action.payload;
            },
            addVolumeScheduleEntry(state, action: PayloadAction<VolumeScheduleEntry>) {
                state.playbackSettings.volumeControl.schedule.push(action.payload);
            },
            removeVolumeScheduleEntry(state, action: PayloadAction<string>) {
                state.playbackSettings.volumeControl.schedule = state.playbackSettings.volumeControl.schedule.filter(
                    (e) => e.id !== action.payload,
                );
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

// Thunk: save current settings to backend API
export const savePlayerSettings = createAsyncThunk<
    void, // return type
    void, // arg type
    { state: unknown; extra: DataStorageAPI }
>('player/savePlayerSettings', async (_arg, { getState, extra }) => {
    const state = getState() as RootState;
    const settings: PlaybackSettings = state.playerStatus.playbackSettings;
    await extra.setPlayerSettings(settings);
});

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
        })
        .addCase(savePlayerSettings.pending, (state) => {
            state.settingsSaving = true;
        })
        .addCase(savePlayerSettings.fulfilled, (state) => {
            state.settingsSaving = false;
        })
        .addCase(savePlayerSettings.rejected, (state) => {
            state.settingsSaving = false;
        });
});

export const {
    setStatus: setPlayerStatus,
    setCStatus,
    setNStatus,
    setPStatus,
    setPlaybackStatistics,
    hydratePlaybackSettings,
} = playerStatusSlice.actions;

export const playerStatusActions = playerStatusSlice.actions;

export default playerStatusSlice.reducer;
