/*
 * Pattern programs: a color for every node as a pure function of where the node is,
 * the time, and a few uniforms an app updates frame by frame. Written as a small
 * expression graph in JSON, compiled once per lease to JavaScript (the evaluator the
 * player always has) and to GLSL (one point per node on the GPU, see @ezplayer/xlgl).
 * No per-node state and no neighbor reads: that is what lets one description run on
 * both.
 *
 * Inputs a program can read: `pos` (world coordinates, vec3), `local` (model-local
 * coordinates, vec3, zero when unknown), `t` (seconds since the lease opened), `i`
 * (node index within the lease), `n` (nodes in the lease), `u` (i / (n - 1)) and
 * uniforms as `$name`. Any of these may carry a swizzle, as in `pos.xz` or `$dir.y`.
 */

export type PatternExpr = number | number[] | string | PatternCall;

export interface PatternCall {
    op: string;
    args?: PatternExpr[];
    /** `ramp`: color stops as [position, color], colors '#rrggbb' or [r, g, b] in 0..1. */
    stops?: [number, string | number[]][];
    /** `swizzle`: the components to take, in xyzw or rgba letters. */
    sel?: string;
}

/** A float, a 2..4 vector, or a color ('#rrggbb', a vec3 in 0..1). */
export type PatternUniformValue = number | number[] | string;

export interface PatternProgram {
    /** Every uniform the program reads, with its default; the default fixes its type. */
    uniforms?: Record<string, PatternUniformValue>;
    /** vec3 or vec4, components 0..1. */
    color: PatternExpr;
    /** float 0..1, multiplies the color's alpha (1 when absent). */
    alpha?: PatternExpr;
}

/** What a lease asks for: a preset by name, or a program, plus starting uniform values. */
export interface PatternSpec {
    preset?: string;
    program?: PatternProgram;
    uniforms?: Record<string, PatternUniformValue>;
}

/** Uniform values after normalization: floats and plain arrays of 2..4 floats. */
export type PatternUniforms = Record<string, number | number[]>;

type Ty = 1 | 2 | 3 | 4;

const GL_TY: Record<Ty, string> = { 1: 'float', 2: 'vec2', 3: 'vec3', 4: 'vec4' };

export class PatternError extends Error {
    constructor(msg: string) {
        super(`pattern: ${msg}`);
        this.name = 'PatternError';
    }
}

