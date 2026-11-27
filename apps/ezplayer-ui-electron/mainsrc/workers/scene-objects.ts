/*
 * Scene object registry: the leased, display-only objects behind
 * /api/ezp/objects. Pure state, no I/O; the clock is injected.
 *
 * Every change bumps a scene revision. Viewers poll delta(since) and get only
 * what changed, with heavy content sent once per content revision.
 */

import { randomBytes } from 'crypto';
import type {
    SceneAppearance,
    SceneAssetInfo,
    SceneContent,
    SceneDelta,
    SceneNode,
    SceneObjectDelta,
    SceneObjectInfo,
    SceneObjectPatch,
    SceneObjectRequest,
    ScenePlacement,
    SceneShapeKind,
    SceneVec3,
    SceneView,
} from '@ezplayer/ezplayer-core';

export const SCENE_DEFAULT_TTL_MS = 30_000;
export const SCENE_MIN_TTL_MS = 250;
export const SCENE_MAX_TTL_MS = 24 * 3600 * 1000;
export const SCENE_MAX_OBJECTS = 256;
export const SCENE_MAX_POINTS = 100_000;
export const SCENE_MAX_NODES = 512;
export const SCENE_MAX_DEPTH = 4;
export const SCENE_MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const SCENE_MAX_TOTAL_ASSET_BYTES = 256 * 1024 * 1024;
export const SCENE_MAX_ASSETS_PER_OBJECT = 32;

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/;
const ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SHAPES = ['sphere', 'box', 'cylinder', 'cone', 'plane'];
const VIEWS = ['both', '2d', '3d'];

/** Extension -> content type of what may be uploaded; the same set show-file serves. */
export const SCENE_ASSET_TYPES: Record<string, string> = {
    '.obj': 'text/plain',
    '.mtl': 'text/plain',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tga': 'image/x-tga',
    '.dds': 'image/vnd-ms.dds',
};

export type SceneResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

class Invalid extends Error {}

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export function isSceneKey(key: unknown): key is string {
    return typeof key === 'string' && KEY_RE.test(key);
}

export function sceneAssetType(name: string): string | undefined {
    if (!ASSET_NAME_RE.test(name) || name.includes('..')) return undefined;
    const dot = name.lastIndexOf('.');
    return dot < 0 ? undefined : SCENE_ASSET_TYPES[name.slice(dot).toLowerCase()];
}

// ---------------------------------------------------------------------------
// Validation: each function returns a clean copy or throws Invalid.
// ---------------------------------------------------------------------------

function num(v: unknown, what: string, min = -Infinity, max = Infinity): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Invalid(`${what} must be a finite number`);
    if (v < min || v > max) throw new Invalid(`${what} must be between ${min} and ${max}`);
    return v;
}

function numArray(v: unknown, what: string, len: number): number[] {
    if (!Array.isArray(v) || v.length !== len) throw new Invalid(`${what} must be an array of ${len} numbers`);
    return v.map((e, i) => num(e, `${what}[${i}]`));
}

function obj(v: unknown, what: string): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Invalid(`${what} must be an object`);
    return v as Record<string, unknown>;
}

function bool(v: unknown, what: string): boolean {
    if (typeof v !== 'boolean') throw new Invalid(`${what} must be a boolean`);
    return v;
}

type FieldCheck = (v: unknown, what: string) => unknown;

const PLACEMENT_FIELDS: Record<keyof ScenePlacement, FieldCheck> = {
    position: (v, w) => numArray(v, w, 3),
    rotation: (v, w) => numArray(v, w, 3),
    quaternion: (v, w) => numArray(v, w, 4),
    direction: (v, w) => numArray(v, w, 3),
    scale: (v, w) => (typeof v === 'number' ? num(v, w) : numArray(v, w, 3)),
    matrix: (v, w) => numArray(v, w, 16),
};

const APPEARANCE_FIELDS: Record<keyof SceneAppearance, FieldCheck> = {
    visible: bool,
    color: (v, w) => {
        if (typeof v !== 'string' || !COLOR_RE.test(v)) throw new Invalid(`${w} must be '#rrggbb'`);
        return v.toLowerCase();
    },
    opacity: (v, w) => num(v, w, 0, 1),
    additive: bool,
};

