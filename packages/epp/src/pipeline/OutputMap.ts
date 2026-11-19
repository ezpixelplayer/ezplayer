/*
 * Output Map: per output, a compiled program that encodes a canonical frame
 * into that output's wire buffer (its own contiguous address space).  Color
 * order, gamma, brightness, RGBW, grouping, reversal and null pixels all live
 * here, so the controller can be the lowest common denominator.
 */

import { DisplayLayout, LayoutModel, NodeCodec, fnv1a } from './Layout';
import { X_MEANING_WHITE } from './FramePool';

export type OutputPolicy = 'controller' | 'player';

/** A run of one model's nodes placed at a wire offset: the port-map form. */
export interface OutputSegmentSpec {
    model: string;
    /** First node of the model (xLights node order) in this segment. */
    nodeStart: number;
    nodeCount: number;
    /** Wire byte offset of the segment's first pixel (after nullBefore). */
    dstOffset: number;
    /** Wire color order, e.g. 'GRB'; the model's own string type when absent. */
    colorOrder?: string;
    gamma?: number;
    brightness?: number;
    /** Each node repeated this many times on the wire. */
    groupCount?: number;
    reverse?: boolean;
    /** Black pixels emitted before / after the run. */
    nullBefore?: number;
    nullAfter?: number;
}

export interface OutputSpec {
    id: string;
    /** Channel-space range this output carries; wire offset = channel - channelStart. */
    channelStart: number;
    channelCount: number;
    /** 'controller' sends renderer intent (default); 'player' applies gamma and brightness here. */
    policy?: OutputPolicy;
    /** Explicit segments replace the channel-range derivation for pixel models. */
    segments?: OutputSegmentSpec[];
}

export const OUT_RAW = 1;
export const OUT_RGB = 2;
export const OUT_RGBW = 3;
export const OUT_MONO = 4;

/** Ints per op: kind, src, dst, count, cpn, r, g, b, w, lut, permOff, mono, modelBase, dstStep, repeat, partial(skipFirst | dropLast<<16) */
export const OUT_OP_INTS = 16;
const O_KIND = 0;
const O_SRC = 1;
const O_DST = 2;
const O_COUNT = 3;
const O_CPN = 4;
const O_R = 5;
const O_G = 6;
const O_B = 7;
const O_W = 8;
const O_LUT = 9;
const O_PERM = 10;
/** For OUT_MONO: canonical component (0..2) that carries the value, and wire channel offset in O_R. */
const O_MONO_SRC = 11;
const O_MODEL_BASE = 12;
const O_DST_STEP = 13;
const O_REPEAT = 14;
const O_PARTIAL = 15;

export interface CompiledOutput {
    id: string;
    wireBytes: number;
    ops: Int32Array;
    luts: Uint8Array;
    perms: Int32Array;
    policy: OutputPolicy;
}

export interface OutputMap {
    id: number;
    layoutVersion: number;
    pixelStride: number;
    outputs: CompiledOutput[];
}

