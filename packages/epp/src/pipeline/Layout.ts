/*
 * Display Layout: the canonical node order for a show, compiled from the
 * models of xlights_rgbeffects.xml.  Pixel models become contiguous runs of
 * RGB(X) nodes; everything else (DMX, serial, unrepresentable string types,
 * channels nobody owns) is carried in a raw region so it still reaches the
 * wire untouched.
 */

import { X_MEANING_NONE, X_MEANING_WHITE, XMeaning } from './FramePool';

export type RoleKind = 'red' | 'green' | 'blue' | 'white' | 'warmWhite' | 'intensity' | 'tint' | 'unused';

export interface ChannelRoleSpec {
    /** 0-based offset of the channel within the node. */
    offset: number;
    kind: RoleKind;
    /** Hex color, required for intensity and tint. */
    tint?: string;
}

/** A contiguous run of nodes mapped to consecutive channels. */
export interface NodeRun {
    nodeStart: number;
    nodeCount: number;
    /** 0-based absolute channel of the first node in the run. */
    channelStart: number;
}

/** One model as the layout compiler needs it (a projection of XlModelChannelInfo plus geometry). */
export interface LayoutModelSpec {
    name: string;
    /** 0-based absolute first channel. */
    startChannel: number;
    nodeCount: number;
    channelsPerNode: number;
    roles: ChannelRoleSpec[];
    /** Node-to-channel runs; a single run from startChannel when absent. */
    runs?: NodeRun[];
    /** Present when the model's nodes form a dense width x height grid; xy holds bufX, bufY per node. */
    grid?: { width: number; height: number; xy?: Int32Array };
    /** World coordinates, 3 floats per node, for coordinate kernels and the manifest. */
    world?: Float32Array;
    /** Baked-in renderer gamma and brightness (1 and 1 for a clean render). */
    gamma?: number;
    brightness?: number;
    /** Wire-side preferences, used by the Output Map under player policy. */
    outputGamma?: number;
    outputBrightness?: number;
    outputColorOrder?: string;
}

export type NodeCodecKind = 'rgb' | 'rgbw' | 'mono' | 'raw';

/** How a node's channels map to and from canonical RGB(X). */
export interface NodeCodec {
    kind: NodeCodecKind;
    channelsPerNode: number;
    r: number;
    g: number;
    b: number;
    /** Offset of the white channel for rgbw. */
    w: number;
    /** Offset of the single channel for mono. */
    mono: number;
    /** Tint for mono as 0..255 components; the largest component must be 255 for a lossless round trip. */
    tintR: number;
    tintG: number;
    tintB: number;
}

export interface LayoutModel {
    name: string;
    /** Index of the first node in the pixel region; -1 for raw models. */
    nodeStart: number;
    nodeCount: number;
    codec: NodeCodec;
    runs: NodeRun[];
    /** Canonical position (relative to nodeStart) of xLights node i; identity when absent. */
    perm?: Int32Array;
    grid?: { width: number; height: number };
    gamma: number;
    brightness: number;
    outputGamma?: number;
    outputBrightness?: number;
    outputColorOrder?: string;
    /** Why the model landed in the raw region. */
    rawReason?: string;
}

export interface RawSpan {
    /** 0-based absolute channel. */
    channelStart: number;
    count: number;
    /** Byte offset within the raw region. */
    rawOffset: number;
}

export interface DisplayLayout {
    layoutVersion: number;
    pixelStride: 3 | 4;
    xMeaning: XMeaning;
    nodeCount: number;
    /** Bytes in the pixel region (node runs aligned to 16). */
    pixelBytes: number;
    rawOffset: number;
    rawCount: number;
    frameBytes: number;
    /** Extent of channel space covered (max of model ends and channelCeiling). */
    totalChannels: number;
    models: LayoutModel[];
    rawSpans: RawSpan[];
    /** World coordinates by canonical node index, 3 floats each; zeros where unknown. */
    world?: Float32Array;
}