function parseColor(s: string): number[] | undefined {
    const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
    if (!m) return undefined;
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function uniformValue(name: string, v: unknown): number | number[] {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const c = parseColor(v);
        if (c) return c;
        throw new PatternError(`uniform ${name}: not a color: ${v}`);
    }
    if (Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return v.slice();
    throw new PatternError(`uniform ${name}: expected a number, a 2..4 vector or '#rrggbb'`);
}

/** Uniforms as the evaluators take them; values of the wrong type for the program are rejected. */
export function normalizeUniforms(program: PatternProgram, values: Record<string, PatternUniformValue> | undefined): PatternUniforms {
    const out: PatternUniforms = {};
    const decl = program.uniforms ?? {};
    for (const [name, def] of Object.entries(decl)) out[name] = uniformValue(name, def);
    for (const [name, v] of Object.entries(values ?? {})) {
        if (!(name in decl)) continue;
        const nv = uniformValue(name, v);
        const want = typeof out[name] === 'number' ? 1 : (out[name] as number[]).length;
        const got = typeof nv === 'number' ? 1 : nv.length;
        if (want !== got) throw new PatternError(`uniform ${name}: expected ${want === 1 ? 'a number' : `a ${want}-vector`}`);
        out[name] = nv;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Lowering: expression -> typed SSA for both backends at once
// ---------------------------------------------------------------------------

interface Val {
    ty: Ty;
    /** One JavaScript expression (a temp name) per component. */
    js: string[];
    /** One GLSL expression (a temp name). */
    gl: string;
}

function glNum(x: number): string {
    if (!Number.isFinite(x)) throw new PatternError(`not a finite number: ${x}`);
    const s = String(x);
    return /[.e]/i.test(s) ? s : `${s}.0`;
}

const UNARY: Record<string, { js: (a: string) => string; gl: string }> = {
    neg: { js: (a) => `(-${a})`, gl: '-' },
    abs: { js: (a) => `Math.abs(${a})`, gl: 'abs' },
    floor: { js: (a) => `Math.floor(${a})`, gl: 'floor' },
    ceil: { js: (a) => `Math.ceil(${a})`, gl: 'ceil' },
    fract: { js: (a) => `(${a} - Math.floor(${a}))`, gl: 'fract' },
    sqrt: { js: (a) => `Math.sqrt(${a})`, gl: 'sqrt' },
    exp: { js: (a) => `Math.exp(${a})`, gl: 'exp' },
    log: { js: (a) => `Math.log(${a})`, gl: 'log' },
    sin: { js: (a) => `Math.sin(${a})`, gl: 'sin' },
    cos: { js: (a) => `Math.cos(${a})`, gl: 'cos' },
    tan: { js: (a) => `Math.tan(${a})`, gl: 'tan' },
    asin: { js: (a) => `Math.asin(${a})`, gl: 'asin' },
    acos: { js: (a) => `Math.acos(${a})`, gl: 'acos' },
    atan: { js: (a) => `Math.atan(${a})`, gl: 'atan' },
    sign: { js: (a) => `Math.sign(${a})`, gl: 'sign' },
    saturate: { js: (a) => `L.sat(${a})`, gl: 'saturate' },
};

const BINARY: Record<string, { js: (a: string, b: string) => string; gl: (a: string, b: string) => string }> = {
    add: { js: (a, b) => `(${a} + ${b})`, gl: (a, b) => `(${a} + ${b})` },
    sub: { js: (a, b) => `(${a} - ${b})`, gl: (a, b) => `(${a} - ${b})` },
    mul: { js: (a, b) => `(${a} * ${b})`, gl: (a, b) => `(${a} * ${b})` },
    div: { js: (a, b) => `(${a} / ${b})`, gl: (a, b) => `(${a} / ${b})` },
    min: { js: (a, b) => `Math.min(${a}, ${b})`, gl: (a, b) => `min(${a}, ${b})` },
    max: { js: (a, b) => `Math.max(${a}, ${b})`, gl: (a, b) => `max(${a}, ${b})` },
    mod: { js: (a, b) => `L.mod(${a}, ${b})`, gl: (a, b) => `mod(${a}, ${b})` },
    pow: { js: (a, b) => `Math.pow(${a}, ${b})`, gl: (a, b) => `pow(${a}, ${b})` },
    /** step(edge, x) */
    step: { js: (a, b) => `(${b} < ${a} ? 0 : 1)`, gl: (a, b) => `step(${a}, ${b})` },
    /** atan2(y, x) */
    atan2: { js: (a, b) => `Math.atan2(${a}, ${b})`, gl: (a, b) => `atan(${a}, ${b})` },
};

const TERNARY: Record<string, { js: (a: string, b: string, c: string) => string; gl: (a: string, b: string, c: string) => string }> = {
    /** clamp(x, lo, hi) */
    clamp: { js: (x, lo, hi) => `Math.min(Math.max(${x}, ${lo}), ${hi})`, gl: (x, lo, hi) => `clamp(${x}, ${lo}, ${hi})` },
    /** mix(a, b, t) */
    mix: { js: (a, b, t) => `(${a} + (${b} - ${a}) * ${t})`, gl: (a, b, t) => `mix(${a}, ${b}, ${t})` },
    /** smoothstep(e0, e1, x) */
    smoothstep: { js: (e0, e1, x) => `L.smooth(${e0}, ${e1}, ${x})`, gl: (e0, e1, x) => `smoothstep(${e0}, ${e1}, ${x})` },
};

const SWIZZLE_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };

const INPUTS: Record<string, Ty> = { pos: 3, local: 3, t: 1, i: 1, n: 1, u: 1 };

class Lowering {
    readonly jsLines: string[] = [];
    readonly glLines: string[] = [];
    readonly helpers = new Set<string>();
    readonly ramps: { stops: [number, number[]][] }[] = [];
    readonly usedInputs = new Set<string>();
    readonly usedUniforms = new Set<string>();
    private n = 0;

    constructor(readonly uniformTypes: Record<string, Ty>) {}

    private temp(ty: Ty, js: string[], gl: string): Val {
        const id = `v${this.n++}`;
        const names = ty === 1 ? [id] : Array.from({ length: ty }, (_, c) => `${id}_${c}`);
        for (let c = 0; c < ty; ++c) this.jsLines.push(`const ${names[c]} = ${js[c]};`);
        this.glLines.push(`${GL_TY[ty]} ${id} = ${gl};`);
        return { ty, js: names, gl: id };
    }

    /** Component c of v, broadcasting a float. */
    private comp(v: Val, c: number): string {
        return v.ty === 1 ? v.js[0] : v.js[c];
    }

    /** v as GLSL of type ty, broadcasting a float. */
    private glAs(v: Val, ty: Ty): string {
        return v.ty === ty ? v.gl : `${GL_TY[ty]}(${v.gl})`;
    }

    private joinTypes(op: string, vals: Val[]): Ty {
        let ty: Ty = 1;
        for (const v of vals) if (v.ty !== 1) ty = v.ty;
        for (const v of vals) if (v.ty !== 1 && v.ty !== ty) throw new PatternError(`${op}: mixed vector sizes ${v.ty} and ${ty}`);
        return ty;
    }

    lower(e: PatternExpr, what: string): Val {
        if (typeof e === 'number') return this.temp(1, [String(e)], glNum(e));
        if (Array.isArray(e)) {
            if (e.length < 2 || e.length > 4 || !e.every((x) => typeof x === 'number')) throw new PatternError(`${what}: a vector has 2 to 4 numbers`);
            const ty = e.length as Ty;
            return this.temp(ty, e.map(String), `${GL_TY[ty]}(${e.map(glNum).join(', ')})`);
        }
        if (typeof e === 'string') return this.ref(e, what);
        if (!e || typeof e !== 'object' || typeof e.op !== 'string') throw new PatternError(`${what}: expected a number, vector, name or {op}`);
        return this.call(e, what);
    }

    private ref(s: string, what: string): Val {
        const color = parseColor(s);
        if (color) return this.lower(color, what);
        const dot = s.indexOf('.');
        const name = dot >= 0 ? s.slice(0, dot) : s;
        const sel = dot >= 0 ? s.slice(dot + 1) : '';
        let v: Val;
        if (name.startsWith('$')) {
            const u = name.slice(1);
            const ty = this.uniformTypes[u];
            if (!ty) throw new PatternError(`${what}: unknown uniform ${name} (declare it in uniforms with a default)`);
            this.usedUniforms.add(u);
            v = { ty, js: ty === 1 ? [`U_${u}`] : Array.from({ length: ty }, (_, c) => `U_${u}_${c}`), gl: `U_${u}` };
        } else {
            const ty = INPUTS[name];
            if (!ty) throw new PatternError(`${what}: unknown name ${name}`);
            this.usedInputs.add(name);
            v = { ty, js: ty === 1 ? [name] : ['x', 'y', 'z'].map((c) => `${name}_${c}`), gl: name };
        }
        return sel ? this.swizzle(v, sel, what) : v;
    }

    private lengthOf(a: Val): Val {
        if (a.ty === 1) return this.temp(1, [`Math.abs(${a.js[0]})`], `abs(${a.gl})`);
        return this.temp(1, [`Math.sqrt(${a.js.map((x) => `${x} * ${x}`).join(' + ')})`], `length(${a.gl})`);
    }

    private swizzle(v: Val, sel: string, what: string): Val {
        if (sel.length < 1 || sel.length > 4) throw new PatternError(`${what}: swizzle ${sel} takes 1 to 4 components`);
        const idx = [...sel].map((ch) => {
            const k = SWIZZLE_INDEX[ch];
            if (k === undefined || k >= v.ty) throw new PatternError(`${what}: component ${ch} is not in a ${GL_TY[v.ty]}`);
            return k;
        });
        if (v.ty === 1) throw new PatternError(`${what}: a float has no components to swizzle`);
        const ty = idx.length as Ty;
        const glSel = idx.map((k) => 'xyzw'[k]).join('');
        return this.temp(ty, idx.map((k) => v.js[k]), `${v.gl}.${glSel}`);
    }

    private call(c: PatternCall, what: string): Val {
        const op = c.op;
        const args = (c.args ?? []).map((a, k) => this.lower(a, `${what}.${op}[${k}]`));
        const need = (k: number) => {
            if (args.length !== k) throw new PatternError(`${what}: ${op} takes ${k} argument${k === 1 ? '' : 's'}`);
        };
        if (op in UNARY) {
            need(1);
            const [a] = args;
            const f = UNARY[op];
            if (op === 'saturate') this.helpers.add('saturate');
            return this.temp(a.ty, a.js.map((x) => f.js(x)), `${f.gl}(${a.gl})`);
        }
        if (op in BINARY) {
            need(2);
            const [a, b] = args;
            const ty = this.joinTypes(op, args);
            const f = BINARY[op];
            const js = Array.from({ length: ty }, (_, k) => f.js(this.comp(a, k), this.comp(b, k)));
            // Explicit broadcasts: GLSL's pow and max take no mixed float/vector arguments.
            return this.temp(ty, js, f.gl(this.glAs(a, ty), this.glAs(b, ty)));
        }
        if (op in TERNARY) {
            need(3);
            const [a, b, d] = args;
            const ty = this.joinTypes(op, args);
            const f = TERNARY[op];
            const js = Array.from({ length: ty }, (_, k) => f.js(this.comp(a, k), this.comp(b, k), this.comp(d, k)));
            return this.temp(ty, js, f.gl(this.glAs(a, ty), this.glAs(b, ty), this.glAs(d, ty)));
        }
        switch (op) {
            case 'vec2':
            case 'vec3':
            case 'vec4': {
                const ty = Number(op[3]) as Ty;
                const parts: string[] = [];
                for (const a of args) parts.push(...a.js);
                if (parts.length === 1) while (parts.length < ty) parts.push(parts[0]);
                if (parts.length !== ty) throw new PatternError(`${what}: ${op} from ${parts.length} components`);
                return this.temp(ty, parts, `${op}(${args.map((a) => a.gl).join(', ')})`);
            }
            case 'swizzle': {
                need(1);
                if (typeof c.sel !== 'string') throw new PatternError(`${what}: swizzle needs sel`);
                return this.swizzle(args[0], c.sel, what);
            }
            case 'dot': {
                need(2);
                const [a, b] = args;
                if (a.ty !== b.ty || a.ty === 1) throw new PatternError(`${what}: dot takes two vectors of one size`);
                return this.temp(1, [a.js.map((x, k) => `${x} * ${b.js[k]}`).join(' + ')], `dot(${a.gl}, ${b.gl})`);
            }
            case 'length': {
                need(1);
                return this.lengthOf(args[0]);
            }
            case 'distance': {
                need(2);
                const [a, b] = args;
                if (a.ty !== b.ty) throw new PatternError(`${what}: distance takes two values of one size`);
                return this.lengthOf(this.temp(a.ty, a.js.map((x, k) => `(${x} - ${b.js[k]})`), `(${a.gl} - ${b.gl})`));
            }
            case 'normalize': {
                need(1);
                const [a] = args;
                if (a.ty === 1) throw new PatternError(`${what}: normalize takes a vector`);
                const len = this.temp(1, [`Math.sqrt(${a.js.map((x) => `${x} * ${x}`).join(' + ')})`], `length(${a.gl})`);
                const inv = this.temp(1, [`(${len.js[0]} > 0 ? 1 / ${len.js[0]} : 0)`], `(${len.gl} > 0.0 ? 1.0 / ${len.gl} : 0.0)`);
                return this.temp(a.ty, a.js.map((x) => `${x} * ${inv.js[0]}`), `(${a.gl} * ${inv.gl})`);
            }
            case 'cross': {
                need(2);
                const [a, b] = args;
                if (a.ty !== 3 || b.ty !== 3) throw new PatternError(`${what}: cross takes two vec3`);
                const [ax, ay, az] = a.js;
                const [bx, by, bz] = b.js;
                return this.temp(3, [`${ay} * ${bz} - ${az} * ${by}`, `${az} * ${bx} - ${ax} * ${bz}`, `${ax} * ${by} - ${ay} * ${bx}`], `cross(${a.gl}, ${b.gl})`);
            }
            case 'angle': {
                // The angle between two vectors, 0..pi; zero vectors give pi/2 rather than NaN.
                need(2);
                const [a, b] = args;
                if (a.ty !== b.ty || a.ty === 1) throw new PatternError(`${what}: angle takes two vectors of one size`);
                this.helpers.add('angle');
                return this.temp(1, [`L.angle(${a.js.join(', ')}, ${b.js.join(', ')})`], `angle${a.ty}(${a.gl}, ${b.gl})`);
            }
            case 'hash': {
                need(1);
                const [a] = args;
                this.helpers.add('hash');
                if (a.ty === 1) return this.temp(1, [`L.hash1(${a.js[0]})`], `hash1(${a.gl})`);
                return this.temp(1, [`L.hash${a.ty}(${a.js.join(', ')})`], `hash${a.ty}(${a.gl})`);
            }
            case 'noise':
            case 'fbm': {
                need(1);
                const [a] = args;
                if (a.ty !== 3) throw new PatternError(`${what}: ${op} takes a vec3`);
                this.helpers.add('hash');
                this.helpers.add('noise');
                if (op === 'fbm') this.helpers.add('fbm');
                return this.temp(1, [`L.${op}(${a.js.join(', ')})`], `${op}(${a.gl})`);
            }
            case 'hsv': {
                need(1);
                const [a] = args;
                if (a.ty !== 3) throw new PatternError(`${what}: hsv takes a vec3 of hue, saturation, value`);
                this.helpers.add('hsv');
                const id = `v${this.n++}`;
                this.jsLines.push(`L.hsv(${a.js.join(', ')}, T);`);
                const names = [0, 1, 2].map((k) => `${id}_${k}`);
                for (let k = 0; k < 3; ++k) this.jsLines.push(`const ${names[k]} = T[${k}];`);
                this.glLines.push(`vec3 ${id} = hsv(${a.gl});`);
                return { ty: 3, js: names, gl: id };
            }
            case 'ramp': {
                need(1);
                const [a] = args;
                if (a.ty !== 1) throw new PatternError(`${what}: ramp takes a float`);
                if (!Array.isArray(c.stops) || c.stops.length < 1) throw new PatternError(`${what}: ramp needs stops`);
                const stops: [number, number[]][] = c.stops.map((s, k) => {
                    if (!Array.isArray(s) || typeof s[0] !== 'number') throw new PatternError(`${what}: stop ${k} is [position, color]`);
                    const col = typeof s[1] === 'string' ? parseColor(s[1]) : Array.isArray(s[1]) && s[1].length === 3 ? s[1] : undefined;
                    if (!col) throw new PatternError(`${what}: stop ${k} color is '#rrggbb' or [r, g, b]`);
                    return [s[0], col];
                });
                stops.sort((x, y) => x[0] - y[0]);
                const k = this.ramps.length;
                this.ramps.push({ stops });
                const id = `v${this.n++}`;
                this.jsLines.push(`L.ramp(R[${k}], ${a.js[0]}, T);`);
                const names = [0, 1, 2].map((q) => `${id}_${q}`);
                for (let q = 0; q < 3; ++q) this.jsLines.push(`const ${names[q]} = T[${q}];`);
                this.glLines.push(`vec3 ${id} = ramp${k}(${a.gl});`);
                return { ty: 3, js: names, gl: id };
            }
            default:
                throw new PatternError(`${what}: unknown op ${op}`);
        }
    }
}

interface Lowered {
    low: Lowering;
    color: Val;
    alpha?: Val;
    uniformTypes: Record<string, Ty>;
}

function lowerProgram(program: PatternProgram): Lowered {
    if (!program || typeof program !== 'object' || program.color === undefined) throw new PatternError('a program needs a color expression');
    const uniformTypes: Record<string, Ty> = {};
    for (const [name, def] of Object.entries(program.uniforms ?? {})) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new PatternError(`uniform name ${name} must be an identifier`);
        if (name in INPUTS) throw new PatternError(`uniform ${name} shadows an input`);
        const v = uniformValue(name, def);
        uniformTypes[name] = typeof v === 'number' ? 1 : (v.length as Ty);
    }
    const low = new Lowering(uniformTypes);
    const color = low.lower(program.color, 'color');
    if (color.ty !== 3 && color.ty !== 4) throw new PatternError('color must be a vec3 or vec4');
    let alpha: Val | undefined;
    if (program.alpha !== undefined) {
        alpha = low.lower(program.alpha, 'alpha');
        if (alpha.ty !== 1) throw new PatternError('alpha must be a float');
    }
    return { low, color, alpha, uniformTypes };
}

/** Checks a program; throws PatternError with the reason when it cannot compile. */
export function validatePattern(program: PatternProgram): void {
    lowerProgram(program);
}

// ---------------------------------------------------------------------------
// JavaScript backend
// ---------------------------------------------------------------------------

/** Paint every node: RGBA bytes per node into out, straight alpha. */
export type PatternRenderFn = (world: Float32Array, local: Float32Array | undefined, n: number, t: number, uniforms: PatternUniforms, out: Uint8Array) => void;

const JS_LIB = {
    T: new Float32Array(4),
    sat: (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x),
    mod: (x: number, y: number) => x - y * Math.floor(x / y),
    smooth: (e0: number, e1: number, x: number) => {
        const t = e1 === e0 ? (x < e0 ? 0 : 1) : Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
        return t * t * (3 - 2 * t);
    },
    angle: (...v: number[]) => {
        const h = v.length / 2;
        let d = 0;
        let la = 0;
        let lb = 0;
        for (let k = 0; k < h; ++k) {
            d += v[k] * v[h + k];
            la += v[k] * v[k];
            lb += v[h + k] * v[h + k];
        }
        const den = Math.sqrt(la * lb);
        return den > 0 ? Math.acos(Math.min(1, Math.max(-1, d / den))) : Math.PI / 2;
    },
    // Hashes without sine (Dave Hoskins): only products, sums and fract of modest numbers,
    // so the GPU's float32 and this double arithmetic land on the same values.
    hash1: (x: number) => {
        let p = x * 0.1031;
        p -= Math.floor(p);
        p += p * (p + 33.33);
        const r = (p + p) * p;
        return r - Math.floor(r);
    },
    hash2: (x: number, y: number) => {
        let px = x * 0.1031;
        let py = y * 0.1031;
        let pz = x * 0.1031;
        px -= Math.floor(px);
        py -= Math.floor(py);
        pz -= Math.floor(pz);
        const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
        px += d;
        py += d;
        pz += d;
        const r = (px + py) * pz;
        return r - Math.floor(r);
    },
    hash3: (x: number, y: number, z: number) => {
        let px = x * 0.1031;
        let py = y * 0.1031;
        let pz = z * 0.1031;
        px -= Math.floor(px);
        py -= Math.floor(py);
        pz -= Math.floor(pz);
        const d = px * (pz + 31.32) + py * (py + 31.32) + pz * (px + 31.32);
        px += d;
        py += d;
        pz += d;
        const r = (px + py) * pz;
        return r - Math.floor(r);
    },
    hash4: (x: number, y: number, z: number, w: number) => {
        let px = x * 0.1031;
        let py = y * 0.103;
        let pz = z * 0.0973;
        let pw = w * 0.1099;
        px -= Math.floor(px);
        py -= Math.floor(py);
        pz -= Math.floor(pz);
        pw -= Math.floor(pw);
        const d = px * (pw + 33.33) + py * (pz + 33.33) + pz * (px + 33.33) + pw * (py + 33.33);
        px += d;
        py += d;
        pz += d;
        pw += d;
        const r = (px + py) * (pz + pw);
        return r - Math.floor(r);
    },
    /** Value noise on the unit lattice, 0..1. */
    noise(x: number, y: number, z: number): number {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const iz = Math.floor(z);
        let fx = x - ix;
        let fy = y - iy;
        let fz = z - iz;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        fz = fz * fz * (3 - 2 * fz);
        const h = JS_LIB.hash3;
        const c00 = h(ix, iy, iz) + (h(ix + 1, iy, iz) - h(ix, iy, iz)) * fx;
        const c10 = h(ix, iy + 1, iz) + (h(ix + 1, iy + 1, iz) - h(ix, iy + 1, iz)) * fx;
        const c01 = h(ix, iy, iz + 1) + (h(ix + 1, iy, iz + 1) - h(ix, iy, iz + 1)) * fx;
        const c11 = h(ix, iy + 1, iz + 1) + (h(ix + 1, iy + 1, iz + 1) - h(ix, iy + 1, iz + 1)) * fx;
        const c0 = c00 + (c10 - c00) * fy;
        const c1 = c01 + (c11 - c01) * fy;
        return c0 + (c1 - c0) * fz;
    },
    /** Four octaves of value noise, 0..1. */
    fbm(x: number, y: number, z: number): number {
        let a = 0.5;
        let s = 0;
        for (let o = 0; o < 4; ++o) {
            s += a * JS_LIB.noise(x, y, z);
            x = x * 2 + 17.3;
            y = y * 2 + 9.1;
            z = z * 2 + 31.7;
            a *= 0.5;
        }
        return s / 0.9375;
    },
    hsv(h: number, s: number, v: number, out: Float32Array): void {
        h = h - Math.floor(h);
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const p = v * (1 - s);
        const q = v * (1 - f * s);
        const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: out[0] = v; out[1] = t; out[2] = p; break;
            case 1: out[0] = q; out[1] = v; out[2] = p; break;
            case 2: out[0] = p; out[1] = v; out[2] = t; break;
            case 3: out[0] = p; out[1] = q; out[2] = v; break;
            case 4: out[0] = t; out[1] = p; out[2] = v; break;
            default: out[0] = v; out[1] = p; out[2] = q;
        }
    },
    ramp(stops: [number, number[]][], t: number, out: Float32Array): void {
        let [, c] = stops[0];
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
        for (let k = 1; k < stops.length; ++k) {
            const [t0] = stops[k - 1];
            const [t1, c1] = stops[k];
            const w = t1 === t0 ? (t < t1 ? 0 : 1) : Math.min(Math.max((t - t0) / (t1 - t0), 0), 1);
            out[0] += (c1[0] - out[0]) * w;
            out[1] += (c1[1] - out[1]) * w;
            out[2] += (c1[2] - out[2]) * w;
            c = c1;
        }
    },
};

