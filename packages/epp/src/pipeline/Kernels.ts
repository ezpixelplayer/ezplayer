/*
 * Compositor kernels.  Every kernel runs over canonical nodes [nodeStart,
 * nodeEnd) of a frame with an explicit stride, allocates nothing, and can be
 * partitioned across workers by node range.
 */

export const BLEND_MAX = 0;
export const BLEND_REPLACE = 1;
/** Source shows only where the destination is still black. */
export const BLEND_UNDERLAY = 2;
export const BLEND_ADD = 3;
export const BLEND_SUBTRACT = 4;
export const BLEND_MULTIPLY = 5;
export const BLEND_SCREEN = 6;
/** Linear mix by opacity. */
export const BLEND_ALPHA = 7;
export const BLEND_MIN = 8;
export type BlendMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const BLEND_MODE_NAMES: Record<string, BlendMode> = {
    max: BLEND_MAX,
    brightest: BLEND_MAX,
    replace: BLEND_REPLACE,
    overlay: BLEND_REPLACE,
    underlay: BLEND_UNDERLAY,
    add: BLEND_ADD,
    subtract: BLEND_SUBTRACT,
    multiply: BLEND_MULTIPLY,
    screen: BLEND_SCREEN,
    alpha: BLEND_ALPHA,
    min: BLEND_MIN,
};

export function blendModeFromName(name: string | undefined, fallback: BlendMode = BLEND_MAX): BlendMode {
    if (!name) return fallback;
    const m = BLEND_MODE_NAMES[name.toLowerCase()];
    return m === undefined ? fallback : m;
}

/** Fill nodes with a color. x is the fourth byte when stride is 4. */
export function fillNodes(frame: Uint8Array, stride: number, nodeStart: number, nodeEnd: number, r: number, g: number, b: number, x = 0): void {
    let d = nodeStart * stride;
    const end = nodeEnd * stride;
    if (stride === 4) {
        for (; d < end; d += 4) {
            frame[d] = r;
            frame[d + 1] = g;
            frame[d + 2] = b;
            frame[d + 3] = x;
        }
    } else {
        for (; d < end; d += 3) {
            frame[d] = r;
            frame[d + 1] = g;
            frame[d + 2] = b;
        }
    }
}

/**
 * Blend src into dst over a node range. Both are canonical frames of the same
 * layout. opacity is 0..255 and only matters for BLEND_ALPHA. The fourth byte
 * is blended like a color channel when blendX is set (white), else left alone.
 */
export function blendNodes(
    mode: BlendMode,
    dst: Uint8Array,
    src: Uint8Array,
    stride: number,
    nodeStart: number,
    nodeEnd: number,
    opacity = 255,
    blendX = false,
): void {
    const start = nodeStart * stride;
    const end = nodeEnd * stride;
    const chans = stride === 4 && !blendX ? 3 : stride;
    switch (mode) {
        case BLEND_MAX:
            for (let i = start; i < end; i += stride) {
                for (let c = 0; c < chans; ++c) {
                    const a = dst[i + c];
                    const b = src[i + c];
                    if (b > a) dst[i + c] = b;
                }
            }
            break;
        case BLEND_MIN:
            for (let i = start; i < end; i += stride) {
                for (let c = 0; c < chans; ++c) {
                    const a = dst[i + c];
                    const b = src[i + c];
                    if (b < a) dst[i + c] = b;
                }
            }
            break;
        case BLEND_REPLACE:
            if (chans === stride) {
                dst.set(src.subarray(start, end), start);
            } else {
                for (let i = start; i < end; i += stride) {
                    dst[i] = src[i];
                    dst[i + 1] = src[i + 1];
                    dst[i + 2] = src[i + 2];
                }
            }
            break;
        case BLEND_UNDERLAY:
            for (let i = start; i < end; i += stride) {
                if (dst[i] === 0 && dst[i + 1] === 0 && dst[i + 2] === 0) {
                    for (let c = 0; c < chans; ++c) dst[i + c] = src[i + c];
                }
            }
            break;
        case BLEND_ADD:
            for (let i = start; i < end; i += stride) {
                for (let c = 0; c < chans; ++c) {
                    const v = dst[i + c] + src[i + c];
                    dst[i + c] = v > 255 ? 255 : v;
                }
            }
            break;
        case BLEND_SUBTRACT:
            for (let i = start; i < end; i += stride) {
                for (let c = 0; c < chans; ++c) {
                    const v = dst[i + c] - src[i + c];
                    dst[i + c] = v < 0 ? 0 : v;
                }
            }
            break;
        case BLEND_MULTIPLY:
            for (let i = start; i < end; i += stride) {
                for (let c = 0; c < chans; ++c) {
                    dst[i + c] = (dst[i + c] * src[i + c] + 127) / 255 | 0;
                }
            }
            break;
        case BLEND_SCREEN:
            for (let i = start; i < end; i += stride) {
                for (let c = 0; c < chans; ++c) {
                    const a = dst[i + c];
                    const b = src[i + c];
                    dst[i + c] = 255 - (((255 - a) * (255 - b) + 127) / 255 | 0);
                }
            }
            break;
        case BLEND_ALPHA: {
            const op = opacity < 0 ? 0 : opacity > 255 ? 255 : opacity;
            const inv = 255 - op;
            for (let i = start; i < end; i += stride) {
                for (let c = 0; c < chans; ++c) {
                    dst[i + c] = (dst[i + c] * inv + src[i + c] * op + 127) / 255 | 0;
                }
            }
            break;
        }
    }
}

