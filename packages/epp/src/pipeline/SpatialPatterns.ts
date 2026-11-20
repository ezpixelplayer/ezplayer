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
    | 'markers';

export type PatternSpace =
    /** Project world coordinates onto the direction; the pattern spans all targets as one picture. */
    | 'world'
    /** Position along each model's own wiring, 0 at its first node. */
    | 'node';

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

export interface SpatialPatternTarget {
    nodeStart: number;
    nodeCount: number;
}

const DEFAULT_PALETTES: Record<SpatialPatternKind, string[]> = {
    solid: ['#ffffff'],
    bars: ['#ff0000', '#00ff00', '#0000ff'],
    rainbow: [],
    chase: ['#ffffff'],
    strobe: ['#ffffff'],
    colorCycle: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'],
    markers: ['#ffffff', '#00ff00', '#ff0000'],
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

/** Pixel models of a layout by name, as pattern targets; unknown and raw models are skipped. */
export function patternTargetsForModels(layout: DisplayLayout, names: Iterable<string>): LayoutModel[] {
    const want = new Set(names);
    return layout.models.filter((m) => m.nodeStart >= 0 && m.nodeCount > 0 && want.has(m.name));
}

export class SpatialPatternRenderer {
    readonly params: SpatialPatternParams;
    readonly targets: SpatialPatternTarget[];
    /** Nodes painted per frame. */
    readonly nodeCount: number;
    private readonly palette: Uint8Array;
    private readonly paletteSize: number;
    /** Coordinate 0..1 per target node, concatenated in target order (canonical node order within a target). */
    private readonly u: Float32Array;
    /** Wiring index per target node, same order as u. */
    private readonly wire: Int32Array;

    constructor(layout: DisplayLayout, models: LayoutModel[], params: SpatialPatternParams) {
        this.params = params;
        this.palette = buildPalette(params);
        this.paletteSize = this.palette.length / 3;
        const usable = models.filter((m) => m.nodeStart >= 0 && m.nodeCount > 0);
        this.targets = usable.map((m) => ({ nodeStart: m.nodeStart, nodeCount: m.nodeCount }));
        this.nodeCount = usable.reduce((a, m) => a + m.nodeCount, 0);
        this.u = new Float32Array(this.nodeCount);
        this.wire = new Int32Array(this.nodeCount);

        // Wiring index: canonical position perm[i] holds xLights node i.
        let base = 0;
        for (const m of usable) {
            for (let i = 0; i < m.nodeCount; ++i) this.wire[base + (m.perm ? m.perm[i] : i)] = i;
            base += m.nodeCount;
        }

        const space: PatternSpace =
            params.space ?? (params.kind === 'chase' || params.kind === 'markers' ? 'node' : 'world');
        const world = layout.world;
        if (space === 'world' && world) {
            const az = ((params.angleDeg ?? 0) * Math.PI) / 180;
            const el = ((params.elevationDeg ?? 0) * Math.PI) / 180;
            const dx = Math.cos(az) * Math.cos(el);
            const dy = Math.sin(az) * Math.cos(el);
            const dz = Math.sin(el);
            let lo = Infinity;
            let hi = -Infinity;
            base = 0;
            for (const m of usable) {
                for (let n = 0; n < m.nodeCount; ++n) {
                    const w = (m.nodeStart + n) * 3;
                    const v = world[w] * dx + world[w + 1] * dy + world[w + 2] * dz;
                    this.u[base + n] = v;
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                base += m.nodeCount;
            }
            const span = hi - lo;
            for (let i = 0; i < this.nodeCount; ++i) this.u[i] = span > 1e-9 ? (this.u[i] - lo) / span : 0;
        } else {
            base = 0;
            for (const m of usable) {
                for (let n = 0; n < m.nodeCount; ++n) this.u[base + n] = this.wire[base + n] / m.nodeCount;
                base += m.nodeCount;
            }
        }
    }

    /** Paint the targets of a canonical frame for time tMs. */
    render(frame: Uint8Array, stride: number, tMs: number): void {
        const p = this.params;
        const pal = this.palette;
        const np = this.paletteSize;
        const t = tMs / 1000;
        const u = this.u;
        const wire = this.wire;
        let k = 0;
        for (const tg of this.targets) {
            let d = tg.nodeStart * stride;
            const n = tg.nodeCount;
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
                    for (let i = 0; i < n; ++i, d += stride) {
                        frame[d] = r;
                        frame[d + 1] = g;
                        frame[d + 2] = b;
                    }
                    k += n;
                    break;
                }
                case 'bars': {
                    const width = Math.max(1e-4, p.width ?? 0.1);
                    const duty = clamp01(p.duty ?? 1);
                    const shift = t * (p.speed ?? 0.5);
                    // A single color alternates with black.
                    const bands = np === 1 ? 2 : np;
                    for (let i = 0; i < n; ++i, d += stride, ++k) {
                        const ph = u[k] / width - shift;
                        const band = Math.floor(ph);
                        const idx = ((band % bands) + bands) % bands;
                        const lit = ph - band < duty && idx < np;
                        const c = idx * 3;
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
                    for (let i = 0; i < n; ++i, d += stride, ++k) {
                        const [r, g, b] = hsvToRgb(frac(u[k] / width - shift), 1, v);
                        frame[d] = r;
                        frame[d + 1] = g;
                        frame[d + 2] = b;
                    }
                    break;
                }
                case 'chase': {
                    const width = clamp01(p.width ?? 0.05);
                    const pos = frac(t * (p.speed ?? 0.25));
                    for (let i = 0; i < n; ++i, d += stride, ++k) {
                        const lit = frac(u[k] - pos) < width;
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
                    for (let i = 0; i < n; ++i, d += stride, ++k) {
                        const w = wire[k];
                        let c = -1;
                        if (w === 0) c = first;
                        else if (w === n - 1) c = last;
                        else if ((w + 1) % every === 0) c = 0;
                        frame[d] = c >= 0 ? pal[c] : 0;
                        frame[d + 1] = c >= 0 ? pal[c + 1] : 0;
                        frame[d + 2] = c >= 0 ? pal[c + 2] : 0;
                    }
                    break;
                }
            }
        }
    }
}

/** True when a pattern changes over time (and so needs frames at the full rate). */
export function patternAnimates(p: SpatialPatternParams): boolean {
    switch (p.kind) {
        case 'solid':
        case 'markers':
            return false;
        case 'strobe':
        case 'colorCycle':
            return true;
        default:
            return (p.speed ?? 1) !== 0;
    }
}

/**
 * Per-channel gains that shift white toward a color temperature, relative to
 * 6500 K (which returns 1, 1, 1).  The largest gain is 1, so the adjustment
 * only ever dims channels.  Fit after Tanner Helland's approximation.
 */
export function whiteBalanceGains(kelvin: number): [number, number, number] {
    const rgbAt = (k: number): [number, number, number] => {
        const t = Math.min(40000, Math.max(1000, k)) / 100;
        const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
        const g =
            t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
        const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
        const c = (v: number) => Math.min(255, Math.max(0, v));
        return [c(r), c(g), c(b)];
    };
    const ref = rgbAt(6500);
    const at = rgbAt(kelvin);
    const g: [number, number, number] = [at[0] / ref[0], at[1] / ref[1], at[2] / ref[2]];
    const mx = Math.max(g[0], g[1], g[2]);
    if (!(mx > 0)) return [1, 1, 1];
    return [g[0] / mx, g[1] / mx, g[2] / mx];
}
