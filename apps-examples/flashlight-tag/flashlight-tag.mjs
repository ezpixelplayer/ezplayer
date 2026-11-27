// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Flashlight tag, as an EZPlayer app.
 *
 * Two stick figures chase each other with flashlights around some trees in
 * the Show View while ghosts chase them both. The game plays itself; phones
 * (or show inputs) start and stop it and watch the score. While it runs the
 * figures, trees, beams and effects are scene objects on short leases, and the
 * sound effects go to an audio bus; both are released when it stops.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * Settings come from the instance's private data key "settings":
 *   plane     "ground" (in front of the layout, best in 3D) or "wall" (over it, best in 2D)
 *   center    [x, y, z] middle of the field; blank fits the layout
 *   size      field width in world units; blank fits the layout
 *   figure    figure height in world units; blank fits the layout
 *   bus       audio bus for the sound effects, default "immediate"; blank for silence
 *   volume    loudness of the sound effects, 0-1, default 0.6
 *   autoStart start the game as soon as the app starts
 */

import zlib from 'node:zlib';

const base = (process.env.EZP_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const instance = process.env.EZP_APP_INSTANCE;
const token = process.env.EZP_APP_TOKEN;
if (!instance || !token) {
    console.error('EZP_APP_INSTANCE and EZP_APP_TOKEN must be set (this program is started by the player)');
    process.exit(1);
}

const authHeaders = { 'x-ezp-app-token': token };
const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };
const appUrl = (path) => `${base}/api/ezp/apps/${encodeURIComponent(instance)}${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Object keys carry the instance name so two instances do not fight over the same objects.
const KEY_PREFIX = instance.replace(/[^A-Za-z0-9._~-]/g, '-').slice(0, 40);
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
const FIGURE_OBJ = Buffer.from(figureObj());
const TREE_ASSETS = { 'tree.obj': Buffer.from(treeObj()), 'tree.mtl': Buffer.from(TREE_MTL), 'tree.png': treePng() };
const GHOST_PNG = ghostPng();

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

const numberOr = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);

/** Where the field goes: from the settings, with anything left blank fitted to the layout. */
async function fitField(settings) {
    const wall = settings.plane === 'wall';
    const given =
        Array.isArray(settings.center) && settings.center.length === 3 && settings.center.every(Number.isFinite);
    const fit = given && settings.size && settings.figure ? undefined : await layoutBounds();
    const span = fit ? Math.max(fit.max[0] - fit.min[0], 100) : 400;
    const layoutHeight = fit ? fit.max[1] - fit.min[1] : 0;
    // On the ground a figure is person sized: about a fifth of a layout as tall as a house.
    const person = !wall && layoutHeight > 0 ? layoutHeight * 0.2 : undefined;
    const size = numberOr(settings.size, person ? Math.min(span, person * 14) : span);
    const HALF_V = wall ? size * 0.3 : size * 0.35;
    const center = given
        ? settings.center
        : fit
          ? wall
              ? [(fit.min[0] + fit.max[0]) / 2, (fit.min[1] + fit.max[1]) / 2, fit.max[2] + size * 0.02]
              : [(fit.min[0] + fit.max[0]) / 2, fit.min[1], fit.max[2] + HALF_V + size * 0.1]
          : [0, 0, 0];
    const H = numberOr(settings.figure, Math.min(person ?? Infinity, size * 0.11));
    return { wall, center, size, H };
}

// ---------------------------------------------------------------------------
// Game: state, rules, and the objects that show it
// ---------------------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function createGame({ wall, center, size, H }) {
    /** Field half extents: u runs along X, v along Z (ground) or Y (wall). */
    const HALF_U = size / 2;
    const HALF_V = wall ? size * 0.3 : size * 0.35;
    const BEAM_LENGTH = size * 0.42;
    const BEAM_HALF_ANGLE = 7;
    const SPEED = size * 0.22;
    const key = (name) => `${KEY_PREFIX}-${name}`;

    /** Field point (u, v) raised by `up` to world coordinates. */
    const world = (u, v, up = 0) =>
        wall ? [center[0] + u, center[1] + v + up, center[2]] : [center[0] + u, center[1] + up, center[2] + v];
    /** Field heading to a world direction. */
    const worldDir = (hu, hv) => (wall ? [hu, hv, 0] : [hu, 0, hv]);
    /** Rotation that turns a figure (built facing +Z) to a field heading. */
    const facing = (hu, hv) => (wall ? [0, hu >= 0 ? 90 : -90, 0] : [0, (Math.atan2(hu, hv) * 180) / Math.PI, 0]);

    const players = [
        {
            key: key('p1'),
            name: 'Blue',
            color: '#40b0ff',
            u: -HALF_U * 0.5,
            v: 0,
            hu: 1,
            hv: 0,
            stride: 0,
            spookedUntil: 0,
        },
        {
            key: key('p2'),
            name: 'Orange',
            color: '#ff7040',
            u: HALF_U * 0.5,
            v: 0,
            hu: -1,
            hv: 0,
            stride: 0,
            spookedUntil: 0,
        },
    ];
    const trees = [
        [-0.55, -0.55],
        [0.1, -0.35],
        [0.6, 0.5],
        [-0.3, 0.6],
    ].map(([u, v], i) => ({ key: key(`tree${i + 1}`), u: u * HALF_U, v: v * HALF_V, scale: H * rand(1.5, 2.1) }));
    const ghosts = ['#ffffff', '#b0ffb0', '#ffb0e0'].map((color, i) => ({
        key: key(`ghost${i + 1}`),
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
    /** Names of the sounds for what happened in the last step. */
    const sfx = [];
    let chasing = false;
    let now = 0;

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
        now = t;
        const chaser = players[it];
        const runner = players[1 - it];
        if (t >= countdownUntil && !chasing) sfx.push('go');
        chasing = t >= countdownUntil;

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
            if (!stunned && t >= countdownUntil && lit(chaser, g)) {
                g.stunnedUntil = t + 3;
                sfx.push('stun');
            }
            if (!stunned && to.d < H * 0.5) {
                target.spookedUntil = t + 2;
                g.stunnedUntil = t + 2;
                sfx.push('spook');
            }
        }

        if (t >= countdownUntil && t - burst.at > 0.8 && lit(chaser, runner, BEAM_LENGTH * 0.6)) {
            tags++;
            burst = { at: t, u: runner.u, v: runner.v, color: chaser.color };
            it = 1 - it;
            countdownUntil = t + 2.5;
            sfx.push('tag');
            console.log(`Tag ${tags}: ${chaser.name} caught ${runner.name}`);
        }
    }

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
            key: key('field'),
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
            key: key('it'),
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
            key: key('burst'),
            define: { content: burstPoints, smoothMs: 0, appearance: { additive: true, visible: false } },
            patch: {
                placement: { position: world(burst.u, burst.v, H * 0.6), scale: H * (0.3 + 2.2 * Math.sqrt(grow)) },
                appearance: { visible: showing, opacity: 1 - grow },
            },
        });
        list.push({
            key: key('ring'),
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

    /** The field as the phone page draws it: positions scaled to -1..1. */
    function snapshot() {
        const norm = (o) => ({ u: +(o.u / HALF_U).toFixed(3), v: +(o.v / HALF_V).toFixed(3) });
        return {
            tags,
            it: players[it].name,
            chasing,
            countdownMs: Math.max(0, Math.round((countdownUntil - now) * 1000)),
            players: players.map((p, i) => ({
                ...norm(p),
                hu: +p.hu.toFixed(3),
                hv: +p.hv.toFixed(3),
                name: p.name,
                color: p.color,
                it: i === it,
                spooked: now < p.spookedUntil,
            })),
            ghosts: ghosts.map((g) => ({ ...norm(g), color: g.color, stunned: now < g.stunnedUntil })),
            trees: trees.map(norm),
            aspect: +(HALF_V / HALF_U).toFixed(3),
        };
    }

    return { step, objects, sfx, snapshot, keys: objects(0).map((o) => o.key) };
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
// Sound effects: mono floats at 48 kHz, uploaded once as clips to a lease on
// an audio bus, then played by name
// ---------------------------------------------------------------------------

const RATE = 48000;
const TAU = Math.PI * 2;

/** `sec` of sound from fn(time, 0..1 through it), eased in and out so it cannot click. */
function sound(sec, fn) {
    const out = new Float32Array(Math.round(sec * RATE));
    for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        out[i] = fn(t, i / out.length) * Math.min(1, t / 0.003, (sec - t) / 0.005);
    }
    return new Uint8Array(out.buffer);
}

const CLIPS = {
    // The chase is on: two quick blips.
    go: sound(0.2, (t) => Math.sin(TAU * (t < 0.1 ? 660 : 990) * t) * 0.5 * (1 - ((t * 10) % 1)) ** 0.5),
    // Caught: a zap that falls, then three rising notes.
    tag: sound(0.6, (t) => {
        if (t < 0.18) return Math.sin(TAU * (1600 * t - 3200 * t * t)) * 0.6 * (1 - t / 0.18);
        const u = (t - 0.18) % 0.14;
        const hz = [523, 659, 784][Math.min(2, Math.floor((t - 0.18) / 0.14))];
        return Math.sin(TAU * hz * u) * 0.55 * Math.min(1, u / 0.003) * (1 - u / 0.14) ** 0.6;
    }),
    // A ghost caught in the beam: a falling, wavering whoop.
    stun: sound(0.5, (t, p) => Math.sin(TAU * (700 * t - 450 * t * t) + 3 * Math.sin(TAU * 9 * t)) * 0.4 * (1 - p)),
    // A ghost touches a player: a low shiver.
    spook: sound(0.7, (t, p) => Math.sin(TAU * 95 * t + 5 * Math.sin(TAU * 6 * t)) * 0.6 * Math.sin(Math.PI * p)),
};

async function audio(method, path, body) {
    const raw = body instanceof Uint8Array;
    const res = await fetch(`${base}/api/ezp/audio/${path}`, {
        method,
        headers: body ? { 'content-type': raw ? 'application/octet-stream' : 'application/json' } : undefined,
        body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 404) throw new Error(`${method} audio/${path}: ${res.status} ${await res.text()}`);
    return res.status === 404 ? undefined : await res.json();
}

/** The sound effects on one audio bus; a lease that ran out (say the player restarted) is made again. */
class Sounds {
    constructor(bus, volume) {
        this.bus = bus;
        this.volume = volume;
        this.lease = undefined;
        this.closed = false;
    }

    async open() {
        this.lease = undefined;
        const opened = await audio('POST', 'leases', {
            bus: this.bus,
            name: `flashlight-tag ${instance}`,
            sampleRate: RATE,
            channels: 1,
            encoding: 'f32le',
            gain: this.volume,
            ttlMs: 5000,
        });
        if (!opened) throw new Error('this player has no audio API');
        const at = `leases/${opened.lease.id}`;
        for (const [name, pcm] of Object.entries(CLIPS))
            await audio('PUT', `${at}/clips/${name}?token=${opened.lease.token}`, pcm);
        this.lease = { at, token: opened.lease.token };
        console.log(`Sound on audio bus ${opened.lease.bus} (${opened.lease.leadMs} ms lead)`);
    }

    async call(what, body) {
        if (!this.lease || this.closed) return;
        const reply = await audio('POST', `${this.lease.at}/${what}?token=${this.lease.token}`, body);
        if (!reply && !this.closed) await this.open();
    }

    play(clip) {
        void this.call('play', { clip }).catch(() => undefined);
    }

    keepalive() {
        void this.call('keepalive').catch(() => undefined);
    }

    async close() {
        this.closed = true;
        const l = this.lease;
        this.lease = undefined;
        if (l) await audio('DELETE', `${l.at}?token=${l.token}`).catch(() => undefined);
    }
}

// ---------------------------------------------------------------------------
// Player API: settings, events, status
// ---------------------------------------------------------------------------

async function loadSettings() {
    const res = await fetch(appUrl('/data/private/settings'), { headers: authHeaders });
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`settings: HTTP ${res.status}`);
    const s = (await res.json()) ?? {};
    const bus = typeof s.bus === 'string' ? s.bus.trim() : 'immediate';
    return {
        plane: s.plane === 'wall' ? 'wall' : 'ground',
        center: Array.isArray(s.center) ? s.center.map(Number) : undefined,
        size: Number(s.size) || undefined,
        figure: Number(s.figure) || undefined,
        bus,
        volume: Math.min(1, Math.max(0, Number(s.volume ?? 0.6))),
        audio: bus !== '' && s.audio !== false,
        autoStart: s.autoStart === true,
    };
}

async function publishStatus(status) {
    await fetch(appUrl('/status'), { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(status) }).catch(
        () => undefined,
    );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    let quit = false;
    const poll = new AbortController();
    const stop = () => {
        quit = true;
        poll.abort();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);

    let settings = null;
    let settingsError = '';
    let lastSettingsAt = -Infinity;
    let phase = 'idle'; // idle | playing
    let message = 'Starting up';
    let game = null;
    let sounds = null;
    let field = null;
    let startedBy = null;
    let pending = null; // 'start' | 'stop' asked for by an event
    let gameStart = 0;
    let lastTick = 0;
    let lastKeepalive = 0;
    const processStart = Date.now();

    const release = async () => {
        const g = game;
        const s = sounds;
        game = null;
        sounds = null;
        field = null;
        await Promise.allSettled([...(g ? g.keys.map((key) => send('DELETE', key)) : []), s?.close()]);
    };

    const startGame = async (who) => {
        await release();
        field = await fitField(settings);
        game = createGame(field);
        if (settings.audio) {
            sounds = new Sounds(settings.bus, settings.volume);
            try {
                await sounds.open();
            } catch (e) {
                console.log(`No sound: ${e.message}`);
                sounds = null;
            }
        }
        for (const o of game.objects(0)) await create(o);
        gameStart = Date.now();
        lastTick = 0;
        lastKeepalive = 0;
        startedBy = who;
        phase = 'playing';
        message = 'Playing';
        console.log(
            `Flashlight tag: ${field.wall ? 'wall' : 'ground'} field ${Math.round(field.size)} wide, figures ${Math.round(field.H)} tall, at [${field.center.map(Math.round).join(', ')}]`,
        );
    };

    const handleEvent = (ev) => {
        const d = ev?.data;
        const type = d?.type === 'input' ? d.input : d?.type;
        if (type === 'start' || type === 'stop')
            pending = { type, who: ev.source === 'cloud' || ev.source === 'lan' ? 'phone' : ev.source };
    };

    const pollEvents = async () => {
        let since = 0;
        while (!quit) {
            try {
                const res = await fetch(appUrl(`/events?since=${since}&wait=30`), {
                    headers: authHeaders,
                    signal: poll.signal,
                });
                if (!res.ok) throw new Error(`events: HTTP ${res.status}`);
                const { events = [] } = await res.json();
                for (const ev of events) {
                    since = Math.max(since, ev.id);
                    // Taps queued before this process started are stale.
                    if (ev.ts >= processStart - 2000) handleEvent(ev);
                }
            } catch (e) {
                if (quit) return;
                console.log(`events: ${e.message}`);
                await sleep(2000);
            }
        }
    };
    void pollEvents();

    let lastStatusJson = '';
    let lastStatusAt = 0;
    let autoStarted = false;

    while (!quit) {
        const now = Date.now();

        // Settings are re-read between games so the owner can move the field without a restart.
        if (phase !== 'playing' && now - lastSettingsAt > 5000) {
            lastSettingsAt = now;
            try {
                settings = await loadSettings();
                settingsError = '';
                if (settings.autoStart && !autoStarted && !pending) pending = { type: 'start', who: 'auto' };
                autoStarted = true;
            } catch (e) {
                settings = null;
                settingsError = `Player not reachable: ${e.message}`;
            }
        }

        if (pending) {
            const { type, who } = pending;
            pending = null;
            if (type === 'start' && phase !== 'playing' && settings) {
                try {
                    await startGame(who);
                } catch (e) {
                    message = `Could not start: ${e.message}`;
                    console.log(message);
                    await release();
                    phase = 'idle';
                }
            } else if (type === 'stop' && phase === 'playing') {
                await release();
                phase = 'idle';
                message = 'Stopped';
            }
        }

        if (phase === 'playing') {
            const t = (now - gameStart) / 1000;
            game.step(t, Math.min(0.2, t - lastTick));
            lastTick = t;
            const keepalive = t - lastKeepalive > 1;
            if (keepalive) lastKeepalive = t;
            // Sounds are asked for first and not waited on: they take longest to arrive.
            for (const clip of game.sfx.splice(0)) sounds?.play(clip);
            if (keepalive) sounds?.keepalive();
            try {
                await Promise.all(
                    game.objects(t).map(async (o) => {
                        // Things that never change just renew their lease now and then.
                        if (!o.patch && !keepalive) return;
                        const status = o.patch
                            ? await send('PATCH', o.key, o.patch)
                            : await send('POST', `${o.key}/keepalive`);
                        // A 404 means the lease ran out (say the player restarted): make it again.
                        if (status === 404 && !quit) await create(o);
                    }),
                );
                message = 'Playing';
            } catch (e) {
                message = `Player not reachable: ${e.message}`;
            }
        }

        const status = {
            phase,
            message: settingsError || message,
            startedBy: phase === 'playing' ? startedBy : null,
            runningMs: phase === 'playing' ? now - gameStart : 0,
            sound: Boolean(sounds?.lease),
            field: field
                ? { plane: field.wall ? 'wall' : 'ground', size: Math.round(field.size), figure: Math.round(field.H) }
                : null,
            game: game ? game.snapshot() : null,
        };
        const json = JSON.stringify(status);
        // The phone's map wants a few frames a second while playing; otherwise only changes, and a heartbeat.
        const due = phase === 'playing' ? 250 : 2000;
        if ((json !== lastStatusJson && now - lastStatusAt >= due) || now - lastStatusAt > 2000) {
            lastStatusJson = json;
            lastStatusAt = now;
            void publishStatus(status);
        }
        await sleep(phase === 'playing' ? TICK_MS : 250);
    }

    await release();
    await publishStatus({
        phase: 'idle',
        message: 'App stopped',
        startedBy: null,
        runningMs: 0,
        sound: false,
        field: null,
        game: null,
    });
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
