/*
 * Spatial test patterns: simple formulas over a per-node coordinate (a
 * projection of the node's world position, or its place along the wiring)
 * plus time.  A renderer is compiled once per (targets, params) and then
 * writes into canonical frames without allocating.
 *
 * This is the test-mode stage of the compositor: it replaces whatever is in
 * the target nodes.
 */

import { DisplayLayout, LayoutModel, parseHexColor } from './Layout';
import { hsvToRgb } from './Kernels';
import { TargetCatalog } from './Targets';

export type SpatialPatternKind =
    /** One color on every node. */
    | 'solid'
    /** Bands of the palette marching along the direction. */
    | 'bars'
    /** A hue sweep along the direction. */
    | 'rainbow'
    /** A lit window travelling along the coordinate, black elsewhere. */
    | 'chase'
    /** Whole target flashing on and off. */
    | 'strobe'
    /** Whole target stepping through the palette (color order check). */
    | 'colorCycle'
    /** Every Nth node along the wiring lit, with the first and last node marked (pixel counting). */
    | 'markers'
    /** Each strand in one color of the palette, in turn (string order check). */
    | 'strands';

export type PatternSpace =
    /** Project world coordinates onto the direction; the pattern spans all targets as one picture. */
    | 'world'
    /** Project each target's own coordinates onto the direction; every target gets the whole pattern. */
    | 'local'
    /** Position along each target's wiring, 0 at its first node. */
    | 'node'
    /** Position along each strand, 0 at the strand's first node. */
    | 'strand';

export interface SpatialPatternParams {
    kind: SpatialPatternKind;
    /** Palette as '#rrggbb'. Defaults depend on the kind. */
    colors?: string[];
    /** Direction of travel in the XY plane, degrees; 0 is +X, 90 is +Y. */
    angleDeg?: number;
    /** Tilt of the direction out of the XY plane toward +Z, degrees. */
    elevationDeg?: number;
    /** Band width (bars, chase) or one full period (rainbow), as a fraction of the extent. */
    width?: number;
    /** Lit fraction of each band for bars, 0..1. */
    duty?: number;
    /** Motion in periods (bars, rainbow) or extents (chase) per second. */
    speed?: number;
    /** Step time for strobe and colorCycle. */
    periodMs?: number;
    /** Node spacing for markers. */
    every?: number;
    space?: PatternSpace;
    /** 0..1 scale on every color. */
    intensity?: number;
}

/** What a pattern paints: a model or a submodel, as its nodes in wiring order. */
export interface SpatialPatternTarget {
    /** "Model" or "Model/Submodel". */
    name: string;
    /** Canonical node per target node, in wiring order (the listed order for a submodel). */
    nodes: Int32Array;
    /** Nodes per strand in that order; one strand when absent or when they do not add up to the nodes. */
    strands?: number[];
    /** Model-local coordinates, 3 floats per target node. */
    local?: Float32Array;
}

const DEFAULT_PALETTES: Record<SpatialPatternKind, string[]> = {
    solid: ['#ffffff'],
    bars: ['#ff0000', '#00ff00', '#0000ff'],
    rainbow: [],
    chase: ['#ffffff'],
    strobe: ['#ffffff'],
    colorCycle: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'],
    markers: ['#ffffff', '#00ff00', '#ff0000'],
    strands: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'],
};

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function frac(v: number): number {
    return v - Math.floor(v);
}

function buildPalette(p: SpatialPatternParams): Uint8Array {
    const src = p.colors && p.colors.length ? p.colors : DEFAULT_PALETTES[p.kind];
    const k = clamp01(p.intensity ?? 1);
    const out = new Uint8Array(Math.max(1, src.length) * 3);
    src.forEach((hex, i) => {
        const c = parseHexColor(hex) ?? [255, 255, 255];
        out[i * 3] = Math.round(c[0] * k);
        out[i * 3 + 1] = Math.round(c[1] * k);
        out[i * 3 + 2] = Math.round(c[2] * k);
    });
    return out;
}

/** A layout model as a pattern target: its nodes in wiring order, no strands or local coordinates. */
export function patternTargetOfModel(m: LayoutModel): SpatialPatternTarget {
    const nodes = new Int32Array(m.nodeCount);
    // Canonical position perm[i] holds xLights node i.
    for (let i = 0; i < m.nodeCount; ++i) nodes[i] = m.nodeStart + (m.perm ? m.perm[i] : i);
    return { name: m.name, nodes };
}

/** Pixel models of a layout by name, as pattern targets; unknown and raw models are skipped. */
export function patternTargetsForModels(layout: DisplayLayout, names: Iterable<string>): SpatialPatternTarget[] {
    const want = new Set(names);
    return layout.models
        .filter((m) => m.nodeStart >= 0 && m.nodeCount > 0 && want.has(m.name))
        .map(patternTargetOfModel);
}