/** Check the known fields of `v`; with `base`, merge onto it and let null clear a field. */
function fields<T extends object>(v: unknown, what: string, checks: Record<string, FieldCheck>, base?: T): T {
    const out: Record<string, unknown> = base ? { ...base } : {};
    if (v === undefined) return out as T;
    for (const [k, val] of Object.entries(obj(v, what))) {
        const check = checks[k];
        if (!check) throw new Invalid(`${what} has no field '${k}'`);
        if (val === null && base) delete out[k];
        else if (val !== undefined) out[k] = check(val, `${what}.${k}`);
    }
    return out as T;
}

function fileRef(o: Record<string, unknown>, what: string): { file?: string; asset?: string } {
    const { file, asset } = o;
    if ((file === undefined) === (asset === undefined)) throw new Invalid(`${what} needs exactly one of file or asset`);
    if (asset !== undefined) {
        if (typeof asset !== 'string' || !sceneAssetType(asset))
            throw new Invalid(`${what}.asset is not a usable asset name`);
        return { asset };
    }
    if (typeof file !== 'string' || !file || file.length > 512)
        throw new Invalid(`${what}.file must be a show-folder path`);
    return { file };
}

interface Budget {
    nodes: number;
    points: number;
}

function content(v: unknown, what: string, depth: number, budget: Budget): SceneContent {
    const o = obj(v, what);
    if (++budget.nodes > SCENE_MAX_NODES) throw new Invalid(`more than ${SCENE_MAX_NODES} nodes`);
    switch (o.type) {
        case 'points': {
            const pos = o.positions;
            if (!Array.isArray(pos) || pos.length % 3 !== 0)
                throw new Invalid(`${what}.positions must be a flat x,y,z array`);
            budget.points += pos.length / 3;
            if (budget.points > SCENE_MAX_POINTS) throw new Invalid(`more than ${SCENE_MAX_POINTS} points`);
            const out: SceneContent = {
                type: 'points',
                positions: pos.map((e, i) => num(e, `${what}.positions[${i}]`)),
            };
            if (o.colors !== undefined) {
                if (!Array.isArray(o.colors) || o.colors.length !== pos.length) {
                    throw new Invalid(`${what}.colors must hold r,g,b for each point`);
                }
                out.colors = o.colors.map((e, i) => Math.round(num(e, `${what}.colors[${i}]`, 0, 255)));
            }
            if (o.size !== undefined) out.size = num(o.size, `${what}.size`, 0);
            if (o.smooth !== undefined) out.smooth = bool(o.smooth, `${what}.smooth`);
            return out;
        }
        case 'beam': {
            const out: SceneContent = { type: 'beam', length: num(o.length, `${what}.length`, 0) };
            if (o.angle !== undefined) out.angle = num(o.angle, `${what}.angle`, 0, 89);
            if (o.radius !== undefined) out.radius = num(o.radius, `${what}.radius`, 0);
            return out;
        }
        case 'shape': {
            if (typeof o.shape !== 'string' || !SHAPES.includes(o.shape)) {
                throw new Invalid(`${what}.shape must be one of ${SHAPES.join(', ')}`);
            }
            const out: SceneContent = { type: 'shape', shape: o.shape as SceneShapeKind };
            if (o.size !== undefined) {
                out.size =
                    typeof o.size === 'number'
                        ? num(o.size, `${what}.size`, 0)
                        : (numArray(o.size, `${what}.size`, 3) as SceneVec3);
            }
            if (o.wireframe !== undefined) out.wireframe = bool(o.wireframe, `${what}.wireframe`);
            return out;
        }
        case 'mesh':
            return { type: 'mesh', ...fileRef(o, what) };
        case 'image': {
            const out: SceneContent = { type: 'image', ...fileRef(o, what) };
            if (o.width !== undefined) out.width = num(o.width, `${what}.width`, 0);
            if (o.height !== undefined) out.height = num(o.height, `${what}.height`, 0);
            return out;
        }
        case 'group': {
            if (depth >= SCENE_MAX_DEPTH) throw new Invalid(`groups nest at most ${SCENE_MAX_DEPTH} deep`);
            if (!Array.isArray(o.children)) throw new Invalid(`${what}.children must be an array`);
            const children = o.children.map((c, i): SceneNode => {
                const cw = `${what}.children[${i}]`;
                const co = obj(c, cw);
                const node: SceneNode = { content: content(co.content, `${cw}.content`, depth + 1, budget) };
                if (co.name !== undefined) {
                    if (typeof co.name !== 'string' || co.name.length > 64)
                        throw new Invalid(`${cw}.name must be a short string`);
                    node.name = co.name;
                }
                if (co.placement !== undefined)
                    node.placement = fields(co.placement, `${cw}.placement`, PLACEMENT_FIELDS);
                if (co.appearance !== undefined)
                    node.appearance = fields(co.appearance, `${cw}.appearance`, APPEARANCE_FIELDS);
                return node;
            });
            return { type: 'group', children };
        }
        default:
            throw new Invalid(`${what}.type must be points, beam, shape, mesh, image or group`);
    }
}