/** Compile a program to a JavaScript evaluator over all nodes of a lease. */
export function compilePatternJs(program: PatternProgram): PatternRenderFn {
    const { low, color, alpha, uniformTypes } = lowerProgram(program);
    const src: string[] = [];
    src.push('const T = L.T;');
    // Uniforms are read once per frame, not per node.
    for (const u of low.usedUniforms) {
        const ty = uniformTypes[u];
        if (ty === 1) src.push(`const U_${u} = U.${u};`);
        else for (let c = 0; c < ty; ++c) src.push(`const U_${u}_${c} = U.${u}[${c}];`);
    }
    const wantLocal = low.usedInputs.has('local');
    src.push('const nInv = n > 1 ? 1 / (n - 1) : 0;');
    src.push('for (let k = 0; k < n; ++k) {');
    src.push('const i = k;');
    if (low.usedInputs.has('u')) src.push('const u = k * nInv;');
    if (low.usedInputs.has('pos')) src.push('const pos_x = world[k * 3], pos_y = world[k * 3 + 1], pos_z = world[k * 3 + 2];');
    if (wantLocal) src.push('const local_x = local ? local[k * 3] : 0, local_y = local ? local[k * 3 + 1] : 0, local_z = local ? local[k * 3 + 2] : 0;');
    src.push(...low.jsLines);
    const a = color.ty === 4 ? color.js[3] : '1';
    const alphaExpr = alpha ? `${a} * ${alpha.js[0]}` : a;
    src.push(`const o = k * 4;`);
    src.push(`out[o] = L.byte(${color.js[0]}); out[o + 1] = L.byte(${color.js[1]}); out[o + 2] = L.byte(${color.js[2]}); out[o + 3] = L.byte(${alphaExpr});`);
    src.push('}');
    const lib = { ...JS_LIB, byte: (x: number) => (x <= 0 || x !== x ? 0 : x >= 1 ? 255 : (x * 255 + 0.5) | 0) };
    const ramps = low.ramps.map((r) => r.stops);
    // The source is assembled from a validated expression tree, never from client text.
    const fn = new Function('L', 'R', 'world', 'local', 'n', 't', 'U', 'out', src.join('\n')) as (
        L: typeof lib,
        R: typeof ramps,
        world: Float32Array,
        local: Float32Array | undefined,
        n: number,
        t: number,
        U: PatternUniforms,
        out: Uint8Array,
    ) => void;
    return (world, local, n, t, U, out) => fn(lib, ramps, world, local, n, t, U, out);
}

