// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Overlay Effects, as an EZPlayer app.
 *
 * Paints effects onto the submodels of the chosen models (or onto a model
 * itself when it has none) through one overlay lease per target, and reports
 * the frame rate it achieves. The effects and the geometry are ported from
 * scripts/overlay-submodels.mjs; each target gets an effect by a seeded random
 * choice from the enabled ones, unless the owner pins one.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * Settings come from the instance's private data key "settings".
 */

import dgram from 'node:dgram';

const base = (process.env.EZP_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
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

const TTL_MS = 15_000;
const WINDOW_MS = 2000; // the rate readouts cover the last two seconds
const SETTINGS_EVERY_MS = 5000;
const OPEN_CONCURRENCY = 8;
const PLAN_CONCURRENCY = 4;
const HTTP_IN_FLIGHT = 16;
// The player takes a status of up to 4 MB; a row per target stays under that up to about 20000 targets.
// The rows ride along only when the list changed, and every few seconds for pages that joined late.
/** A model row is about 150 bytes; the player takes a status of up to 4 MB. */
const STATUS_MODELS_MAX = 5000;
const TARGETS_RESEND_MS = 10_000;

// ---------------------------------------------------------------------------
// Overlay API
// ---------------------------------------------------------------------------

async function api(method, path, body) {
    const res = await fetch(`${base}/api/ezp/overlays${path}`, {
        method,
        headers: body ? { ...authHeaders, 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    // Leases live on the player's frame pipeline, which exists only while it plays (songs or idle frames).
    if (res.status === 503)
        throw new Error('The player is not playing, so there are no frames to paint on. Start the show in EZPlayer.');
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return JSON.parse(text);
}

const udpHost = new URL(base).hostname;
let sock = null;
let udpPort = 0;

/** One payload as overlay packets (see the API reference: UDP payload packets). */
function sendUdp(l, seq) {
    const payload = l.payload;
    const pending = [];
    for (let off = 0; off < payload.length; off += 1400) {
        const data = payload.subarray(off, Math.min(payload.length, off + 1400));
        const p = Buffer.alloc(24 + data.length);
        p.writeUInt32BE(0x455a4f31, 0);
        p.writeUInt32BE(l.lease.id, 4);
        p.writeUInt32BE(l.lease.token, 8);
        p.writeUInt32BE(seq, 12);
        p.writeUInt8(off + data.length === payload.length ? 1 : 0, 16);
        p.writeUInt32BE(off, 17);
        p.writeUInt16BE(data.length, 21);
        p.set(data, 24);
        pending.push(
            new Promise((r) =>
                sock.send(p, udpPort, udpHost, (err) => {
                    // Handed to the socket counts: the payload renews the lease, so no keepalive is needed.
                    if (err) l.errors++;
                    else l.lastAck = performance.now();
                    r();
                }),
            ),
        );
    }
    return Promise.all(pending);
}

// Thousands of requests landing at once make the player slow for everyone else and
// crowd out this app's own status write; a few at a time costs no frame rate (measured).
let httpActive = 0;
const httpQueue = [];
async function limited(fn) {
    if (httpActive >= HTTP_IN_FLIGHT) await new Promise((r) => httpQueue.push(r));
    httpActive++;
    try {
        return await fn();
    } finally {
        httpActive--;
        httpQueue.shift()?.();
    }
}

async function sendHttp(l, seq) {
    const res = await limited(() =>
        fetch(`${base}/api/ezp/overlays/${l.lease.id}/frame?token=${l.lease.token}&seq=${seq}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body: l.payload,
        }).catch(() => null),
    );
    if (res?.ok) l.lastAck = performance.now();
    else l.errors++;
}

// ---------------------------------------------------------------------------
// Color and randomness
// ---------------------------------------------------------------------------

function hsv(h, s, v) {
    h = Number.isFinite(h) ? ((h % 1) + 1) % 1 : 0;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const [r, g, b] = [
        [v, t, p],
        [q, v, p],
        [p, v, t],
        [p, q, v],
        [t, p, v],
        [v, p, q],
    ][i % 6];
    return [r * 255, g * 255, b * 255];
}
const frac = (v) => v - Math.floor(v);
/** Repeatable noise in 0..1. */
const noise = (a, b) => frac(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

/** A seeded generator (mulberry32) so the effect draw is the same for the same seed. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Each node's place on the plane its target mostly lies in, and that plane's size. */
function flatten(xyz) {
    const n = xyz.length / 3;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < xyz.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3], xyz[i]);
        hi[i % 3] = Math.max(hi[i % 3], xyz[i]);
    }
    const wide = [0, 1, 2].sort((a, b) => hi[b] - lo[b] - (hi[a] - lo[a])).slice(0, 2);
    // Y is up: keep it as the picture's vertical when the plane has it.
    const [ua, va] = wide.includes(1) ? [wide.find((a) => a !== 1), 1] : [0, 2];
    const pts = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        pts[i * 2] = xyz[i * 3 + ua] - lo[ua];
        pts[i * 2 + 1] = xyz[i * 3 + va] - lo[va];
    }
    return { n, pts, w: Math.max(1e-6, hi[ua] - lo[ua]), h: Math.max(1e-6, hi[va] - lo[va]) };
}

/**
 * The payload cells of a target in the lease format it takes, each with its
 * strand and place along it (s, i), its place on the target's plane (u, v in
 * 0..1) and its byte offset, plus per-strand shape for the strand effects.
 * Buffer rows (or columns) are the strands of a submodel; grid rows are the
 * strands of a matrix; a nodes payload is split by the target's strand list.
 */
function buildGeo(t, format) {
    const xyz = t.nodes?.local ?? t.nodes?.world;
    const flat = xyz?.length ? flatten(xyz) : null;
    const cells = [];
    let width;
    let height;
    const place = (node, gx, gy, gw, gh) => {
        if (flat) {
            const px = flat.pts[node * 2];
            const py = flat.pts[node * 2 + 1];
            return { px, py, u: px / flat.w, v: py / flat.h };
        }
        return { px: gx, py: gy, u: (gx + 0.5) / gw, v: (gy + 0.5) / gh };
    };
    if (format === 'grid') {
        // A grid payload is resampled onto the model, so its own x, y are the geometry.
        width = t.width;
        height = t.height;
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const py = height - 1 - y;
                cells.push({
                    offset: (y * width + x) * 3,
                    s: y,
                    i: x,
                    px: x,
                    py,
                    u: (x + 0.5) / width,
                    v: (py + 0.5) / height,
                });
            }
    } else if (format === 'buffer') {
        width = t.buffer.width;
        height = t.buffer.height;
        const c = t.nodes.cells;
        for (let k = 0; k < c.length; k += 3) {
            const [node, x, y] = [c[k], c[k + 1], c[k + 2]];
            cells.push({
                offset: ((height - 1 - y) * width + x) * 3,
                s: t.vertical ? x : y,
                i: t.vertical ? y : x,
                ...place(node, x, y, width, height),
            });
        }
    } else {
        width = t.nodeCount;
        height = 1;
        const strands = t.strands?.length ? [...t.strands] : [];
        let node = 0;
        for (let s = 0; node < t.nodeCount; s++) {
            const len = s < strands.length ? strands[s] : t.nodeCount - node;
            for (let i = 0; i < len && node < t.nodeCount; i++, node++)
                cells.push({ offset: node * 3, s, i, ...place(node, node, 0, t.nodeCount, 1) });
        }
    }
    const plane = flat && format !== 'grid' ? { w: flat.w, h: flat.h } : { w: width, h: height };
    return { format, width, height, n: t.nodeCount, cells, plane, ...strandStats(cells) };
}

/** For each strand: its direction, its angle around the center and its distance from it, and ranks by each. */
function strandStats(cells) {
    let count = 0;
    let cx = 0;
    let cy = 0;
    for (const c of cells) {
        count = Math.max(count, c.s + 1);
        cx += c.px / cells.length;
        cy += c.py / cells.length;
    }
    const strands = Array.from({ length: count }, () => ({ at: [], len: 0 }));
    let far = 1e-6;
    for (const c of cells) {
        const px = c.px - cx;
        const py = c.py - cy;
        const r = Math.hypot(px, py);
        far = Math.max(far, r);
        strands[c.s].at.push({ i: c.i, px, py, r });
        strands[c.s].len = Math.max(strands[c.s].len, c.i + 1);
    }
    const used = strands.filter((s) => s.at.length > 0);
    for (const s of strands) {
        s.rank = s.angleRank = s.radiusRank = 0;
        if (!s.at.length) {
            Object.assign(s, { span: 0, radius: 0, outward: true, angle: 0 });
            continue;
        }
        s.at.sort((a, b) => a.i - b.i);
        const first = s.at[0];
        const last = s.at[s.at.length - 1];
        let rmin = Infinity;
        let rmax = -Infinity;
        let rsum = 0;
        let mx = 0;
        let my = 0;
        for (const p of s.at) {
            rmin = Math.min(rmin, p.r);
            rmax = Math.max(rmax, p.r);
            rsum += p.r;
            mx += p.px / s.at.length;
            my += p.py / s.at.length;
        }
        s.span = (rmax - rmin) / far;
        s.radius = rsum / s.at.length;
        s.outward = last.r >= first.r;
        s.angle = Math.atan2(my, mx) / (Math.PI * 2) + 0.5;
    }
    const rankBy = (key, field) => [...used].sort((a, b) => a[key] - b[key]).forEach((s, k) => (s[field] = k));
    used.forEach((s, k) => (s.rank = k));
    rankBy('angle', 'angleRank');
    rankBy('radius', 'radiusRank');
    const span = used.reduce((a, s) => a + s.span, 0) / Math.max(1, used.length);
    return { strands, used: used.length, concentric: used.length >= 2 && span < 0.25 };
}

// ---------------------------------------------------------------------------
// Effects: each make(geo, hue) returns paint(t, payload)
// ---------------------------------------------------------------------------

/** Paint cell by cell; `pixel` gets the cell and its strand. */
function byCell(geo, pixel) {
    const { cells, strands } = geo;
    return (t, out) => {
        for (let k = 0; k < cells.length; k++) {
            const c = cells[k];
            out.set(pixel(t, c, strands[c.s]), c.offset);
        }
    };
}

/** Night sky, falling snow, a drift on the ground and a little tree, as a width x height picture. */
function snowScene(width, height) {
    const flakes = Array.from({ length: Math.ceil(width * 0.9) }, (_, n) => ({
        x: noise(n, 1) * width,
        y: noise(n, 2) * height,
        speed: 2.5 + noise(n, 3) * 4,
        sway: noise(n, 4) * 6,
    }));
    const cx = Math.floor(width / 2);
    const top = Math.floor(height * 0.25);
    const ground = (x) => height - 3 - Math.round(Math.sin((x / width) * Math.PI) * 1.5);
    return (t, out) => {
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let c = [0, 8 + 22 * (y / height), 50 + 40 * (y / height)];
                // Tree: a triangle of green rows over a brown trunk.
                const row = y - top;
                const half = Math.floor(row / 2) + 1;
                if (row >= 0 && y < ground(cx) - 1 && Math.abs(x - cx) <= half) {
                    c = [0, 120 + 60 * noise(x, y), 20];
                    // Lights on the tree blink in turn.
                    if (noise(x * 3, y * 7) > 0.78) c = hsv(noise(x, y) + Math.floor(t * 2) * 0.17, 1, 1);
                }
                if (x === cx && y >= ground(cx) - 1 && y < ground(cx)) c = [110, 60, 20];
                if (x === cx && y === top - 1) c = [255, 220, 0].map((ch) => ch * (0.6 + 0.4 * Math.sin(t * 6)));
                if (y >= ground(x)) c = [200, 215, 255];
                out.set(c, (y * width + x) * 3);
            }
        }
        for (const f of flakes) {
            const y = Math.floor((f.y + t * f.speed) % height);
            const x = Math.floor((f.x + Math.sin(t * 1.3 + f.sway) * 1.5 + width) % width);
            if (y < ground(x)) out.set([255, 255, 255], (y * width + x) * 3);
        }
    };
}

/** The snow scene on any target: drawn as a picture, then read where each cell's node is. */
function sceneByPosition(geo) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
    const { w, h } = geo.plane;
    const height = clamp(Math.sqrt((geo.n * h) / w), 10, 64);
    const width = clamp((height * w) / h, 10, 96);
    const picture = new Uint8Array(width * height * 3);
    const draw = snowScene(width, height);
    const from = geo.cells.map((c) => {
        const x = Math.min(width - 1, Math.floor(c.u * width));
        const y = Math.min(height - 1, Math.floor((1 - c.v) * height));
        return (y * width + x) * 3;
    });
    return (t, out) => {
        draw(t, picture);
        for (let k = 0; k < from.length; k++) out.set(picture.subarray(from[k], from[k] + 3), geo.cells[k].offset);
    };
}

/** A pattern over a face from each cell's place on it. */
const face = (pattern) => (geo, hue) => byCell(geo, (t, c) => pattern(c.u, c.v, t, hue));

const EFFECTS = {
    comets: {
        title: 'Comets',
        about: 'A comet runs out along each strand, alternate strands half a beat apart',
        make: (geo, hue) =>
            byCell(geo, (t, c, s) => {
                const along = s.outward ? c.i : s.len - 1 - c.i;
                const head = frac(t * 0.7 + (s.angleRank % 2) * 0.5) * (s.len + 4);
                const d = head - along;
                const tail = d >= 0 && d < 5 ? 1 - d / 5 : 0;
                return hsv(hue + s.angle * 0.3 + t * 0.05, 1 - tail * 0.6, 0.12 + 0.88 * tail);
            }),
    },
    sweep: {
        title: 'Radar sweep',
        about: 'A bright sector sweeps around the strands',
        make: (geo, hue) =>
            byCell(geo, (t, c, s) => {
                const glow = Math.max(0, 1 - frac(s.angle - t * 0.35) * 3);
                return hsv(hue + c.i / (s.len * 3), 0.9, 0.08 + 0.92 * glow * glow);
            }),
    },
    rings: {
        title: 'Marching rings',
        about: 'Each strand is one color and the colors march from strand to strand',
        make: (geo, hue) =>
            byCell(geo, (t, c, s) => {
                const rank = geo.concentric ? s.radiusRank : s.rank;
                return hsv(hue + rank / Math.max(3, geo.used) - t * 0.25, 1, 0.5 + 0.5 * Math.sin(t * 4 - rank * 1.3));
            }),
    },
    twinkle: {
        title: 'Twinkle',
        about: 'Icy sparkle',
        make: (geo) =>
            byCell(geo, (t, c, s) => {
                const phase = noise(s.rank + 1, c.i + 1);
                const v = Math.pow(Math.max(0, Math.sin((t * (0.6 + phase) + phase) * Math.PI * 2)), 6);
                return [120 + 135 * v, 170 + 85 * v, 255].map((ch) => ch * (0.15 + 0.85 * v));
            }),
    },
    snow: {
        title: 'Snow scene',
        about: 'Night sky, falling snow, a drift and a little tree, drawn where the nodes are',
        make: (geo) => sceneByPosition(geo),
    },
    waves: {
        title: 'Waves',
        about: 'Hue and brightness ripple across the face',
        make: face((u, v, t, hue) =>
            hsv(
                hue + 0.12 * Math.sin(u * 7 + t * 2) + 0.12 * Math.sin(v * 6 - t * 1.4),
                1,
                0.35 + 0.65 * frac(Math.sin(u * 5 + t) + Math.cos(v * 5 - t) + 2),
            ),
        ),
    },
    rainbow: {
        title: 'Rainbow',
        about: 'A diagonal rainbow slides across the face',
        make: face((u, v, t, hue) => hsv(hue + (u + v) * 0.7 - t * 0.3, 1, 1)),
    },
    ripple: {
        title: 'Ripple',
        about: 'Rings spread from the center',
        make: face((u, v, t, hue) =>
            hsv(hue + 0.4, 1, 0.5 + 0.5 * Math.sin(Math.hypot(u - 0.5, v - 0.5) * 30 - t * 6)),
        ),
    },
    checker: {
        title: 'Checkerboard',
        about: 'A two-color checkerboard that flips twice a second',
        make: face((u, v, t, hue) =>
            (Math.floor(u * 5) + Math.floor(v * 5) + Math.floor(t * 2)) % 2 ? hsv(hue, 1, 1) : hsv(hue + 0.5, 1, 0.8),
        ),
    },
    stripes: {
        title: 'Stripes',
        about: 'Slanted bright stripes roll over the face',
        make: face((u, v, t, hue) => hsv(hue + 0.1 * Math.sin(t), 1, Math.abs(Math.sin(v * 12 + u * 4 - t * 4)))),
    },
    chase: {
        title: 'Chase',
        about: 'Three shades chase along each strand',
        make: (geo, hue) => {
            const palette = [hsv(hue, 1, 1), hsv(hue + 0.08, 0.3, 1), hsv(hue + 0.5, 1, 0.5)];
            return byCell(geo, (t, c) => palette[Math.floor(frac(c.i / 9 - t * 0.5) * palette.length)]);
        },
    },
};
const EFFECT_NAMES = Object.keys(EFFECTS);
const dark = (t, out) => out.fill(0);

// ---------------------------------------------------------------------------
// Settings and the plan
// ---------------------------------------------------------------------------

const BLENDS = ['replace', 'max', 'underlay', 'add', 'subtract', 'multiply', 'screen', 'alpha', 'min'];

function normalize(s) {
    const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    return {
        models: Array.isArray(s.models) ? s.models.filter((m) => typeof m === 'string' && m) : [],
        fps: Math.min(60, Math.max(1, Number(s.fps) || 20)),
        blend: BLENDS.includes(s.blend) ? s.blend : 'replace',
        useUdp: s.useUdp === true,
        seed: Number.isFinite(Number(s.seed)) ? Math.floor(Number(s.seed)) >>> 0 : 1234,
        effects: obj(s.effects),
        pins: obj(s.pins),
        autoStart: s.autoStart === true,
    };
}

/** The lease format a target takes: its grid for a matrix, otherwise its render buffer, else plain nodes. */
function formatFor(t) {
    if (!t.subModel && t.width && t.height) return 'grid';
    if (t.buffer && t.nodes?.cells?.length) return 'buffer';
    return 'nodes';
}

/** The targets of the chosen models: their submodels, or the model itself when it has none. */
async function plan(settings) {
    const all = (await api('GET', '/targets')).targets;
    const targets = [];
    const missing = settings.models.filter((name) => !all.some((m) => m.model === name));
    const present = settings.models.filter((name) => !missing.includes(name));
    // Per-node detail is a big answer per model; a few in flight at once, and the page sees the count climb.
    const rowsOf = new Map();
    let done = 0;
    await pool(present, PLAN_CONCURRENCY, async (name) => {
        working = `Reading ${done + 1} of ${present.length} models...`;
        rowsOf.set(name, (await api('GET', `/targets?model=${encodeURIComponent(name)}&detail=nodes`)).targets);
        done++;
    });
    working = '';
    for (const name of present) {
        const rows = rowsOf.get(name) ?? [];
        const subs = rows.filter((r) => r.subModel && r.nodeCount > 0);
        for (const r of subs.length ? subs : rows.filter((r) => !r.subModel && r.nodeCount > 0)) {
            const format = formatFor(r);
            const geo = buildGeo(r, format);
            const w = r.nodes?.world ?? [];
            let x = 0;
            for (let i = 0; i < w.length; i += 3) x += w[i] / (w.length / 3);
            targets.push({
                target: r.target ?? r.model,
                model: r.model,
                subModel: r.subModel ?? null,
                kind: r.kind,
                nodes: r.nodeCount,
                format,
                width: geo.width,
                height: geo.height,
                geo,
                x,
            });
        }
    }
    // A stable order keeps the seeded draw the same from run to run.
    targets.sort((a, b) => a.target.localeCompare(b.target));
    // Hue runs across the yard.
    const lo = Math.min(...targets.map((j) => j.x));
    const hi = Math.max(...targets.map((j) => j.x));
    for (const j of targets) j.hue = hi > lo ? (0.85 * (j.x - lo)) / (hi - lo) : 0.55;
    return { targets, missing };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let quit = false;
let phase = 'idle'; // idle | running
let wanted = 'idle';
let restartAsked = false;
let busy = false; // leases being opened or released

let settings = null;
let settingsJson = '';
let settingsError = 'Starting up';
let lastSettingsCheck = -Infinity;
let autoStartDone = false;

let planned = [];
let planError = '';
let missing = [];
/** Overrides from events: a new seed from reshuffle, pins from setEffect ('' unpins). Reset when settings change. */
let runtime = { seed: 1234, pins: {} };

let live = [];
let loopPromise = null;
let message = '';
/** Bumps whenever the model list or its effects change, so a page knows when to redraw the table. */
let modelsRev = 0;
/** What the app is in the middle of (reading models, opening leases); shown over everything else while set. */
let working = '';

function newStats(targetFps) {
    return { targetFps, started: performance.now(), frames: 0, late: 0, window: [] };
}
let stats = newStats(0);
/** How late setTimeout fires here; Windows ticks at about 15.6 ms, Linux and macOS near 1 ms. */
let timerTickMs = 1;

async function measureTimerTick() {
    const gaps = [];
    for (let k = 0; k < 7; k++) {
        const t = performance.now();
        await sleep(1);
        gaps.push(performance.now() - t);
    }
    gaps.sort((a, b) => a - b);
    return Math.max(1, gaps[3]);
}

function painter(tg) {
    return tg.effect ? EFFECTS[tg.effect].make(tg.geo, tg.hue) : dark;
}

/** Gives every planned target its effect; running targets switch painters in place. */
/** A pin names a target or its whole model; a runtime change (from the settings page) wins over the saved one. */
function pinFor(tg) {
    for (const key of [tg.target, tg.model]) {
        if (key in runtime.pins) return runtime.pins[key];
        if (key in settings.pins) return settings.pins[key];
    }
    return undefined;
}

function assign() {
    if (!settings) return;
    modelsRev++;
    const enabled = EFFECT_NAMES.filter((n) => settings.effects[n] !== false);
    const rand = rng(runtime.seed);
    for (const tg of planned) {
        // Draw for every target so pinning one does not reshuffle the others.
        const pick = enabled.length ? enabled[Math.floor(rand() * enabled.length)] : null;
        const pin = pinFor(tg);
        tg.pinned = Boolean(pin && EFFECTS[pin]);
        tg.effect = tg.pinned ? pin : pick;
    }
    for (const l of live) {
        if (l.effect === l.tg.effect) continue;
        l.effect = l.tg.effect;
        l.paint = painter(l.tg);
    }
}

async function replan() {
    try {
        const p = await plan(settings);
        planned = p.targets;
        missing = p.missing;
        planError = '';
    } catch (e) {
        planned = [];
        missing = [];
        planError = e.message;
    }
    working = '';
    assign();
}

async function refreshSettings() {
    try {
        const res = await fetch(appUrl('/data/private/settings'), { headers: authHeaders });
        if (res.status !== 404 && !res.ok) throw new Error(`settings: HTTP ${res.status}`);
        const raw = res.status === 404 ? {} : ((await res.json()) ?? {});
        const next = normalize(raw);
        const json = JSON.stringify(next);
        if (json !== settingsJson) {
            settingsJson = json;
            settings = next;
            runtime = { seed: next.seed, pins: {} };
            await replan();
        } else if (planError) {
            // The player may have been loading its layout; try again.
            await replan();
        }
        settingsError = settings.models.length ? '' : 'Not configured: open the app settings and pick a model.';
        if (!autoStartDone) {
            autoStartDone = true;
            if (settings.autoStart && settings.models.length) wanted = 'running';
        }
    } catch (e) {
        settingsError = `Player not reachable: ${e.message}`;
    }
}

async function pool(items, size, fn) {
    let k = 0;
    const worker = async () => {
        while (k < items.length && !quit) await fn(items[k++]);
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

async function releaseAll() {
    const gone = live;
    live = [];
    await Promise.allSettled(gone.map((l) => api('DELETE', `/${l.lease.id}?token=${l.lease.token}`)));
    if (gone.length) console.log(`closed ${gone.length} leases`);
}

async function startRun() {
    if (!settings?.models.length) return void (message = settingsError);
    if (!planned.length) return void (message = planError || 'No targets: none of the chosen models is in the layout.');
    const todo = planned.filter((tg) => tg.effect);
    if (!todo.length) return void (message = 'Enable at least one effect in the app settings.');
    busy = true;
    const openingFrom = performance.now();
    try {
        if (settings.useUdp && !sock) sock = dgram.createSocket('udp4');
        // Opened leases are live at once so the keepalive timer renews them while the rest open.
        const opened = [];
        const skipped = [];
        live = opened;
        await pool(todo, OPEN_CONCURRENCY, async (tg) => {
            working = `Opening leases: ${opened.length + skipped.length} of ${todo.length}...`;
            try {
                // An effect is decoration: it layers over whatever else paints the model and never blocks a game.
                const body = {
                    model: tg.target,
                    format: tg.format,
                    mode: 'layer',
                    blend: settings.blend,
                    ttlMs: TTL_MS,
                    name: 'overlay-effects',
                };
                if (tg.format !== 'nodes') Object.assign(body, { width: tg.width, height: tg.height });
                // 'max' keeps a node lit when any strand crossing it is lit.
                if (tg.format === 'buffer') body.overlap = 'max';
                const res = await api('POST', '', body);
                udpPort = res.udpPort;
                const expected = (tg.format === 'nodes' ? tg.nodes : tg.width * tg.height) * 3;
                if (res.lease.frameBytes !== expected) {
                    await api('DELETE', `/${res.lease.id}?token=${res.lease.token}`).catch(() => undefined);
                    throw new Error(`lease takes ${res.lease.frameBytes} bytes, painter makes ${expected}`);
                }
                opened.push({
                    tg,
                    lease: res.lease,
                    effect: tg.effect,
                    paint: painter(tg),
                    payload: Buffer.alloc(res.lease.frameBytes),
                    lastAck: performance.now(),
                    errors: 0,
                });
            } catch (e) {
                skipped.push(tg.target);
                console.log(`skipped ${tg.target}: ${e.message}`);
            }
        });
        working = '';
        if (!opened.length)
            throw new Error(skipped.length ? 'no lease could be opened (see the log)' : 'nothing to paint');
        console.log(`opened ${opened.length} leases in ${((performance.now() - openingFrom) / 1000).toFixed(1)} s`);
        stats = newStats(settings.fps);
        phase = 'running';
        const over = settings.useUdp ? 'UDP' : 'HTTP';
        message = `Painting ${opened.length} targets at ${settings.fps} fps over ${over}`;
        if (skipped.length) message += `; ${skipped.length} skipped (see the log)`;
        console.log(message);
        loopPromise = frameLoop().catch((e) => {
            console.error(e);
            message = `Frame loop failed: ${e.message}`;
            wanted = 'idle';
        });
    } catch (e) {
        working = '';
        message = `Could not start: ${e.message}`;
        console.log(message);
        wanted = 'idle';
        await releaseAll();
    }
    busy = false;
}

async function stopRun(why) {
    busy = true;
    phase = 'idle';
    working = 'Closing leases...';
    await loopPromise;
    loopPromise = null;
    await releaseAll();
    working = '';
    message = why;
    // Settings may have changed while running; pick them up before the next start.
    lastSettingsCheck = -Infinity;
    busy = false;
}

/**
 * Paints every target once per tick at the configured rate. A frame is late
 * when it starts more than half a frame interval after it was due; when the
 * loop falls a whole interval behind it drops the missed frames instead of
 * bursting to catch up, so achieved fps tells the truth. Timers fire on the
 * platform's tick, so the wait is cut by half a tick: a frame then starts within
 * half a tick either side of its due time instead of a whole tick after it.
 */
async function frameLoop() {
    const interval = 1000 / settings.fps;
    const send = settings.useUdp ? sendUdp : sendHttp;
    const t0 = performance.now();
    let due = t0;
    let seq = 0;
    while (phase === 'running' && !quit) {
        const now = performance.now();
        const remaining = due - now;
        if (remaining > Math.max(0.5, timerTickMs / 2)) {
            await sleep(Math.max(1, remaining - timerTickMs / 2));
            continue;
        }
        const start = performance.now();
        if (start - due > interval / 2) {
            stats.late++;
            if (start - due > interval) due = start;
        }
        seq++;
        const t = (start - t0) / 1000;
        let bytes = 0;
        const sends = [];
        for (const l of live) {
            l.paint(t, l.payload);
            bytes += l.payload.length;
            sends.push(send(l, seq));
        }
        await Promise.all(sends);
        const end = performance.now();
        stats.frames++;
        stats.window.push({ at: end, ms: end - start, bytes });
        while (stats.window.length && stats.window[0].at < end - WINDOW_MS) stats.window.shift();
        due += interval;
        // A UDP send that finishes at once calls back through nextTick, so a loop that is behind
        // never returns to the event loop and starves the timers (status, keepalive). This does.
        await new Promise((r) => setImmediate(r));
    }
}

/** The rate readouts over the last WINDOW_MS (or the run so far when shorter). */
function summarize(now) {
    const cut = now - WINDOW_MS;
    let n = 0;
    let ms = 0;
    let max = 0;
    let bytes = 0;
    for (const f of stats.window) {
        if (f.at < cut) continue;
        n++;
        ms += f.ms;
        max = Math.max(max, f.ms);
        bytes += f.bytes;
    }
    const span = Math.max(0.25, Math.min(WINDOW_MS, now - stats.started) / 1000);
    return {
        achieved: phase === 'running' ? n / span : 0,
        avg: n ? ms / n : 0,
        max,
        bytesPerSec: phase === 'running' ? bytes / span : 0,
    };
}

function status(now) {
    const s = summarize(now);
    const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
    let text = message;
    if (working) text = working;
    else if (!settings || settingsError) text = settingsError;
    else if (phase === 'idle') {
        const gone = missing.length ? `Not in the layout: ${missing.join(', ')}` : '';
        text = planError || [message || 'Idle; tap Start', gone].filter(Boolean).join('. ');
    }
    return {
        phase: phase === 'running' ? 'running' : busy ? (wanted === 'running' ? 'starting' : 'stopping') : 'idle',
        fps: { target: settings?.fps ?? 0, achieved: round(s.achieved, 1) },
        frameMs: { avg: round(s.avg, 2), max: round(s.max, 2) },
        bytesPerSec: Math.round(s.bytesPerSec),
        lateFrames: stats.late,
        frames: stats.frames,
        sendErrors: live.reduce((a, l) => a + l.errors, 0),
        transport: settings?.useUdp ? 'udp' : 'http',
        timerTickMs: round(timerTickMs, 1),
        leases: live.length,
        seed: runtime.seed,
        targetCount: planned.length,
        modelCount: new Set(planned.map((tg) => tg.model)).size,
        modelsListed: new Set(planned.map((tg) => tg.model)).size <= STATUS_MODELS_MAX,
        modelsRev,
        effectsAvailable: EFFECT_NAMES,
        effects: EFFECT_NAMES.map((name) => ({
            name,
            title: EFFECTS[name].title,
            about: EFFECTS[name].about,
            enabled: settings ? settings.effects[name] !== false : true,
        })),
        message: text,
    };
}

/**
 * One row per model, sent with a status only when the list changed or a page may have joined.
 * A layout can have twenty thousand submodels; a row for each is megabytes a page cannot draw.
 */
function modelRows() {
    const rows = new Map();
    for (const tg of planned) {
        let r = rows.get(tg.model);
        if (!r) {
            r = { model: tg.model, targets: 0, nodes: 0, leases: {}, effects: new Set(), pinned: false, one: tg };
            rows.set(tg.model, r);
        }
        r.targets++;
        r.nodes += tg.nodes;
        r.leases[tg.format] = (r.leases[tg.format] ?? 0) + 1;
        if (tg.effect) r.effects.add(tg.effect);
        r.pinned ||= tg.pinned;
    }
    return [...rows.values()].map((r) => ({
        model: r.model,
        targets: r.targets,
        nodes: r.nodes,
        lease:
            r.targets === 1
                ? r.one.format === 'nodes'
                    ? 'nodes'
                    : `${r.one.format} ${r.one.width}x${r.one.height}`
                : Object.entries(r.leases)
                      .map(([f, n]) => `${n} ${f}`)
                      .join(', '),
        effect: r.effects.size === 1 ? [...r.effects][0] : r.effects.size ? 'mixed' : '',
        pinned: r.pinned,
    }));
}

let statusRefused = 0;
/** True when the player took it. A write that hangs must not wedge the feed, hence the timeout. */
async function publishStatus(st) {
    const res = await fetch(appUrl('/status'), {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(st),
        signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    // Refused status is invisible on the page; say so once per kind of refusal.
    if (res && !res.ok && res.status !== statusRefused) {
        statusRefused = res.status;
        console.log(`status refused: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    }
    return Boolean(res?.ok);
}

function handleEvent(ev) {
    const d = ev?.data;
    if (!d || typeof d !== 'object') return;
    const type = d.type === 'input' ? d.input : d.type;
    switch (type) {
        case 'start':
            wanted = 'running';
            break;
        case 'stop':
            wanted = 'idle';
            break;
        case 'restart':
            wanted = 'running';
            restartAsked = phase === 'running';
            break;
        case 'reshuffle':
            runtime.seed = (Math.random() * 0x100000000) >>> 0;
            assign();
            break;
        case 'setEffect': {
            // Visitors on the show's cloud page may start and stop, not change what is painted.
            if (ev.source === 'cloud') return;
            if (typeof d.target !== 'string' || !planned.some((tg) => tg.target === d.target || tg.model === d.target)) return;
            const effect = typeof d.effect === 'string' && EFFECTS[d.effect] ? d.effect : '';
            runtime.pins[d.target] = effect;
            assign();
            break;
        }
        default:
            break;
    }
}

async function main() {
    const poll = new AbortController();
    const startedAt = Date.now();
    const shutdown = () => {
        quit = true;
        poll.abort();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    timerTickMs = await measureTimerTick();
    console.log(`timer tick ${timerTickMs.toFixed(1)} ms`);

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
                    if (ev.ts >= startedAt - 2000) handleEvent(ev);
                }
            } catch (e) {
                if (quit) return;
                console.log(`events: ${e.message}`);
                await sleep(2000);
            }
        }
    };
    void pollEvents();

    // Payload traffic renews a lease, but UDP gives no receipt; a lease with no acknowledged send gets a keepalive.
    const keepalive = setInterval(() => {
        if (phase !== 'running' && !busy) return;
        const now = performance.now();
        for (const l of live) {
            if (now - l.lastAck < TTL_MS / 3) continue;
            l.lastAck = now;
            void limited(() =>
                fetch(`${base}/api/ezp/overlays/${l.lease.id}/keepalive?token=${l.lease.token}`, { method: 'POST' }),
            ).catch(() => undefined);
        }
    }, 1000);

    // On a timer of its own: the loop below blocks for as long as a plan or a start takes.
    let lastStatusJson = '';
    let lastStatusAt = -Infinity;
    let publishing = false;
    let sentModelsRev = -1;
    let sentModelsAt = -Infinity;
    const statusTimer = setInterval(() => {
        if (publishing || quit) return;
        const st = status(performance.now());
        const json = JSON.stringify(st);
        const t = performance.now();
        const due =
            (phase === 'running' && t - lastStatusAt >= 500) ||
            (phase !== 'running' && (json !== lastStatusJson || t - lastStatusAt > 5000));
        const withModels =
            st.modelsListed && (modelsRev !== sentModelsRev || t - sentModelsAt > TARGETS_RESEND_MS);
        if (!due && !withModels) return;
        if (withModels) st.models = modelRows();
        const rev = modelsRev;
        lastStatusJson = json;
        lastStatusAt = t;
        publishing = true;
        publishStatus(st)
            .then((ok) => {
                if (ok && withModels) {
                    sentModelsRev = rev;
                    sentModelsAt = t;
                }
            })
            .finally(() => {
                publishing = false;
            });
    }, 250);
    while (!quit) {
        const now = performance.now();
        if (phase === 'idle' && !busy && now - lastSettingsCheck > SETTINGS_EVERY_MS) {
            lastSettingsCheck = now;
            await refreshSettings();
        }
        if (!busy) {
            if (phase === 'running' && (wanted === 'idle' || restartAsked)) {
                restartAsked = false;
                await stopRun(wanted === 'idle' ? 'Stopped' : 'Restarting...');
                if (wanted === 'running') {
                    lastSettingsCheck = performance.now();
                    await refreshSettings();
                }
            } else if (phase === 'idle' && wanted === 'running') {
                await startRun();
            }
        }
        await sleep(250);
    }

    clearInterval(statusTimer);
    clearInterval(keepalive);
    phase = 'idle';
    await loopPromise;
    await releaseAll();
    sock?.close();
    message = 'App stopped';
    await publishStatus(status(performance.now()));
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