export interface LayoutOptions {
    /** Channel-space extent to cover even where no model exists (controllers' ranges). */
    channelCeiling?: number;
    /** 3 for RGB8, 4 for RGBX8. Default: 4 with white when any model has a white channel, else 3. */
    pixelStride?: 3 | 4;
    xMeaning?: XMeaning;
    /** Keep world coordinates in the layout (memory: 12 bytes per node). */
    keepWorld?: boolean;
}

const NODE_ALIGN = 16;

export function parseHexColor(hex: string | undefined): [number, number, number] | undefined {
    if (!hex) return undefined;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return undefined;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const IMPLICIT_TINT: Record<string, [number, number, number]> = {
    white: [255, 255, 255],
    warmWhite: [255, 229, 204],
};

/**
 * Classify a node's channel roles. Anything that cannot round-trip through
 * canonical RGB(X) byte-exactly is 'raw'.
 */
export function classifyRoles(roles: ChannelRoleSpec[], channelsPerNode: number, allowWhite: boolean): NodeCodec {
    const codec: NodeCodec = {
        kind: 'raw',
        channelsPerNode,
        r: -1,
        g: -1,
        b: -1,
        w: -1,
        mono: -1,
        tintR: 0,
        tintG: 0,
        tintB: 0,
    };
    if (!roles.length || channelsPerNode <= 0) return codec;
    let whites = 0;
    let monos = 0;
    let bad = false;
    for (const r of roles) {
        if (r.offset < 0 || r.offset >= channelsPerNode) {
            bad = true;
            break;
        }
        switch (r.kind) {
            case 'red':
                if (codec.r >= 0) bad = true;
                codec.r = r.offset;
                break;
            case 'green':
                if (codec.g >= 0) bad = true;
                codec.g = r.offset;
                break;
            case 'blue':
                if (codec.b >= 0) bad = true;
                codec.b = r.offset;
                break;
            case 'white':
            case 'warmWhite':
                ++whites;
                codec.w = r.offset;
                break;
            case 'intensity':
            case 'tint': {
                ++monos;
                codec.mono = r.offset;
                const t = parseHexColor(r.tint);
                if (!t) bad = true;
                else [codec.tintR, codec.tintG, codec.tintB] = t;
                break;
            }
            case 'unused':
                break;
            default:
                bad = true;
        }
    }
    if (bad) return codec;
    const hasRGB = codec.r >= 0 && codec.g >= 0 && codec.b >= 0;
    if (hasRGB && monos === 0) {
        if (whites === 0) codec.kind = 'rgb';
        else if (whites === 1 && allowWhite) codec.kind = 'rgbw';
        return codec;
    }
    if (!hasRGB && codec.r < 0 && codec.g < 0 && codec.b < 0 && whites === 0 && monos === 1) {
        // Lossless only when the tint's largest component is full scale.
        const mx = Math.max(codec.tintR, codec.tintG, codec.tintB);
        if (mx === 255) codec.kind = 'mono';
        return codec;
    }
    if (!hasRGB && codec.r < 0 && codec.g < 0 && codec.b < 0 && whites === 1 && monos === 0) {
        // A lone white channel is mono with the white tint.
        const role = roles.find((r) => r.kind === 'white' || r.kind === 'warmWhite')!;
        const t = IMPLICIT_TINT[role.kind];
        codec.mono = codec.w;
        codec.w = -1;
        [codec.tintR, codec.tintG, codec.tintB] = t;
        codec.kind = 'mono';
        return codec;
    }
    return codec;
}

/** FNV-1a over a string, for layout and descriptor versions. */
export function fnv1a(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; ++i) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

function modelRuns(m: LayoutModelSpec): NodeRun[] {
    if (m.runs && m.runs.length) return m.runs.map((r) => ({ ...r }));
    return [{ nodeStart: 0, nodeCount: m.nodeCount, channelStart: m.startChannel }];
}

/** Build a permutation putting a dense grid in row-major order (bottom row first). */
function gridPermutation(m: LayoutModelSpec): Int32Array | undefined {
    const g = m.grid;
    if (!g || !g.xy || g.width <= 0 || g.height <= 0) return undefined;
    const xy = g.xy;
    if (g.width * g.height !== m.nodeCount || xy.length < m.nodeCount * 2) return undefined;
    const perm = new Int32Array(m.nodeCount);
    const seen = new Uint8Array(m.nodeCount);
    let identity = true;
    for (let i = 0; i < m.nodeCount; ++i) {
        const x: number = xy[i * 2];
        const y: number = xy[i * 2 + 1];
        if (x < 0 || x >= g.width || y < 0 || y >= g.height) return undefined;
        const p = y * g.width + x;
        if (seen[p]) return undefined; // not a bijection
        seen[p] = 1;
        perm[i] = p;
        if (p !== i) identity = false;
    }
    return identity ? undefined : perm;
}

export function compileLayout(specs: LayoutModelSpec[], opts?: LayoutOptions): DisplayLayout {
    const anyWhite = specs.some((m) => m.roles.some((r) => r.kind === 'white' || r.kind === 'warmWhite'));
    let pixelStride: 3 | 4 = opts?.pixelStride ?? (anyWhite ? 4 : 3);
    let xMeaning: XMeaning = opts?.xMeaning ?? (pixelStride === 4 && anyWhite ? X_MEANING_WHITE : X_MEANING_NONE);
    if (pixelStride === 3) xMeaning = X_MEANING_NONE;
    if (opts?.pixelStride === 4 && opts?.xMeaning === undefined) xMeaning = anyWhite ? X_MEANING_WHITE : X_MEANING_NONE;
    if (pixelStride !== 3 && pixelStride !== 4) pixelStride = 3;
    const allowWhite = pixelStride === 4 && xMeaning === X_MEANING_WHITE;

    const models: LayoutModel[] = [];
    let nodeCursor = 0;
    let totalChannels = opts?.channelCeiling ?? 0;
    // Channel ranges owned by pixel models, to subtract from the raw region.
    const owned: { start: number; end: number }[] = [];

    const sorted = [...specs].sort((a, b) => a.startChannel - b.startChannel || a.name.localeCompare(b.name));
    for (const m of sorted) {
        const runs = modelRuns(m);
        for (const r of runs) totalChannels = Math.max(totalChannels, r.channelStart + r.nodeCount * m.channelsPerNode);
        const codec = classifyRoles(m.roles, m.channelsPerNode, allowWhite);
        const lm: LayoutModel = {
            name: m.name,
            nodeStart: -1,
            nodeCount: m.nodeCount,
            codec,
            runs,
            gamma: m.gamma ?? 1,
            brightness: m.brightness ?? 1,
            outputGamma: m.outputGamma,
            outputBrightness: m.outputBrightness,
            outputColorOrder: m.outputColorOrder,
        };
        const runNodes = runs.reduce((a, r) => a + r.nodeCount, 0);
        if (codec.kind === 'raw' || m.nodeCount <= 0 || runNodes !== m.nodeCount) {
            lm.rawReason =
                codec.kind === 'raw' ? 'string type cannot round-trip through RGB' : 'node runs do not cover the model';
            models.push(lm);
            continue;
        }
        lm.nodeStart = nodeCursor;
        lm.perm = gridPermutation(m);
        if (m.grid) lm.grid = { width: m.grid.width, height: m.grid.height };
        nodeCursor += m.nodeCount;
        // Next model starts on a 16-node boundary: 16 bytes aligned for either stride.
        nodeCursor = Math.ceil(nodeCursor / NODE_ALIGN) * NODE_ALIGN;
        for (const r of runs) owned.push({ start: r.channelStart, end: r.channelStart + r.nodeCount * m.channelsPerNode });
        models.push(lm);
    }

    const nodeCount = nodeCursor;
    const pixelBytes = Math.ceil((nodeCount * pixelStride) / NODE_ALIGN) * NODE_ALIGN;

    // Raw spans: everything in [0, totalChannels) not owned by a pixel model.
    owned.sort((a, b) => a.start - b.start);
    const rawSpans: RawSpan[] = [];
    let cursor = 0;
    let rawOff = 0;
    const pushSpan = (s: number, e: number) => {
        if (e <= s) return;
        rawSpans.push({ channelStart: s, count: e - s, rawOffset: rawOff });
        rawOff += e - s;
    };
    for (const o of owned) {
        if (o.start > cursor) pushSpan(cursor, o.start);
        cursor = Math.max(cursor, o.end);
    }
    pushSpan(cursor, totalChannels);

    const rawCount = rawOff;
    // An empty layout still gets a (zero) frame to publish, so the pool has something to hand out.
    const frameBytes = Math.max(4, pixelBytes + Math.ceil(rawCount / 4) * 4);

    let world: Float32Array | undefined;
    if (opts?.keepWorld) {
        world = new Float32Array(nodeCount * 3);
        for (let i = 0; i < models.length; ++i) {
            const lm = models[i];
            const spec = sorted[i];
            if (lm.nodeStart < 0 || !spec.world) continue;
            for (let n = 0; n < lm.nodeCount; ++n) {
                const dst = lm.nodeStart + (lm.perm ? lm.perm[n] : n);
                world[dst * 3] = spec.world[n * 3];
                world[dst * 3 + 1] = spec.world[n * 3 + 1];
                world[dst * 3 + 2] = spec.world[n * 3 + 2];
            }
        }
    }

    const layout: DisplayLayout = {
        layoutVersion: 0,
        pixelStride,
        xMeaning,
        nodeCount,
        pixelBytes,
        rawOffset: pixelBytes,
        rawCount,
        frameBytes,
        totalChannels,
        models,
        rawSpans,
        world,
    };
    layout.layoutVersion = fnv1a(JSON.stringify(layoutManifest(layout)));
    return layout;
}

/** What readers need to interpret a frame; stable across frames of one layout. */
export interface LayoutManifest {
    layoutVersion: number;
    pixelStride: number;
    xMeaning: number;
    nodeCount: number;
    pixelBytes: number;
    rawOffset: number;
    rawCount: number;
    frameBytes: number;
    totalChannels: number;
    models: {
        name: string;
        nodeStart: number;
        nodeCount: number;
        channelsPerNode: number;
        codec: NodeCodecKind;
        grid?: { width: number; height: number };
        raw?: string;
    }[];
    rawSpans: RawSpan[];
}

export function layoutManifest(layout: DisplayLayout): LayoutManifest {
    return {
        layoutVersion: layout.layoutVersion,
        pixelStride: layout.pixelStride,
        xMeaning: layout.xMeaning,
        nodeCount: layout.nodeCount,
        pixelBytes: layout.pixelBytes,
        rawOffset: layout.rawOffset,
        rawCount: layout.rawCount,
        frameBytes: layout.frameBytes,
        totalChannels: layout.totalChannels,
        models: layout.models.map((m) => ({
            name: m.name,
            nodeStart: m.nodeStart,
            nodeCount: m.nodeCount,
            channelsPerNode: m.codec.channelsPerNode,
            codec: m.codec.kind,
            grid: m.grid,
            raw: m.rawReason,
        })),
        rawSpans: layout.rawSpans,
    };
}

export function findModel(layout: DisplayLayout, name: string): LayoutModel | undefined {
    return layout.models.find((m) => m.name === name);
}

/** Byte offset of canonical node n in a frame. */
export function nodeOffset(layout: DisplayLayout, node: number): number {
    return node * layout.pixelStride;
}
