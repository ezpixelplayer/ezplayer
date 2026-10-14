import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root = '';
vi.mock('electron', () => ({
    app: {
        getPath: (name: string) => path.join(root, name),
        getGPUFeatureStatus: () => ({ gpu_compositing: 'enabled' }),
    },
}));
vi.mock('../versions.js', () => ({ ezpVersions: { version: '0.0.0-test' } }));
vi.mock('./diagEnv.js', () => ({ getDiagEnv: () => ({ os: { platform: 'test' } }) }));
vi.mock('./diagnostics.js', () => ({
    getDiagnosticsConsent: () => ({ uploadEnabled: false, includePlayerId: false }),
}));

const { buildSupportBundle, pruneCrashDumps, supportBundleName } = await import('./diagbundle.js');

const DAY = 24 * 3600 * 1000;
function put(rel: string, body: string, ageMs = 0): void {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(file, t, t);
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ezp-bundle-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('buildSupportBundle', () => {
    it('zips the logs, the two newest recent dumps, and a summary', async () => {
        put('logs/ezplayer-main.log', 'main');
        put('logs/playbackmain.log.1', 'older');
        put('crashDumps/reports/a.dmp', 'a', 1 * DAY);
        put('crashDumps/reports/b.dmp', 'b', 2 * DAY);
        put('crashDumps/reports/c.dmp', 'c', 3 * DAY);
        put('crashDumps/reports/old.dmp', 'old', 40 * DAY);
        put('crashDumps/reports/notes.txt', 'x');

        const zip = await JSZip.loadAsync(await buildSupportBundle());

        expect(Object.keys(zip.files).sort()).toEqual([
            'crash-dumps/',
            'crash-dumps/a.dmp',
            'crash-dumps/b.dmp',
            'diagnostics.json',
            'logs/',
            'logs/ezplayer-main.log',
            'logs/playbackmain.log.1',
        ]);
        expect(await zip.file('logs/ezplayer-main.log')!.async('string')).toBe('main');
        const summary = JSON.parse(await zip.file('diagnostics.json')!.async('string'));
        expect(summary).toMatchObject({
            gpuFeatureStatus: { gpu_compositing: 'enabled' },
            reporting: { uploadEnabled: false },
        });
        expect(summary.versions.version).toBe('0.0.0-test');
    });

    it('still produces a summary with no logs or dumps folder', async () => {
        const zip = await JSZip.loadAsync(await buildSupportBundle());
        expect(Object.keys(zip.files)).toEqual(['diagnostics.json']);
    });
});

describe('pruneCrashDumps', () => {
    it('removes dumps older than 90 days only', () => {
        put('crashDumps/reports/new.dmp', 'n', 10 * DAY);
        put('crashDumps/reports/old.dmp', 'o', 91 * DAY);
        put('crashDumps/reports/old.txt', 't', 91 * DAY);
        pruneCrashDumps();
        expect(fs.readdirSync(path.join(root, 'crashDumps/reports')).sort()).toEqual(['new.dmp', 'old.txt']);
    });
});

describe('supportBundleName', () => {
    it('is a filesystem-safe zip name', () => {
        expect(supportBundleName()).toMatch(/^ezplayer-logs-[A-Za-z0-9_-]+-[0-9T-]+Z\.zip$/);
    });
});