/** Apply a 256-entry LUT to the color channels of a node range (and X when applyX). */
export function lutNodes(frame: Uint8Array, stride: number, nodeStart: number, nodeEnd: number, lut: Uint8Array, lutOff = 0, applyX = false): void {
    const start = nodeStart * stride;
    const end = nodeEnd * stride;
    const chans = stride === 4 && !applyX ? 3 : stride;
    for (let i = start; i < end; i += stride) {
        for (let c = 0; c < chans; ++c) frame[i + c] = lut[lutOff + frame[i + c]];
    }
}

/** Scale color channels by brightness 0..1 without a LUT (for per-frame values). */
export function scaleNodes(frame: Uint8Array, stride: number, nodeStart: number, nodeEnd: number, brightness: number, applyX = false): void {
    if (brightness >= 1) return;
    const k = Math.max(0, Math.round(brightness * 256));
    const start = nodeStart * stride;
    const end = nodeEnd * stride;
    const chans = stride === 4 && !applyX ? 3 : stride;
    for (let i = start; i < end; i += stride) {
        for (let c = 0; c < chans; ++c) frame[i + c] = (frame[i + c] * k + 128) >> 8;
    }
}

/**
 * Scale R, G, B (and X) by separate factors in [0, 1] without a LUT: global
 * brightness folded together with a color-temperature tint. Factors at or
 * above 1 leave the channel alone.
 */
export function scaleNodesRgb(frame: Uint8Array, stride: number, nodeStart: number, nodeEnd: number, kr: number, kg: number, kb: number, kx = 1): void {
    const r = Math.max(0, Math.min(256, Math.round(kr * 256)));
    const g = Math.max(0, Math.min(256, Math.round(kg * 256)));
    const b = Math.max(0, Math.min(256, Math.round(kb * 256)));
    const x = Math.max(0, Math.min(256, Math.round(kx * 256)));
    if (r === 256 && g === 256 && b === 256 && (stride === 3 || x === 256)) return;
    const start = nodeStart * stride;
    const end = nodeEnd * stride;
    for (let i = start; i < end; i += stride) {
        if (r !== 256) frame[i] = (frame[i] * r + 128) >> 8;
        if (g !== 256) frame[i + 1] = (frame[i + 1] * g + 128) >> 8;
        if (b !== 256) frame[i + 2] = (frame[i + 2] * b + 128) >> 8;
        if (stride === 4 && x !== 256) frame[i + 3] = (frame[i + 3] * x + 128) >> 8;
    }
}

/** True when every color channel in the range is zero. */
export function isBlack(frame: Uint8Array, stride: number, nodeStart: number, nodeEnd: number): boolean {
    const start = nodeStart * stride;
    const end = nodeEnd * stride;
    for (let i = start; i < end; i += stride) {
        if (frame[i] | frame[i + 1] | frame[i + 2]) return false;
    }
    return true;
}

