import fs from 'fs/promises';
import { atomicWriteFile } from './atomicWrite.js';
import type { PlaybackSettings } from '@ezplayer/ezplayer-core';

let currentSettings: PlaybackSettings | null = null;
let currentPath: string | null = null;
let writeInProgress = false;
let writeQueued = false;
/** Last successfully-persisted JSON. Used to dedupe writes — a save thunk that
 *  fires for every action (slider drag, broadcast round-trip) should not hit
 *  the disk repeatedly with identical bytes. */
let lastWrittenJson: string | null = null;

export function getSettingsCache(): PlaybackSettings | null {
    return currentSettings;
}

export async function loadSettingsFromDisk(settingsPath: string): Promise<PlaybackSettings> {
    const defaults: PlaybackSettings = {
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
            excludedTags: ['nojukebox'],
            includedTags: [],
        },
    };
    // Reset the dedupe cache for the new path. A subsequent save with content
    // identical to disk should still be skipped, so seed it from the parsed
    // file when we have one.
    lastWrittenJson = null;
    try {
        const raw = await fs.readFile(settingsPath, 'utf8');
        // A previous crash (or pull-the-plug) can leave a zero-byte settings file
        // — JSON.parse on that throws SyntaxError. Treat empty / unparseable the
        // same as "missing": fall back to defaults rather than failing the load.
        if (raw.trim() === '') {
            currentSettings = defaults;
            return defaults;
        }
        const parsed = JSON.parse(raw) as PlaybackSettings;

        currentSettings = parsed;
        // Seed the dedupe key with the canonical serialized form of what we
        // just loaded. If `savePlayerSettings` fires for a hydrate (which it
        // shouldn't anymore, but defense in depth), the comparison skips.
        lastWrittenJson = JSON.stringify(parsed, null, 2);
        return parsed;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code === 'ENOENT' || e instanceof SyntaxError) {
            currentSettings = defaults;
            return defaults;
        }
        throw err;
    }
}

async function writeSettingsToDisk(settingsPath: string, settings: PlaybackSettings) {
    const json = JSON.stringify(settings, null, 2);
    if (json === lastWrittenJson) {
        // Identical to the last successfully-written content — skip.
        return;
    }
    await atomicWriteFile(settingsPath, json);
    lastWrittenJson = json;
}

async function scheduleWrite() {
    if (writeInProgress) {
        writeQueued = true;
        return;
    }

    if (!currentSettings || !currentPath) {
        return;
    }

    writeInProgress = true;
    const snapshot = currentSettings;
    const curpath = currentPath;

    try {
        await writeSettingsToDisk(curpath, snapshot);
    } catch (err) {
        console.error(`Failed to write settings file ${curpath}`, err);
    } finally {
        writeInProgress = false;

        if (writeQueued) {
            writeQueued = false;
            void scheduleWrite();
        }
    }
}

// Call this when renderer wants to update settings
export function applySettingsFromRenderer(settingsFile: string, newSettings: PlaybackSettings) {
    currentPath = settingsFile;
    currentSettings = newSettings;
    void scheduleWrite();
}

/** Per-group epoch-ms stamp of the cloud `*_updated` value the player has
 *  adopted for each settings group. Sidecar to `playbackSettings.json`; drives
 *  the one-way cloud→player last-write-wins — a group is adopted only when the
 *  cloud's stamp strictly exceeds the one recorded here. A local-only edit
 *  never touches this, so it survives until a *newer* cloud save supersedes it. */
export interface CloudSettingsMeta {
    playback?: number;
    volume?: number;
    viewerControl?: number;
}

export async function loadCloudSettingsMeta(metaPath: string): Promise<CloudSettingsMeta> {
    try {
        const raw = await fs.readFile(metaPath, 'utf8');
        if (raw.trim() === '') return {};
        return JSON.parse(raw) as CloudSettingsMeta;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code === 'ENOENT' || e instanceof SyntaxError) return {};
        throw err;
    }
}

export async function saveCloudSettingsMeta(metaPath: string, meta: CloudSettingsMeta): Promise<void> {
    await atomicWriteFile(metaPath, JSON.stringify(meta, null, 2));
}
