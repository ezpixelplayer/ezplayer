/**
 * Support bundle: a zip of the logs folder, recent crash dumps, and an
 * environment summary, for a user to send when asking for help. No show data
 * or settings are included.
 */

import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { ezpVersions } from '../versions.js';
import { getDiagEnv } from './diagEnv.js';
import { getDiagnosticsConsent } from './diagnostics.js';
import { logsDir } from './applog.js';

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

export function supportBundleName(): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const host = os.hostname().replace(/[^A-Za-z0-9-]/g, '_');
    return `ezplayer-logs-${host}-${stamp}.zip`;
}

export async function buildSupportBundle(): Promise<Uint8Array> {
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
        versions: ezpVersions,
        gpuFeatureStatus: app.getGPUFeatureStatus(),
        env: getDiagEnv(),
        reporting: getDiagnosticsConsent(),
        logsDir: logsDir(),
        uptimeSec: Math.round(process.uptime()),
    };
    zip.file('diagnostics.json', JSON.stringify(summary, undefined, 2));

    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
