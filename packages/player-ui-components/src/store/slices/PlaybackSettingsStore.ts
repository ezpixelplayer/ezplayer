import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
    AdditionalAudioOutput,
    PlaybackSettings,
    ViewerControlScheduleEntry,
    VolumeControlState,
    VolumeScheduleEntry,
} from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { RootState } from '../Store';

function newAdditionalOutputId(): string {
    return `aaudio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultVolumeControl(): VolumeControlState {
    return { defaultVolume: 100, schedule: [] };
}

/** Migrate deprecated `audioOutputDeviceIds` → `additionalAudioOutputs`. */
function migrateAdditionalAudioOutputs(input: PlaybackSettings): AdditionalAudioOutput[] | undefined {
    if (input.additionalAudioOutputs && input.additionalAudioOutputs.length > 0) {
        return input.additionalAudioOutputs.map((o) => ({
            id: o.id || newAdditionalOutputId(),
            deviceId: o.deviceId ?? '',
            volumeControl: {
                defaultVolume: o.volumeControl?.defaultVolume ?? 100,
                schedule: o.volumeControl?.schedule ?? [],
            },
        }));
    }
    if (input.audioOutputDeviceIds && input.audioOutputDeviceIds.length > 0) {
        return input.audioOutputDeviceIds.filter(Boolean).map((deviceId) => ({
            id: newAdditionalOutputId(),
            deviceId,
            volumeControl: defaultVolumeControl(),
        }));
    }
    return undefined;
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
    const additionalAudioOutputs = migrateAdditionalAudioOutputs(input);
    const { audioOutputDeviceIds: _deprecatedIds, ...rest } = input;
    return {
        ...rest,
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
        useDefaultAudioOutput: input.useDefaultAudioOutput !== false,
        systemDefaultOutputDeviceId: input.systemDefaultOutputDeviceId ?? undefined,
        primaryAudioOutputDeviceId: input.primaryAudioOutputDeviceId ?? undefined,
        additionalAudioOutputs,
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

        /** Electron: play to system default output (uses `volumeControl`). */
        setUseDefaultAudioOutput(state, action: PayloadAction<boolean>) {
            state.settings.useDefaultAudioOutput = action.payload;
            if (!action.payload) {
                delete state.settings.primaryAudioOutputDeviceId;
                const sysDefaultId = state.settings.systemDefaultOutputDeviceId;
                const kept = (state.settings.additionalAudioOutputs ?? []).filter(
                    (o) =>
                        o.deviceId &&
                        o.deviceId !== 'default' &&
                        o.deviceId !== 'communications' &&
                        o.deviceId !== sysDefaultId,
                );
                state.settings.additionalAudioOutputs = kept.length > 0 ? kept : undefined;
            }
        },

        setSystemDefaultOutputDeviceId(state, action: PayloadAction<string | undefined>) {
            const next = action.payload?.trim();
            state.settings.systemDefaultOutputDeviceId = next || undefined;
        },

        /** Electron primary sink (`''` / omit = system Default). */
        setPrimaryAudioOutputDeviceId(state, action: PayloadAction<string>) {
            const next = action.payload;
            state.settings.primaryAudioOutputDeviceId = next ? next : undefined;
        },

        /** Electron: replace the full additional-outputs list. */
        setAdditionalAudioOutputs(state, action: PayloadAction<AdditionalAudioOutput[]>) {
            state.settings.additionalAudioOutputs =
                action.payload.length > 0 ? action.payload : undefined;
            delete state.settings.audioOutputDeviceIds;
        },
        addAdditionalAudioOutput(state, action: PayloadAction<AdditionalAudioOutput>) {
            (state.settings.additionalAudioOutputs ??= []).push({
                ...action.payload,
                id: action.payload.id || newAdditionalOutputId(),
                volumeControl: action.payload.volumeControl ?? defaultVolumeControl(),
            });
            delete state.settings.audioOutputDeviceIds;
        },
        removeAdditionalAudioOutput(state, action: PayloadAction<string>) {
            const next = (state.settings.additionalAudioOutputs ?? []).filter((o) => o.id !== action.payload);
            state.settings.additionalAudioOutputs = next.length > 0 ? next : undefined;
        },
        updateAdditionalAudioOutput(
            state,
            action: PayloadAction<{ id: string; patch: Partial<Omit<AdditionalAudioOutput, 'id'>> }>,
        ) {
            const list = state.settings.additionalAudioOutputs ?? [];
            const idx = list.findIndex((o) => o.id === action.payload.id);
            if (idx < 0) return;
            const cur = list[idx];
            const patch = action.payload.patch;
            list[idx] = {
                ...cur,
                ...patch,
                id: cur.id,
                volumeControl: patch.volumeControl
                    ? {
                          defaultVolume: patch.volumeControl.defaultVolume ?? cur.volumeControl.defaultVolume,
                          schedule: patch.volumeControl.schedule ?? cur.volumeControl.schedule ?? [],
                      }
                    : cur.volumeControl,
            };
        },
        setAdditionalAudioOutputDeviceId(state, action: PayloadAction<{ id: string; deviceId: string }>) {
            const entry = (state.settings.additionalAudioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (entry) entry.deviceId = action.payload.deviceId;
        },
        setAdditionalAudioOutputVolume(state, action: PayloadAction<{ id: string; volume: number }>) {
            const entry = (state.settings.additionalAudioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (entry) {
                entry.volumeControl = entry.volumeControl ?? defaultVolumeControl();
                entry.volumeControl.defaultVolume = action.payload.volume;
            }
        },
        addAdditionalAudioOutputScheduleEntry(
            state,
            action: PayloadAction<{ id: string; entry: VolumeScheduleEntry }>,
        ) {
            const entry = (state.settings.additionalAudioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (!entry) return;
            entry.volumeControl = entry.volumeControl ?? defaultVolumeControl();
            (entry.volumeControl.schedule ??= []).push(action.payload.entry);
        },
        removeAdditionalAudioOutputScheduleEntry(
            state,
            action: PayloadAction<{ id: string; entryId: string }>,
        ) {
            const entry = (state.settings.additionalAudioOutputs ?? []).find((o) => o.id === action.payload.id);
            if (!entry?.volumeControl?.schedule) return;
            entry.volumeControl.schedule = entry.volumeControl.schedule.filter(
                (e) => e.id !== action.payload.entryId,
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
    setSystemDefaultOutputDeviceId,
    setPrimaryAudioOutputDeviceId,
    setAdditionalAudioOutputs,
    addAdditionalAudioOutput,
    removeAdditionalAudioOutput,
    updateAdditionalAudioOutput,
    setAdditionalAudioOutputDeviceId,
    setAdditionalAudioOutputVolume,
    addAdditionalAudioOutputScheduleEntry,
    removeAdditionalAudioOutputScheduleEntry,
} = playbackSettingsSlice.actions;

export const playbackSettingsActions = playbackSettingsSlice.actions;
export default playbackSettingsSlice.reducer;
