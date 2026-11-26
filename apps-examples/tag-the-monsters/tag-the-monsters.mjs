// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Tag the Monsters, as an EZPlayer app.
 *
 * A player walks the yard with a wand. A base station (or the Wand Simulator app)
 * reports where the wand is and where it points, and the player's flashlight beam
 * lands on every pixel in its path: one pattern lease over an xLights group, with
 * the beam's origin and direction as uniforms the player evaluates per node, on the
 * GPU when it has one. Monsters and friends run across the matrices you choose,
 * drawn as RGBA sprites over the show that keeps playing underneath. Hold the beam
 * on a monster to tag it; light up a friend and lose points.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * Settings come from the instance's private data key "settings"; see README.md.
 */

import dgram from 'node:dgram';

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
const KEY_PREFIX = `ttm-${instance.replace(/[^A-Za-z0-9._~-]/g, '-').slice(0, 32)}`;
const TICK_MS = 40;
const OBJECT_TTL_MS = 3000;
const LEASE_TTL_MS = 10_000;
// A lease with no traffic for its TTL is dropped, and a still wand sends nothing, so the uniforms go out this often anyway.
const BEAM_KEEPALIVE_MS = 2000;
const POSE_STALE_MS = 2500;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const DEFAULTS = {
    cast: 'halloween',
    beamGroup: '',
    beamModels: [],
    spriteModels: [],
    beam: { halfAngle: 0.12, softness: 0.35, range: 1500, color: '#fff0c0', noise: 0.15, blend: 'add' },
    wand: { origin: null, heading: 0, scale: 100, eyeHeight: 1.6 },
    rules: { roundSeconds: 90, dwellMs: 350, coverage: 0.4, foePoints: 10, friendPenalty: 5, respawnMs: 1200 },
    background: { foe: '#40001a', friend: '#003020', alpha: 0.4 },
    useUdp: true,
    autoStart: false,
};

const num = (v, d, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);

function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const b = r.beam ?? {};
    const w = r.wand ?? {};
    const ru = r.rules ?? {};
    const bg = r.background ?? {};
    return {
        cast: r.cast === 'christmas' ? 'christmas' : 'halloween',
        beamGroup: typeof r.beamGroup === 'string' ? r.beamGroup : '',
        beamModels: names(r.beamModels),
        spriteModels: names(r.spriteModels),
        beam: {
            halfAngle: num(b.halfAngle, DEFAULTS.beam.halfAngle, 0.02, 1.2),
            softness: num(b.softness, DEFAULTS.beam.softness, 0, 1),
            range: num(b.range, DEFAULTS.beam.range, 10, 100000),
            color: color(b.color, DEFAULTS.beam.color),
            noise: num(b.noise, DEFAULTS.beam.noise, 0, 1),
            blend: b.blend === 'over' || b.blend === 'max' ? b.blend : 'add',
        },
        wand: {
            origin: Array.isArray(w.origin) && w.origin.length === 3 && w.origin.every((x) => typeof x === 'number') ? w.origin : null,
            heading: num(w.heading, 0, -360, 360),
            scale: num(w.scale, DEFAULTS.wand.scale, 0.01, 100000),
            eyeHeight: num(w.eyeHeight, DEFAULTS.wand.eyeHeight, 0, 10),
        },
        rules: {
            roundSeconds: num(ru.roundSeconds, DEFAULTS.rules.roundSeconds, 10, 3600),
            dwellMs: num(ru.dwellMs, DEFAULTS.rules.dwellMs, 0, 5000),
            coverage: num(ru.coverage, DEFAULTS.rules.coverage, 0.05, 1),
            foePoints: num(ru.foePoints, DEFAULTS.rules.foePoints, 0, 1000),
            friendPenalty: num(ru.friendPenalty, DEFAULTS.rules.friendPenalty, 0, 1000),
            respawnMs: num(ru.respawnMs, DEFAULTS.rules.respawnMs, 0, 30000),
        },
        background: {
            foe: color(bg.foe, DEFAULTS.background.foe),
            friend: color(bg.friend, DEFAULTS.background.friend),
            alpha: num(bg.alpha, DEFAULTS.background.alpha, 0, 1),
        },
        useUdp: r.useUdp !== false,
        autoStart: r.autoStart === true,
    };
}

