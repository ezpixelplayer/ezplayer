import fs from 'fs/promises';
import type { CloudConfig } from '@ezplayer/ezplayer-core';

/** Default cloud service URL seeded on first run when no cloud-config.json exists. */
const DEFAULT_CLOUD_SERVICE_URL = 'https://ezrgbcloud-ezplay-cloud-endpoint.cloud.dbos.dev/';

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
        const parsed = JSON.parse(raw) as Partial<CloudConfig>;
        currentConfig = {
            cloudServiceUrl: parsed.cloudServiceUrl ?? '',
            playerIdToken: parsed.playerIdToken ?? '',
            // Treat absent/unknown layoutSource as 'xlights' (the legacy default) on read,
            // but preserve the field so writes don't silently rewrite a cloud-mode folder.
            layoutSource: parsed.layoutSource === 'cloud' ? 'cloud' : 'xlights',
            // Default true on absent. Only an explicit `false` parks the worker.
            cloudEnabled: parsed.cloudEnabled === false ? false : true,
            layoutMeta: parsed.layoutMeta,
        };
        return currentConfig;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code === 'ENOENT') {
            // Seed with the default cloud URL so registration is reachable out of the box.
            // The user can edit or clear the URL via the dialog.
            currentConfig = { ...FRESH };
            void scheduleWrite();
            return currentConfig;
        }
        throw err;
    }
}

async function writeCloudConfigToDisk(configPath: string, config: CloudConfig) {
    const json = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, json, 'utf8');
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
