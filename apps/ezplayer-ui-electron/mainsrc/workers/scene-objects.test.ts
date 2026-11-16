/**
 * Scene objects: what a producer can inject, how long it lasts, and what a
 * polling viewer is told about it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import Koa from 'koa';
import Router from '@koa/router';
import getRawBody from 'raw-body';
import type { SceneDelta, SceneObjectInfo } from '@ezplayer/ezplayer-core';
import { SCENE_DEFAULT_TTL_MS, SCENE_MAX_DEPTH, SCENE_MAX_OBJECTS, SceneObjectRegistry } from './scene-objects';
import { registerSceneReadRoutes, registerSceneWriteRoutes } from './scene-objects-api';

const beam = { type: 'beam', length: 500 } as const;

/** A registry on a clock the test moves by hand. */
function fixture() {
    const clock = { t: 1000 };
    const reg = new SceneObjectRegistry({ now: () => clock.t, epoch: 'e1' });
    return { clock, reg };
}

function must<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r as Extract<T, { ok: true }>;
}

describe('scene object registry', () => {
    it('creates under a caller-chosen key, open to any writer', () => {
        const { reg } = fixture();
        const r = must(reg.put('wand', { content: beam, placement: { position: [1, 2, 3] } }));
        expect(r.created).toBe(true);
        expect(r.token).toBeUndefined();
        expect(r.object).toMatchObject({ key: 'wand', protected: false, ttlMs: SCENE_DEFAULT_TTL_MS, view: 'both' });
        expect(must(reg.patch('wand', { appearance: { color: '#FF0000' } })).object.appearance.color).toBe('#ff0000');
    });

    it('makes up a key and token when the caller names neither', () => {
        const { reg } = fixture();
        const a = must(reg.put(undefined, { content: beam }));
        const b = must(reg.put(undefined, { content: beam }));
        expect(a.object.key).not.toBe(b.object.key);
        expect(a.token).toMatch(/^[0-9a-f]{16}$/);
        expect(reg.patch(a.object.key, {}).ok).toBe(false);
        expect(reg.patch(a.object.key, {}, a.token).ok).toBe(true);
    });

    it('takes the key from the body name, and holds a caller-chosen token', () => {
        const { reg } = fixture();
        const r = must(reg.put(undefined, { name: 'tree', token: 's3cret', content: beam }));
        expect(r.object).toMatchObject({ key: 'tree', protected: true });
        expect(reg.put('tree', { content: beam })).toMatchObject({ ok: false, status: 403 });
        expect(reg.remove('tree', 'nope')).toMatchObject({ ok: false, status: 403 });
        // A restarted producer that still knows its secret just carries on.
        const again = must(reg.put('tree', { content: beam }, 's3cret'));
        expect(again.created).toBe(false);
        expect(again.token).toBeUndefined();
        expect(must(reg.remove('tree', 's3cret')).ok).toBe(true);
    });

    it('rejects bad keys and bad bodies without changing anything', () => {
        const { reg } = fixture();
        expect(reg.put('a/b', { content: beam })).toMatchObject({ ok: false, status: 400 });
        expect(reg.put('x', {})).toMatchObject({ ok: false, status: 400 });
        expect(reg.put('x', { content: { type: 'laser' } })).toMatchObject({ ok: false, status: 400 });
        expect(reg.put('x', { content: beam, placement: { position: [1, 2] } })).toMatchObject({
            ok: false,
            status: 400,
        });
        expect(reg.put('x', { content: beam, placement: { spin: 1 } })).toMatchObject({ ok: false, status: 400 });
        expect(reg.put('x', { content: beam, appearance: { color: 'red' } })).toMatchObject({ ok: false, status: 400 });
        expect(reg.put('x', { content: { type: 'points', positions: [1, 2] } })).toMatchObject({
            ok: false,
            status: 400,
        });
        expect(reg.put('x', { content: { type: 'mesh' } })).toMatchObject({ ok: false, status: 400 });
        expect(reg.put('x', { content: { type: 'mesh', asset: '../x.obj' } })).toMatchObject({
            ok: false,
            status: 400,
        });
        expect(reg.size).toBe(0);

        must(reg.put('x', { content: beam, placement: { position: [1, 2, 3] } }));
        expect(reg.patch('x', { placement: { position: [9, 9, 9] }, appearance: { opacity: 7 } }).ok).toBe(false);
        expect(reg.get('x')?.placement.position).toEqual([1, 2, 3]);
    });

    it('limits group depth and object count', () => {
        const { reg } = fixture();
        let nested: unknown = beam;
        for (let i = 0; i <= SCENE_MAX_DEPTH; i++) nested = { type: 'group', children: [{ content: nested }] };
        expect(reg.put('deep', { content: nested })).toMatchObject({ ok: false, status: 400 });
        for (let i = 0; i < SCENE_MAX_OBJECTS; i++) must(reg.put(`o${i}`, { content: beam }));
        expect(reg.put('one-more', { content: beam })).toMatchObject({ ok: false, status: 429 });
        // Replacing an existing key is not a new object.
        expect(reg.put('o0', { content: beam }).ok).toBe(true);
    });

    it('merges placement and appearance by field, and null clears one', () => {
        const { reg } = fixture();
        must(
            reg.put('p', {
                content: beam,
                placement: { position: [1, 2, 3], scale: 2 },
                appearance: { color: '#00ff00' },
            }),
        );
        const o = must(
            reg.patch('p', { placement: { rotation: [0, 90, 0], scale: null }, appearance: { visible: false } }),
        ).object;
        expect(o.placement).toEqual({ position: [1, 2, 3], rotation: [0, 90, 0] });
        expect(o.appearance).toEqual({ color: '#00ff00', visible: false });
    });

    it('expires an object that is not heard from, and any write renews it', () => {
        const { reg, clock } = fixture();
        must(reg.put('a', { content: beam, ttlMs: 1000 }));
        must(reg.put('b', { content: beam, ttlMs: 1000 }));
        must(reg.put('c', { content: beam, ttlMs: 1000 }));
        clock.t += 900;
        must(reg.patch('a', { placement: { position: [0, 0, 1] } }));
        must(reg.keepalive('b'));
        clock.t += 200;
        expect(reg.list().map((o) => o.key)).toEqual(['a', 'b']);
        expect(reg.patch('c', {})).toMatchObject({ ok: false, status: 404 });
        expect(reg.get('a')?.expiresInMs).toBe(800);
        clock.t += 1000;
        expect(reg.size).toBe(2);
        reg.sweep();
        expect(reg.size).toBe(0);
    });

    it('clamps the lease length', () => {
        const { reg } = fixture();
        expect(must(reg.put('a', { content: beam, ttlMs: 1 })).object.ttlMs).toBe(250);
        expect(must(reg.put('b', { content: beam, ttlMs: 1e12 })).object.ttlMs).toBe(24 * 3600 * 1000);
    });
});

