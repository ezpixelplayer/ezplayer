#!/usr/bin/env node
/*
 * Submodel overlays: an overlay lease client that decorates the submodels of
 * a running EZPlayer's layout, whatever the layout is.
 *
 *   node scripts/overlay-submodels.mjs [http://localhost:3000] [options]
 *
 *   --match=regex    Models to decorate; default all that have submodels
 *   --per-model=n    Most submodels to paint on one model; default 4
 *   --max=n          Most leases to open; default 300
 *   --seconds=n      Stop after n seconds; default runs until Ctrl+C
 *   --fps=n          Frames per second; default 20
 *   --list           Print what would be painted and exit
 *
 * Nothing is chosen by name. Each submodel is classed by where its nodes are:
 * strands that run out from a centre get comets or a radar sweep, strands that
 * go around it get marching rings, rows of a matrix get a snow scene, a flat
 * face gets a pattern drawn by position, and a line gets a chase. Colors
 * follow each prop's place across the yard.
 *
 * It exercises the target inventory with node coordinates, the buffer and
 * nodes formats, and UDP payloads. Ctrl+C closes the leases.
 */

import dgram from 'node:dgram';

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/+$/, '');
const match = new RegExp(opt('match') ?? '', 'i');
const perModel = Number(opt('per-model') ?? 4);
const maxLeases = Number(opt('max') ?? 300);
const seconds = Number(opt('seconds') ?? 0);
const listOnly = args.includes('--list');
const TICK_MS = 1000 / Number(opt('fps') ?? 20);
const TTL_MS = 5000;
const MIN_NODES = 6;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(method, path, body) {
    const res = await fetch(`${base}/api/ezp/overlays${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return JSON.parse(text);
}

const sock = dgram.createSocket('udp4');
const host = new URL(base).hostname;
let udpPort = 0;

/** One payload as overlay packets (see the API reference: UDP payload packets). */
function sendFrame(lease, seq, payload) {
    for (let off = 0; off < payload.length; off += 1400) {
        const data = payload.subarray(off, Math.min(payload.length, off + 1400));
        const p = Buffer.alloc(24 + data.length);
        p.writeUInt32BE(0x455a4f31, 0);
        p.writeUInt32BE(lease.id, 4);
        p.writeUInt32BE(lease.token, 8);
        p.writeUInt32BE(seq, 12);
        p.writeUInt8(off + data.length === payload.length ? 1 : 0, 16);
        p.writeUInt32BE(off, 17);
        p.writeUInt16BE(data.length, 21);
        p.set(data, 24);
        sock.send(p, udpPort, host);
    }
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

function hsv(h, s, v) {
    h = ((h % 1) + 1) % 1;
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

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Each node's place on the plane its target mostly lies in, and that plane's size. */
function flatten(target) {
    const xyz = target.nodes.local ?? target.nodes.world;
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
 * The strands of a target whose buffer has one row (or column) per strand:
 * every buffer cell with its strand and place along it, and for each strand
 * its direction, its angle around the centre and its distance from it.
 */
function strandsOf(target, flat) {
    const { width, height } = target.buffer;
    const cells = target.nodes.cells;
    const count = target.vertical ? width : height;
    const strands = Array.from({ length: count }, () => ({ at: [], len: 0 }));
    const out = [];
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < flat.n; i++) {
        cx += flat.pts[i * 2] / flat.n;
        cy += flat.pts[i * 2 + 1] / flat.n;
    }
    let far = 1e-6;
    for (let c = 0; c < cells.length; c += 3) {
        const [node, x, y] = [cells[c], cells[c + 1], cells[c + 2]];
        const s = target.vertical ? x : y;
        const i = target.vertical ? y : x;
        const px = flat.pts[node * 2] - cx;
        const py = flat.pts[node * 2 + 1] - cy;
        const r = Math.hypot(px, py);
        far = Math.max(far, r);
        strands[s].at.push({ i, px, py, r });
        strands[s].len = Math.max(strands[s].len, i + 1);
        out.push({ offset: ((height - 1 - y) * width + x) * 3, s, i });
    }
    const used = strands.filter((s) => s.at.length > 1);
    for (const s of used) {
        s.at.sort((a, b) => a.i - b.i);
        const first = s.at[0];
        const last = s.at[s.at.length - 1];
        const rs = s.at.map((p) => p.r);
        s.span = (Math.max(...rs) - Math.min(...rs)) / far;
        s.radius = rs.reduce((a, b) => a + b, 0) / rs.length;
        s.outward = last.r >= first.r;
        const mx = s.at.reduce((a, p) => a + p.px, 0) / s.at.length;
        const my = s.at.reduce((a, p) => a + p.py, 0) / s.at.length;
        s.angle = Math.atan2(my, mx) / (Math.PI * 2) + 0.5;
        const d = Math.hypot(last.px - first.px, last.py - first.py) || 1;
        s.dir = [(last.px - first.px) / d, (last.py - first.py) / d];
        let path = 0;
        for (let k = 1; k < s.at.length; k++)
            path += Math.hypot(s.at[k].px - s.at[k - 1].px, s.at[k].py - s.at[k - 1].py);
        s.straight = d / (path || 1);
    }
    const mean = (f) => used.reduce((a, s) => a + f(s), 0) / Math.max(1, used.length);
    return {
        cells: out,
        strands,
        used: used.length,
        longest: Math.max(0, ...strands.map((s) => s.len)),
        span: mean((s) => s.span),
        // 1 when the strands are straight lines that all point the same way.
        parallel: mean((s) => s.straight * Math.abs(s.dir[0] * used[0].dir[0] + s.dir[1] * used[0].dir[1])),
    };
}

// ---------------------------------------------------------------------------
// Painters: each returns paint(t, payload)
// ---------------------------------------------------------------------------

/** Paint a buffer picture cell by cell; `pixel` gets the cell's strand and place on it. */
function byStrand(geo, pixel) {
    return (t, out) => {
        for (const c of geo.cells) out.set(pixel(t, geo.strands[c.s], c.i), c.offset);
    };
}

/** A comet runs out each arm, alternate arms half a beat apart. */
const comets = (geo, hue) =>
    byStrand(geo, (t, s, i) => {
        const along = s.outward ? i : s.len - 1 - i;
        const head = frac(t * 0.7 + (s.rank % 2) * 0.5) * (s.len + 4);
        const d = head - along;
        const tail = d >= 0 && d < 5 ? 1 - d / 5 : 0;
        return hsv(hue + s.angle * 0.3 + t * 0.05, 1 - tail * 0.6, 0.12 + 0.88 * tail);
    });

/** A bright sector sweeps around the strands like a radar. */
const sweep = (geo, hue) =>
    byStrand(geo, (t, s, i) => {
        const glow = Math.max(0, 1 - frac(s.angle - t * 0.35) * 3);
        return hsv(hue + i / (s.len * 3), 0.9, 0.08 + 0.92 * glow * glow);
    });

/** Each strand is one color and the colors march from strand to strand. */
const rings = (geo, hue) =>
    byStrand(geo, (t, s) =>
        hsv(hue + s.rank / Math.max(3, geo.used) - t * 0.25, 1, 0.5 + 0.5 * Math.sin(t * 4 - s.rank * 1.3)),
    );

/** Icy sparkle. */
const twinkle = (geo) =>
    byStrand(geo, (t, s, i) => {
        const phase = noise(s.rank + 1, i + 1);
        const v = Math.pow(Math.max(0, Math.sin((t * (0.6 + phase) + phase) * Math.PI * 2)), 6);
        return [120 + 135 * v, 170 + 85 * v, 255].map((ch) => ch * (0.15 + 0.85 * v));
    });

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

/** The snow scene on any flat set of nodes: drawn as a picture, then read where each node is. */
function sceneByPosition(flat) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
    const height = clamp(Math.sqrt((flat.n * flat.h) / flat.w), 10, 64);
    const width = clamp((height * flat.w) / flat.h, 10, 96);
    const picture = new Uint8Array(width * height * 3);
    const draw = snowScene(width, height);
    const from = new Int32Array(flat.n);
    for (let i = 0; i < flat.n; i++) {
        const x = Math.min(width - 1, Math.floor((flat.pts[i * 2] / flat.w) * width));
        const y = Math.min(height - 1, Math.floor((1 - flat.pts[i * 2 + 1] / flat.h) * height));
        from[i] = (y * width + x) * 3;
    }
    return (t, out) => {
        draw(t, picture);
        for (let i = 0; i < flat.n; i++) out.set(picture.subarray(from[i], from[i] + 3), i * 3);
    };
}

/** Patterns over a face, from each node's place on it (u, v in 0..1). */
const facePatterns = [
    (u, v, t, hue) =>
        hsv(
            hue + 0.12 * Math.sin(u * 7 + t * 2) + 0.12 * Math.sin(v * 6 - t * 1.4),
            1,
            0.35 + 0.65 * frac(Math.sin(u * 5 + t) + Math.cos(v * 5 - t) + 2),
        ),
    (u, v, t, hue) => hsv(hue + (u + v) * 0.7 - t * 0.3, 1, 1),
    (u, v, t, hue) => hsv(hue + 0.4, 1, 0.5 + 0.5 * Math.sin(Math.hypot(u - 0.5, v - 0.5) * 30 - t * 6)),
    (u, v, t, hue) =>
        (Math.floor(u * 5) + Math.floor(v * 5) + Math.floor(t * 2)) % 2 ? hsv(hue, 1, 1) : hsv(hue + 0.5, 1, 0.8),
    (u, v, t, hue) => hsv(hue + 0.1 * Math.sin(t), 1, Math.abs(Math.sin(v * 12 + u * 4 - t * 4))),
];

function byPosition(flat, pattern, hue) {
    return (t, out) => {
        for (let i = 0; i < flat.n; i++)
            out.set(pattern(flat.pts[i * 2] / flat.w, flat.pts[i * 2 + 1] / flat.h, t, hue), i * 3);
    };
}

/** Three shades chase along a strand. */
function chase(count, hue) {
    const palette = [hsv(hue, 1, 1), hsv(hue + 0.08, 0.3, 1), hsv(hue + 0.5, 1, 0.5)];
    return (t, out) => {
        for (let n = 0; n < count; n++) out.set(palette[Math.floor(frac(n / 9 - t * 0.5) * palette.length)], n * 3);
    };
}

// ---------------------------------------------------------------------------
// Choosing what to paint
// ---------------------------------------------------------------------------

let faces = 0;

/** What a target looks like, the lease format that suits it, and its painter. */
function classify(target) {
    const flat = flatten(target);
    const stranded = target.kind === 'multi' || target.kind === 'multiEqual';
    // Only the default buffer has a row per strand; other styles keep the parent's shape.
    if (stranded && target.bufferStyle === 'Default') {
        const geo = strandsOf(target, flat);
        const used = geo.strands.filter((s) => s.at.length > 1);
        const rankBy = (key) => [...used].sort((a, b) => a[key] - b[key]).forEach((s, k) => (s.rank = k));
        geo.strands.forEach((s, k) => (s.rank = k));
        if (geo.used >= 2 && geo.parallel > 0.9) {
            if (geo.used >= 6 && geo.longest >= 6)
                return { look: 'matrix', format: 'nodes', make: () => sceneByPosition(flat) };
            return { look: 'bars', format: 'buffer', make: (hue) => rings(geo, hue) };
        }
        if (geo.used >= 2 && geo.span > 0.45) {
            rankBy('angle');
            if (geo.used >= 10) return { look: 'spokes', format: 'buffer', make: (hue) => sweep(geo, hue) };
            return { look: 'arms', format: 'buffer', make: (hue) => comets(geo, hue) };
        }
        if (geo.used >= 2 && geo.span < 0.25) {
            rankBy('radius');
            return { look: 'rings', format: 'buffer', make: (hue) => rings(geo, hue) };
        }
        return { look: 'tangle', format: 'buffer', make: () => twinkle(geo) };
    }
    if (Math.min(flat.w, flat.h) > 0.15 * Math.max(flat.w, flat.h) && flat.n >= 16) {
        const k = faces++;
        // Every sixth face is big enough to hold the scene instead of a pattern.
        if (k % 6 === 5 && flat.n >= 150) return { look: 'face', format: 'nodes', make: () => sceneByPosition(flat) };
        return { look: 'face', format: 'nodes', make: (hue) => byPosition(flat, facePatterns[k % 5], hue) };
    }
    return { look: 'line', format: 'nodes', make: (hue) => chase(flat.n, hue) };
}

/** The model list, waiting out a player that is still loading its layout. */
async function ready() {
    for (let tries = 0; ; tries++) {
        try {
            return await api('GET', '/targets');
        } catch (err) {
            if (tries >= 30 || !/ 503 /.test(err.message)) throw err;
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
}

async function plan() {
    // The short list says which models have submodels; coordinates come one model at a time.
    const models = (await ready()).targets.filter((m) => m.subModels && match.test(m.model));
    const jobs = [];
    for (const m of models) {
        const subs = (await api('GET', `/targets?model=${encodeURIComponent(m.model)}&detail=nodes`)).targets
            .filter((t) => t.subModel && t.nodeCount >= MIN_NODES && t.nodes?.world && t.buffer)
            // Stranded ones first, then the biggest.
            .sort(
                (a, b) =>
                    (b.kind.startsWith('multi') ? 1 : 0) - (a.kind.startsWith('multi') ? 1 : 0) ||
                    b.nodeCount - a.nodeCount,
            );
        const taken = new Set();
        let rank = 0;
        for (const t of subs) {
            if (rank >= perModel) break;
            const w = t.nodes.world;
            const keys = [];
            for (let i = 0; i < w.length; i += 3)
                keys.push(`${w[i].toFixed(2)},${w[i + 1].toFixed(2)},${w[i + 2].toFixed(2)}`);
            // Leave nodes to the submodel that already has them.
            if (keys.filter((k) => taken.has(k)).length > keys.length * 0.25) continue;
            keys.forEach((k) => taken.add(k));
            let x = 0;
            for (let i = 0; i < w.length; i += 3) x += w[i] / (w.length / 3);
            jobs.push({ target: t, rank: rank++, x, ...classify(t) });
        }
    }
    // When there are too many, every model keeps its first choice before any gets a second.
    jobs.sort((a, b) => a.rank - b.rank || b.target.nodeCount - a.target.nodeCount);
    const kept = jobs.slice(0, maxLeases);
    // Hue runs across the yard.
    const lo = Math.min(...kept.map((j) => j.x));
    const hi = Math.max(...kept.map((j) => j.x));
    for (const j of kept) j.hue = hi > lo ? (0.85 * (j.x - lo)) / (hi - lo) : 0.55;
    return { kept, dropped: jobs.length - kept.length };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const live = [];
let stopping = false;

async function stop() {
    if (stopping) return;
    stopping = true;
    await Promise.allSettled(live.map((l) => api('DELETE', `/${l.lease.id}?token=${l.lease.token}`)));
    sock.close();
    console.log(`closed ${live.length} leases`);
    process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const { kept: jobs, dropped } = await plan();
if (!jobs.length) {
    console.log(`no submodels to decorate on models matching ${match}`);
    process.exit(1);
}
const describe = (j) => `  ${j.target.target} (${j.look}, ${j.target.kind}, ${j.target.nodeCount} nodes, ${j.format})`;
if (listOnly) {
    for (const j of jobs) console.log(describe(j));
    console.log(`${jobs.length} submodels on ${new Set(jobs.map((j) => j.target.model)).size} models`);
    process.exit(0);
}
for (const job of jobs) {
    try {
        // 'max' keeps a node lit when any strand crossing it is lit.
        const res = await api('POST', '', {
            model: job.target.target,
            format: job.format,
            mode: 'layer',
            overlap: 'max',
            ttlMs: TTL_MS,
            name: 'overlay-submodels',
        });
        udpPort = res.udpPort;
        live.push({ lease: res.lease, paint: job.make(job.hue), payload: Buffer.alloc(res.lease.frameBytes) });
        console.log(describe(job));
    } catch (err) {
        console.log(`  skipped ${job.target.target}: ${err.message}`);
    }
}
console.log(`painting ${live.length} submodels on ${new Set(jobs.map((j) => j.target.model)).size} models`);
if (dropped) console.log(`${dropped} more were left out; raise --max or narrow --match`);

const started = Date.now();
let seq = 0;
setInterval(() => {
    const t = (Date.now() - started) / 1000;
    if (seconds && t > seconds) return void stop();
    seq++;
    for (const l of live) {
        l.paint(t, l.payload);
        sendFrame(l.lease, seq, l.payload);
    }
}, TICK_MS);