/**
 * Models and submodels ("Model/Submodel") by name, with their strands and
 * local coordinates, in the order asked for.  Names the catalog does not
 * have are skipped.
 */
export function patternTargets(catalog: TargetCatalog, names: Iterable<string>): SpatialPatternTarget[] {
    const out: SpatialPatternTarget[] = [];
    const seen = new Set<string>();
    for (const name of names) {
        const t = catalog.find(name);
        if (!t || !t.nodes.length || seen.has(t.name)) continue;
        seen.add(t.name);
        if (t.subModel) {
            out.push({ name: t.name, nodes: t.nodes, strands: t.strands, local: t.local });
            continue;
        }
        const lm = catalog.layout.models.find((m) => m.name === t.model && m.nodeStart >= 0);
        if (!lm) continue;
        const tg = patternTargetOfModel(lm);
        tg.strands = t.strands;
        if (t.local) {
            // The catalog keeps a model's coordinates in canonical order.
            const local = new Float32Array(lm.nodeCount * 3);
            for (let i = 0; i < lm.nodeCount; ++i) {
                const c = (tg.nodes[i] - lm.nodeStart) * 3;
                local.set(t.local.subarray(c, c + 3), i * 3);
            }
            tg.local = local;
        }
        out.push(tg);
    }
    return out;
}

export class SpatialPatternRenderer {
    readonly params: SpatialPatternParams;
    /** Names of the targets painted. */
    readonly names: string[];
    /** Nodes painted per frame. */
    readonly nodeCount: number;
    private readonly palette: Uint8Array;
    private readonly paletteSize: number;
    /** Per painted node, targets concatenated, each in wiring order: */
    /** canonical node, */
    private readonly idx: Int32Array;
    /** coordinate 0..1, */
    private readonly u: Float32Array;
    /** place in the counted run (the target, or the strand in strand space), and that run's length, */
    private readonly pos: Int32Array;
    private readonly len: Int32Array;
    /** and the strand it is on. */
    private readonly strand: Int32Array;

    constructor(layout: DisplayLayout, targets: SpatialPatternTarget[], params: SpatialPatternParams) {
        this.params = params;
        this.palette = buildPalette(params);
        this.paletteSize = this.palette.length / 3;
        const usable = targets.filter((t) => t.nodes.length > 0);
        this.names = usable.map((t) => t.name);
        const total = usable.reduce((a, t) => a + t.nodes.length, 0);
        this.nodeCount = total;
        this.idx = new Int32Array(total);
        this.u = new Float32Array(total);
        this.pos = new Int32Array(total);
        this.len = new Int32Array(total);
        this.strand = new Int32Array(total);

        const world = layout.world;
        let space: PatternSpace =
            params.space ?? (params.kind === 'chase' || params.kind === 'markers' ? 'node' : 'world');
        if (space === 'world' && !world) space = 'node';

        const az = ((params.angleDeg ?? 0) * Math.PI) / 180;
        const el = ((params.elevationDeg ?? 0) * Math.PI) / 180;
        const dx = Math.cos(az) * Math.cos(el);
        const dy = Math.sin(az) * Math.cos(el);
        const dz = Math.sin(el);
        const normalize = (from: number, to: number) => {
            let lo = Infinity;
            let hi = -Infinity;
            for (let i = from; i < to; ++i) {
                if (this.u[i] < lo) lo = this.u[i];
                if (this.u[i] > hi) hi = this.u[i];
            }
            const span = hi - lo;
            for (let i = from; i < to; ++i) this.u[i] = span > 1e-9 ? (this.u[i] - lo) / span : 0;
        };

        let base = 0;
        for (const t of usable) {
            const n = t.nodes.length;
            const listed = t.strands?.filter((c) => c > 0) ?? [];
            const strands = listed.length && listed.reduce((a, c) => a + c, 0) === n ? listed : [n];
            let i = 0;
            strands.forEach((count, si) => {
                for (let k = 0; k < count; ++k, ++i) {
                    const o = base + i;
                    this.idx[o] = t.nodes[i];
                    this.strand[o] = si;
                    if (space === 'strand') {
                        this.pos[o] = k;
                        this.len[o] = count;
                    } else {
                        this.pos[o] = i;
                        this.len[o] = n;
                    }
                }
            });
            // Local coordinates when the target has them, else its own corner of the world.
            const own = space === 'local' ? (t.local && t.local.length >= n * 3 ? t.local : undefined) : undefined;
            for (let k = 0; k < n; ++k) {
                const o = base + k;
                if (own) {
                    this.u[o] = own[k * 3] * dx + own[k * 3 + 1] * dy + own[k * 3 + 2] * dz;
                } else if ((space === 'world' || space === 'local') && world) {
                    const w = this.idx[o] * 3;
                    this.u[o] = world[w] * dx + world[w + 1] * dy + world[w + 2] * dz;
                } else {
                    this.u[o] = this.pos[o] / this.len[o];
                }
            }
            if (space === 'local' && (own || world)) normalize(base, base + n);
            base += n;
        }
        if (space === 'world') normalize(0, total);
    }

