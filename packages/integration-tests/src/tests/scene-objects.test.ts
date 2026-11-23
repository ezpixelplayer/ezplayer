/** Scene objects end to end: a producer injects display-only objects over
 *  HTTP, a viewer polls them back, uploaded files ride along with the object,
 *  and an object that is not renewed disappears on its own. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SceneDelta, SceneObjectInfo } from '@ezplayer/ezplayer-core';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

let show: FixtureShow;
let app: EzPlayerProc;

const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
});

async function scene(since = 0, epoch?: string): Promise<{ status: number; delta?: SceneDelta }> {
    const q = epoch ? `?since=${since}&epoch=${epoch}` : `?since=${since}`;
    const res = await fetch(`${app.base}/api/ezp/scene${q}`);
    return { status: res.status, delta: res.status === 200 ? ((await res.json()) as SceneDelta) : undefined };
}

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
});

describe('scene objects', () => {
    it('starts with an empty scene', async () => {
        const { status, delta } = await scene();
        expect(status).toBe(200);
        expect(delta?.keys).toEqual([]);
    });

    it('shows a viewer what a producer injects and then moves', async () => {
        const put = await fetch(
            `${app.base}/api/ezp/objects/wand`,
            json('PUT', {
                content: { type: 'beam', length: 800, angle: 4 },
                placement: { position: [10, 20, 30], direction: [0, 0, -1] },
                appearance: { color: '#00d0ff' },
            }),
        );
        expect(put.status, await put.clone().text()).toBe(201);

        const first = (await scene()).delta!;
        expect(first.keys).toEqual(['wand']);
        expect(first.objects[0]).toMatchObject({
            key: 'wand',
            content: { type: 'beam', length: 800, angle: 4 },
            placement: { position: [10, 20, 30] },
            appearance: { color: '#00d0ff' },
        });
        expect((await scene(first.rev, first.epoch)).status).toBe(204);

        const patch = await fetch(
            `${app.base}/api/ezp/objects/wand`,
            json('PATCH', { placement: { position: [11, 20, 30] }, appearance: { visible: false } }),
        );
        expect(patch.status).toBe(200);

        const moved = (await scene(first.rev, first.epoch)).delta!;
        expect(moved.objects).toHaveLength(1);
        expect(moved.objects[0].placement.position).toEqual([11, 20, 30]);
        expect(moved.objects[0].appearance).toEqual({ color: '#00d0ff', visible: false });
        // Content is not resent for a move.
        expect(moved.objects[0].content).toBeUndefined();

        expect((await fetch(`${app.base}/api/ezp/objects/wand`, json('DELETE'))).status).toBe(200);
        expect((await scene(moved.rev, moved.epoch)).delta!.keys).toEqual([]);
    });

    it('keeps uploaded files with the object and serves them to viewers', async () => {
        const made = await fetch(
            `${app.base}/api/ezp/objects`,
            json('POST', { content: { type: 'mesh', asset: 'tri.obj' }, ttlMs: 60_000 }),
        );
        expect(made.status).toBe(201);
        const { object, token } = (await made.json()) as { object: SceneObjectInfo; token: string };
        const assetUrl = `${app.base}/api/ezp/objects/${object.key}/assets/tri.obj`;
        const obj = 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n';

        // The made-up key came with a token, and uploads need it.
        const refused = await fetch(assetUrl, { method: 'PUT', body: obj });
        expect(refused.status).toBe(403);
        const up = await fetch(`${assetUrl}?token=${token}`, { method: 'PUT', body: obj });
        expect(up.status, await up.clone().text()).toBe(200);

        const feed = (await scene()).delta!;
        const seen = feed.objects.find((o) => o.key === object.key)!;
        expect(seen.assets?.['tri.obj'].size).toBe(obj.length);

        const got = await fetch(`${assetUrl}?rev=${seen.assets!['tri.obj'].rev}`);
        expect(got.status).toBe(200);
        expect(await got.text()).toBe(obj);

        expect((await fetch(`${app.base}/api/ezp/objects/${object.key}?token=${token}`, json('DELETE'))).status).toBe(
            200,
        );
        expect((await fetch(assetUrl)).status).toBe(404);
    });

    it('drops an object whose lease runs out', async () => {
        await fetch(
            `${app.base}/api/ezp/objects/brief`,
            json('PUT', { content: { type: 'shape', shape: 'sphere' }, ttlMs: 400 }),
        );
        const before = (await scene()).delta!;
        expect(before.keys).toContain('brief');

        // Renewing holds it past its first deadline.
        await new Promise((r) => setTimeout(r, 250));
        expect((await fetch(`${app.base}/api/ezp/objects/brief/keepalive`, json('POST'))).status).toBe(200);
        await new Promise((r) => setTimeout(r, 250));
        expect((await fetch(`${app.base}/api/ezp/objects/brief`)).status).toBe(200);

        await new Promise((r) => setTimeout(r, 600));
        const after = (await scene(before.rev, before.epoch)).delta!;
        expect(after.keys).not.toContain('brief');
        expect((await fetch(`${app.base}/api/ezp/objects/brief`, json('PATCH', {}))).status).toBe(404);
    });

    it('says what is wrong with a bad request', async () => {
        const res = await fetch(
            `${app.base}/api/ezp/objects/bad`,
            json('PUT', { content: { type: 'points', positions: [1, 2] } }),
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain('positions');
    });
});
