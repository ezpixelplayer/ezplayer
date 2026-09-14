/*
 * Input Map: a compiled program that turns one dense channel-space frame (as a
 * sequence file describes it) into one canonical frame (as the Display Layout
 * describes it).  Compiled once per (descriptor, layout) pair, applied inside
 * the ingest worker, so play time never pays for it.
 */

import { ChannelRoleSpec, classifyRoles, DisplayLayout, fnv1a, NodeRun } from './Layout';
import { X_MEANING_WHITE } from './FramePool';

/** One model as the file that was rendered understood it. */
export interface ChannelDescriptorModel {
    name: string;
    startChannel: number;
    nodeCount: number;
    channelsPerNode: number;
    roles: ChannelRoleSpec[];
    runs?: NodeRun[];
    /** Gamma and brightness the renderer baked in; 1 and 1 for a clean render. */
    gamma?: number;
    brightness?: number;
}

/** The channel layout a sequence file was rendered against. Pinned per file. */
export interface ChannelDescriptor {
    totalChannels: number;
    models: ChannelDescriptorModel[];
    /** Where the descriptor came from: 'header', 'sidecar', 'pinned'. */
    source?: string;
}

export function descriptorHash(d: ChannelDescriptor): number {
    const canon = {
        totalChannels: d.totalChannels,
        models: d.models.map((m) => ({
            n: m.name,
            s: m.startChannel,
            c: m.nodeCount,
            p: m.channelsPerNode,
            r: m.roles,
            u: m.runs,
            g: m.gamma ?? 1,
            b: m.brightness ?? 1,
        })),
    };
    return fnv1a(JSON.stringify(canon));
}

// Op kinds
export const IN_RAW = 1;
export const IN_RGB = 2;
export const IN_RGBW = 3;
export const IN_MONO = 4;

/** Ints per op: kind, src, dst, count, cpn, r, g, b, w, lut, permOff, tint, modelBase, reserved x3 */
export const OP_INTS = 16;
const O_KIND = 0;
const O_SRC = 1;
/** First canonical node (or raw byte offset for IN_RAW) written by the op. */
const O_DST = 2;
const O_COUNT = 3;
const O_CPN = 4;
/** Channel offsets within a node; O_R doubles as the mono channel for IN_MONO. */
const O_R = 5;
const O_G = 6;
const O_B = 7;
const O_W = 8;
const O_LUT = 9;
/** Offset into perms of this op's first node, or -1. Permuted ops write modelBase + perms[permOff + i]. */
const O_PERM = 10;
const O_TINT = 11;
const O_MODEL_BASE = 12;

export interface InputMap {
    id: number;
    descriptorHash: number;
    layoutVersion: number;
    /** Bytes per source frame the map reads (the file's dense channel count). */
    srcChannels: number;
    frameBytes: number;
    pixelStride: number;
    ops: Int32Array;
    opCount: number;
    /** 256 bytes per LUT, indexed by O_LUT. */
    luts: Uint8Array;
    /** Permutation tables referenced by O_PERM (canonical node offset for node i). */
    perms: Int32Array;
    /** Models in the layout with no counterpart in the file (they stay black). */
    missing: string[];
    /** Models in the file the layout does not know (ignored). */
    extra: string[];
    /** Models whose node count differs; copied up to the smaller count. */
    resized: { name: string; file: number; layout: number }[];
    /** Models with baked gamma or brightness that were inverted (lossy). */
    inverted: string[];
}