// ---------------------------------------------------------------------------
// Casts: who runs across the matrices. Bitmaps are rows of palette letters; '.' is clear.
// ---------------------------------------------------------------------------

const CASTS = {
    halloween: {
        foes: {
            ghost: {
                palette: { w: '#e8e8ff', k: '#202040' },
                rows: ['..wwww..', '.wwwwww.', 'wwkwwkww', 'wwwwwwww', 'wwwwwwww', 'wwwwwwww', 'wwwwwwww', 'w.ww.ww.'],
            },
            witch: {
                palette: { k: '#201030', g: '#60c040', p: '#8030c0', y: '#ffe060' },
                rows: ['...kk...', '..kkkk..', 'kkkkkkkk', '..gggg..', '..gkkg..', '.pppppp.', '.pppppp.', '..pp.pp.'],
            },
            goblin: {
                palette: { g: '#50a030', r: '#ff3030', b: '#604020' },
                rows: ['g......g', 'gg....gg', '.gggggg.', '.grggrg.', '.gggggg.', '..bbbb..', '..bbbb..', '..b..b..'],
            },
        },
        friends: {
            pumpkin: {
                palette: { o: '#ff8010', k: '#201000', g: '#30a030' },
                rows: ['...gg...', '.oooooo.', 'ookookoo', 'oooooooo', 'okoooook', 'ookkkkoo', '.oooooo.', '..oooo..'],
            },
            kid: {
                palette: { s: '#f0c090', b: '#4060ff', r: '#ff4040', k: '#402010' },
                rows: ['..kkkk..', '..ssss..', '..ssss..', '.bbbbbb.', '.bbbbbb.', '..rrrr..', '..r..r..', '..k..k..'],
            },
            candy: {
                palette: { r: '#ff2040', w: '#ffffff', y: '#ffe040' },
                rows: ['........', 'y.rwrwr.', 'yrrwrwrr', 'yrwrwrwr', 'yrrwrwrr', 'y.rwrwr.', '........', '........'],
            },
        },
    },
    christmas: {
        foes: {
            krampus: {
                palette: { b: '#503020', r: '#ff3020', k: '#101010', w: '#ffffff' },
                rows: ['b......b', '.b....b.', '.bbbbbb.', '.brbbrb.', '.bbwwbb.', '.kkkkkk.', '.kkkkkk.', '.kk..kk.'],
            },
            gremlin: {
                palette: { g: '#30b040', y: '#ffe040', k: '#102010' },
                rows: ['.g....g.', 'gg....gg', '.gggggg.', '.gyggyg.', '.gggggg.', '.gkkkkg.', '..gggg..', '..g..g..'],
            },
            yeti: {
                palette: { w: '#f0f8ff', b: '#80a0ff', k: '#202040' },
                rows: ['.wwwwww.', 'wwwwwwww', 'wwkwwkww', 'wwwbbwww', 'wwwwwwww', 'wwwwwwww', '.wwwwww.', '.ww..ww.'],
            },
        },
        friends: {
            santa: {
                palette: { r: '#ff2020', w: '#ffffff', s: '#f0c090', k: '#202020' },
                rows: ['...rr...', '..rrrr..', '.wwwwww.', '.ssssss.', '.swwwws.', '.rrrrrr.', '.rkkkkr.', '.kk..kk.'],
            },
            reindeer: {
                palette: { b: '#805030', r: '#ff3020', k: '#201008' },
                rows: ['b.b..b.b', '.bb..bb.', '..bbbb..', '.bkbbkb.', '..bbbb..', '...rr...', '..bbbb..', '..b..b..'],
            },
            elf: {
                palette: { g: '#20a040', s: '#f0c090', r: '#ff3030', y: '#ffe040' },
                rows: ['...gg...', '..gggg..', '..ssss..', '..ssss..', '.gggggg.', '.gyggyg.', '.rrrrrr.', '..r..r..'],
            },
            gingerbread: {
                palette: { b: '#b06020', w: '#ffffff', r: '#ff3030' },
                rows: ['..bbbb..', '..bwbw..', '..bbbb..', 'bbbbbbbb', 'b.brrb.b', '..bbbb..', '..bbbb..', '..b..b..'],
            },
        },
    },
};

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---------------------------------------------------------------------------
// Player API
// ---------------------------------------------------------------------------

