import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { AppInputMapping, AppInstanceRecord, CloudPollScheduleEntry, InstalledApp } from '@ezplayer/ezplayer-core';
import { atomicWriteFile } from '../data/atomicWrite.js';
import { settingsPath } from '../data/SettingsDir.js';
import { APP_NAME_RE, MANIFEST_FILE, parseManifest } from './apps-manifest.js';

/** Packages live here, visible to the owner like any other show content. */
export const APPS_DIR = 'apps';
/** Each instance's documents, outside the packages so a reinstall keeps them. */
export const APPS_DATA_DIR = 'apps-data';

export interface AppsFile {
    instances: AppInstanceRecord[];
    defaultSchedule: CloudPollScheduleEntry[];
    pythonPath?: string;
    inputMappings: AppInputMapping[];
}

const EMPTY: AppsFile = { instances: [], defaultSchedule: [], inputMappings: [] };

export function appsFilePath(showFolder: string): string {
    return settingsPath(showFolder, 'apps.json');
}

export function appsDir(showFolder: string): string {
    return path.join(showFolder, APPS_DIR);
}

export function appDataDir(showFolder: string, instance: string): string {
    return path.join(showFolder, APPS_DATA_DIR, instance);
}

export async function loadAppsFile(showFolder: string): Promise<AppsFile> {
    try {
        const raw = JSON.parse(await fsp.readFile(appsFilePath(showFolder), 'utf8')) as Partial<AppsFile>;
        return {
            instances: Array.isArray(raw.instances) ? raw.instances.filter(validInstance) : [],
            defaultSchedule: Array.isArray(raw.defaultSchedule) ? raw.defaultSchedule : [],
            pythonPath: typeof raw.pythonPath === 'string' && raw.pythonPath !== '' ? raw.pythonPath : undefined,
            inputMappings: Array.isArray(raw.inputMappings) ? raw.inputMappings : [],
        };
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[apps] apps.json unreadable, starting empty:', err);
        }
        return { ...EMPTY, instances: [], defaultSchedule: [], inputMappings: [] };
    }
}

export async function saveAppsFile(showFolder: string, file: AppsFile): Promise<void> {
    await atomicWriteFile(appsFilePath(showFolder), JSON.stringify(file, null, 2));
}

function validInstance(i: unknown): i is AppInstanceRecord {
    const r = i as AppInstanceRecord;
    return typeof r?.name === 'string' && APP_NAME_RE.test(r.name) && typeof r.appId === 'string';
}

/** Every directory under `<show>/apps` with a manifest, parsed or with its error. */
export async function scanInstalledApps(showFolder: string): Promise<InstalledApp[]> {
    const root = appsDir(showFolder);
    let names: string[];
    try {
        names = (await fsp.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
        return [];
    }
    const out: InstalledApp[] = [];
    for (const name of names.sort()) {
        const dir = path.join(root, name);
        const file = path.join(dir, MANIFEST_FILE);
        if (!fs.existsSync(file)) continue;
        let source: InstalledApp['source'];
        let installedAt: number | undefined;
        try {
            const rec = JSON.parse(await fsp.readFile(path.join(dir, '.ezapp-source.json'), 'utf8'));
            if (rec?.source?.kind) source = rec.source;
            if (typeof rec?.installedAt === 'number') installedAt = rec.installedAt;
        } catch {
            /* dropped in by hand: no source to update from */
        }
        try {
            const manifest = parseManifest(JSON.parse(await fsp.readFile(file, 'utf8')));
            if (manifest.id !== name) throw new Error(`id "${manifest.id}" does not match the directory name`);
            out.push({ id: name, dir, manifest, source, installedAt });
        } catch (err) {
            out.push({ id: name, dir, error: (err as Error).message, source, installedAt });
        }
    }
    return out;
}