// ---------------------------------------------------------------------------
// GLSL backend
// ---------------------------------------------------------------------------

export interface PatternGlsl {
    vertex: string;
    fragment: string;
    /** Uniform name -> components, for binding. */
    uniforms: Record<string, Ty>;
    /** Whether the vertex shader reads the `local` attribute. */
    usesLocal: boolean;
}

const GL_HELPERS: Record<string, string> = {
    saturate: `float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 saturate(vec4 x) { return clamp(x, 0.0, 1.0); }`,
    angle: `float angle2(vec2 a, vec2 b) { float d = length(a) * length(b); return d > 0.0 ? acos(clamp(dot(a, b) / d, -1.0, 1.0)) : 1.5707963; }
float angle3(vec3 a, vec3 b) { float d = length(a) * length(b); return d > 0.0 ? acos(clamp(dot(a, b) / d, -1.0, 1.0)) : 1.5707963; }
float angle4(vec4 a, vec4 b) { float d = length(a) * length(b); return d > 0.0 ? acos(clamp(dot(a, b) / d, -1.0, 1.0)) : 1.5707963; }`,
    hash: `float hash1(float x) { float p = fract(x * 0.1031); p += p * (p + 33.33); return fract((p + p) * p); }
float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hash3(vec3 p) { vec3 q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
float hash4(vec4 p) { vec4 q = fract(p * vec4(0.1031, 0.1030, 0.0973, 0.1099)); q += dot(q, q.wzxy + 33.33); return fract((q.x + q.y) * (q.z + q.w)); }`,
    noise: `float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = p - i;
    f = f * f * (3.0 - 2.0 * f);
    float c00 = mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x);
    float c10 = mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x);
    float c01 = mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x);
    float c11 = mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x);
    return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}`,
    fbm: `float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int o = 0; o < 4; ++o) {
        s += a * noise(p);
        p = p * 2.0 + vec3(17.3, 9.1, 31.7);
        a *= 0.5;
    }
    return s / 0.9375;
}`,
    hsv: `vec3 hsv(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`,
};

