import fs from 'fs/promises';
import type { PlaybackSettings } from '@ezplayer/ezplayer-core';

let currentSettings: PlaybackSettings | null = null;
let currentPath: string | null = null;
let writeInProgress = false;
let writeQueued = false;

export function getSettingsCache(): PlaybackSettings | null {
    return currentSettings;
}

export async function loadSettingsFromDisk(settingsPath: string): Promise<PlaybackSettings> {
    try {
        const raw = await fs.readFile(settingsPath, 'utf8');
        const parsed = JSON.parse(raw) as PlaybackSettings;

        currentSettings = parsed;
        return parsed;
    } catch (e) {
        const err = e as {code?: string}
        if (err?.code === 'ENOENT') {
            // Defaults if file doesn't exist
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
            };
            currentSettings = defaults;
            return defaults;
        }
        throw err;
    }
}

async function writeSettingsToDisk(settingsPath: string, settings: PlaybackSettings) {
    const json = JSON.stringify(settings, null, 2);
    await fs.writeFile(settingsPath, json, 'utf8');
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
        reportError(`Failed to write settings file ${curpath}`);
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