describe('scene delta', () => {
    it('sends content once, then only what moved', () => {
        const { reg } = fixture();
        must(reg.put('a', { content: beam }));
        must(reg.put('b', { content: { type: 'points', positions: [0, 0, 0] } }));
        const first = reg.delta()!;
        expect(first.epoch).toBe('e1');
        expect(first.keys).toEqual(['a', 'b']);
        expect(first.objects.map((o) => [o.key, o.content?.type])).toEqual([
            ['a', 'beam'],
            ['b', 'points'],
        ]);

        expect(reg.delta(first.rev, 'e1')).toBeUndefined();

        must(reg.patch('b', { placement: { position: [5, 0, 0] } }));
        const moved = reg.delta(first.rev, 'e1')!;
        expect(moved.keys).toEqual(['a', 'b']);
        expect(moved.objects).toHaveLength(1);
        expect(moved.objects[0]).toMatchObject({ key: 'b', placement: { position: [5, 0, 0] } });
        expect(moved.objects[0].content).toBeUndefined();

        must(reg.patch('a', { content: { type: 'beam', length: 9 } }));
        const recontent = reg.delta(moved.rev, 'e1')!;
        expect(recontent.objects).toHaveLength(1);
        expect(recontent.objects[0].content).toEqual({ type: 'beam', length: 9 });
    });

    it('reports removal and expiry through the key list', () => {
        const { reg, clock } = fixture();
        must(reg.put('a', { content: beam, ttlMs: 1000 }));
        must(reg.put('b', { content: beam, ttlMs: 5000 }));
        const first = reg.delta()!;
        clock.t += 2000;
        const afterExpiry = reg.delta(first.rev, 'e1')!;
        expect(afterExpiry.keys).toEqual(['b']);
        expect(afterExpiry.objects).toEqual([]);
        must(reg.remove('b'));
        expect(reg.delta(afterExpiry.rev, 'e1')!.keys).toEqual([]);
    });

    it('starts a viewer over when it comes from another epoch', () => {
        const { reg } = fixture();
        must(reg.put('a', { content: beam }));
        const rev = reg.delta()!.rev;
        const full = reg.delta(rev, 'some-earlier-run')!;
        expect(full.objects[0].content).toEqual(beam);
        // A revision from the future is treated the same way.
        expect(reg.delta(rev + 50, 'e1')!.objects).toHaveLength(1);
    });

    it('keepalive is invisible to viewers', () => {
        const { reg } = fixture();
        must(reg.put('a', { content: beam }));
        const rev = reg.delta()!.rev;
        must(reg.keepalive('a'));
        expect(reg.delta(rev, 'e1')).toBeUndefined();
    });
});