/** Inverse of baked = 255 * (v/255)^gamma * brightness. */
export function buildInverseLut(gamma: number, brightness: number, out: Uint8Array, off = 0): void {
    const g = gamma > 0 ? gamma : 1;
    const b = brightness > 0 ? brightness : 1;
    for (let i = 0; i < 256; ++i) {
        const lin = Math.min(1, i / 255 / b);
        const v = Math.round(255 * Math.pow(lin, 1 / g));
        out[off + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
}

class OpBuilder {
    ops: number[] = [];
    luts: number[] = [];
    perms: number[] = [];
    lutCache = new Map<string, number>();

    lutFor(gamma: number, brightness: number): number {
        if ((gamma === 1 || !gamma) && (brightness === 1 || !brightness)) return -1;
        const key = `${gamma}/${brightness}`;
        const hit = this.lutCache.get(key);
        if (hit !== undefined) return hit;
        const idx = this.luts.length / 256;
        const tmp = new Uint8Array(256);
        buildInverseLut(gamma, brightness, tmp);
        for (let i = 0; i < 256; ++i) this.luts.push(tmp[i]);
        this.lutCache.set(key, idx);
        return idx;
    }

    permFor(perm: Int32Array | undefined): number {
        if (!perm) return -1;
        const off = this.perms.length;
        for (let i = 0; i < perm.length; ++i) this.perms.push(perm[i]);
        return off;
    }

    push(
        kind: number,
        src: number,
        dst: number,
        count: number,
        cpn: number,
        r: number,
        g: number,
        b: number,
        w: number,
        lut: number,
        perm: number,
        tint: number,
        modelBase: number,
    ) {
        this.ops.push(kind, src, dst, count, cpn, r, g, b, w, lut, perm, tint, modelBase, 0, 0, 0);
    }
}

function runsOf(m: ChannelDescriptorModel): NodeRun[] {
    if (m.runs && m.runs.length) return m.runs;
    return [{ nodeStart: 0, nodeCount: m.nodeCount, channelStart: m.startChannel }];
}

/** A sparse-file range: absolute channels [channelStart, channelStart+length) live at byte srcOffset of each frame. */
export interface SparseRangeSpec {
    srcOffset: number;
    channelStart: number;
    length: number;
}

/** Pieces of [ch, ch+count) that exist in the source, each with its byte offset. */
function remapChannels(sparse: SparseRangeSpec[] | undefined, ch: number, count: number): { src: number; ch: number; count: number }[] {
    if (!sparse) return [{ src: ch, ch, count }];
    const out: { src: number; ch: number; count: number }[] = [];
    for (const r of sparse) {
        const lo = Math.max(ch, r.channelStart);
        const hi = Math.min(ch + count, r.channelStart + r.length);
        if (hi <= lo) continue;
        out.push({ src: r.srcOffset + (lo - r.channelStart), ch: lo, count: hi - lo });
    }
    out.sort((a, b) => a.ch - b.ch);
    return out;
}

/**
 * Compile the translation from a file's channel space into a layout's
 * canonical frame. `sparse` describes an fseq whose frames hold only some
 * channel ranges; ops then read the packed offsets directly.
 */
export function compileInputMap(desc: ChannelDescriptor, layout: DisplayLayout, sparse?: SparseRangeSpec[]): InputMap {
    const b = new OpBuilder();
    const byName = new Map<string, ChannelDescriptorModel>();
    for (const m of desc.models) byName.set(m.name, m);
    const missing: string[] = [];
    const resized: InputMap['resized'] = [];
    const inverted: string[] = [];
    const seen = new Set<string>();
    const stride = layout.pixelStride;
    const white = stride === 4 && layout.xMeaning === X_MEANING_WHITE;

    for (const lm of layout.models) {
        if (lm.nodeStart < 0) continue; // raw models come through the raw spans
        const dm = byName.get(lm.name);
        if (!dm) {
            missing.push(lm.name);
            continue;
        }
        seen.add(lm.name);
        const codec = classifyRoles(dm.roles, dm.channelsPerNode, true);
        if (codec.kind === 'raw') {
            // The file's string type cannot be decoded; leave the model black.
            missing.push(lm.name);
            continue;
        }
        const nodes = Math.min(dm.nodeCount, lm.nodeCount);
        if (dm.nodeCount !== lm.nodeCount) resized.push({ name: lm.name, file: dm.nodeCount, layout: lm.nodeCount });
        const lut = b.lutFor(dm.gamma ?? 1, dm.brightness ?? 1);
        if (lut >= 0) inverted.push(lm.name);
        const perm = b.permFor(lm.perm);
        // Walk the file's runs in node order and cut them at the node budget.
        const cpn = dm.channelsPerNode;
        const tint = (codec.tintR << 16) | (codec.tintG << 8) | codec.tintB;
        const kind = codec.kind === 'rgb' ? IN_RGB : codec.kind === 'rgbw' ? (white ? IN_RGBW : IN_RGB) : IN_MONO;
        const r = kind === IN_MONO ? codec.mono : codec.r;
        let done = 0;
        for (const run of runsOf(dm)) {
            if (done >= nodes) break;
            const n = Math.min(run.nodeCount, nodes - done);
            for (const piece of remapChannels(sparse, run.channelStart, n * cpn)) {
                // Only whole nodes inside the piece; a range edge through a node drops that node.
                const firstNode = Math.ceil((piece.ch - run.channelStart) / cpn);
                const lastNode = Math.floor((piece.ch + piece.count - run.channelStart) / cpn) - 1;
                if (lastNode < firstNode) continue;
                const src = piece.src + (run.channelStart + firstNode * cpn - piece.ch);
                const dstNode = lm.nodeStart + done + firstNode;
                const permOff = perm >= 0 ? perm + done + firstNode : -1;
                b.push(kind, src, dstNode, lastNode - firstNode + 1, cpn, r, codec.g, codec.b, codec.w, lut, permOff, tint, lm.nodeStart);
            }
            done += n;
        }
    }
    // Raw spans: copy by channel identity where the file has those channels.
    for (const span of layout.rawSpans) {
        const s = span.channelStart;
        const e = Math.min(span.channelStart + span.count, desc.totalChannels);
        if (e <= s) continue;
        for (const piece of remapChannels(sparse, s, e - s)) {
            b.push(IN_RAW, piece.src, layout.rawOffset + span.rawOffset + (piece.ch - s), piece.count, 1, 0, 0, 0, 0, -1, -1, 0, 0);
        }
    }
    const extra = desc.models.filter((m) => !seen.has(m.name) && !layout.models.some((lm) => lm.name === m.name)).map((m) => m.name);

    const ops = Int32Array.from(b.ops);
    const srcChannels = sparse ? sparse.reduce((a, r) => Math.max(a, r.srcOffset + r.length), 0) : desc.totalChannels;
    const map: InputMap = {
        id: 0,
        descriptorHash: descriptorHash(desc),
        layoutVersion: layout.layoutVersion,
        srcChannels,
        frameBytes: layout.frameBytes,
        pixelStride: stride,
        ops,
        opCount: ops.length / OP_INTS,
        luts: Uint8Array.from(b.luts),
        perms: Int32Array.from(b.perms),
        missing,
        extra,
        resized,
        inverted,
    };
    map.id = fnv1a(`${map.descriptorHash}:${map.layoutVersion}:${sparse ? JSON.stringify(sparse) : ''}`);
    return map;
}

/** Copy a program's tables into SharedArrayBuffers so workers can receive it without copying. */
export function sharedInputMapProgram(map: InputMap): InputMapProgram {
    const share = <T extends Int32Array | Uint8Array>(a: T, ctor: { new (b: SharedArrayBuffer): T; BYTES_PER_ELEMENT: number }) => {
        const sab = new SharedArrayBuffer(Math.max(1, a.length) * ctor.BYTES_PER_ELEMENT);
        const v = new ctor(sab);
        v.set(a as never);
        return a.length ? v : new ctor(new SharedArrayBuffer(0));
    };
    return {
        id: map.id,
        srcChannels: map.srcChannels,
        frameBytes: map.frameBytes,
        pixelStride: map.pixelStride,
        ops: share(map.ops, Int32Array),
        luts: share(map.luts, Uint8Array),
        perms: share(map.perms, Int32Array),
    };
}

/** Fields of an InputMap that can cross a worker boundary (typed arrays over plain buffers). */
export interface InputMapProgram {
    id: number;
    srcChannels: number;
    frameBytes: number;
    pixelStride: number;
    ops: Int32Array;
    luts: Uint8Array;
    perms: Int32Array;
}

export function inputMapProgram(map: InputMap): InputMapProgram {
    return {
        id: map.id,
        srcChannels: map.srcChannels,
        frameBytes: map.frameBytes,
        pixelStride: map.pixelStride,
        ops: map.ops,
        luts: map.luts,
        perms: map.perms,
    };
}

/**
 * Apply the map to one frame. `src` is a dense channel-space frame starting at
 * srcBase (at least srcChannels bytes); `dst` receives frameBytes at dstBase.
 */
export function applyInputMap(map: InputMapProgram, src: Uint8Array, srcBase: number, dst: Uint8Array, dstBase: number): void {
    const ops = map.ops;
    const stride = map.pixelStride;
    const luts = map.luts;
    const perms = map.perms;
    dst.fill(0, dstBase, dstBase + map.frameBytes);
    for (let o = 0; o < ops.length; o += OP_INTS) {
        const kind = ops[o + O_KIND];
        const count = ops[o + O_COUNT];
        if (kind === IN_RAW) {
            const s = srcBase + ops[o + O_SRC];
            dst.set(src.subarray(s, s + count), dstBase + ops[o + O_DST]);
            continue;
        }
        const cpn = ops[o + O_CPN];
        const lut = ops[o + O_LUT];
        const lutOff = lut >= 0 ? lut * 256 : -1;
        const permOff = ops[o + O_PERM];
        const dstNode0 = ops[o + O_DST];
        const modelBase = ops[o + O_MODEL_BASE];
        let s = srcBase + ops[o + O_SRC];
        if (kind === IN_RGB || kind === IN_RGBW) {
            const ro = ops[o + O_R];
            const go = ops[o + O_G];
            const bo = ops[o + O_B];
            const wo = ops[o + O_W];
            for (let i = 0; i < count; ++i, s += cpn) {
                const d = dstBase + (permOff >= 0 ? modelBase + perms[permOff + i] : dstNode0 + i) * stride;
                let r = src[s + ro];
                let g = src[s + go];
                let bl = src[s + bo];
                if (lutOff >= 0) {
                    r = luts[lutOff + r];
                    g = luts[lutOff + g];
                    bl = luts[lutOff + bl];
                }
                dst[d] = r;
                dst[d + 1] = g;
                dst[d + 2] = bl;
                if (kind === IN_RGBW) {
                    let w = src[s + wo];
                    if (lutOff >= 0) w = luts[lutOff + w];
                    dst[d + 3] = w;
                }
            }
        } else if (kind === IN_MONO) {
            const mo = ops[o + O_R];
            const tint = ops[o + O_TINT];
            const tr = (tint >> 16) & 255;
            const tg = (tint >> 8) & 255;
            const tb = tint & 255;
            for (let i = 0; i < count; ++i, s += cpn) {
                const d = dstBase + (permOff >= 0 ? modelBase + perms[permOff + i] : dstNode0 + i) * stride;
                let v = src[s + mo];
                if (lutOff >= 0) v = luts[lutOff + v];
                dst[d] = (v * tr + 127) / 255 | 0;
                dst[d + 1] = (v * tg + 127) / 255 | 0;
                dst[d + 2] = (v * tb + 127) / 255 | 0;
            }
        }
    }
}

/** Apply the map to every frame of a chunk. */
export function applyInputMapChunk(
    map: InputMapProgram,
    src: Uint8Array,
    srcStride: number,
    dst: Uint8Array,
    nframes: number,
): void {
    for (let f = 0; f < nframes; ++f) {
        applyInputMap(map, src, f * srcStride, dst, f * map.frameBytes);
    }
}
