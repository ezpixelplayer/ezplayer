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

const { buildSupportBundle, nonDefault, pruneCrashDumps, redactSecrets, supportBundleName } =
    await import('./diagbundle.js');
const { defaultPlaybackSettings } = await import('./data/SettingsStorage.js');

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
            'settings.json',
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
        expect(Object.keys(zip.files)).toEqual(['diagnostics.json', 'settings.json']);
    });
});

describe('support bundle levels', () => {
    const show = () => path.join(root, 'show');
    beforeEach(() => {
        put('userData/config.json', JSON.stringify({ showFolder: 'x', autoUpdateMode: 'manual' }));
        put('show/xlights_networks.xml', '<Networks/>');
        put('show/xlights_rgbeffects.xml', '<xrgb/>');
        put('show/song.fseq', 'fseq');
        put(
            'show/.ezplayer/sequences.json',
            JSON.stringify({
                data: {
                    allSongs: [
                        { id: 's1', work: { title: 'One' }, files: { fseq: 'song.fseq', audio: 'gone.mp3' } },
                        { id: 's2', deleted: true, files: { fseq: 'old.fseq' } },
                    ],
                },
            }),
        );
        put('show/.ezplayer/playlists.json', '{"data":{"playlists":[]}}');
        put('show/.ezplayer/schedule.json', '{not json');
        put('show/.ezplayer/remote-access.json', JSON.stringify({ version: 1, shell: { password: { hash: 'h' } } }));
    });
    const sources = () => ({
        showFolder: show(),
        playbackSettings: {
            ...defaultPlaybackSettings(),
            audioSyncAdjust: 40,
            viewerControl: { enabled: true, type: 'remote-falcon' as const, remoteFalconToken: 'rf', schedule: [] },
        },
        cloudConfig: {
            cloudServiceUrl: 'https://api.ezplayer.dev/',
            playerIdToken: 'pid',
            cloudEnabled: true,
            cloudPollMode: 'scheduled' as const,
        },
    });
    const build = async (level: 'logs' | 'setup' | 'layout') =>
        JSZip.loadAsync(await buildSupportBundle(level, sources()));
    const names = (zip: JSZip) => Object.keys(zip.files).filter((n) => !n.endsWith('/'));
    const read = async (zip: JSZip, name: string) => zip.file(name)!.async('string');

    it('logs: settings changed from defaults, secrets redacted, no show data or network', async () => {
        const zip = await build('logs');
        expect(names(zip).sort()).toEqual(['diagnostics.json', 'settings.json']);
        expect(JSON.parse(await read(zip, 'settings.json'))).toEqual({
            showFolder: show(),
            app: { showFolder: 'x', autoUpdateMode: 'manual' },
            playback: {
                audioSyncAdjust: 40,
                viewerControl: { enabled: true, type: 'remote-falcon', remoteFalconToken: '<redacted>' },
            },
            cloud: { playerIdToken: '<redacted>', cloudPollMode: 'scheduled' },
            remoteAccess: { version: 1, shell: { password: '<redacted>' } },
        });
    });

    it('setup: adds network, controller setup, songs, playlists, schedule, and a media listing', async () => {
        const zip = await build('setup');
        expect(names(zip).sort()).toEqual([
            'diagnostics.json',
            'media-files.json',
            'network.json',
            'settings.json',
            'show/playlists.json',
            'show/schedule.json',
            'show/sequences.json',
            'show/xlights_networks.xml',
        ]);
        expect(await read(zip, 'show/schedule.json')).toBe('{not json');
        expect(JSON.parse(await read(zip, 'network.json')).interfaces).toBeTypeOf('object');
        expect(JSON.parse(await read(zip, 'media-files.json'))).toEqual([
            {
                id: 's1',
                title: 'One',
                files: [
                    { kind: 'fseq', path: 'song.fseq', size: 4, mtime: expect.any(String) },
                    { kind: 'audio', path: 'gone.mp3', missing: true },
                ],
            },
        ]);
    });

    it('layout: adds the layout file', async () => {
        const zip = await build('layout');
        expect(names(zip)).toContain('show/xlights_rgbeffects.xml');
        expect(names(zip)).toContain('show/sequences.json');
    });
});

describe('redactSecrets', () => {
    it('replaces set values under secret-looking keys at any depth', () => {
        expect(
            redactSecrets({
                a: 1,
                apiKey: 'k',
                list: [{ token: 't', blank: '' }],
                nested: { password: '', secret: null },
            }),
        ).toEqual({
            a: 1,
            apiKey: '<redacted>',
            list: [{ token: '<redacted>', blank: '' }],
            nested: { password: '', secret: null },
        });
    });
});

describe('nonDefault', () => {
    it('keeps only what differs; arrays compare whole', () => {
        expect(nonDefault({ a: 1, b: { c: 2, d: 3 }, e: [1, 2] }, { a: 1, b: { c: 2, d: 4 }, e: [1, 2] })).toEqual({
            b: { d: 3 },
        });
        expect(nonDefault({ a: 1 }, { a: 1 })).toBeUndefined();
        expect(nonDefault({ e: [1] }, { e: [1, 2] })).toEqual({ e: [1] });
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
        expect(supportBundleName('layout')).toMatch(/^ezplayer-layout-/);
    });
});