describe('scene assets', () => {
    it('holds uploaded files with the object and re-announces content when they change', () => {
        const { reg, clock } = fixture();
        must(reg.put('house', { content: { type: 'mesh', asset: 'house.obj' }, ttlMs: 1000 }));
        const rev0 = reg.delta()!.rev;
        const up = must(reg.putAsset('house', 'house.obj', new Uint8Array([1, 2, 3])));
        expect(up.asset).toMatchObject({ size: 3, contentType: 'text/plain' });

        const d = reg.delta(rev0, 'e1')!;
        expect(d.objects[0].assets).toEqual({ 'house.obj': up.asset });
        expect(d.objects[0].content).toEqual({ type: 'mesh', asset: 'house.obj' });
        expect([...reg.getAsset('house', 'house.obj')!.bytes]).toEqual([1, 2, 3]);

        // A replace of the definition keeps the files.
        must(reg.put('house', { content: { type: 'mesh', asset: 'house.obj' }, ttlMs: 1000 }));
        expect(reg.get('house')?.assets['house.obj'].size).toBe(3);

        const again = must(reg.putAsset('house', 'house.obj', new Uint8Array([9])));
        expect(again.asset.rev).toBeGreaterThan(up.asset.rev);

        clock.t += 2000;
        expect(reg.getAsset('house', 'house.obj')).toBeUndefined();
    });

    it('refuses odd names, unknown objects, and writers without the token', () => {
        const { reg } = fixture();
        must(reg.put('h', { content: beam, token: 't' }));
        const bytes = new Uint8Array(1);
        expect(reg.putAsset('h', 'a.obj', bytes)).toMatchObject({ ok: false, status: 403 });
        expect(reg.putAsset('h', 'a.exe', bytes, 't')).toMatchObject({ ok: false, status: 400 });
        expect(reg.putAsset('h', '..obj', bytes, 't')).toMatchObject({ ok: false, status: 400 });
        expect(reg.putAsset('nope', 'a.obj', bytes)).toMatchObject({ ok: false, status: 404 });
        expect(reg.removeAsset('h', 'a.obj', 't')).toMatchObject({ ok: false, status: 404 });
        must(reg.putAsset('h', 'a.obj', bytes, 't'));
        expect(reg.removeAsset('h', 'a.obj', 't').ok).toBe(true);
    });
});

