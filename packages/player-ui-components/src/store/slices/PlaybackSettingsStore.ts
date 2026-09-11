import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
    AudioDevice,
    AudioOutputConfig,
    PlaybackSettings,
    ViewerControlScheduleEntry,
    VolumeControlState,
    VolumeScheduleEntry,
} from '@ezplayer/ezplayer-core';
import { isPhysicalAudioOutput } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { RootState } from '../Store';

function newAudioOutputId(): string {
    return `aout-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultVolumeControl(): VolumeControlState {
    return { defaultVolume: 100, schedule: [] };
}

function normalizeAudioOutputs(list: AudioOutputConfig[] | undefined): AudioOutputConfig[] | undefined {
    if (!list || list.length === 0) return undefined;
    return list.map((o) => ({
        id: o.id || newAudioOutputId(),
        deviceId: o.deviceId ?? '',
        label: o.label ?? '',
        groupId: o.groupId,
        volumeControl: {
            defaultVolume: o.volumeControl?.defaultVolume ?? 100,
            schedule: o.volumeControl?.schedule ?? [],
        },
    }));
}

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
const DEFAULT_TEST_SEQUENCE_TAGS = ['test'];

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
        testSequenceTags: normalizeTagList(input.testSequenceTags, DEFAULT_TEST_SEQUENCE_TAGS),
        audioOutputs: normalizeAudioOutputs(input.audioOutputs),
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
        testSequenceTags: DEFAULT_TEST_SEQUENCE_TAGS,
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

/** Physical output sinks on the player machine; null when the backend cannot enumerate. */
export const fetchAudioOutputDevices = createAsyncThunk<AudioDevice[] | null, void, { extra: DataStorageAPI }>(
    'playbackSettings/fetchAudioOutputDevices',
    async (_arg, { extra }) => {
        if (!extra.getAudioOutputDevices) return null;
        return (await extra.getAudioOutputDevices()).filter(isPhysicalAudioOutput);
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

        setTestSequenceTags(state, action: PayloadAction<string[]>) {
            state.settings.testSequenceTags = normalizeTagList(action.payload, []);
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

        setNormalizeNewSongs(state, action: PayloadAction<boolean>) {
            state.settings.normalizeNewSongs = action.payload;
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

        setMediaFolder(state, action: PayloadAction<string | undefined>) {
            const next = action.payload?.trim();
            state.settings.mediaFolder = next || undefined;
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

        /** Desktop: true = system default output with `volumeControl`; false = `audioOutputs`. */
        setUseDefaultAudioOutput(state, action: PayloadAction<boolean>) {
            state.settings.useDefaultAudioOutput = action.payload ? undefined : false;
        },
        addAudioOutput(state, action: PayloadAction<Omit<AudioOutputConfig, 'id' | 'volumeControl'>>) {
            (state.settings.audioOutputs ??= []).push({
                ...action.payload,
                id: newAudioOutputId(),
                volumeControl: defaultVolumeControl(),
            });
        },
        removeAudioOutput(state, action: PayloadAction<string>) {
            const next = (state.settings.audioOutputs ?? []).filter((o) => o.id !== action.payload);
            state.settings.audioOutputs = next.length > 0 ? next : undefined;
        },
        /** Refresh stored identity after a re-match (deviceId changed, label edited). */
        setAudioOutputDevice(
            state,
            action: PayloadAction<{ id: string; deviceId: string; label: string; groupId?: string }>,
        ) {
            const entry = (state.settings.audioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (!entry) return;
            entry.deviceId = action.payload.deviceId;
            entry.label = action.payload.label;
            entry.groupId = action.payload.groupId;
        },
        setAudioOutputVolume(state, action: PayloadAction<{ id: string; volume: number }>) {
            const entry = (state.settings.audioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (entry) entry.volumeControl.defaultVolume = action.payload.volume;
        },
        addAudioOutputScheduleEntry(state, action: PayloadAction<{ id: string; entry: VolumeScheduleEntry }>) {
            const entry = (state.settings.audioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (entry) (entry.volumeControl.schedule ??= []).push(action.payload.entry);
        },
        removeAudioOutputScheduleEntry(state, action: PayloadAction<{ id: string; entryId: string }>) {
            const entry = (state.settings.audioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (!entry?.volumeControl.schedule) return;
            entry.volumeControl.schedule = entry.volumeControl.schedule.filter((e) => e.id !== action.payload.entryId);
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
    setTestSequenceTags,
    setViewerControlEnabled,
    setViewerControlType,
    setRemoteFalconToken,
    addViewerControlScheduleEntry,
    removeViewerControlScheduleEntry,
    setSendIdleBlackFrames,
    setNormalizeNewSongs,
    setMultisyncEnabled,
    setMultisyncRemotes,
    setMultisyncPort,
    setMultisyncMulticastAddress,
    setAdvancedDdpPort,
    setMediaFolder,
    setDefaultVolume,
    addVolumeScheduleEntry,
    removeVolumeScheduleEntry,
    setUseDefaultAudioOutput,
    addAudioOutput,
    removeAudioOutput,
    setAudioOutputDevice,
    setAudioOutputVolume,
    addAudioOutputScheduleEntry,
    removeAudioOutputScheduleEntry,
} = playbackSettingsSlice.actions;

export const playbackSettingsActions = playbackSettingsSlice.actions;
export default playbackSettingsSlice.reducer;