async function api(method, path, body) {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: body ? jsonHeaders : authHeaders,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.status === 503) throw new Error('The player is not playing, so there are no frames to paint on. Start the show in EZPlayer.');
    if (!res.ok) {
        let msg = text;
        try {
            msg = JSON.parse(text).error ?? text;
        } catch {
            /* plain text */
        }
        throw new Error(`${method} ${path}: ${res.status} ${msg}`);
    }
    return text ? JSON.parse(text) : {};
}

const udpHost = new URL(base).hostname;
let sock = null;
let udpPort = 0;

/** One payload as overlay packets (see the API reference: UDP payload packets). */
function sendUdp(lease, seq, payload) {
    for (let off = 0; off < payload.length || off === 0; off += 1400) {
        const data = payload.subarray(off, Math.min(payload.length, off + 1400));
        const p = Buffer.alloc(24 + data.length);
        p.writeUInt32BE(0x455a4f31, 0);
        p.writeUInt32BE(lease.id, 4);
        p.writeUInt32BE(lease.token, 8);
        p.writeUInt32BE(seq, 12);
        p.writeUInt8(off + data.length >= payload.length ? 1 : 0, 16);
        p.writeUInt32BE(off, 17);
        p.writeUInt16BE(data.length, 21);
        p.set(data, 24);
        sock.send(p, udpPort, udpHost, () => undefined);
        if (payload.length === 0) break;
    }
}

