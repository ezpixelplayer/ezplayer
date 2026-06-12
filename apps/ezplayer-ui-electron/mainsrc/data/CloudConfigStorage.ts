import fs from 'fs/promises';
import { atomicWriteFile } from './atomicWrite.js';
import type { CloudConfig } from '@ezplayer/ezplayer-core';

/** Default cloud service URL seeded on first run when no cloud-config.json exists.
 *  Points at the production cloud service; users can override it via the Cloud
 *  Settings dialog. */
export const DEFAULT_CLOUD_SERVICE_URL = 'https://api.ezplayer.dev/';

const FRESH: CloudConfig = { cloudServiceUrl: DEFAULT_CLOUD_SERVICE_URL, playerIdToken: '' };
const EMPTY: CloudConfig = { cloudServiceUrl: '', playerIdToken: '' };

let currentConfig: CloudConfig = { ...EMPTY };
let currentPath: string | null = null;
let writeInProgress = false;
let writeQueued = false;

export function getCloudConfigCache(): CloudConfig {
    return currentConfig;
}

export async function loadCloudConfigFromDisk(configPath: string): Promise<CloudConfig> {
    currentPath = configPath;
    try {
        const raw = await fs.readFile(configPath, 'utf8');
        // Empty / unparseable file (e.g. crashed mid-write) is treated the same
        // as missing: re-seed FRESH defaults so the load never fails the folder open.
        if (raw.trim() === '') {
            currentConfig = { ...FRESH };
            void scheduleWrite();
            return currentConfig;
        }
        const parsed = JSON.parse(raw) as Partial<CloudConfig>;
        currentConfig = {
            cloudServiceUrl: parsed.cloudServiceUrl ?? '',
            playerIdToken: parsed.playerIdToken ?? '',
            // Treat absent/unknown layoutSource as 'xlights' (the legacy default) on read,
            // but preserve the field so writes don't silently rewrite a cloud-mode folder.
            layoutSource: parsed.layoutSource === 'cloud' ? 'cloud' : 'xlights',
            // Default true on absent. Only an explicit `false` parks the worker.
            cloudEnabled: parsed.cloudEnabled === false ? false : true,
            cloudPollMode: parsed.cloudPollMode === 'scheduled' ? 'scheduled' : 'always',
            cloudPollSchedule: parsed.cloudPollSchedule,
            cloudPollIntervals: parsed.cloudPollIntervals,
            layoutMeta: parsed.layoutMeta,
        };
        return currentConfig;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code === 'ENOENT' || e instanceof SyntaxError) {
            // Missing or unparseable file → seed FRESH defaults.
            currentConfig = { ...FRESH };
            void scheduleWrite();
            return currentConfig;
        }
        throw err;
    }
}

async function writeCloudConfigToDisk(configPath: string, config: CloudConfig) {
    const json = JSON.stringify(config, null, 2);
    await atomicWriteFile(configPath, json);
}

async function scheduleWrite() {
    if (writeInProgress) {
        writeQueued = true;
        return;
    }
    if (!currentPath) return;

    writeInProgress = true;
    const snapshot = currentConfig;
    const curpath = currentPath;
    try {
        await writeCloudConfigToDisk(curpath, snapshot);
    } catch (err) {
        console.error(`Failed to write cloud config ${curpath}`, err);
    } finally {
        writeInProgress = false;
        if (writeQueued) {
            writeQueued = false;
            void scheduleWrite();
        }
    }
}

/** Update one or more fields. Empty strings are valid (and mean "cleared"). */
export function updateCloudConfig(patch: Partial<CloudConfig>): CloudConfig {
    currentConfig = {
        ...currentConfig,
        ...patch,
    };
    void scheduleWrite();
    return currentConfig;
}

export function resetCloudConfig() {
    currentConfig = { ...EMPTY };
    currentPath = null;
}