describe('scene objects HTTP API', () => {
    let server: Server;
    let base: string;
    let reg: SceneObjectRegistry;
    const clock = { t: 0 };

    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
        const isBytes = body instanceof Uint8Array;
        const res = await fetch(base + path, {
            method,
            headers: {
                ...(body === undefined
                    ? {}
                    : { 'content-type': isBytes ? 'application/octet-stream' : 'application/json' }),
                ...headers,
            },
            body: body === undefined ? undefined : isBytes ? (body as unknown as BodyInit) : JSON.stringify(body),
        });
        return res;
    };

    beforeAll(async () => {
        const router = new Router();
        // Late-bound so each test gets a fresh registry behind the same server.
        const live = new Proxy({} as SceneObjectRegistry, {
            get: (_t, prop) => {
                const v = (reg as unknown as Record<string | symbol, unknown>)[prop];
                return typeof v === 'function' ? v.bind(reg) : v;
            },
        });
        registerSceneReadRoutes(router, live);
        registerSceneWriteRoutes(router, live);
        const app = new Koa();
        // The same minimal JSON parsing the server worker does.
        app.use(async (ctx, next) => {
            if (ctx.method !== 'GET' && ctx.is('json')) {
                const raw = await getRawBody(ctx.req, { encoding: 'utf8', limit: '1mb' });
                ctx.request.body = raw ? JSON.parse(raw) : {};
            }
            await next();
        });
        app.use(router.routes());
        app.use(router.allowedMethods());
        server = app.listen(0, '127.0.0.1');
        await new Promise((r) => server.once('listening', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(() => {
        server.close();
    });

    beforeEach(() => {
        clock.t = 0;
        reg = new SceneObjectRegistry({ now: () => clock.t, epoch: 'e1' });
    });

    it('walks an object through its life', async () => {
        const made = await call('PUT', '/api/ezp/objects/wand', { content: beam, ttlMs: 2000 });
        expect(made.status).toBe(201);
        expect(((await made.json()) as { object: SceneObjectInfo }).object.key).toBe('wand');

        const patched = await call('PATCH', '/api/ezp/objects/wand', { placement: { direction: [0, 0, 1] } });
        expect(patched.status).toBe(200);

        const list = (await (await call('GET', '/api/ezp/objects')).json()) as { objects: SceneObjectInfo[] };
        expect(list.objects.map((o) => o.key)).toEqual(['wand']);

        expect((await call('POST', '/api/ezp/objects/wand/keepalive')).status).toBe(200);
        expect((await call('PUT', '/api/ezp/objects/wand', { content: beam })).status).toBe(200);
        expect((await call('DELETE', '/api/ezp/objects/wand')).status).toBe(200);
        expect((await call('GET', '/api/ezp/objects/wand')).status).toBe(404);
        expect((await call('PATCH', '/api/ezp/objects/wand', {})).status).toBe(404);
    });

    it('hands out a key and token on a bare POST, and takes the token either way', async () => {
        const res = await call('POST', '/api/ezp/objects', { content: beam });
        expect(res.status).toBe(201);
        const { object, token } = (await res.json()) as { object: SceneObjectInfo; token: string };
        expect(token).toBeTruthy();
        const path = `/api/ezp/objects/${object.key}`;
        expect((await call('PATCH', path, {})).status).toBe(403);
        expect((await call('PATCH', `${path}?token=${token}`, {})).status).toBe(200);
        expect((await call('PATCH', path, {}, { 'x-ezp-token': token })).status).toBe(200);
        // Listings never show it.
        expect(await (await call('GET', path)).text()).not.toContain(token);
    });

    it('feeds a polling viewer deltas, and 204 when nothing changed', async () => {
        await call('PUT', '/api/ezp/objects/a', { content: beam, ttlMs: 1000 });
        const first = await call('GET', '/api/ezp/scene');
        expect(first.headers.get('access-control-allow-origin')).toBe('*');
        const d = (await first.json()) as SceneDelta;
        expect(d.objects[0].content).toEqual(beam);

        expect((await call('GET', `/api/ezp/scene?since=${d.rev}&epoch=${d.epoch}`)).status).toBe(204);

        clock.t += 5000;
        const gone = (await (await call('GET', `/api/ezp/scene?since=${d.rev}&epoch=${d.epoch}`)).json()) as SceneDelta;
        expect(gone.keys).toEqual([]);
    });

    it('stores and serves asset bytes', async () => {
        await call('PUT', '/api/ezp/objects/pic', { content: { type: 'image', asset: 'a.png', width: 100 } });
        const bytes = new Uint8Array([137, 80, 78, 71]);
        const up = await call('PUT', '/api/ezp/objects/pic/assets/a.png', bytes);
        expect(up.status).toBe(200);

        const got = await call('GET', '/api/ezp/objects/pic/assets/a.png?rev=1');
        expect(got.status).toBe(200);
        expect(got.headers.get('content-type')).toBe('image/png');
        expect(got.headers.get('cache-control')).toContain('max-age');
        expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([...bytes]);

        expect((await call('PUT', '/api/ezp/objects/pic/assets/a.png', { not: 'bytes' })).status).toBe(415);
        expect((await call('GET', '/api/ezp/objects/pic/assets/b.png')).status).toBe(404);
        expect((await call('GET', '/api/ezp/objects/pic/assets/%E0%A4%A.png')).status).toBe(400);
        expect((await call('DELETE', '/api/ezp/objects/pic/assets/a.png')).status).toBe(200);
        expect((await call('GET', '/api/ezp/objects/pic/assets/a.png')).status).toBe(404);
    });

    it('answers a bad body with 400 and says why', async () => {
        const res = await call('PUT', '/api/ezp/objects/x', { content: { type: 'beam' } });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toContain('content.length');
    });
});
