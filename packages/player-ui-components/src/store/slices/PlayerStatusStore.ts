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
    BrightnessScheduleEntry,
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

const DEFAULT_JUKEBOX_EXCLUDED_TAGS = ['nojukebox'];

function normalizeTagList(tags: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(tags)) return fallback;
    const normalized = tags.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : '')).filter(Boolean);
    return Array.from(new Set(normalized));
}

function normalizePlaybackSettings(input: Partial<PlaybackSettings> | undefined): PlaybackSettings {
    const safeInput = input ?? {};
    const jukebox = safeInput.jukebox ?? {};
    const excludedNormalized = normalizeTagList(jukebox.excludedTags, []);
    const includedNormalized = normalizeTagList(jukebox.includedTags, []);

    const viewerControl = safeInput.viewerControl as any;
    const volumeControl = safeInput.volumeControl as any;
    const brightnessControl = safeInput.brightnessControl as any;

    const normalizedViewerSchedule = Array.isArray(viewerControl?.schedule) ? viewerControl.schedule : [];
    const normalizedVolumeSchedule = Array.isArray(volumeControl?.schedule) ? volumeControl.schedule : [];
    const normalizedBrightnessSchedule = Array.isArray(brightnessControl?.schedule) ? brightnessControl.schedule : [];

    return {
        ...safeInput,
        audioSyncAdjust: safeInput.audioSyncAdjust ?? 0,
        backgroundSequence: safeInput.backgroundSequence ?? 'overlay',
        viewerControl: {
            enabled: Boolean(viewerControl?.enabled) ? true : false,
            type: viewerControl?.type ?? 'disabled',
            remoteFalconToken: viewerControl?.remoteFalconToken,
            schedule: normalizedViewerSchedule,
        },
        volumeControl: {
            defaultVolume: typeof volumeControl?.defaultVolume === 'number' ? volumeControl.defaultVolume : 100,
            schedule: normalizedVolumeSchedule,
        },
        brightnessControl: {
            defaultBrightness:
                typeof brightnessControl?.defaultBrightness === 'number'
                    ? brightnessControl.defaultBrightness
                    : 100,
            schedule: normalizedBrightnessSchedule,
        },
        jukebox: {
            excludedTags: Array.from(new Set([...DEFAULT_JUKEBOX_EXCLUDED_TAGS, ...excludedNormalized])),
            includedTags: includedNormalized,
        },
    };
}

export const initialStatusState: PlayerStatusState = {
    playerStatus: {},
    loading: false,
    issuing: false,
    settingsSaving: false,
    error: undefined,
    playbackSettings: normalizePlaybackSettings({
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
        brightnessControl: {
            defaultBrightness: 100,
            schedule: [],
        },
        jukebox: {
            excludedTags: DEFAULT_JUKEBOX_EXCLUDED_TAGS,
            includedTags: [],
        },
    }),
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
                state.playbackSettings = normalizePlaybackSettings(action.payload);
            },
            setAudioSyncAdjust(state, action: PayloadAction<number>) {
                state.playbackSettings.audioSyncAdjust = action.payload;
            },
            setBackgroundSequence(state, action: PayloadAction<'overlay' | 'underlay'>) {
                state.playbackSettings.backgroundSequence = action.payload;
            },

            // Jukebox management
            setJukeboxExcludedTags(state, action: PayloadAction<string[]>) {
                state.playbackSettings.jukebox = state.playbackSettings.jukebox ?? {};
                const next = normalizeTagList(action.payload, []);
                state.playbackSettings.jukebox.excludedTags = Array.from(
                    new Set([...DEFAULT_JUKEBOX_EXCLUDED_TAGS, ...next]),
                );
            },
            setJukeboxIncludedTags(state, action: PayloadAction<string[]>) {
                state.playbackSettings.jukebox = state.playbackSettings.jukebox ?? {};
                state.playbackSettings.jukebox.includedTags = normalizeTagList(action.payload, []);
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

            // Brightness control
            setDefaultBrightness(state, action: PayloadAction<number>) {
                if (!state.playbackSettings.brightnessControl) {
                    state.playbackSettings.brightnessControl = { defaultBrightness: 100, schedule: [] };
                }
                if (!Array.isArray(state.playbackSettings.brightnessControl.schedule)) {
                    state.playbackSettings.brightnessControl.schedule = [];
                }
                state.playbackSettings.brightnessControl.defaultBrightness = action.payload;
            },
            addBrightnessScheduleEntry(state, action: PayloadAction<BrightnessScheduleEntry>) {
                if (!state.playbackSettings.brightnessControl) {
                    state.playbackSettings.brightnessControl = { defaultBrightness: 100, schedule: [] };
                }
                if (!Array.isArray(state.playbackSettings.brightnessControl.schedule)) {
                    state.playbackSettings.brightnessControl.schedule = [];
                }
                state.playbackSettings.brightnessControl.schedule.push(action.payload);
            },
            updateBrightnessScheduleEntry(
                state,
                action: PayloadAction<{ id: string; entry: BrightnessScheduleEntry }>,
            ) {
                const { id, entry } = action.payload;
                if (!state.playbackSettings.brightnessControl) {
                    state.playbackSettings.brightnessControl = { defaultBrightness: 100, schedule: [] };
                }
                if (!Array.isArray(state.playbackSettings.brightnessControl.schedule)) {
                    state.playbackSettings.brightnessControl.schedule = [];
                }
                const idx = state.playbackSettings.brightnessControl.schedule.findIndex((e) => e.id === id);
                if (idx < 0) {
                    state.playbackSettings.brightnessControl.schedule.push(entry);
                    return;
                }
                // Preserve array order (priority derived from array position).
                state.playbackSettings.brightnessControl.schedule[idx] = entry;
            },
            removeBrightnessScheduleEntry(state, action: PayloadAction<string>) {
                if (!state.playbackSettings.brightnessControl) {
                    state.playbackSettings.brightnessControl = { defaultBrightness: 100, schedule: [] };
                }
                if (!Array.isArray(state.playbackSettings.brightnessControl.schedule)) {
                    state.playbackSettings.brightnessControl.schedule = [];
                }
                state.playbackSettings.brightnessControl.schedule = state.playbackSettings.brightnessControl.schedule.filter(
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