function view(v: unknown): SceneView {
    if (typeof v !== 'string' || !VIEWS.includes(v)) throw new Invalid(`view must be one of ${VIEWS.join(', ')}`);
    return v as SceneView;
}

const ttl = (v: unknown): number => Math.min(SCENE_MAX_TTL_MS, Math.max(SCENE_MIN_TTL_MS, num(v, 'ttlMs')));
const smooth = (v: unknown): number => num(v, 'smoothMs', 0, 10_000);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface Asset {
    bytes: Uint8Array;
    info: SceneAssetInfo;
}

interface Entry {
    key: string;
    token?: string;
    ttlMs: number;
    expiresAt: number;
    rev: number;
    contentRev: number;
    view: SceneView;
    smoothMs?: number;
    placement: ScenePlacement;
    appearance: SceneAppearance;
    content: SceneContent;
    assets: Map<string, Asset>;
}

export interface SceneRegistryOptions {
    /** Milliseconds on any steady clock. */
    now?: () => number;
    epoch?: string;
}

export class SceneObjectRegistry {
    readonly epoch: string;
    private readonly now: () => number;
    private readonly entries = new Map<string, Entry>();
    private rev = 0;
    private nextId = 1;
    private assetBytes = 0;

    constructor(opts: SceneRegistryOptions = {}) {
        this.now = opts.now ?? (() => performance.now());
        this.epoch = opts.epoch ?? randomBytes(6).toString('hex');
    }

    get size(): number {
        return this.entries.size;
    }

    /** Drop expired objects. Every read and write starts with this. */
    sweep(): void {
        const now = this.now();
        for (const e of this.entries.values()) {
            if (e.expiresAt <= now) this.drop(e);
        }
    }

    private drop(e: Entry): void {
        for (const a of e.assets.values()) this.assetBytes -= a.bytes.byteLength;
        this.entries.delete(e.key);
        ++this.rev;
    }

    /** The live entry, once the token (if it has one) is presented. */
    private writable(key: string, token: string | undefined): SceneResult<{ entry: Entry }> {
        this.sweep();
        const entry = this.entries.get(key);
        if (!entry) return fail(404, `no object '${key}'`);
        if (entry.token !== undefined && entry.token !== token) return fail(403, `wrong or missing token for '${key}'`);
        return { ok: true, entry };
    }

    private touch(e: Entry): void {
        e.rev = ++this.rev;
        e.expiresAt = this.now() + e.ttlMs;
    }

    private info(e: Entry): SceneObjectInfo {
        const assets: Record<string, SceneAssetInfo> = {};
        for (const [name, a] of e.assets) assets[name] = a.info;
        return {
            key: e.key,
            protected: e.token !== undefined,
            ttlMs: e.ttlMs,
            expiresInMs: Math.max(0, Math.round(e.expiresAt - this.now())),
            rev: e.rev,
            contentRev: e.contentRev,
            view: e.view,
            ...(e.smoothMs !== undefined ? { smoothMs: e.smoothMs } : {}),
            placement: e.placement,
            appearance: e.appearance,
            content: e.content,
            assets,
        };
    }