function glVec3(c: number[]): string {
    return `vec3(${c.map(glNum).join(', ')})`;
}

/**
 * Compile a program to a GLSL 3.3 vertex shader that puts node i on texel i of a
 * `size` target and a passthrough fragment shader. Attributes: `pos` (vec3) and,
 * when used, `local` (vec3). Built-in uniforms: `size` (vec2), `t`, `n` (float).
 */
export function compilePatternGlsl(program: PatternProgram): PatternGlsl {
    const { low, color, alpha, uniformTypes } = lowerProgram(program);
    const lines: string[] = ['#version 330 core', 'in vec3 pos;'];
    const usesLocal = low.usedInputs.has('local');
    if (usesLocal) lines.push('in vec3 local;');
    lines.push('uniform vec2 size;', 'uniform float t;', 'uniform float n;');
    const uniforms: Record<string, Ty> = {};
    for (const u of low.usedUniforms) {
        uniforms[u] = uniformTypes[u];
        lines.push(`uniform ${GL_TY[uniformTypes[u]]} U_${u};`);
    }
    lines.push('out vec4 vcolor;');
    for (const h of ['saturate', 'angle', 'hash', 'noise', 'fbm', 'hsv']) if (low.helpers.has(h)) lines.push(GL_HELPERS[h]);
    low.ramps.forEach((r, k) => {
        const body: string[] = [`vec3 c = ${glVec3(r.stops[0][1])};`];
        for (let s = 1; s < r.stops.length; ++s) {
            const [t0] = r.stops[s - 1];
            const [t1, c1] = r.stops[s];
            const w = t1 === t0 ? `step(${glNum(t1)}, x)` : `clamp((x - ${glNum(t0)}) / ${glNum(t1 - t0)}, 0.0, 1.0)`;
            body.push(`c = mix(c, ${glVec3(c1)}, ${w});`);
        }
        body.push('return c;');
        lines.push(`vec3 ramp${k}(float x) {\n    ${body.join('\n    ')}\n}`);
    });
    lines.push('void main() {');
    lines.push('    float i = float(gl_VertexID);');
    lines.push('    float u = n > 1.0 ? i / (n - 1.0) : 0.0;');
    for (const l of low.glLines) lines.push(`    ${l}`);
    const c4 = color.ty === 4 ? color.gl : `vec4(${color.gl}, 1.0)`;
    lines.push(`    vec4 c = ${c4};`);
    if (alpha) lines.push(`    c.a *= ${alpha.gl};`);
    lines.push('    vcolor = clamp(c, 0.0, 1.0);');
    lines.push('    float px = mod(i, size.x);');
    lines.push('    float py = floor(i / size.x);');
    lines.push('    gl_Position = vec4((px + 0.5) / size.x * 2.0 - 1.0, (py + 0.5) / size.y * 2.0 - 1.0, 0.0, 1.0);');
    lines.push('}');
    const fragment = `#version 330 core
in vec4 vcolor;
out vec4 color;
void main() { color = vcolor; }`;
    return { vertex: lines.join('\n'), fragment, uniforms, usesLocal };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** Programs apps can name instead of writing their own; uniforms override the defaults. */
export const PATTERN_PRESETS: Record<string, PatternProgram> = {
    /** A flashlight cone from `origin` along `dir`, soft-edged, fading with distance; `noise` adds drifting cloudiness. */
    beam: {
        uniforms: { origin: [0, 0, 0], dir: [0, 0, -1], halfAngle: 0.12, softness: 0.3, range: 1000, color: '#fff0c0', noise: 0 },
        color: '$color',
        alpha: {
            op: 'mul',
            args: [
                {
                    op: 'mul',
                    args: [
                        { op: 'sub', args: [1, { op: 'smoothstep', args: [{ op: 'mul', args: ['$halfAngle', { op: 'sub', args: [1, '$softness'] }] }, '$halfAngle', { op: 'angle', args: [{ op: 'sub', args: ['pos', '$origin'] }, '$dir'] }] }] },
                        { op: 'saturate', args: [{ op: 'sub', args: [1, { op: 'div', args: [{ op: 'distance', args: ['pos', '$origin'] }, '$range'] }] }] },
                    ],
                },
                { op: 'sub', args: [1, { op: 'mul', args: ['$noise', { op: 'fbm', args: [{ op: 'add', args: [{ op: 'mul', args: ['pos', 0.02] }, { op: 'vec3', args: [{ op: 'mul', args: ['t', 0.3] }] }] }] }] }] },
            ],
        },
    },
    /** A ring of light `radius` from `center`, `thickness` wide. */
    shockwave: {
        uniforms: { center: [0, 0, 0], radius: 0, thickness: 20, color: '#80c0ff' },
        color: '$color',
        alpha: { op: 'sub', args: [1, { op: 'saturate', args: [{ op: 'div', args: [{ op: 'abs', args: [{ op: 'sub', args: [{ op: 'distance', args: ['pos', '$center'] }, '$radius'] }] }, '$thickness'] }] }] },
    },
    /** A band `width` wide across the plane `dot(pos, dir) = offset`. */
    wipe: {
        uniforms: { dir: [1, 0, 0], offset: 0, width: 30, color: '#ffffff' },
        color: '$color',
        alpha: { op: 'sub', args: [1, { op: 'saturate', args: [{ op: 'div', args: [{ op: 'abs', args: [{ op: 'sub', args: [{ op: 'dot', args: ['pos', '$dir'] }, '$offset'] }] }, '$width'] }] }] },
    },
    /** Flames rising from `base` up to `height`: scrolled noise through a heat ramp. */
    fire: {
        uniforms: { base: 0, height: 100, speed: 40, scale: 0.03, intensity: 1 },
        color: {
            op: 'ramp',
            args: [{ op: 'saturate', args: [{ op: 'mul', args: ['$intensity', { op: 'add', args: [{ op: 'sub', args: [{ op: 'mul', args: [{ op: 'fbm', args: [{ op: 'vec3', args: [{ op: 'mul', args: ['pos.x', '$scale'] }, { op: 'sub', args: [{ op: 'mul', args: ['pos.y', '$scale'] }, { op: 'mul', args: ['t', { op: 'mul', args: ['$speed', '$scale'] }] }] }, { op: 'mul', args: ['pos.z', '$scale'] }] }] }, 1.6] }, { op: 'mul', args: [{ op: 'div', args: [{ op: 'sub', args: ['pos.y', '$base'] }, '$height'] }, 1.3] }] }, 0.1] }] }] }],
            stops: [[0, '#000000'], [0.25, '#7a0000'], [0.5, '#ff4a00'], [0.75, '#ffb020'], [1, '#ffffe0']],
        },
        alpha: { op: 'saturate', args: [{ op: 'mul', args: [2, { op: 'mul', args: ['$intensity', { op: 'add', args: [{ op: 'sub', args: [{ op: 'mul', args: [{ op: 'fbm', args: [{ op: 'vec3', args: [{ op: 'mul', args: ['pos.x', '$scale'] }, { op: 'sub', args: [{ op: 'mul', args: ['pos.y', '$scale'] }, { op: 'mul', args: ['t', { op: 'mul', args: ['$speed', '$scale'] }] }] }, { op: 'mul', args: ['pos.z', '$scale'] }] }] }, 1.6] }, { op: 'mul', args: [{ op: 'div', args: [{ op: 'sub', args: ['pos.y', '$base'] }, '$height'] }, 1.3] }] }, 0.1] }] }] }] },
    },
    /** Flakes drifting down: one per `cell` of space with a random offset, falling at `speed`. */
    snow: {
        uniforms: { cell: 25, speed: 30, size: 0.35, density: 0.6, color: '#e8f4ff' },
        color: '$color',
        alpha: {
            op: 'mul',
            args: [
                { op: 'step', args: [{ op: 'sub', args: [1, '$density'] }, { op: 'hash', args: [{ op: 'floor', args: [{ op: 'div', args: [{ op: 'add', args: ['pos', { op: 'vec3', args: [0, { op: 'mul', args: ['t', '$speed'] }, 0] }] }, '$cell'] }] }] }] },
                {
                    op: 'sub',
                    args: [
                        1,
                        {
                            op: 'smoothstep',
                            args: [
                                0,
                                '$size',
                                {
                                    op: 'distance',
                                    args: [
                                        { op: 'fract', args: [{ op: 'div', args: [{ op: 'add', args: ['pos', { op: 'vec3', args: [0, { op: 'mul', args: ['t', '$speed'] }, 0] }] }, '$cell'] }] },
                                        {
                                            op: 'add',
                                            args: [
                                                0.3,
                                                {
                                                    op: 'mul',
                                                    args: [
                                                        0.4,
                                                        {
                                                            op: 'vec3',
                                                            args: [
                                                                { op: 'hash', args: [{ op: 'add', args: [{ op: 'floor', args: [{ op: 'div', args: [{ op: 'add', args: ['pos', { op: 'vec3', args: [0, { op: 'mul', args: ['t', '$speed'] }, 0] }] }, '$cell'] }] }, [1.7, 3.1, 5.3]] }] },
                                                                { op: 'hash', args: [{ op: 'add', args: [{ op: 'floor', args: [{ op: 'div', args: [{ op: 'add', args: ['pos', { op: 'vec3', args: [0, { op: 'mul', args: ['t', '$speed'] }, 0] }] }, '$cell'] }] }, [7.9, 2.3, 4.1]] }] },
                                                                { op: 'hash', args: [{ op: 'add', args: [{ op: 'floor', args: [{ op: 'div', args: [{ op: 'add', args: ['pos', { op: 'vec3', args: [0, { op: 'mul', args: ['t', '$speed'] }, 0] }] }, '$cell'] }] }, [3.3, 8.7, 1.9]] }] },
                                                            ],
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    /** Streaks falling through columns `cell` apart, each `length` long, with a trail. */
    meteors: {
        uniforms: { cell: 40, speed: 120, length: 60, height: 300, density: 0.5, color: '#c0e0ff' },
        color: '$color',
        alpha: {
            op: 'mul',
            args: [
                { op: 'step', args: [{ op: 'sub', args: [1, '$density'] }, { op: 'hash', args: [{ op: 'floor', args: [{ op: 'div', args: ['pos.xz', '$cell'] }] }] }] },
                {
                    op: 'mul',
                    args: [
                        // Across the column: bright at its center, dark at its edge.
                        { op: 'sub', args: [1, { op: 'smoothstep', args: [0, 0.5, { op: 'distance', args: [{ op: 'fract', args: [{ op: 'div', args: ['pos.xz', '$cell'] }] }, [0.5, 0.5]] }] }] },
                        // Along it: the head is at a height that wraps with time and a per-column phase; the trail fades below it.
                        {
                            op: 'mul',
                            args: [
                                { op: 'step', args: [0, { op: 'sub', args: [{ op: 'mul', args: ['$height', { op: 'fract', args: [{ op: 'sub', args: [{ op: 'hash', args: [{ op: 'add', args: [{ op: 'floor', args: [{ op: 'div', args: ['pos.xz', '$cell'] }] }, [2.7, 9.3]] }] }, { op: 'div', args: [{ op: 'mul', args: ['t', '$speed'] }, '$height'] }] }] }] }, 'pos.y'] }] },
                                { op: 'saturate', args: [{ op: 'sub', args: [1, { op: 'div', args: [{ op: 'sub', args: [{ op: 'mul', args: ['$height', { op: 'fract', args: [{ op: 'sub', args: [{ op: 'hash', args: [{ op: 'add', args: [{ op: 'floor', args: [{ op: 'div', args: ['pos.xz', '$cell'] }] }, [2.7, 9.3]] }] }, { op: 'div', args: [{ op: 'mul', args: ['t', '$speed'] }, '$height'] }] }] }] }, 'pos.y'] }, '$length'] }] }] },
                            ],
                        },
                    ],
                },
            ],
        },
    },
    /** One color everywhere. */
    solid: { uniforms: { color: '#ffffff', opacity: 1 }, color: '$color', alpha: '$opacity' },
    /** Hue by position along `dir`, cycling over `period` units and drifting at `speed` cycles a second. */
    rainbow: {
        uniforms: { dir: [1, 0, 0], period: 200, speed: 0.2 },
        color: { op: 'hsv', args: [{ op: 'vec3', args: [{ op: 'fract', args: [{ op: 'add', args: [{ op: 'div', args: [{ op: 'dot', args: ['pos', '$dir'] }, '$period'] }, { op: 'mul', args: ['t', '$speed'] }] }] }, 1, 1] }] },
    },
};

/** The program and starting uniforms a lease's pattern spec resolves to. */
export function resolvePattern(spec: PatternSpec): { program: PatternProgram; uniforms: PatternUniforms; preset?: string } {
    if (!spec || typeof spec !== 'object') throw new PatternError('a pattern lease needs pattern: { preset } or { program }');
    let program: PatternProgram;
    if (spec.preset !== undefined) {
        const p = PATTERN_PRESETS[spec.preset];
        if (!p) throw new PatternError(`unknown preset ${spec.preset}; one of ${Object.keys(PATTERN_PRESETS).join(', ')}`);
        program = p;
    } else if (spec.program) {
        program = spec.program;
    } else {
        throw new PatternError('a pattern lease needs pattern: { preset } or { program }');
    }
    validatePattern(program);
    return { program, uniforms: normalizeUniforms(program, spec.uniforms), preset: spec.preset };
}
