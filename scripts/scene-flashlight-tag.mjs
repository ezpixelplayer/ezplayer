#!/usr/bin/env node
/*
 * Flashlight tag: a scene objects client that plays a little game in a running
 * EZPlayer's Show View. Two stick figures chase each other with flashlights
 * around some trees while ghosts chase them both.
 *
 *   node scripts/scene-flashlight-tag.mjs [http://localhost:3000] [options]
 *
 *   --plane=ground   Play on the ground in front of the layout (default; best in 3D)
 *   --plane=wall     Play on the X/Y plane over the layout (best in 2D)
 *   --center=x,y,z   Middle of the field; default fits the layout
 *   --size=n         Field width in world units; default fits the layout
 *   --figure=n       Figure height in world units; default fits the layout
 *
 * It exercises uploaded meshes (figures, textured trees), uploaded images
 * (ghosts), beams, shapes, points, groups whose contents are replaced, leases,
 * keepalive and delete. Ctrl+C removes everything it made.
 */

import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/+$/, '');
const wall = opt('plane') === 'wall';
const TTL_MS = 3000;
const TICK_MS = 50;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function send(method, path, body, raw) {
    const res = await fetch(`${base}/api/ezp/objects/${path}`, {
        method,
        headers:
            body === undefined ? undefined : { 'content-type': raw ? 'application/octet-stream' : 'application/json' },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status;
}

// ---------------------------------------------------------------------------
// Generated assets
// ---------------------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

/** RGBA PNG from pixel(x, y) -> [r, g, b, a]. */
function png(width, height, pixel) {
    const rows = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const at = y * (1 + width * 4);
        for (let x = 0; x < width; x++) rows.set(pixel(x, y), at + 1 + x * 4);
    }
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const out = Buffer.alloc(8 + data.length + 4);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE(crc32(body), 8 + data.length);
        return out;
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0);
    head.writeUInt32BE(height, 4);
    head.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', head),
        chunk('IDAT', zlib.deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** A white ghost on a clear background; the object's color tints it. */
function ghostPng() {
    const W = 64;
    const H = 80;
    return png(W, H, (x, y) => {
        const u = (x + 0.5) / W - 0.5;
        const v = (y + 0.5) / H;
        const halfWidth = v < 0.4 ? 0.42 * Math.sqrt(Math.max(0, 1 - ((0.4 - v) / 0.38) ** 2)) : 0.42;
        const hem = 0.9 + 0.07 * Math.cos(u * Math.PI * 7);
        if (Math.abs(u) > halfWidth || v < 0.02 || v > hem) return [0, 0, 0, 0];
        const eye = Math.hypot((Math.abs(u) - 0.15) / 0.07, (v - 0.36) / 0.09) < 1;
        const mouth = Math.hypot(u / 0.06, (v - 0.56) / 0.07) < 1;
        if (eye || mouth) return [20, 20, 40, 255];
        const shade = 255 - Math.round(60 * Math.abs(u) * 2);
        return [shade, shade, 255, 235];
    });
}

/** Tree colors by height: trunk brown at the bottom, leaves darker to lighter going up. */
function treePng() {
    return png(16, 16, (_x, y) => {
        if (y >= 12) return [110, 70, 35, 255];
        return [30, 170 - y * 7, 40, 255];
    });
}

/** Collects OBJ geometry. */
function objBuilder() {
    const lines = [];
    let verts = 0;
    let uvs = 0;
    const api = {
        line: (s) => lines.push(s),
        /** Axis-aligned box; `v` is one texture row for all of it, when given. */
        box(cx, cy, cz, sx, sy, sz, v) {
            const first = verts + 1;
            for (const dz of [-1, 1])
                for (const dy of [-1, 1])
                    for (const dx of [-1, 1])
                        lines.push(`v ${cx + (dx * sx) / 2} ${cy + (dy * sy) / 2} ${cz + (dz * sz) / 2}`);
            verts += 8;
            let t = '';
            if (v !== undefined) {
                lines.push(`vt 0.5 ${v}`);
                t = `/${++uvs}`;
            }
            const quads = [
                [0, 2, 3, 1],
                [4, 5, 7, 6],
                [0, 1, 5, 4],
                [2, 6, 7, 3],
                [0, 4, 6, 2],
                [1, 3, 7, 5],
            ];
            for (const q of quads) lines.push(`f ${q.map((i) => `${first + i}${t}`).join(' ')}`);
        },
        /** Sphere of latitude and longitude bands. */
        ball(cx, cy, cz, r, seg = 10, rings = 6) {
            const first = verts + 1;
            for (let j = 0; j <= rings; j++) {
                const lat = (j / rings) * Math.PI;
                for (let i = 0; i < seg; i++) {
                    const lon = (i / seg) * 2 * Math.PI;
                    lines.push(
                        `v ${cx + r * Math.sin(lat) * Math.cos(lon)} ${cy + r * Math.cos(lat)} ${cz + r * Math.sin(lat) * Math.sin(lon)}`,
                    );
                }
            }
            verts += (rings + 1) * seg;
            for (let j = 0; j < rings; j++)
                for (let i = 0; i < seg; i++) {
                    const a = first + j * seg + i;
                    const b = first + j * seg + ((i + 1) % seg);
                    lines.push(`f ${a} ${b} ${b + seg} ${a + seg}`);
                }
        },
        /** Cone standing on y0 with its tip at y1; texture rows v0 at the rim, v1 at the tip. */
        cone(r, y0, y1, v0, v1, seg = 10) {
            const first = verts + 1;
            for (let i = 0; i < seg; i++) {
                const a = (i / seg) * 2 * Math.PI;
                lines.push(`v ${r * Math.cos(a)} ${y0} ${r * Math.sin(a)}`);
            }
            lines.push(`v 0 ${y1} 0`, `vt 0.5 ${v0}`, `vt 0.5 ${v1}`);
            verts += seg + 1;
            const rim = ++uvs;
            const tip = ++uvs;
            for (let i = 0; i < seg; i++)
                lines.push(`f ${first + ((i + 1) % seg)}/${rim} ${first + i}/${rim} ${first + seg}/${tip}`);
        },
        text: () => lines.join('\n') + '\n',
    };
    return api;
}

/** One unit tall, feet at the origin, facing +Z, flashlight held out in the right hand. */
function figureObj() {
    const o = objBuilder();
    o.ball(0, 0.9, 0, 0.1);
    o.box(0, 0.62, 0, 0.07, 0.36, 0.07);
    o.box(0, 0.77, 0, 0.3, 0.05, 0.05);
    o.box(0, 0.45, 0, 0.16, 0.05, 0.05);
    o.box(0.13, 0.74, 0.14, 0.05, 0.05, 0.3);
    o.box(0.13, 0.74, 0.33, 0.09, 0.09, 0.12);
    return o.text();
}

function treeObj() {
    const o = objBuilder();
    o.line('mtllib tree.mtl');
    o.line('usemtl tree');
    o.box(0, 0.15, 0, 0.12, 0.3, 0.12, 0.1);
    o.cone(0.38, 0.25, 0.7, 0.3, 0.6);
    o.cone(0.28, 0.55, 1.0, 0.55, 0.95);
    return o.text();
}

const TREE_MTL = 'newmtl tree\nKd 1 1 1\nmap_Kd tree.png\n';

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

/**
 * Extent of the node positions ({wX, wY, wZ}) found in a JSON value. The
 * outermost few percent are left out so a stray prop does not set the scale.
 */
function boundsOf(value) {
    const axes = [[], [], []];
    const walk = (v) => {
        if (!v || typeof v !== 'object') return;
        if (typeof v.wX === 'number' && typeof v.wY === 'number') {
            axes[0].push(v.wX);
            axes[1].push(v.wY);
            axes[2].push(typeof v.wZ === 'number' ? v.wZ : 0);
        }
        for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
    };
    walk(value);
    if (!axes[0].length) return undefined;
    for (const a of axes) a.sort((p, q) => p - q);
    const at = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
    return { min: axes.map((a) => at(a, 0.03)), max: axes.map((a) => at(a, 0.97)) };
}

async function layoutBounds() {
    try {
        const res = await fetch(`${base}/api/ezp/model-coordinates`);
        return res.ok ? boundsOf(await res.json()) : undefined;
    } catch {
        return undefined;
    }
}

const fit = opt('center') && opt('size') && opt('figure') ? undefined : await layoutBounds();
const span = fit ? Math.max(fit.max[0] - fit.min[0], 100) : 400;
const layoutHeight = fit ? fit.max[1] - fit.min[1] : 0;
// On the ground a figure is person sized: about a fifth of a layout as tall as a house.
const person = !wall && layoutHeight > 0 ? layoutHeight * 0.2 : undefined;
const size = Number(opt('size') ?? (person ? Math.min(span, person * 14) : span));
/** Field half extents: u runs along X, v along Z (ground) or Y (wall). */
const HALF_U = size / 2;
const HALF_V = wall ? size * 0.3 : size * 0.35;
const center =
    opt('center')?.split(',').map(Number) ??
    (fit
        ? wall
            ? [(fit.min[0] + fit.max[0]) / 2, (fit.min[1] + fit.max[1]) / 2, fit.max[2] + size * 0.02]
            : [(fit.min[0] + fit.max[0]) / 2, fit.min[1], fit.max[2] + HALF_V + size * 0.1]
        : [0, 0, 0]);

/** Figure height. */
const H = Number(opt('figure') ?? Math.min(person ?? Infinity, size * 0.11));
const BEAM_LENGTH = size * 0.42;
const BEAM_HALF_ANGLE = 7;

/** Field point (u, v) raised by `up` to world coordinates. */
const world = (u, v, up = 0) =>
    wall ? [center[0] + u, center[1] + v + up, center[2]] : [center[0] + u, center[1] + up, center[2] + v];
/** Field heading to a world direction. */
const worldDir = (hu, hv) => (wall ? [hu, hv, 0] : [hu, 0, hv]);
/** Rotation that turns a figure (built facing +Z) to a field heading. */
const facing = (hu, hv) => (wall ? [0, hu >= 0 ? 90 : -90, 0] : [0, (Math.atan2(hu, hv) * 180) / Math.PI, 0]);

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const SPEED = size * 0.22;
const players = [
    { key: 'tag-p1', color: '#40b0ff', u: -HALF_U * 0.5, v: 0, hu: 1, hv: 0, stride: 0, spookedUntil: 0 },
    { key: 'tag-p2', color: '#ff7040', u: HALF_U * 0.5, v: 0, hu: -1, hv: 0, stride: 0, spookedUntil: 0 },
];
const trees = [
    [-0.55, -0.55],
    [0.1, -0.35],
    [0.6, 0.5],
    [-0.3, 0.6],
].map(([u, v], i) => ({ key: `tag-tree${i + 1}`, u: u * HALF_U, v: v * HALF_V, scale: H * rand(1.5, 2.1) }));
const ghosts = ['#ffffff', '#b0ffb0', '#ffb0e0'].map((color, i) => ({
    key: `tag-ghost${i + 1}`,
    color,
    u: rand(-HALF_U, HALF_U),
    v: i % 2 ? HALF_V : -HALF_V,
    faceLeft: false,
    stunnedUntil: 0,
    phase: i * 2.1,
}));
/** Index of the player with the lit flashlight. */
let it = 0;
/** The chaser stands still until then, giving the other a head start. */
let countdownUntil = 1.5;
let tags = 0;
/** The last tag, for the effect. */
let burst = { at: -100, u: 0, v: 0, color: '#ffffff' };

/** Unit vector and length from a to b. */
function toward(a, b) {
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const d = Math.hypot(du, dv) || 1e-6;
    return { du: du / d, dv: dv / d, d };
}

/** True when b sits inside a's flashlight cone. */
function lit(a, b, reach = BEAM_LENGTH) {
    const t = toward(a, b);
    return t.d < reach && t.du * a.hu + t.dv * a.hv > Math.cos((BEAM_HALF_ANGLE * Math.PI) / 180);
}

function step(t, dt) {
    const chaser = players[it];
    const runner = players[1 - it];

    for (const p of players) {
        let wu = 0;
        let wv = 0;
        const other = p === chaser ? runner : chaser;
        const o = toward(p, other);
        if (p === chaser) {
            wu = o.du;
            wv = o.dv;
        } else {
            // Run away, curving sideways so the chase circles instead of ending in a corner.
            const side = Math.sin(t * 0.7 + tags) > 0 ? 1 : -1;
            wu = -o.du - o.dv * 0.6 * side;
            wv = -o.dv + o.du * 0.6 * side;
            for (const g of ghosts) {
                const away = toward(g, p);
                const push = Math.max(0, 1 - away.d / (H * 3));
                wu += away.du * push * 2;
                wv += away.dv * push * 2;
            }
        }
        // Stay on the field and go around the trees.
        wu -= Math.max(0, Math.abs(p.u) / HALF_U - 0.7) * 6 * Math.sign(p.u);
        wv -= Math.max(0, Math.abs(p.v) / HALF_V - 0.7) * 6 * Math.sign(p.v);
        for (const tree of trees) {
            const away = toward(tree, p);
            const push = Math.max(0, 1 - away.d / (H * 1.6));
            wu += (away.du - away.dv * 0.5) * push * 4;
            wv += (away.dv + away.du * 0.5) * push * 4;
        }
        const w = Math.hypot(wu, wv) || 1;
        // Turn toward the wanted heading; the chaser turns slower so its beam lags.
        const turn = Math.min(1, dt * (p === chaser ? 3.5 : 6));
        p.hu += (wu / w - p.hu) * turn;
        p.hv += (wv / w - p.hv) * turn;
        const h = Math.hypot(p.hu, p.hv) || 1;
        p.hu /= h;
        p.hv /= h;

        let speed = SPEED * (p === chaser ? 1 : 0.88);
        if (t < p.spookedUntil) speed *= 0.45;
        if (p === chaser && t < countdownUntil) speed = 0;
        if (t - burst.at < 0.8) speed = 0;
        p.u = clamp(p.u + p.hu * speed * dt, -HALF_U, HALF_U);
        p.v = clamp(p.v + p.hv * speed * dt, -HALF_V, HALF_V);
        p.stride += (speed / H) * dt * 4.5;
    }

    for (const g of ghosts) {
        const stunned = t < g.stunnedUntil;
        const target = players.reduce((a, b) => (toward(g, a).d < toward(g, b).d ? a : b));
        const to = toward(g, target);
        const dir = stunned ? -1.6 : 1;
        g.u = clamp(g.u + to.du * dir * SPEED * 0.42 * dt, -HALF_U * 1.15, HALF_U * 1.15);
        g.v = clamp(g.v + to.dv * dir * SPEED * 0.42 * dt, -HALF_V * 1.15, HALF_V * 1.15);
        g.faceLeft = to.du * dir < 0;
        if (!stunned && t >= countdownUntil && lit(chaser, g)) g.stunnedUntil = t + 3;
        if (!stunned && to.d < H * 0.5) {
            target.spookedUntil = t + 2;
            g.stunnedUntil = t + 2;
        }
    }

    if (t >= countdownUntil && t - burst.at > 0.8 && lit(chaser, runner, BEAM_LENGTH * 0.6)) {
        tags++;
        burst = { at: t, u: runner.u, v: runner.v, color: chaser.color };
        it = 1 - it;
        countdownUntil = t + 2.5;
        console.log(`Tag ${tags}: ${chaser.key} caught ${runner.key}`);
    }
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

const FIGURE_OBJ = Buffer.from(figureObj());
const TREE_ASSETS = { 'tree.obj': Buffer.from(treeObj()), 'tree.mtl': Buffer.from(TREE_MTL), 'tree.png': treePng() };
const GHOST_PNG = ghostPng();

/** A limb: a thin cylinder hanging from a joint, swung forward by `deg`. */
function limb(x, y, length, deg) {
    const a = (deg * Math.PI) / 180;
    return {
        content: { type: 'shape', shape: 'cylinder', size: [0.05, length, 0.05] },
        placement: {
            position: [x, y - (length / 2) * Math.cos(a), (-length / 2) * Math.sin(a)],
            rotation: [deg, 0, 0],
        },
    };
}

function limbs(p) {
    const swing = Math.sin(p.stride) * 40;
    return {
        type: 'group',
        children: [limb(-0.06, 0.45, 0.45, swing), limb(0.06, 0.45, 0.45, -swing), limb(-0.15, 0.77, 0.32, -swing)],
    };
}

const burstPoints = (() => {
    const positions = [];
    const colors = [];
    for (let i = 0; i < 160; i++) {
        const a = rand(0, 2 * Math.PI);
        const z = rand(-1, 1);
        const r = Math.sqrt(1 - z * z) * rand(0.6, 1);
        positions.push(r * Math.cos(a), r * Math.sin(a), z);
        colors.push(255, rand(170, 255), rand(60, 200));
    }
    return { type: 'points', positions, colors, size: 0.035, smooth: true };
})();

/**
 * Everything the game shows: what each object is, and what it looks like now.
 * `define` is sent at the start and whenever a lease was lost; `patch` each tick.
 */
function objects(t) {
    const list = [];
    const chaser = players[it];
    const sinceBurst = t - burst.at;
    const waiting = t < countdownUntil;

    list.push({
        key: 'tag-field',
        define: {
            content: { type: 'shape', shape: 'plane', size: [HALF_U * 2.3, HALF_V * 2.3, 1], wireframe: true },
            placement: { position: world(0, 0, wall ? 0 : -H * 0.02), rotation: wall ? [0, 0, 0] : [-90, 0, 0] },
            appearance: { color: '#305070', opacity: 0.6 },
        },
    });
    for (const tree of trees)
        list.push({
            key: tree.key,
            assets: TREE_ASSETS,
            define: {
                content: { type: 'mesh', asset: 'tree.obj' },
                placement: { position: world(tree.u, tree.v), scale: tree.scale },
            },
        });

    for (const p of players) {
        const isIt = p === chaser;
        const spooked = t < p.spookedUntil;
        // The one just caught blinks.
        const caught = sinceBurst < 0.8 && isIt;
        const color = caught && Math.floor(sinceBurst * 12) % 2 ? '#ffffff' : spooked ? '#a0c0a0' : p.color;
        const bob = Math.abs(Math.sin(p.stride)) * H * 0.04;
        const placement = { position: world(p.u, p.v, bob), rotation: facing(p.hu, p.hv), scale: H };
        list.push({
            key: p.key,
            assets: { 'figure.obj': FIGURE_OBJ },
            define: { content: { type: 'mesh', asset: 'figure.obj' } },
            patch: { placement, appearance: { color } },
        });
        // Replacing the group each tick is what moves the legs.
        list.push({
            key: `${p.key}-limbs`,
            define: {},
            patch: { content: limbs(p), placement, appearance: { color } },
        });
        // The beam leaves the flashlight, a little right of and ahead of the figure.
        const from = wall
            ? world(p.u + Math.sign(p.hu) * 0.38 * H, p.v, 0.74 * H + bob)
            : world(p.u + (p.hu * 0.38 + p.hv * 0.13) * H, p.v + (p.hv * 0.38 - p.hu * 0.13) * H, 0.74 * H + bob);
        list.push({
            key: `${p.key}-beam`,
            define: { content: { type: 'beam', length: BEAM_LENGTH, angle: BEAM_HALF_ANGLE, radius: H * 0.03 } },
            patch: {
                placement: { position: from, direction: worldDir(p.hu, p.hv) },
                appearance: {
                    visible: isIt,
                    color: waiting ? '#806040' : '#fff0c0',
                    opacity: waiting ? 0.35 : 1,
                },
            },
        });
    }

    // A spinning marker over whoever is it.
    list.push({
        key: 'tag-it',
        define: { content: { type: 'shape', shape: 'cone', size: [H * 0.18, H * 0.25, H * 0.18] } },
        patch: {
            placement: {
                position: world(chaser.u, chaser.v, H * (1.3 + 0.05 * Math.sin(t * 5))),
                rotation: [180, (t * 180) % 360, 0],
            },
            appearance: { color: waiting && Math.floor(t * 4) % 2 ? '#806000' : '#ffd000' },
        },
    });

    for (const g of ghosts) {
        const stunned = t < g.stunnedUntil;
        const height = H * (0.75 + 0.12 * Math.sin(t * 2.5 + g.phase));
        const at = world(g.u, g.v, height);
        // Ghosts stand a touch nearer the viewer than the players on the wall.
        if (wall) at[2] += size * 0.01;
        list.push({
            key: g.key,
            assets: { 'ghost.png': GHOST_PNG },
            define: { content: { type: 'image', asset: 'ghost.png', height: H * 1.1 } },
            patch: {
                placement: { position: at, scale: [g.faceLeft ? -1 : 1, 1, 1] },
                appearance: { color: g.color, opacity: stunned ? 0.2 : 0.75 + 0.2 * Math.sin(t * 3 + g.phase) },
            },
        });
    }

    // The tag effect: sparks and a glow that grow and fade.
    const grow = clamp(sinceBurst / 1.2, 0, 1);
    const showing = sinceBurst < 1.2;
    list.push({
        key: 'tag-burst',
        define: { content: burstPoints, smoothMs: 0, appearance: { additive: true, visible: false } },
        patch: {
            placement: { position: world(burst.u, burst.v, H * 0.6), scale: H * (0.3 + 2.2 * Math.sqrt(grow)) },
            appearance: { visible: showing, opacity: 1 - grow },
        },
    });
    list.push({
        key: 'tag-ring',
        define: {
            content: { type: 'shape', shape: 'sphere' },
            smoothMs: 0,
            appearance: { additive: true, visible: false },
        },
        patch: {
            placement: { position: world(burst.u, burst.v, H * 0.6), scale: H * (0.2 + 3 * grow) },
            appearance: { visible: showing, color: burst.color, opacity: (1 - grow) * 0.35 },
        },
    });
    return list;
}

/** Create an object in its current state and upload its files. */
async function create(o) {
    const patch = o.patch ?? {};
    const body = {
        ttlMs: TTL_MS,
        ...o.define,
        ...patch,
        appearance: { ...o.define.appearance, ...patch.appearance },
    };
    await send('PUT', o.key, body);
    for (const [name, bytes] of Object.entries(o.assets ?? {}))
        await send('PUT', `${o.key}/assets/${name}`, bytes, true);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const keys = objects(0).map((o) => o.key);
let stopping = false;
process.on('SIGINT', async () => {
    if (stopping) process.exit(1);
    stopping = true;
    await Promise.allSettled(keys.map((key) => send('DELETE', key)));
    process.exit(0);
});

for (const o of objects(0)) await create(o);
console.log(
    `Flashlight tag on ${base}: ${wall ? 'wall' : 'ground'} field ${Math.round(size)} wide, figures ${Math.round(H)} tall, at [${center.map(Math.round).join(', ')}]. Ctrl+C to stop.`,
);

const start = Date.now();
let last = 0;
let lastKeepalive = 0;
while (!stopping) {
    const t = (Date.now() - start) / 1000;
    step(t, Math.min(0.2, t - last));
    last = t;
    const keepalive = t - lastKeepalive > 1;
    if (keepalive) lastKeepalive = t;
    await Promise.all(
        objects(t).map(async (o) => {
            // Things that never change just renew their lease now and then.
            if (!o.patch && !keepalive) return;
            const status = o.patch ? await send('PATCH', o.key, o.patch) : await send('POST', `${o.key}/keepalive`);
            // A 404 means the lease ran out (say the player restarted): make it again.
            if (status === 404 && !stopping) await create(o);
        }),
    );
    await new Promise((r) => setTimeout(r, TICK_MS));
}