/** Peak-preserving gamma: apply the curve to the brightest channel and scale the others by the same ratio (colors keep their hue). */
export function dynamicGammaNodes(frame: Uint8Array, stride: number, nodeStart: number, nodeEnd: number, lut: Uint8Array, lutOff = 0): void {
    const start = nodeStart * stride;
    const end = nodeEnd * stride;
    for (let i = start; i < end; i += stride) {
        const r = frame[i];
        const g = frame[i + 1];
        const b = frame[i + 2];
        const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
        if (mx === 0) continue;
        const curved = lut[lutOff + mx];
        if (curved === mx) continue;
        frame[i] = (r * curved + (mx >> 1)) / mx | 0;
        frame[i + 1] = (g * curved + (mx >> 1)) / mx | 0;
        frame[i + 2] = (b * curved + (mx >> 1)) / mx | 0;
    }
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const sextants: [number, number, number][] = [
        [v, t, p],
        [q, v, p],
        [p, v, t],
        [p, q, v],
        [t, p, v],
        [v, p, q],
    ];
    const [r, g, b] = sextants[((i % 6) + 6) % 6];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export type TestPatternKind = 'solid' | 'chase' | 'rainbow' | 'diagonal' | 'axes' | 'strobe';

export interface TestPatternParams {
    kind: TestPatternKind;
    /** Color for solid, chase, diagonal, strobe. */
    r?: number;
    g?: number;
    b?: number;
    /** Nodes (or grid cells) per second of motion. */
    speed?: number;
    /** For diagonal: stripe width in cells. */
    width?: number;
    /** For grid patterns; the range is treated as a strip when absent. */
    grid?: { width: number; height: number };
}

/** Render a test pattern into a node range at time tMs. */
export function testPatternNodes(frame: Uint8Array, stride: number, nodeStart: number, nodeEnd: number, p: TestPatternParams, tMs: number): void {
    const n = nodeEnd - nodeStart;
    if (n <= 0) return;
    const r = p.r ?? 255;
    const g = p.g ?? 128;
    const b = p.b ?? 0;
    const speed = p.speed ?? 20;
    switch (p.kind) {
        case 'solid':
            fillNodes(frame, stride, nodeStart, nodeEnd, r, g, b);
            break;
        case 'strobe': {
            const on = Math.floor(tMs / 500) % 2 === 0;
            fillNodes(frame, stride, nodeStart, nodeEnd, on ? r : 0, on ? g : 0, on ? b : 0);
            break;
        }
        case 'chase': {
            fillNodes(frame, stride, nodeStart, nodeEnd, 0, 0, 0);
            const pos = Math.floor((tMs / 1000) * speed) % n;
            const d = (nodeStart + pos) * stride;
            frame[d] = r;
            frame[d + 1] = g;
            frame[d + 2] = b;
            break;
        }
        case 'rainbow': {
            const phase = (tMs / 1000) * 0.1;
            for (let i = 0; i < n; ++i) {
                const [cr, cg, cb] = hsvToRgb((i / n + phase) % 1, 1, 1);
                const d = (nodeStart + i) * stride;
                frame[d] = cr;
                frame[d + 1] = cg;
                frame[d + 2] = cb;
            }
            break;
        }
        case 'diagonal': {
            // Orange stripes marching along x+y; wiring errors show as broken stripes.
            const w = p.grid?.width ?? n;
            const sw = Math.max(1, p.width ?? 4);
            const shift = Math.floor((tMs / 1000) * speed);
            for (let i = 0; i < n; ++i) {
                const x = i % w;
                const y = Math.floor(i / w);
                const on = Math.floor((x + y + shift) / sw) % 2 === 0;
                const d = (nodeStart + i) * stride;
                frame[d] = on ? r : 0;
                frame[d + 1] = on ? g : 0;
                frame[d + 2] = on ? b : 0;
            }
            break;
        }
        case 'axes': {
            // Red ramps along x, green along y: each corner is a different color, so orientation is unambiguous.
            const w = p.grid?.width ?? n;
            const h = p.grid?.height ?? 1;
            for (let i = 0; i < n; ++i) {
                const x = i % w;
                const y = Math.floor(i / w);
                const d = (nodeStart + i) * stride;
                frame[d] = w > 1 ? Math.round((255 * x) / (w - 1)) : 255;
                frame[d + 1] = h > 1 ? Math.round((255 * y) / (h - 1)) : 0;
                frame[d + 2] = 32;
            }
            break;
        }
    }
}
