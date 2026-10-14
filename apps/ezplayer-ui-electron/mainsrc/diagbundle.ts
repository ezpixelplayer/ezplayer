/**
 * Support bundle: a zip for a user to send when asking for help. Every level
 * has the logs folder, recent crash dumps, an environment summary, and the
 * settings that differ from defaults, with secrets redacted. 'setup' adds
 * network interfaces, the xLights networks file, and the show's songs,
 * playlists, and schedule (no media). 'layout' adds the xLights layout file.
 */

import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { CloudConfig, PlaybackSettings, SequenceFiles, SupportBundleLevel } from '@ezplayer/ezplayer-core';
import { ezpVersions } from '../versions.js';
import { getDiagEnv } from './diagEnv.js';
import { getDiagnosticsConsent } from './diagnostics.js';
import { logsDir } from './applog.js';
import { CLOUD_CONFIG_DEFAULTS } from './data/CloudConfigStorage.js';
import { defaultPlaybackSettings } from './data/SettingsStorage.js';
import { SUBDIR_NAME } from './data/SettingsDir.js';
import { REMOTE_ACCESS_FILENAME } from './remoteaccess.js';

const DUMP_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const DUMPS_INCLUDED = 2;
const DUMP_PRUNE_AGE_MS = 90 * 24 * 3600 * 1000;

function dumpReportsDir(): string {
    return path.join(app.getPath('crashDumps'), 'reports');
}

interface FoundFile {
    file: string;
    name: string;
    mtimeMs: number;
}

function listFiles(dir: string, accept: (name: string) => boolean): FoundFile[] {
    try {
        return fs
            .readdirSync(dir)
            .filter(accept)
            .flatMap((name) => {
                const file = path.join(dir, name);
                try {
                    const st = fs.statSync(file);
                    return st.isFile() ? [{ file, name, mtimeMs: st.mtimeMs }] : [];
                } catch {
                    return [];
                }
            });
    } catch {
        return [];
    }
}

/** Delete crash dumps older than DUMP_PRUNE_AGE_MS; nothing else removes them. */
export function pruneCrashDumps(): void {
    const now = Date.now();
    for (const f of listFiles(dumpReportsDir(), (n) => n.endsWith('.dmp'))) {
        if (now - f.mtimeMs > DUMP_PRUNE_AGE_MS) {
            try {
                fs.rmSync(f.file, { force: true });
            } catch {
                /* best-effort */
            }
        }
    }
}

export function supportBundleName(level: SupportBundleLevel = 'logs'): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const host = os.hostname().replace(/[^A-Za-z0-9-]/g, '_');
    return `ezplayer-${level}-${host}-${stamp}.zip`;
}

const SECRET_KEY = /token|secret|password|passwd|api_?key/i;

/** Copy of `v` with every non-empty value under a secret-looking key replaced. */
export function redactSecrets(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(redactSecrets);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
        out[k] = SECRET_KEY.test(k) && x !== undefined && x !== null && x !== '' ? '<redacted>' : redactSecrets(x);
    }
    return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The parts of `v` that differ from `defaults`; objects compare by key, anything else whole. */
export function nonDefault(v: unknown, defaults: unknown): unknown {
    if (isPlainObject(v) && isPlainObject(defaults)) {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
            const d = nonDefault(x, defaults[k]);
            if (d !== undefined) out[k] = d;
        }
        return Object.keys(out).length ? out : undefined;
    }
    return JSON.stringify(v) === JSON.stringify(defaults) ? undefined : v;
}

export interface SupportBundleSources {
    showFolder?: string;
    playbackSettings?: PlaybackSettings | null;
    cloudConfig?: CloudConfig;
}

function readJson(file: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}

const json = (v: unknown) => JSON.stringify(v, undefined, 2);

function settingsSummary(src: SupportBundleSources): unknown {
    const sub = src.showFolder ? path.join(src.showFolder, SUBDIR_NAME) : undefined;
    return redactSecrets({
        showFolder: src.showFolder,
        app: readJson(path.join(app.getPath('userData'), 'config.json')),
        playback: src.playbackSettings ? nonDefault(src.playbackSettings, defaultPlaybackSettings()) : undefined,
        cloud: src.cloudConfig ? nonDefault(src.cloudConfig, CLOUD_CONFIG_DEFAULTS) : undefined,
        remoteAccess: sub ? readJson(path.join(sub, REMOTE_ACCESS_FILENAME)) : undefined,
    });
}