/** Forward LUT: gamma curve, then brightness scale, as xLights and FPP do it. */
export function buildForwardLut(gamma: number, brightness: number, out: Uint8Array, off = 0): void {
    const g = gamma > 0 ? gamma : 1;
    const b = brightness >= 0 ? brightness : 1;
    for (let i = 0; i < 256; ++i) {
        const v = Math.round(255 * b * Math.pow(i / 255, g));
        out[off + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
}

class OutBuilder {
    ops: number[] = [];
    luts: number[] = [];
    perms: number[] = [];
    lutCache = new Map<string, number>();
    permCache = new Map<Int32Array, number>();

    lutFor(gamma: number | undefined, brightness: number | undefined): number {
        const g = gamma ?? 1;
        const b = brightness ?? 1;
        if (g === 1 && b === 1) return -1;
        const key = `${g}/${b}`;
        const hit = this.lutCache.get(key);
        if (hit !== undefined) return hit;
        const idx = this.luts.length / 256;
        const tmp = new Uint8Array(256);
        buildForwardLut(g, b, tmp);
        for (let i = 0; i < 256; ++i) this.luts.push(tmp[i]);
        this.lutCache.set(key, idx);
        return idx;
    }

    permFor(perm: Int32Array | undefined): number {
        if (!perm) return -1;
        const hit = this.permCache.get(perm);
        if (hit !== undefined) return hit;
        const off = this.perms.length;
        for (let i = 0; i < perm.length; ++i) this.perms.push(perm[i]);
        this.permCache.set(perm, off);
        return off;
    }

    push(vals: number[]) {
        if (vals.length !== OUT_OP_INTS) throw new Error('bad op');
        for (const v of vals) this.ops.push(v);
    }
}

/** Wire offsets for a color order string like 'GRB' over a node of cpn channels. */
function wireOffsets(codec: NodeCodec, colorOrder: string | undefined): { r: number; g: number; b: number; w: number } {
    if (!colorOrder) return { r: codec.r, g: codec.g, b: codec.b, w: codec.w };
    const order = colorOrder.toUpperCase();
    const r = order.indexOf('R');
    const g = order.indexOf('G');
    const b = order.indexOf('B');
    const w = order.indexOf('W');
    if (r < 0 || g < 0 || b < 0) return { r: codec.r, g: codec.g, b: codec.b, w: codec.w };
    return { r, g, b, w: w >= 0 ? w : codec.w };
}

function monoComponent(codec: NodeCodec): number {
    if (codec.tintR === 255) return 0;
    if (codec.tintG === 255) return 1;
    return 2;
}

interface NodeSeg {
    lm: LayoutModel;
    /** First model node (xLights order). */
    node0: number;
    count: number;
    dst: number;
    dstStep: number;
    repeat: number;
    skipFirst: number;
    dropLast: number;
    colorOrder?: string;
    gamma?: number;
    brightness?: number;
}

function emitNodeSeg(b: OutBuilder, layout: DisplayLayout, s: NodeSeg, policy: OutputPolicy) {
    const lm = s.lm;
    const codec = lm.codec;
    const wo = wireOffsets(codec, s.colorOrder ?? lm.outputColorOrder);
    const lut = policy === 'player' ? b.lutFor(s.gamma ?? lm.outputGamma, s.brightness ?? lm.outputBrightness) : -1;
    const permOff = lm.perm ? b.permFor(lm.perm) + s.node0 : -1;
    const white = layout.pixelStride === 4 && layout.xMeaning === X_MEANING_WHITE;
    let kind = OUT_RGB;
    let mono = 0;
    if (codec.kind === 'rgbw') kind = white ? OUT_RGBW : OUT_RGB;
    else if (codec.kind === 'mono') {
        kind = OUT_MONO;
        mono = monoComponent(codec);
    }
    const r = kind === OUT_MONO ? codec.mono : wo.r;
    b.push([
        kind,
        lm.nodeStart + s.node0,
        s.dst,
        s.count,
        codec.channelsPerNode,
        r,
        wo.g,
        wo.b,
        wo.w,
        lut,
        permOff,
        mono,
        lm.nodeStart,
        s.dstStep,
        s.repeat,
        (s.skipFirst & 0xffff) | (s.dropLast << 16),
    ]);
}

/** Derive segments for a controller that carries a channel range of the layout. */
function segmentsFromRange(b: OutBuilder, layout: DisplayLayout, S: number, E: number, policy: OutputPolicy) {
    for (const lm of layout.models) {
        if (lm.nodeStart < 0) continue;
        const cpn = lm.codec.channelsPerNode;
        for (const run of lm.runs) {
            const cs = run.channelStart;
            const ce = cs + run.nodeCount * cpn;
            const lo = Math.max(cs, S);
            const hi = Math.min(ce, E);
            if (hi <= lo) continue;
            const firstNode = Math.floor((lo - cs) / cpn);
            const skipFirst = lo - cs - firstNode * cpn;
            const lastNode = Math.ceil((hi - cs) / cpn) - 1;
            const dropLast = (lastNode + 1) * cpn - (hi - cs);
            emitNodeSeg(
                b,
                layout,
                {
                    lm,
                    node0: run.nodeStart + firstNode,
                    count: lastNode - firstNode + 1,
                    dst: lo - S - skipFirst,
                    dstStep: cpn,
                    repeat: 1,
                    skipFirst,
                    dropLast,
                },
                policy,
            );
        }
    }
    for (const span of layout.rawSpans) {
        const lo = Math.max(span.channelStart, S);
        const hi = Math.min(span.channelStart + span.count, E);
        if (hi <= lo) continue;
        b.push([OUT_RAW, layout.rawOffset + span.rawOffset + (lo - span.channelStart), lo - S, hi - lo, 1, 0, 0, 0, 0, -1, -1, 0, 0, 1, 1, 0]);
    }
}

export function compileOutputMap(layout: DisplayLayout, specs: OutputSpec[]): OutputMap {
    const outputs: CompiledOutput[] = [];
    for (const spec of specs) {
        const b = new OutBuilder();
        const policy = spec.policy ?? 'controller';
        let wireBytes = spec.channelCount;
        if (spec.segments) {
            for (const seg of spec.segments) {
                const lm = layout.models.find((m) => m.name === seg.model);
                if (!lm || lm.nodeStart < 0) continue;
                const cpn = lm.codec.channelsPerNode;
                const n = Math.max(0, Math.min(seg.nodeCount, lm.nodeCount - seg.nodeStart));
                if (n <= 0) continue;
                const repeat = Math.max(1, seg.groupCount ?? 1);
                const dst0 = seg.dstOffset + (seg.nullBefore ?? 0) * cpn;
                const bytes = n * repeat * cpn;
                wireBytes = Math.max(wireBytes, dst0 + bytes + (seg.nullAfter ?? 0) * cpn);
                emitNodeSeg(
                    b,
                    layout,
                    {
                        lm,
                        node0: seg.nodeStart,
                        count: n,
                        dst: seg.reverse ? dst0 + bytes - cpn * repeat : dst0,
                        dstStep: seg.reverse ? -cpn * repeat : cpn * repeat,
                        repeat,
                        skipFirst: 0,
                        dropLast: 0,
                        colorOrder: seg.colorOrder,
                        gamma: seg.gamma,
                        brightness: seg.brightness,
                    },
                    policy,
                );
            }
            // Raw channels still come through by range.
            const E = spec.channelStart + spec.channelCount;
            for (const span of layout.rawSpans) {
                const lo = Math.max(span.channelStart, spec.channelStart);
                const hi = Math.min(span.channelStart + span.count, E);
                if (hi <= lo) continue;
                b.push([OUT_RAW, layout.rawOffset + span.rawOffset + (lo - span.channelStart), lo - spec.channelStart, hi - lo, 1, 0, 0, 0, 0, -1, -1, 0, 0, 1, 1, 0]);
            }
        } else {
            segmentsFromRange(b, layout, spec.channelStart, spec.channelStart + spec.channelCount, policy);
        }
        outputs.push({
            id: spec.id,
            wireBytes,
            ops: Int32Array.from(b.ops),
            luts: Uint8Array.from(b.luts),
            perms: Int32Array.from(b.perms),
            policy,
        });
    }
    const map: OutputMap = { id: 0, layoutVersion: layout.layoutVersion, pixelStride: layout.pixelStride, outputs };
    map.id = fnv1a(JSON.stringify(specs) + ':' + layout.layoutVersion);
    return map;
}

const scratch = new Uint8Array(64);

/** Encode one canonical frame into an output's wire buffer (zeroed first). */
export function applyOutput(out: CompiledOutput, stride: number, frame: Uint8Array, frameBase: number, wire: Uint8Array): void {
    const ops = out.ops;
    const luts = out.luts;
    const perms = out.perms;
    wire.fill(0, 0, out.wireBytes);
    for (let o = 0; o < ops.length; o += OUT_OP_INTS) {
        const kind = ops[o + O_KIND];
        const count = ops[o + O_COUNT];
        if (kind === OUT_RAW) {
            const s = frameBase + ops[o + O_SRC];
            wire.set(frame.subarray(s, s + count), ops[o + O_DST]);
            continue;
        }
        const cpn = ops[o + O_CPN];
        const ro = ops[o + O_R];
        const go = ops[o + O_G];
        const bo = ops[o + O_B];
        const wo = ops[o + O_W];
        const lut = ops[o + O_LUT];
        const lutOff = lut >= 0 ? lut * 256 : -1;
        const permOff = ops[o + O_PERM];
        const srcNode0 = ops[o + O_SRC];
        const modelBase = ops[o + O_MODEL_BASE];
        const dstStep = ops[o + O_DST_STEP];
        const repeat = ops[o + O_REPEAT];
        const partial = ops[o + O_PARTIAL];
        const skipFirst = partial & 0xffff;
        const dropLast = partial >>> 16;
        const monoSrc = ops[o + O_MONO_SRC];
        let d = ops[o + O_DST];
        for (let i = 0; i < count; ++i, d += dstStep) {
            const s = frameBase + (permOff >= 0 ? modelBase + perms[permOff + i] : srcNode0 + i) * stride;
            const isPartial = (i === 0 && skipFirst > 0) || (i === count - 1 && dropLast > 0);
            const target = isPartial ? scratch : wire;
            const td = isPartial ? 0 : d;
            if (isPartial) scratch.fill(0, 0, cpn);
            if (kind === OUT_MONO) {
                let v = frame[s + monoSrc];
                if (lutOff >= 0) v = luts[lutOff + v];
                target[td + ro] = v;
            } else {
                let r = frame[s];
                let g = frame[s + 1];
                let bl = frame[s + 2];
                if (lutOff >= 0) {
                    r = luts[lutOff + r];
                    g = luts[lutOff + g];
                    bl = luts[lutOff + bl];
                }
                target[td + ro] = r;
                target[td + go] = g;
                target[td + bo] = bl;
                if (kind === OUT_RGBW && wo >= 0) {
                    let w = frame[s + 3];
                    if (lutOff >= 0) w = luts[lutOff + w];
                    target[td + wo] = w;
                }
            }
            if (isPartial) {
                const from = i === 0 ? skipFirst : 0;
                const to = i === count - 1 ? cpn - dropLast : cpn;
                for (let k = from; k < to; ++k) wire[d + k] = scratch[k];
            }
            for (let rep = 1; rep < repeat; ++rep) {
                wire.copyWithin(d + rep * cpn, d, d + cpn);
            }
        }
    }
}