    /**
     * Create or replace. With no key the request's name is used, else one is
     * made up along with a token. Uploaded assets survive a replace.
     */
    put(
        key: string | undefined,
        body: unknown,
        token?: string,
    ): SceneResult<{ object: SceneObjectInfo; token?: string; created: boolean }> {
        this.sweep();
        try {
            const req = obj(body, 'body') as unknown as SceneObjectRequest;
            let generated = false;
            if (key === undefined) {
                if (req.name !== undefined) key = req.name;
                else {
                    do key = `obj-${this.nextId++}`;
                    while (this.entries.has(key));
                    generated = true;
                }
            }
            if (!isSceneKey(key))
                return fail(400, 'key must be 1-64 of A-Z a-z 0-9 . _ ~ - and start with a letter or digit');
            if (req.token !== undefined && (typeof req.token !== 'string' || !req.token || req.token.length > 128)) {
                return fail(400, 'token must be a non-empty string');
            }
            const presented = token ?? req.token;
            const prior = this.entries.get(key);
            if (prior?.token !== undefined && prior.token !== presented) {
                return fail(403, `wrong or missing token for '${key}'`);
            }
            if (!prior && this.entries.size >= SCENE_MAX_OBJECTS)
                return fail(429, `more than ${SCENE_MAX_OBJECTS} objects`);

            const entry: Entry = {
                key,
                token: prior?.token ?? presented ?? (generated ? randomBytes(8).toString('hex') : undefined),
                ttlMs: req.ttlMs !== undefined ? ttl(req.ttlMs) : SCENE_DEFAULT_TTL_MS,
                expiresAt: 0,
                rev: 0,
                contentRev: 0,
                view: req.view !== undefined ? view(req.view) : 'both',
                smoothMs: req.smoothMs !== undefined ? smooth(req.smoothMs) : undefined,
                placement: fields(req.placement, 'placement', PLACEMENT_FIELDS),
                appearance: fields(req.appearance, 'appearance', APPEARANCE_FIELDS),
                content: content(req.content, 'content', 0, { nodes: 0, points: 0 }),
                assets: prior?.assets ?? new Map(),
            };
            this.entries.set(key, entry);
            this.touch(entry);
            entry.contentRev = entry.rev;
            return {
                ok: true,
                object: this.info(entry),
                created: !prior,
                // Only handed back when it was just set.
                ...(!prior && entry.token !== undefined ? { token: entry.token } : {}),
            };
        } catch (e) {
            if (e instanceof Invalid) return fail(400, e.message);
            throw e;
        }
    }

    patch(key: string, body: unknown, token?: string): SceneResult<{ object: SceneObjectInfo }> {
        const w = this.writable(key, token);
        if (!w.ok) return w;
        const e = w.entry;
        try {
            const p = obj(body, 'body') as SceneObjectPatch;
            // Validate everything before changing anything.
            const next = {
                ttlMs: p.ttlMs !== undefined ? ttl(p.ttlMs) : e.ttlMs,
                view: p.view !== undefined ? view(p.view) : e.view,
                smoothMs: p.smoothMs !== undefined ? smooth(p.smoothMs) : e.smoothMs,
                placement: fields(p.placement, 'placement', PLACEMENT_FIELDS, e.placement),
                appearance: fields(p.appearance, 'appearance', APPEARANCE_FIELDS, e.appearance),
                content:
                    p.content !== undefined ? content(p.content, 'content', 0, { nodes: 0, points: 0 }) : undefined,
            };
            e.ttlMs = next.ttlMs;
            e.view = next.view;
            e.smoothMs = next.smoothMs;
            e.placement = next.placement;
            e.appearance = next.appearance;
            this.touch(e);
            if (next.content) {
                e.content = next.content;
                e.contentRev = e.rev;
            }
            return { ok: true, object: this.info(e) };
        } catch (err) {
            if (err instanceof Invalid) return fail(400, err.message);
            throw err;
        }
    }

