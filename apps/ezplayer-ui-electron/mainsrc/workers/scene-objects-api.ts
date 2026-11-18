/*
 * Scene objects API: HTTP face of the SceneObjectRegistry.
 *
 * Read routes (the viewer feed and asset bytes) are safe on every surface.
 * Write routes change what viewers see and belong on the web app only.
 */

import type Koa from 'koa';
import Router from '@koa/router';
import getRawBody from 'raw-body';
import { SCENE_FEED_PATH, SCENE_OBJECTS_PATH } from '@ezplayer/ezplayer-core';
import { SCENE_MAX_ASSET_BYTES, type SceneObjectRegistry, type SceneResult } from './scene-objects.js';

const ASSET_ROUTE = `${SCENE_OBJECTS_PATH}/:key/assets/:name`;
const ASSET_PATH_RE = /^\/api\/ezp\/objects\/([^/?]+)\/assets\/([^/?]+)$/;

const tokenOf = (ctx: Koa.Context): string | undefined => {
    const t = ctx.query.token ?? ctx.get('x-ezp-token');
    return typeof t === 'string' && t !== '' ? t : undefined;
};

/** Send a registry result; `pick` shapes the success body. */
function reply<T>(ctx: Koa.Context, res: SceneResult<T>, pick?: (r: T) => unknown, okStatus = 200): void {
    if (!res.ok) {
        ctx.status = res.status;
        ctx.body = { ok: false, error: res.error };
        return;
    }
    ctx.status = okStatus;
    ctx.body = { ok: true, ...((pick ? pick(res) : {}) as object) };
}

interface ProxyResult {
    status: number;
    headers?: Record<string, string>;
    body?: Buffer;
}

const asBuffer = (b: Uint8Array): Buffer => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

/** The read routes as the cloud HTTP-over-WS proxy needs them; undefined when the path is not ours. */
export function dispatchSceneRead(
    registry: SceneObjectRegistry,
    pathStr: string,
    query: Record<string, string> | undefined,
): ProxyResult | undefined {
    if (pathStr === SCENE_FEED_PATH) {
        const delta = registry.delta(Number(query?.since ?? 0), query?.epoch);
        if (!delta) return { status: 204 };
        return {
            status: 200,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
            body: Buffer.from(JSON.stringify(delta), 'utf8'),
        };
    }
    const m = ASSET_PATH_RE.exec(pathStr);
    if (!m) return undefined;
    let asset: ReturnType<SceneObjectRegistry['getAsset']>;
    try {
        asset = registry.getAsset(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    } catch {
        // Malformed percent-encoding.
        return { status: 400 };
    }
    if (!asset) return { status: 404 };
    return {
        status: 200,
        headers: {
            'content-type': asset.info.contentType,
            // A URL that names the revision never changes its bytes.
            'cache-control': query?.rev ? 'private, max-age=3600' : 'no-store',
        },
        body: asBuffer(asset.bytes),
    };
}

/** GET /api/ezp/scene and GET /api/ezp/objects/:key/assets/:name. */
export function registerSceneReadRoutes(router: Router, registry: SceneObjectRegistry): void {
    const serve = (ctx: Koa.Context) => {
        const query: Record<string, string> = {};
        for (const [k, v] of Object.entries(ctx.query)) if (typeof v === 'string') query[k] = v;
        const res = dispatchSceneRead(registry, ctx.path, query);
        ctx.set('Access-Control-Allow-Origin', '*');
        if (!res) {
            ctx.status = 404;
            return;
        }
        for (const [k, v] of Object.entries(res.headers ?? {})) ctx.set(k, v);
        ctx.status = res.status;
        if (res.body) ctx.body = res.body;
    };
    router.get(SCENE_FEED_PATH, serve);
    router.get(ASSET_ROUTE, serve);
}

/** Everything that creates, changes or lists objects. */
export function registerSceneWriteRoutes(router: Router, registry: SceneObjectRegistry): void {
    const created = (r: { created: boolean }) => (r.created ? 201 : 200);

    router.get(SCENE_OBJECTS_PATH, (ctx) => {
        ctx.body = { ok: true, epoch: registry.epoch, objects: registry.list() };
    });

    router.get(`${SCENE_OBJECTS_PATH}/:key`, (ctx) => {
        const object = registry.get(ctx.params.key);
        if (!object) {
            ctx.status = 404;
            ctx.body = { ok: false, error: `no object '${ctx.params.key}'` };
            return;
        }
        ctx.body = { ok: true, object };
    });

    // Create; the key is the body's name, or made up (with a token) when absent.
    router.post(SCENE_OBJECTS_PATH, (ctx) => {
        const res = registry.put(undefined, ctx.request.body, tokenOf(ctx));
        reply(ctx, res, (r) => ({ object: r.object, token: r.token }), res.ok ? created(res) : undefined);
    });

    // Create or replace under a caller-chosen key.
    router.put(`${SCENE_OBJECTS_PATH}/:key`, (ctx) => {
        const res = registry.put(ctx.params.key, ctx.request.body, tokenOf(ctx));
        reply(ctx, res, (r) => ({ object: r.object, token: r.token }), res.ok ? created(res) : undefined);
    });

    router.patch(`${SCENE_OBJECTS_PATH}/:key`, (ctx) => {
        reply(ctx, registry.patch(ctx.params.key, ctx.request.body ?? {}, tokenOf(ctx)), (r) => ({ object: r.object }));
    });

    router.post(`${SCENE_OBJECTS_PATH}/:key/keepalive`, (ctx) => {
        reply(ctx, registry.keepalive(ctx.params.key, tokenOf(ctx)), (r) => ({ expiresInMs: r.expiresInMs }));
    });

    router.delete(`${SCENE_OBJECTS_PATH}/:key`, (ctx) => {
        reply(ctx, registry.remove(ctx.params.key, tokenOf(ctx)));
    });

    // Raw bytes; the name's extension decides the content type.
    router.put(ASSET_ROUTE, async (ctx) => {
        if (ctx.is('json')) {
            ctx.status = 415;
            ctx.body = { ok: false, error: 'send asset bytes as application/octet-stream' };
            return;
        }
        let raw: Buffer;
        try {
            raw = await getRawBody(ctx.req, { limit: SCENE_MAX_ASSET_BYTES });
        } catch (err) {
            ctx.status = (err as { status?: number }).status ?? 400;
            ctx.body = { ok: false, error: (err as Error).message };
            return;
        }
        reply(ctx, registry.putAsset(ctx.params.key, ctx.params.name, new Uint8Array(raw), tokenOf(ctx)), (r) => ({
            asset: r.asset,
        }));
    });

    router.delete(ASSET_ROUTE, (ctx) => {
        reply(ctx, registry.removeAsset(ctx.params.key, ctx.params.name, tokenOf(ctx)));
    });
}
