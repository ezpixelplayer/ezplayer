import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { PlaybackSettings, ViewerControlScheduleEntry, VolumeScheduleEntry } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { RootState } from '../Store';

/**
 * Playback settings slice — durable, user-editable settings (audio sync, jukebox
 * filters, viewer-control schedule, volume schedule). Carved out of the runtime
 * slice so the high-cadence status pushes there don't re-render components
 * watching settings.
 */
export interface PlaybackSettingsState {
    settings: PlaybackSettings;
    settingsSaving: boolean;
    error?: string;
}

const DEFAULT_JUKEBOX_EXCLUDED_TAGS = ['nojukebox'];

function normalizeTagList(tags: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(tags)) return fallback;
    const normalized = tags.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : '')).filter(Boolean);
    return Array.from(new Set(normalized));
}

function normalizePlaybackSettings(input: PlaybackSettings): PlaybackSettings {
    const jukebox = input?.jukebox ?? {};
    const excludedNormalized = normalizeTagList(jukebox.excludedTags, []);
    const includedNormalized = normalizeTagList(jukebox.includedTags, []);
    // Deep-default sub-objects: a whole-object `??` only fires when the parent
    // is null/undefined, so `viewerControl: { enabled: true }` with `schedule`
    // missing slips through and crashes downstream `.schedule.length` reads.
    // Spread defaults first, then input, then explicitly re-default arrays.
    return {
        ...input,
        audioSyncAdjust: input.audioSyncAdjust ?? 0,
        backgroundSequence: input.backgroundSequence ?? 'overlay',
        viewerControl: {
            ...input.viewerControl,
            enabled: input.viewerControl?.enabled ?? false,
            type: input.viewerControl?.type ?? 'disabled',
            schedule: input.viewerControl?.schedule ?? [],
        },
        volumeControl: {
            ...input.volumeControl,
            defaultVolume: input.volumeControl?.defaultVolume ?? 100,
            schedule: input.volumeControl?.schedule ?? [],
        },
        jukebox: {
            excludedTags: Array.from(new Set([...DEFAULT_JUKEBOX_EXCLUDED_TAGS, ...excludedNormalized])),
            includedTags: includedNormalized,
        },
    };
}

export const initialPlaybackSettingsState: PlaybackSettingsState = {
    settingsSaving: false,
    error: undefined,
    settings: normalizePlaybackSettings({
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
        jukebox: {
            excludedTags: DEFAULT_JUKEBOX_EXCLUDED_TAGS,
            includedTags: [],
        },
    }),
};

export const savePlayerSettings = createAsyncThunk<void, void, { state: unknown; extra: DataStorageAPI }>(
    'playbackSettings/savePlayerSettings',
    async (_arg, { getState, extra }) => {
        const state = getState() as RootState;
        const settings: PlaybackSettings = state.playbackSettings.settings;
        await extra.setPlayerSettings(settings);
    },
);