function sendPayload(lease, seq, payload) {
    if (settings.useUdp && sock && udpPort) {
        sendUdp(lease, seq, payload);
        return;
    }
    fetch(`${base}/api/ezp/overlays/${lease.id}/frame?token=${lease.token}&seq=${seq}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: payload,
    }).catch(() => undefined);
}

async function closeLease(lease) {
    await fetch(`${base}/api/ezp/overlays/${lease.id}?token=${lease.token}`, { method: 'DELETE' }).catch(() => undefined);
}

// Scene objects: the holder, the wand and the beam in the Show View.
async function putObject(key, body) {
    const res = await fetch(`${base}/api/ezp/objects/${KEY_PREFIX}-${key}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ttlMs: OBJECT_TTL_MS, ...body }) });
    return res.status;
}
async function patchObject(key, body) {
    const res = await fetch(`${base}/api/ezp/objects/${KEY_PREFIX}-${key}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) }).catch(() => null);
    return res ? res.status : 0;
}
async function deleteObject(key) {
    await fetch(`${base}/api/ezp/objects/${KEY_PREFIX}-${key}`, { method: 'DELETE', headers: authHeaders }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let settings = normalize({});
let settingsJson = '';
let phase = 'idle'; // idle | starting | playing | over | stopping
let message = '';
let score = 0;
let tags = 0;
let misses = 0;
let roundEndsAt = 0;
let roundResult = null;
let beamLease = null;
let beamSeq = 1;
let lastBeamJson = '';
let lastBeamSentAt = 0;
let sprites = []; // one per sprite model
let objectsDefined = false;
let quit = false;
let wanted = null; // 'running' | 'stopped' | null
let lastPublish = 0;
let publishDirty = true;
let layoutGroups = [];
let gridModels = [];
let targetsError = '';

/** The latest wand report in device units, and the world pose derived from it. */
const pose = { x: 0, z: 0, yaw: 0, pitch: 10, on: false, at: 0, seen: 0 };
let world = { origin: [0, 0, 0], dir: [0, 0, -1], on: false };
let layoutBounds = null;

const deg = Math.PI / 180;

/** Device frame to world: x right, z toward the holder's back; yaw 0 faces the display (world -z), pitch up. */
function updateWorldPose() {
    const w = settings.wand;
    const originW = w.origin ?? defaultOrigin();
    const h = w.heading * deg;
    const ch = Math.cos(h);
    const sh = Math.sin(h);
    const dx = pose.x * w.scale;
    const dz = pose.z * w.scale;
    const origin = [originW[0] + dx * ch + dz * sh, originW[1] + w.eyeHeight * w.scale, originW[2] - dx * sh + dz * ch];
    const yaw = pose.yaw * deg + h;
    const pitch = pose.pitch * deg;
    const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const fresh = Date.now() - pose.seen < POSE_STALE_MS;
    world = { origin, dir, on: pose.on && fresh, fresh };
}

/** The device origin when none is configured: in front of the layout, at its middle. */
function defaultOrigin() {
    const b = layoutBounds;
    if (!b) return [0, 0, 0];
    return [(b.lo[0] + b.hi[0]) / 2, b.lo[1], b.hi[2] + (b.hi[2] - b.lo[2]) * 0.25];
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

async function loadTargets() {
    try {
        const res = await api('GET', '/api/ezp/overlays/targets?groups=1');
        layoutGroups = (res.groups ?? []).map((g) => ({ name: g.name, models: g.models.length }));
        gridModels = res.targets.filter((t) => t.width && t.height && t.width >= 8 && t.height >= 8).map((t) => ({ model: t.model, width: t.width, height: t.height, type: t.type }));
        targetsError = '';
    } catch (e) {
        targetsError = e.message;
    }
}

/** World extent of a few models, for the default wand origin. */
async function loadBounds() {
    try {
        const res = await fetch(`${base}/api/ezp/model-coordinates`);
        if (!res.ok) return;
        const data = await res.json();
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        const walk = (v) => {
            if (!v || typeof v !== 'object') return;
            if (typeof v.wX === 'number' && typeof v.wY === 'number') {
                const p = [v.wX, v.wY, typeof v.wZ === 'number' ? v.wZ : 0];
                for (let k = 0; k < 3; ++k) {
                    if (p[k] < lo[k]) lo[k] = p[k];
                    if (p[k] > hi[k]) hi[k] = p[k];
                }
                return;
            }
            for (const c of Array.isArray(v) ? v : Object.values(v)) walk(c);
        };
        walk(data);
        if (Number.isFinite(lo[0])) layoutBounds = { lo, hi };
    } catch {
        /* the default origin falls back to 0,0,0 */
    }
}

// ---------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------

class Sprite {
    constructor(target, nodesWorld) {
        this.model = target.model;
        this.width = target.width;
        this.height = target.height;
        this.nodesWorld = nodesWorld; // world x, y, z per node in frame order (row-major, bottom row first)
        this.lease = null;
        this.payload = null;
        this.seq = 1;
        this.creature = null;
        this.role = null;
        this.x = 0;
        this.dir = 1;
        this.speed = 0;
        this.scale = 1;
        this.hidden = true;
        this.nextAt = 0;
        this.dwell = 0;
        this.flash = 0;
        this.flashColor = null;
        this.litFraction = 0;
    }

    async open() {
        const res = await api('POST', '/api/ezp/overlays', {
            name: 'tag-the-monsters',
            mode: 'exclusive',
            model: this.model,
            format: 'grid',
            channels: 4,
            blend: 'over',
            ttlMs: LEASE_TTL_MS,
        });
        this.lease = res.lease;
        this.payload = new Uint8Array(res.lease.frameBytes);
        if (!udpPort) udpPort = res.udpPort;
    }

    /** Pick who runs next and from which side. */
    spawn(now) {
        const cast = CASTS[settings.cast];
        const foe = Math.random() < 0.55;
        const pool = foe ? cast.foes : cast.friends;
        const keys = Object.keys(pool);
        const name = keys[Math.floor(Math.random() * keys.length)];
        this.creature = { name, ...pool[name] };
        this.role = foe ? 'foe' : 'friend';
        this.scale = Math.max(1, Math.floor((this.height * 0.75) / this.creature.rows.length));
        this.spriteW = this.creature.rows[0].length * this.scale;
        this.spriteH = this.creature.rows.length * this.scale;
        this.dir = Math.random() < 0.5 ? 1 : -1;
        this.x = this.dir > 0 ? -this.spriteW : this.width;
        // Cross the matrix in three to six seconds.
        this.speed = ((this.width + this.spriteW) / (3 + Math.random() * 3)) * this.dir;
        this.y = Math.floor((this.height - this.spriteH) / 2);
        this.hidden = false;
        this.dwell = 0;
        this.spawnedAt = now;
    }

    /** Move; when the run ends, rest a little and spawn again. */
    step(now, dtSec) {
        if (this.flash > 0) this.flash -= dtSec;
        if (this.hidden) {
            if (now >= this.nextAt) this.spawn(now);
            return;
        }
        this.x += this.speed * dtSec;
        const gone = this.dir > 0 ? this.x > this.width : this.x + this.spriteW < 0;
        if (gone) {
            this.hidden = true;
            this.nextAt = now + 500 + Math.random() * 1500;
        }
    }

    /** Cells the creature lights right now, as payload (x, y) top-first. */
    litCells() {
        const cells = [];
        if (this.hidden) return cells;
        const rows = this.creature.rows;
        const x0 = Math.round(this.x);
        for (let r = 0; r < rows.length; ++r) {
            for (let c = 0; c < rows[r].length; ++c) {
                if (rows[r][c] === '.') continue;
                for (let sy = 0; sy < this.scale; ++sy) {
                    const y = this.y + r * this.scale + sy;
                    if (y < 0 || y >= this.height) continue;
                    for (let sx = 0; sx < this.scale; ++sx) {
                        const x = x0 + c * this.scale + sx;
                        if (x < 0 || x >= this.width) continue;
                        cells.push(x, y, rows[r][c]);
                    }
                }
            }
        }
        return cells;
    }

    /** The share of the creature's lit nodes inside the beam cone. */
    coverage() {
        if (this.hidden || !world.on) return 0;
        const cells = this.litCells();
        if (!cells.length) return 0;
        const [ox, oy, oz] = world.origin;
        const [dx, dy, dz] = world.dir;
        const cosHalf = Math.cos(settings.beam.halfAngle);
        const range = settings.beam.range;
        let inside = 0;
        const n = cells.length / 3;
        for (let k = 0; k < cells.length; k += 3) {
            // Payload rows run top first; canonical grid rows run bottom first.
            const node = (this.height - 1 - cells[k + 1]) * this.width + cells[k];
            const w = node * 3;
            const vx = this.nodesWorld[w] - ox;
            const vy = this.nodesWorld[w + 1] - oy;
            const vz = this.nodesWorld[w + 2] - oz;
            const d = Math.hypot(vx, vy, vz);
            if (d > range || d === 0) continue;
            if ((vx * dx + vy * dy + vz * dz) / d >= cosHalf) ++inside;
        }
        return inside / n;
    }

    /** Draw the background tint and the creature into the RGBA payload. */
    render() {
        const p = this.payload;
        const bg = settings.background;
        const tint = this.hidden ? null : hexRgb(this.role === 'foe' ? bg.foe : bg.friend);
        const a = this.hidden ? 0 : Math.round(bg.alpha * 255);
        for (let i = 0; i < p.length; i += 4) {
            if (tint) {
                p[i] = tint[0];
                p[i + 1] = tint[1];
                p[i + 2] = tint[2];
                p[i + 3] = a;
            } else {
                p[i] = p[i + 1] = p[i + 2] = p[i + 3] = 0;
            }
        }
        if (this.hidden) return;
        const flash = this.flash > 0 ? this.flashColor : null;
        const cells = this.litCells();
        for (let k = 0; k < cells.length; k += 3) {
            const o = (cells[k + 1] * this.width + cells[k]) * 4;
            const rgb = flash ?? hexRgb(this.creature.palette[cells[k + 2]] ?? '#ffffff');
            p[o] = rgb[0];
            p[o + 1] = rgb[1];
            p[o + 2] = rgb[2];
            p[o + 3] = 255;
        }
    }

    send() {
        if (!this.lease) return;
        this.render();
        sendPayload(this.lease, this.seq++, this.payload);
    }

    /** Tagged: flash, leave, come back as somebody else after a while. */
    tagged(now) {
        const foe = this.role === 'foe';
        this.flash = 0.25;
        this.flashColor = foe ? [255, 255, 255] : [255, 40, 40];
        this.hidden = false;
        // Let the flash show for a few frames, then go.
        setTimeout(() => {
            this.hidden = true;
            this.nextAt = Date.now() + settings.rules.respawnMs;
        }, 250);
        this.dwell = 0;
        return foe;
    }

    async close() {
        if (this.lease) await closeLease(this.lease);
        this.lease = null;
    }

    status() {
        return {
            model: this.model,
            size: `${this.width}x${this.height}`,
            creature: this.hidden ? null : this.creature.name,
            role: this.hidden ? null : this.role,
            x: this.hidden ? null : Math.round(this.x),
            lit: Math.round(this.litFraction * 100),
            dwell: Math.round(this.dwell),
        };
    }
}

// ---------------------------------------------------------------------------
// Beam lease and scene objects
// ---------------------------------------------------------------------------

async function openBeam() {
    const b = settings.beam;
    const req = {
        name: 'tag-the-monsters beam',
        mode: 'layer',
        blend: b.blend,
        ttlMs: LEASE_TTL_MS,
        pattern: {
            preset: 'beam',
            uniforms: { origin: world.origin, dir: world.dir, halfAngle: b.halfAngle, softness: b.softness, range: b.range, color: '#000000', noise: b.noise },
        },
    };
    if (settings.beamGroup) req.group = settings.beamGroup;
    else if (settings.beamModels.length) req.models = settings.beamModels;
    const res = await api('POST', '/api/ezp/overlays', req);
    beamLease = res.lease;
    if (!udpPort) udpPort = res.udpPort;
    lastBeamJson = '';
    console.log(`beam lease ${beamLease.id} over ${beamLease.nodeCount} nodes on ${beamLease.pattern?.backend ?? '?'} (${beamLease.group ?? (beamLease.models ?? []).length + ' models'})`);
}

function updateBeam() {
    if (!beamLease) return;
    const u = {
        origin: world.origin.map((v) => Math.round(v * 10) / 10),
        dir: world.dir.map((v) => Math.round(v * 1000) / 1000),
        color: world.on ? settings.beam.color : '#000000',
    };
    const json = JSON.stringify(u);
    const now = Date.now();
    if (json === lastBeamJson && now - lastBeamSentAt < BEAM_KEEPALIVE_MS) return;
    lastBeamJson = json;
    lastBeamSentAt = now;
    sendPayload(beamLease, beamSeq++, Buffer.from(json));
}

/** The holder: a head, a body and the wand in hand, plus the beam leaving the wand. */
function holderBody() {
    const h = settings.wand.eyeHeight * settings.wand.scale;
    const u = h / 1.7;
    return {
        content: {
            type: 'group',
            children: [
                { name: 'head', content: { type: 'shape', shape: 'sphere', size: u * 0.22 }, placement: { position: [0, -u * 0.05, 0] } },
                { name: 'body', content: { type: 'shape', shape: 'cylinder', size: [u * 0.32, u * 0.7, u * 0.2] }, placement: { position: [0, -u * 0.55, 0] } },
                { name: 'legs', content: { type: 'shape', shape: 'cylinder', size: [u * 0.26, u * 0.8, u * 0.2] }, placement: { position: [0, -u * 1.3, 0] } },
                { name: 'wand', content: { type: 'shape', shape: 'cylinder', size: [u * 0.04, u * 0.35, u * 0.04] }, placement: { position: [u * 0.3, -u * 0.35, -u * 0.15], rotation: [90, 0, 0] }, appearance: { color: '#c0c0d0' } },
            ],
        },
        appearance: { color: '#4060a0' },
    };
}

async function defineObjects() {
    const b = settings.beam;
    const h = settings.wand.eyeHeight * settings.wand.scale;
    await putObject('holder', { ...holderBody(), placement: { position: world.origin, direction: [world.dir[0], 0, world.dir[2]] }, smoothMs: 80 });
    await putObject('beam', {
        content: { type: 'beam', length: b.range, angle: (b.halfAngle * 180) / Math.PI, radius: h * 0.02 },
        placement: { position: beamStart(), direction: world.dir },
        appearance: { color: b.color, visible: world.on },
        smoothMs: 60,
    });
    objectsDefined = true;
}

/** The beam leaves the wand tip, a little ahead of and beside the holder. */
function beamStart() {
    const u = (settings.wand.eyeHeight * settings.wand.scale) / 1.7;
    const [dx, , dz] = world.dir;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    // Right of the facing direction is (-fz, fx) in the x/z plane.
    return [world.origin[0] + fx * u * 0.3 - fz * u * 0.3, world.origin[1] - u * 0.3, world.origin[2] + fz * u * 0.3 + fx * u * 0.3];
}

let lastObjectJson = '';
async function updateObjects() {
    if (!objectsDefined) return;
    const json = JSON.stringify([world.origin, world.dir, world.on]);
    if (json === lastObjectJson) return;
    lastObjectJson = json;
    const s1 = await patchObject('holder', { placement: { position: world.origin, direction: [world.dir[0], 0, world.dir[2]] } });
    const s2 = await patchObject('beam', { placement: { position: beamStart(), direction: world.dir }, appearance: { visible: world.on } });
    // A 404 means the lease ran out (the player restarted): make them again.
    if (s1 === 404 || s2 === 404) await defineObjects().catch(() => (objectsDefined = false));
}

async function removeObjects() {
    objectsDefined = false;
    lastObjectJson = '';
    await Promise.all([deleteObject('holder'), deleteObject('beam')]);
}

// ---------------------------------------------------------------------------
// Round
// ---------------------------------------------------------------------------

async function start() {
    if (phase === 'playing' || phase === 'starting') return;
    phase = 'starting';
    message = '';
    publishDirty = true;
    try {
        await loadTargets();
        if (targetsError) throw new Error(targetsError);
        if (!settings.beamGroup && !settings.beamModels.length) throw new Error('No beam coverage: pick an xLights group or some models in the app settings.');
        const chosen = settings.spriteModels.map((m) => gridModels.find((g) => g.model === m)).filter(Boolean);
        if (!chosen.length) throw new Error('No sprite matrices: pick at least one grid model in the app settings.');
        if (settings.useUdp && !sock) {
            sock = dgram.createSocket('udp4');
            sock.on('error', () => undefined);
        }
        updateWorldPose();
        await openBeam();
        sprites = [];
        for (const t of chosen) {
            const res = await api('GET', `/api/ezp/overlays/targets?model=${encodeURIComponent(t.model)}&detail=nodes`);
            const row = res.targets.find((x) => x.model === t.model && !x.subModel);
            if (!row?.nodes?.world) throw new Error(`${t.model}: the player has no node coordinates for it`);
            const s = new Sprite(t, Float32Array.from(row.nodes.world));
            await s.open();
            s.nextAt = Date.now() + Math.random() * 1500;
            sprites.push(s);
        }
        await defineObjects();
        score = 0;
        tags = 0;
        misses = 0;
        roundResult = null;
        roundEndsAt = Date.now() + settings.rules.roundSeconds * 1000;
        phase = 'playing';
        console.log(`round started: ${sprites.length} sprite matrices, cast ${settings.cast}`);
    } catch (e) {
        message = e.message;
        console.log(`start failed: ${e.message}`);
        await releaseAll();
        phase = 'idle';
    }
    publishDirty = true;
}

async function releaseAll() {
    const gone = sprites;
    sprites = [];
    await Promise.allSettled(gone.map((s) => s.close()));
    if (beamLease) {
        await closeLease(beamLease);
        beamLease = null;
    }
    await removeObjects();
}

async function stop(result) {
    if (phase === 'idle' || phase === 'stopping') return;
    phase = 'stopping';
    publishDirty = true;
    roundResult = result ?? { score, tags, misses, reason: 'stopped' };
    await releaseAll();
    phase = result ? 'over' : 'idle';
    publishDirty = true;
    console.log(`round ${result ? 'over' : 'stopped'}: score ${score}, ${tags} tagged, ${misses} friends lit`);
}

let lastTick = Date.now();
async function tick() {
    const now = Date.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    updateWorldPose();
    if (phase !== 'playing') return;
    if (now >= roundEndsAt) {
        await stop({ score, tags, misses, reason: 'time' });
        return;
    }
    updateBeam();
    void updateObjects();
    for (const s of sprites) {
        s.step(now, dt);
        const cov = s.coverage();
        s.litFraction = cov;
        if (!s.hidden && s.flash <= 0 && cov >= settings.rules.coverage) {
            s.dwell += dt * 1000;
            if (s.dwell >= settings.rules.dwellMs) {
                const foe = s.tagged(now);
                if (foe) {
                    score += settings.rules.foePoints;
                    tags++;
                } else {
                    score = Math.max(0, score - settings.rules.friendPenalty);
                    misses++;
                }
                publishDirty = true;
            }
        } else {
            s.dwell = Math.max(0, s.dwell - dt * 2000);
        }
        s.send();
    }
}

// ---------------------------------------------------------------------------
// Status, settings, events
// ---------------------------------------------------------------------------

async function publish(force = false) {
    const now = Date.now();
    if (!force && !publishDirty && now - lastPublish < 500) return;
    if (!force && now - lastPublish < 150) return;
    lastPublish = now;
    publishDirty = false;
    const status = {
        phase,
        message,
        cast: settings.cast,
        score,
        tags,
        misses,
        timeLeft: phase === 'playing' ? Math.max(0, Math.ceil((roundEndsAt - now) / 1000)) : null,
        roundSeconds: settings.rules.roundSeconds,
        result: roundResult,
        beam: { on: world.on, fresh: !!world.fresh, lease: beamLease ? { id: beamLease.id, nodes: beamLease.nodeCount, backend: beamLease.pattern?.backend, group: beamLease.group ?? null, models: beamLease.models?.length ?? null } : null },
        pose: { x: pose.x, z: pose.z, yaw: pose.yaw, pitch: pose.pitch, on: pose.on, ageMs: pose.seen ? now - pose.seen : null },
        wand: { origin: world.origin.map((v) => Math.round(v)), dir: world.dir.map((v) => Math.round(v * 100) / 100) },
        sprites: sprites.map((s) => s.status()),
        groups: layoutGroups,
        gridModels,
        layoutBounds,
        targetsError,
        transport: settings.useUdp ? 'udp' : 'http',
    };
    await fetch(appUrl('/status'), { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(status) }).catch(() => undefined);
}

async function refreshSettings() {
    try {
        const res = await fetch(appUrl('/data/private/settings'), { headers: authHeaders });
        if (res.status !== 404 && !res.ok) throw new Error(`settings: HTTP ${res.status}`);
        const raw = res.status === 404 ? {} : ((await res.json()) ?? {});
        const next = normalize(raw);
        const json = JSON.stringify(next);
        if (json !== settingsJson) {
            const first = settingsJson === '';
            settingsJson = json;
            settings = next;
            publishDirty = true;
            if (first && settings.autoStart) wanted = 'running';
            // A changed beam or cast takes effect at the next round; the wand calibration applies at once.
        }
    } catch (e) {
        message = `Player not reachable: ${e.message}`;
    }
}

function handleEvent(ev) {
    const d = ev?.data;
    if (!d || typeof d !== 'object') return;
    const type = d.type === 'input' ? d.input : d.type;
    if (type === 'start') wanted = 'running';
    else if (type === 'stop') wanted = 'stopped';
    else if (type === 'pose') {
        const v = d.value;
        if (!v || typeof v !== 'object') return;
        pose.x = num(v.x, pose.x, -1000, 1000);
        pose.z = num(v.z, pose.z, -1000, 1000);
        pose.yaw = num(v.yaw, pose.yaw, -720, 720);
        pose.pitch = num(v.pitch, pose.pitch, -90, 90);
        pose.on = v.on === true || v.on === 1 || v.on === '1' || v.on === 'true';
        pose.seen = Date.now();
    }
}

async function pollEvents() {
    let since = 0;
    while (!quit) {
        try {
            const res = await fetch(appUrl(`/events?since=${since}&wait=30`), { headers: authHeaders });
            if (!res.ok) throw new Error(`events: HTTP ${res.status}`);
            const { events = [] } = await res.json();
            for (const ev of events) {
                since = Math.max(since, ev.id);
                handleEvent(ev);
            }
        } catch (e) {
            if (quit) return;
            console.log(`events: ${e.message}`);
            await sleep(2000);
        }
    }
}

async function main() {
    console.log(`Tag the Monsters: instance ${instance} at ${base}`);
    await refreshSettings();
    await Promise.all([loadTargets(), loadBounds()]);
    void pollEvents();
    let lastSettings = 0;
    let lastTargets = 0;
    while (!quit) {
        const now = Date.now();
        if (now - lastSettings > 2000) {
            lastSettings = now;
            await refreshSettings();
        }
        if (now - lastTargets > 15000 && phase !== 'playing') {
            lastTargets = now;
            await loadTargets();
        }
        if (wanted === 'running') {
            wanted = null;
            await start();
        } else if (wanted === 'stopped') {
            wanted = null;
            await stop();
        }
        await tick();
        await publish();
        const spent = Date.now() - now;
        await sleep(Math.max(5, TICK_MS - spent));
    }
}

async function shutdown() {
    if (quit) return;
    quit = true;
    await releaseAll().catch(() => undefined);
    if (sock) sock.close();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
