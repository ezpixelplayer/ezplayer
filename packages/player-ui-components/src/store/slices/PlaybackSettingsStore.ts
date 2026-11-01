import type { ControllerRefreshMode, ViewerControlBackend, ViewerControlScheduleList } from '@ezplayer/ezplayer-core';
import { controllerRefreshSettingsFor } from '@ezplayer/ezplayer-core';
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
    AudioOutputConfig,
    PlaybackSettings,
    ViewerControlScheduleEntry,
    VolumeControlState,
    VolumeScheduleEntry,
    withViewerControlBackends,
} from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { RootState } from '../Store';

function newAudioOutputId(): string {
    return `aout-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newScheduleEntryId(): string {
    return Math.random().toString(36).slice(2, 11);
}

function defaultVolumeControl(): VolumeControlState {
    return { defaultVolume: 100, schedule: [] };
}

/** Replace the entry with the same id, keeping its place (and so its priority). */
function replaceEntry<T extends { id: string }>(list: T[] | undefined, entry: T): void {
    const i = (list ?? []).findIndex((e) => e.id === entry.id);
    if (list && i >= 0) list[i] = entry;
}

/** Move an entry by `delta` places; later entries take priority. */
function moveEntry<T extends { id: string }>(list: T[] | undefined, entryId: string, delta: number): void {
    if (!list) return;
    const from = list.findIndex((e) => e.id === entryId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    const [entry] = list.splice(from, 1);
    list.splice(to, 0, entry);
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
            // Older files have only `type`; derive the backend set from it.
            backends:
                input.viewerControl?.backends ??
                (input.viewerControl?.type === 'remote-falcon' || input.viewerControl?.type === 'ezplayer'
                    ? [input.viewerControl.type]
                    : []),
            schedule: input.viewerControl?.schedule ?? [],
            remoteFalconSchedule: input.viewerControl?.remoteFalconSchedule ?? [],
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
                state.settings.viewerControl.backends = [];
            }
        },
        /** Single-backend setter for callers that choose one type; `backends` follows. */
        setViewerControlType(state, action: PayloadAction<'disabled' | 'remote-falcon' | 'ezplayer'>) {
            state.settings.viewerControl = withViewerControlBackends(
                state.settings.viewerControl,
                action.payload === 'disabled' ? [] : [action.payload],
            );
        },
        /** The set of backends to run; `type` and `enabled` follow (built-in is primary). */
        setViewerControlBackends(state, action: PayloadAction<ViewerControlBackend[]>) {
            state.settings.viewerControl = withViewerControlBackends(state.settings.viewerControl, action.payload);
        },
        setRemoteFalconToken(state, action: PayloadAction<string>) {
            state.settings.viewerControl.remoteFalconToken = action.payload;
        },
        setMinSongsBetweenRepeats(state, action: PayloadAction<number>) {
            state.settings.viewerControl.minSongsBetweenRepeats = action.payload;
        },
        /** Turning it on with no Remote Falcon schedule yet starts from a copy of the main one. */
        setSeparateRemoteFalconSchedule(state, action: PayloadAction<boolean>) {
            const vc = state.settings.viewerControl;
            vc.separateRemoteFalconSchedule = action.payload;
            if (action.payload && !vc.remoteFalconSchedule?.length) {
                vc.remoteFalconSchedule = (vc.schedule ?? []).map((e) => ({ ...e, id: newScheduleEntryId() }));
            }
        },
        addViewerControlScheduleEntry(
            state,
            action: PayloadAction<{ list: ViewerControlScheduleList; entry: ViewerControlScheduleEntry }>,
        ) {
            (state.settings.viewerControl[action.payload.list] ??= []).push(action.payload.entry);
        },
        removeViewerControlScheduleEntry(
            state,
            action: PayloadAction<{ list: ViewerControlScheduleList; entryId: string }>,
        ) {
            const { list, entryId } = action.payload;
            state.settings.viewerControl[list] = (state.settings.viewerControl[list] ?? []).filter(
                (e) => e.id !== entryId,
            );
        },
        updateViewerControlScheduleEntry(
            state,
            action: PayloadAction<{ list: ViewerControlScheduleList; entry: ViewerControlScheduleEntry }>,
        ) {
            replaceEntry(state.settings.viewerControl[action.payload.list], action.payload.entry);
        },
        moveViewerControlScheduleEntry(
            state,
            action: PayloadAction<{ list: ViewerControlScheduleList; entryId: string; delta: number }>,
        ) {
            const { list, entryId, delta } = action.payload;
            moveEntry(state.settings.viewerControl[list], entryId, delta);
        },

        setSendIdleBlackFrames(state, action: PayloadAction<boolean>) {
            state.settings.sendIdleBlackFrames = action.payload;
        },

        setControllerRefresh(state, action: PayloadAction<ControllerRefreshMode>) {
            state.settings.controllerRefresh = controllerRefreshSettingsFor(action.payload);
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
        setMultisyncMediaSync(state, action: PayloadAction<boolean>) {
            const sync = (state.settings.sync ??= {});
            (sync.multisync ??= { enabled: false, remotes: [] }).mediaSync = action.payload;
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
        updateVolumeScheduleEntry(state, action: PayloadAction<VolumeScheduleEntry>) {
            replaceEntry(state.settings.volumeControl.schedule, action.payload);
        },
        moveVolumeScheduleEntry(state, action: PayloadAction<{ entryId: string; delta: number }>) {
            moveEntry(state.settings.volumeControl.schedule, action.payload.entryId, action.payload.delta);
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
        updateAudioOutputScheduleEntry(state, action: PayloadAction<{ id: string; entry: VolumeScheduleEntry }>) {
            const output = (state.settings.audioOutputs ?? []).find((o) => o.id === action.payload.id);
            replaceEntry(output?.volumeControl.schedule, action.payload.entry);
        },
        moveAudioOutputScheduleEntry(state, action: PayloadAction<{ id: string; entryId: string; delta: number }>) {
            const output = (state.settings.audioOutputs ?? []).find((o) => o.id === action.payload.id);
            moveEntry(output?.volumeControl.schedule, action.payload.entryId, action.payload.delta);
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
    setMinSongsBetweenRepeats,
    setSeparateRemoteFalconSchedule,
    addViewerControlScheduleEntry,
    removeViewerControlScheduleEntry,
    updateViewerControlScheduleEntry,
    moveViewerControlScheduleEntry,
    setSendIdleBlackFrames,
    setControllerRefresh,
    setNormalizeNewSongs,
    setMultisyncEnabled,
    setMultisyncRemotes,
    setMultisyncPort,
    setMultisyncMulticastAddress,
    setMultisyncMediaSync,
    setAdvancedDdpPort,
    setMediaFolder,
    setDefaultVolume,
    addVolumeScheduleEntry,
    removeVolumeScheduleEntry,
    updateVolumeScheduleEntry,
    moveVolumeScheduleEntry,
    setUseDefaultAudioOutput,
    addAudioOutput,
    removeAudioOutput,
    setAudioOutputDevice,
    setAudioOutputVolume,
    addAudioOutputScheduleEntry,
    removeAudioOutputScheduleEntry,
    updateAudioOutputScheduleEntry,
    moveAudioOutputScheduleEntry,
} = playbackSettingsSlice.actions;

export const playbackSettingsActions = playbackSettingsSlice.actions;
export default playbackSettingsSlice.reducer;