function networkSummary(): unknown {
    const interfaces: Record<string, unknown[]> = {};
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        interfaces[name] = (addrs ?? []).map(({ address, netmask, family, internal }) => ({
            address,
            netmask,
            family,
            internal,
        }));
    }
    return { hostname: os.hostname(), interfaces };
}

interface MediaFile {
    kind: string;
    path: string;
    size?: number;
    mtime?: string;
    missing?: boolean;
}

/** Each song's files and whether they are on disk. */
function mediaSummary(showFolder: string, songs: unknown): unknown[] {
    const list = (songs as { data?: { allSongs?: unknown[] } } | undefined)?.data?.allSongs;
    if (!Array.isArray(list)) return [];
    return list.flatMap((s) => {
        const song = s as { id?: string; deleted?: boolean; work?: { title?: string }; files?: SequenceFiles };
        if (song.deleted || !song.files) return [];
        const files = Object.entries(song.files).flatMap(([kind, f]): MediaFile[] => {
            if (typeof f !== 'string' || !f) return [];
            try {
                const st = fs.statSync(path.resolve(showFolder, f));
                return [{ kind, path: f, size: st.size, mtime: st.mtime.toISOString() }];
            } catch {
                return [{ kind, path: f, missing: true }];
            }
        });
        return [{ id: song.id, title: song.work?.title, files }];
    });
}

/** Add show-folder files; JSON is redacted, anything unparseable goes in as is. */
function addShowFiles(zip: JSZip, dir: string, names: string[]): void {
    for (const name of names) {
        let body: string;
        try {
            body = fs.readFileSync(path.join(dir, name), 'utf8');
        } catch {
            continue;
        }
        if (name.endsWith('.json')) {
            try {
                body = json(redactSecrets(JSON.parse(body)));
            } catch {
                /* include a corrupt file as found */
            }
        }
        zip.file(`show/${name}`, body);
    }
}

export async function buildSupportBundle(
    level: SupportBundleLevel = 'logs',
    src: SupportBundleSources = {},
): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const f of listFiles(logsDir(), () => true)) {
        try {
            zip.file(`logs/${f.name}`, fs.readFileSync(f.file), { date: new Date(f.mtimeMs) });
        } catch {
            /* a file rotated away mid-read */
        }
    }

    const now = Date.now();
    const dumps = listFiles(dumpReportsDir(), (n) => n.endsWith('.dmp'))
        .filter((f) => now - f.mtimeMs < DUMP_MAX_AGE_MS)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, DUMPS_INCLUDED);
    for (const f of dumps) {
        try {
            zip.file(`crash-dumps/${f.name}`, fs.readFileSync(f.file), { date: new Date(f.mtimeMs) });
        } catch {
            /* best-effort */
        }
    }

    const summary = {
        createdAt: new Date().toISOString(),
        level,
        versions: ezpVersions,
        gpuFeatureStatus: app.getGPUFeatureStatus(),
        env: getDiagEnv(),
        reporting: getDiagnosticsConsent(),
        logsDir: logsDir(),
        uptimeSec: Math.round(process.uptime()),
    };
    zip.file('diagnostics.json', json(summary));
    zip.file('settings.json', json(settingsSummary(src)));

    const show = src.showFolder;
    if (level !== 'logs') {
        zip.file('network.json', json(networkSummary()));
        if (show) {
            const sub = path.join(show, SUBDIR_NAME);
            addShowFiles(zip, show, ['xlights_networks.xml']);
            addShowFiles(zip, sub, ['sequences.json', 'playlists.json', 'schedule.json']);
            zip.file('media-files.json', json(mediaSummary(show, readJson(path.join(sub, 'sequences.json')))));
        }
    }
    if (level === 'layout' && show) addShowFiles(zip, show, ['xlights_rgbeffects.xml']);

    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