    /** Paint the targets of a canonical frame for time tMs. */
    render(frame: Uint8Array, stride: number, tMs: number): void {
        const p = this.params;
        const pal = this.palette;
        const np = this.paletteSize;
        const t = tMs / 1000;
        const { idx, u, pos, len, strand } = this;
        const n = this.nodeCount;
        switch (p.kind) {
            case 'solid':
            case 'strobe':
            case 'colorCycle': {
                let r = pal[0];
                let g = pal[1];
                let b = pal[2];
                if (p.kind === 'strobe') {
                    const period = Math.max(20, p.periodMs ?? 500);
                    if (Math.floor(tMs / period) % 2 !== 0) r = g = b = 0;
                } else if (p.kind === 'colorCycle') {
                    const period = Math.max(20, p.periodMs ?? 1000);
                    const c = (Math.floor(tMs / period) % np) * 3;
                    r = pal[c];
                    g = pal[c + 1];
                    b = pal[c + 2];
                }
                for (let k = 0; k < n; ++k) {
                    const d = idx[k] * stride;
                    frame[d] = r;
                    frame[d + 1] = g;
                    frame[d + 2] = b;
                }
                break;
            }
            case 'bars': {
                const width = Math.max(1e-4, p.width ?? 0.1);
                const duty = clamp01(p.duty ?? 1);
                const shift = t * (p.speed ?? 0.5);
                // A single color alternates with black.
                const bands = np === 1 ? 2 : np;
                for (let k = 0; k < n; ++k) {
                    const d = idx[k] * stride;
                    const ph = u[k] / width - shift;
                    const band = Math.floor(ph);
                    const i = ((band % bands) + bands) % bands;
                    const lit = ph - band < duty && i < np;
                    const c = i * 3;
                    frame[d] = lit ? pal[c] : 0;
                    frame[d + 1] = lit ? pal[c + 1] : 0;
                    frame[d + 2] = lit ? pal[c + 2] : 0;
                }
                break;
            }
            case 'rainbow': {
                const width = Math.max(1e-4, p.width ?? 1);
                const shift = t * (p.speed ?? 0.1);
                const v = clamp01(p.intensity ?? 1);
                for (let k = 0; k < n; ++k) {
                    const d = idx[k] * stride;
                    const [r, g, b] = hsvToRgb(frac(u[k] / width - shift), 1, v);
                    frame[d] = r;
                    frame[d + 1] = g;
                    frame[d + 2] = b;
                }
                break;
            }
            case 'chase': {
                const width = clamp01(p.width ?? 0.05);
                const at = frac(t * (p.speed ?? 0.25));
                for (let k = 0; k < n; ++k) {
                    const d = idx[k] * stride;
                    const lit = frac(u[k] - at) < width;
                    frame[d] = lit ? pal[0] : 0;
                    frame[d + 1] = lit ? pal[1] : 0;
                    frame[d + 2] = lit ? pal[2] : 0;
                }
                break;
            }
            case 'markers': {
                const every = Math.max(1, Math.round(p.every ?? 10));
                const first = np > 1 ? 3 : 0;
                const last = np > 2 ? 6 : 0;
                for (let k = 0; k < n; ++k) {
                    const d = idx[k] * stride;
                    const w = pos[k];
                    let c = -1;
                    if (w === 0) c = first;
                    else if (w === len[k] - 1) c = last;
                    else if ((w + 1) % every === 0) c = 0;
                    frame[d] = c >= 0 ? pal[c] : 0;
                    frame[d + 1] = c >= 0 ? pal[c + 1] : 0;
                    frame[d + 2] = c >= 0 ? pal[c + 2] : 0;
                }
                break;
            }
            case 'strands': {
                for (let k = 0; k < n; ++k) {
                    const d = idx[k] * stride;
                    const c = (strand[k] % np) * 3;
                    frame[d] = pal[c];
                    frame[d + 1] = pal[c + 1];
                    frame[d + 2] = pal[c + 2];
                }
                break;
            }
        }
    }
}

/** True when a pattern changes over time (and so needs frames at the full rate). */
export function patternAnimates(p: SpatialPatternParams): boolean {
    switch (p.kind) {
        case 'solid':
        case 'markers':
        case 'strands':
            return false;
        case 'strobe':
        case 'colorCycle':
            return true;
        default:
            return (p.speed ?? 1) !== 0;
    }
}
