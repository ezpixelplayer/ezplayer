/** Playback settings over REST: the whole object, and parts of it addressed by
 *  path, so a client can change one block without resending everything. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

let show: FixtureShow;
let app: EzPlayerProc;

const BASE_SETTINGS = {
    audioSyncAdjust: 25,
    backgroundSequence: 'overlay',
    viewerControl: { enabled: false, type: 'disabled', schedule: [] },
    volumeControl: { defaultVolume: 80, schedule: [] },
    testSequenceTags: ['test'],
};

const url = (p = '') => `${app.base}/api/ezp/playback-settings${p}`;
const getJson = async (p = '') => {
    const res = await fetch(url(p));
    return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
};
const post = (p: string, value: unknown) =>
    fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

/** The settings file the player keeps in the show folder. The player writes it
 *  after answering the POST, so give the write a moment to land. */
const onDisk = async () => {
    const file = path.join(show.dir, '.ezplayer', 'playbackSettings.json');
    const deadline = Date.now() + 5000;
    for (;;) {
        try {
            return JSON.parse(await fsp.readFile(file, 'utf8'));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() > deadline) throw err;
            await new Promise((r) => setTimeout(r, 200));
        }
    }
};

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    // Start from a known whole object.
    expect((await post('', BASE_SETTINGS)).status).toBe(200);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
});

describe('playback settings API', () => {
    it('GET returns the whole object the player holds', async () => {
        const { status, body } = await getJson();
        expect(status).toBe(200);
        expect(body).toMatchObject(BASE_SETTINGS);
    });

    it('GET of a part returns just that value, 404 while unset', async () => {
        expect(await getJson('/volumeControl/defaultVolume')).toEqual({ status: 200, body: 80 });
        expect(await getJson('/viewerControl')).toEqual({ status: 200, body: BASE_SETTINGS.viewerControl });
        expect((await getJson('/sync')).status).toBe(404);
        expect((await getJson('/sync/multisync')).status).toBe(404);
        expect((await getJson('/notASetting')).status).toBe(404);
    });

    it('POST of a part replaces only that part, creating missing parents', async () => {
        const multisync = { enabled: true, remotes: ['127.0.0.1:32320'], mediaSync: true };
        expect((await post('/sync/multisync', multisync)).status).toBe(200);

        expect(await getJson('/sync/multisync')).toEqual({ status: 200, body: multisync });
        const whole = (await getJson()).body;
        expect(whole.sync).toEqual({ multisync });
        // Everything else is as it was.
        expect(whole).toMatchObject(BASE_SETTINGS);
        // ...and it reached the disk copy the player reloads from.
        expect((await onDisk()).sync.multisync).toEqual(multisync);
    });

    it('POST of a leaf changes one field within its block', async () => {
        expect((await post('/sync/multisync/enabled', false)).status).toBe(200);
        expect(await getJson('/sync/multisync')).toEqual({
            status: 200,
            body: { enabled: false, remotes: ['127.0.0.1:32320'], mediaSync: true },
        });
        expect((await post('/volumeControl/defaultVolume', 55)).status).toBe(200);
        expect((await getJson()).body.volumeControl).toEqual({ defaultVolume: 55, schedule: [] });
    });

    it('null unsets an optional part; required parts refuse', async () => {
        expect((await post('/sync', null)).status).toBe(200);
        expect((await getJson('/sync')).status).toBe(404);
        expect('sync' in (await getJson()).body).toBe(false);

        expect((await post('/volumeControl', null)).status).toBe(400);
        expect((await getJson('/volumeControl')).status).toBe(200);
    });

    it('rejects paths that would corrupt the object', async () => {
        // Unknown top-level key: never planted in the settings.
        expect((await post('/notASetting', 1)).status).toBe(404);
        expect('notASetting' in (await getJson()).body).toBe(false);
        // Descending through a scalar.
        expect((await post('/audioSyncAdjust/foo', 1)).status).toBe(400);
        expect((await getJson('/audioSyncAdjust')).body).toBe(25);
        // Prototype names.
        expect((await post('/advanced/__proto__/polluted', true)).status).toBe(400);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('whole-object POST still replaces everything', async () => {
        expect((await post('/sync/multisync', { enabled: true, remotes: [] })).status).toBe(200);
        expect((await post('', BASE_SETTINGS)).status).toBe(200);
        const whole = (await getJson()).body;
        expect(whole).toEqual(BASE_SETTINGS);
        expect((await getJson('/sync')).status).toBe(404);
    });
});