const playbackSettingsSlice = createSlice({
    name: 'playbackSettings',
    initialState: initialPlaybackSettingsState,
    reducers: {
        hydratePlaybackSettings(state, action: PayloadAction<PlaybackSettings>) {
            state.settings = normalizePlaybackSettings(action.payload);
        },
        setAudioSyncAdjust(state, action: PayloadAction<number>) {
            state.settings.audioSyncAdjust = action.payload;
        },
        setBackgroundSequence(state, action: PayloadAction<'overlay' | 'underlay'>) {
            state.settings.backgroundSequence = action.payload;
        },

        // Jukebox management
        setJukeboxExcludedTags(state, action: PayloadAction<string[]>) {
            state.settings.jukebox = state.settings.jukebox ?? {};
            const next = normalizeTagList(action.payload, []);
            state.settings.jukebox.excludedTags = Array.from(new Set([...DEFAULT_JUKEBOX_EXCLUDED_TAGS, ...next]));
        },
        setJukeboxIncludedTags(state, action: PayloadAction<string[]>) {
            state.settings.jukebox = state.settings.jukebox ?? {};
            state.settings.jukebox.includedTags = normalizeTagList(action.payload, []);
        },

        // Viewer control
        setViewerControlEnabled(state, action: PayloadAction<boolean>) {
            state.settings.viewerControl.enabled = action.payload;
            if (!action.payload) {
                state.settings.viewerControl.type = 'disabled';
            }
        },
        setViewerControlType(state, action: PayloadAction<'disabled' | 'remote-falcon' | 'ezplayer'>) {
            state.settings.viewerControl.type = action.payload;
            state.settings.viewerControl.enabled = action.payload !== 'disabled';
        },
        setRemoteFalconToken(state, action: PayloadAction<string>) {
            state.settings.viewerControl.remoteFalconToken = action.payload;
        },
        addViewerControlScheduleEntry(state, action: PayloadAction<ViewerControlScheduleEntry>) {
            (state.settings.viewerControl.schedule ??= []).push(action.payload);
        },
        removeViewerControlScheduleEntry(state, action: PayloadAction<string>) {
            state.settings.viewerControl.schedule = (state.settings.viewerControl.schedule ?? []).filter(
                (e) => e.id !== action.payload,
            );
        },

        setSendIdleBlackFrames(state, action: PayloadAction<boolean>) {
            state.settings.sendIdleBlackFrames = action.payload;
        },

        // Sync output (FPP MultiSync master; future timecode strategies join here)
        setMultisyncEnabled(state, action: PayloadAction<boolean>) {
            const sync = (state.settings.sync ??= {});
            (sync.multisync ??= { enabled: false, remotes: [] }).enabled = action.payload;
        },
        setMultisyncRemotes(state, action: PayloadAction<string[]>) {
            const sync = (state.settings.sync ??= {});
            (sync.multisync ??= { enabled: false, remotes: [] }).remotes = action.payload;
        },
        setMultisyncPort(state, action: PayloadAction<number | undefined>) {
            const sync = (state.settings.sync ??= {});
            (sync.multisync ??= { enabled: false, remotes: [] }).port = action.payload;
        },
        setMultisyncMulticastAddress(state, action: PayloadAction<string | undefined>) {
            const sync = (state.settings.sync ??= {});
            (sync.multisync ??= { enabled: false, remotes: [] }).multicastAddress = action.payload || undefined;
        },

        // Advanced diagnostic overrides
        setAdvancedDdpPort(state, action: PayloadAction<number | undefined>) {
            (state.settings.advanced ??= {}).ddpPort = action.payload;
        },

        // Volume control
        setDefaultVolume(state, action: PayloadAction<number>) {
            state.settings.volumeControl.defaultVolume = action.payload;
        },
        addVolumeScheduleEntry(state, action: PayloadAction<VolumeScheduleEntry>) {
            (state.settings.volumeControl.schedule ??= []).push(action.payload);
        },
        removeVolumeScheduleEntry(state, action: PayloadAction<string>) {
            state.settings.volumeControl.schedule = (state.settings.volumeControl.schedule ?? []).filter(
                (e) => e.id !== action.payload,
            );
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(savePlayerSettings.pending, (state) => {
                state.settingsSaving = true;
            })
            .addCase(savePlayerSettings.fulfilled, (state) => {
                state.settingsSaving = false;
            })
            .addCase(savePlayerSettings.rejected, (state, action) => {
                state.settingsSaving = false;
                state.error = action.error.message;
            });
    },
});

export const {
    hydratePlaybackSettings,
    setAudioSyncAdjust,
    setBackgroundSequence,
    setJukeboxExcludedTags,
    setJukeboxIncludedTags,
    setViewerControlEnabled,
    setViewerControlType,
    setRemoteFalconToken,
    addViewerControlScheduleEntry,
    removeViewerControlScheduleEntry,
    setSendIdleBlackFrames,
    setMultisyncEnabled,
    setMultisyncRemotes,
    setMultisyncPort,
    setMultisyncMulticastAddress,
    setAdvancedDdpPort,
    setDefaultVolume,
    addVolumeScheduleEntry,
    removeVolumeScheduleEntry,
} = playbackSettingsSlice.actions;

export const playbackSettingsActions = playbackSettingsSlice.actions;
export default playbackSettingsSlice.reducer;