    /** Renew the lease without changing anything viewers see. */
    keepalive(key: string, token?: string): SceneResult<{ expiresInMs: number }> {
        const w = this.writable(key, token);
        if (!w.ok) return w;
        w.entry.expiresAt = this.now() + w.entry.ttlMs;
        return { ok: true, expiresInMs: w.entry.ttlMs };
    }

    remove(key: string, token?: string): SceneResult<object> {
        const w = this.writable(key, token);
        if (!w.ok) return w;
        this.drop(w.entry);
        return { ok: true };
    }

    get(key: string): SceneObjectInfo | undefined {
        this.sweep();
        const e = this.entries.get(key);
        return e && this.info(e);
    }

    list(): SceneObjectInfo[] {
        this.sweep();
        return [...this.entries.values()].map((e) => this.info(e));
    }

    /** What changed after `since`; undefined when nothing did. */
    delta(since = 0, epoch?: string): SceneDelta | undefined {
        this.sweep();
        if ((epoch !== undefined && epoch !== this.epoch) || !(since >= 0) || since > this.rev) since = 0;
        else if (epoch === this.epoch && since === this.rev) return undefined;
        const objects: SceneObjectDelta[] = [];
        for (const e of this.entries.values()) {
            if (e.rev <= since) continue;
            const full = this.info(e);
            const d: SceneObjectDelta = {
                key: full.key,
                rev: full.rev,
                contentRev: full.contentRev,
                view: full.view,
                ...(full.smoothMs !== undefined ? { smoothMs: full.smoothMs } : {}),
                placement: full.placement,
                appearance: full.appearance,
            };
            if (e.contentRev > since) {
                d.content = full.content;
                d.assets = full.assets;
            }
            objects.push(d);
        }
        return { epoch: this.epoch, rev: this.rev, keys: [...this.entries.keys()], objects };
    }

    putAsset(key: string, name: string, bytes: Uint8Array, token?: string): SceneResult<{ asset: SceneAssetInfo }> {
        const w = this.writable(key, token);
        if (!w.ok) return w;
        const e = w.entry;
        const contentType = sceneAssetType(name);
        if (!contentType) return fail(400, `asset name must end in one of ${Object.keys(SCENE_ASSET_TYPES).join(' ')}`);
        if (bytes.byteLength > SCENE_MAX_ASSET_BYTES) return fail(413, `asset is over ${SCENE_MAX_ASSET_BYTES} bytes`);
        const prior = e.assets.get(name);
        if (!prior && e.assets.size >= SCENE_MAX_ASSETS_PER_OBJECT) {
            return fail(429, `more than ${SCENE_MAX_ASSETS_PER_OBJECT} assets on '${key}'`);
        }
        const total = this.assetBytes - (prior?.bytes.byteLength ?? 0) + bytes.byteLength;
        if (total > SCENE_MAX_TOTAL_ASSET_BYTES) return fail(507, 'asset store is full');
        this.assetBytes = total;
        this.touch(e);
        e.contentRev = e.rev;
        const asset: Asset = { bytes, info: { size: bytes.byteLength, rev: e.rev, contentType } };
        e.assets.set(name, asset);
        return { ok: true, asset: asset.info };
    }

    getAsset(key: string, name: string): { bytes: Uint8Array; info: SceneAssetInfo } | undefined {
        this.sweep();
        return this.entries.get(key)?.assets.get(name);
    }

    removeAsset(key: string, name: string, token?: string): SceneResult<object> {
        const w = this.writable(key, token);
        if (!w.ok) return w;
        const a = w.entry.assets.get(name);
        if (!a) return fail(404, `no asset '${name}' on '${key}'`);
        this.assetBytes -= a.bytes.byteLength;
        w.entry.assets.delete(name);
        this.touch(w.entry);
        w.entry.contentRev = w.entry.rev;
        return { ok: true };
    }
}
