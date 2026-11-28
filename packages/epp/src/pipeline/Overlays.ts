/*
 * Overlay leases: pixels produced outside the compose path (an API client, a
 * game, a GPU producer) land in a double-buffered layer aimed at a model or
 * the whole display, and the compositor blends the latest complete layer
 * into each frame until the lease expires.
 */

import { DisplayLayout, LayoutModelSpec } from './Layout';
import { overlappingNodes, PixelTarget, StrandKind, TargetCatalog } from './Targets';
import { BlendMode, blendModeFromName, blendNodes, BLEND_ADD, BLEND_ALPHA, BLEND_MAX, BLEND_REPLACE } from './Kernels';
import {
    compilePatternJs,
    normalizeUniforms,
    PatternProgram,
    PatternSpec,
    PatternUniforms,
    resolvePattern,
} from './Patterns';

/**
 * 'buffer' is the target's own render buffer, sparse where it has no node. 'pattern'
 * carries no pixels: the player evaluates a program per node (see Patterns.ts) and
 * the payload is a JSON object of uniform values.
 */
export type OverlayFormat = 'grid' | 'nodes' | 'buffer' | 'pattern';

/** Longest uniform payload a pattern lease accepts. */
export const PATTERN_PAYLOAD_MAX = 16384;

/** Which cell colors a node that sits in several buffer cells. */
export type OverlayOverlap = 'last' | 'first' | 'max';

/** 'exclusive' refuses other exclusive leases on any of its nodes; 'layer' blends over anything. */
export type OverlayMode = 'exclusive' | 'layer';

/** The app instance that opened a lease; the server fills this in from the app token. */
export interface OverlayOwner {
    instance: string;
    title: string;
}

export interface OverlayLeaseRequest {
    /** Who is painting; shown in the lease list and in "in use" errors. */
    name: string;
    mode: OverlayMode;
    /** Never taken from a client; see OverlayOwner. */
    owner?: OverlayOwner;
    /** Model name or "Model/Submodel"; the whole display when absent. */
    model?: string;
    /** Submodel of `model`, when not given in the name. */
    subModel?: string;
    /** Several targets at once (models or "Model/Submodel"); the payload lists their nodes in this order. */
    models?: string[];
    /** An xLights model group; the player resolves it to `models` before opening. */
    group?: string;
    /** 'grid' and 'buffer': width x height rows of cells, top row first; 'nodes': one cell per node. */
    format?: OverlayFormat;
    /** Bytes per cell: 3 (RGB) or 4 (RGBA; alpha scales the cell before it blends, and fades the frame under an 'over' blend). */
    channels?: 3 | 4;
    /** 'pattern' format: the program to evaluate per node and its starting uniforms. */
    pattern?: PatternSpec;
    /** Payload size; defaults to the target's own grid or buffer (or nodeCount x 1). */
    width?: number;
    height?: number;
    /** 'buffer' only; 'last' is the cell listed latest, as xLights picks. */
    overlap?: OverlayOverlap;
    blend?: string;
    /** 0..1 */
    opacity?: number;
    ttlMs?: number;
}

export interface OverlayTargetQuery {
    /** Only this model (with its submodels) or this "Model/Submodel". */
    model?: string;
    /** 'submodels' adds submodels and the shape of every target; 'nodes' adds per-node coordinates too. */
    detail?: 'submodels' | 'nodes';
}

export interface OverlayTargetInfo {
    model: string;
    subModel?: string;
    nodeCount: number;
    /** Dense grid size. */
    width?: number;
    height?: number;
    /** How many submodels the model has. */
    subModels?: number;
    /** Name to open a lease with. */
    target?: string;
    kind?: StrandKind;
    /** Nodes per strand. */
    strands?: number[];
    buffer?: { width: number; height: number };
    /** Nodes that sit in more than one buffer cell. */
    overlaps?: number;
    vertical?: boolean;
    bufferStyle?: string;
    /** Per node, in 'nodes' payload order; cells are (node, x, y) with y up. */
    nodes?: { world?: number[]; local?: number[]; cells?: number[] };
}

export interface OverlayLeaseInfo {
    id: number;
    token: number;
    name: string;
    mode: OverlayMode;
    owner?: OverlayOwner;
    model?: string;
    subModel?: string;
    /** The targets of a multi-target lease, in payload order. */
    models?: string[];
    group?: string;
    format: OverlayFormat;
    channels: 3 | 4;
    overlap?: OverlayOverlap;
    width: number;
    height: number;
    /** First canonical node; -1 when the target's nodes are not one run. */
    nodeStart: number;
    nodeCount: number;
    /** Bytes one full payload carries; 0 for a pattern lease, whose payload is JSON. */
    frameBytes: number;
    blend: string;
    opacity: number;
    ttlMs: number;
    expiresAt: number;
    openedAt: number;
    /** Frames committed so far (uniform updates for a pattern lease). */
    frames: number;
    /** Pattern leases: how many output frames the pattern has painted, i.e. the player's frame rate over time. */
    renders?: number;
    /** Pattern leases: how long one paint takes, in ms, smoothed over the last few dozen frames. */
    renderMs?: number;
    /** Pattern leases: what runs, on which evaluator, and the uniforms it paints with now. */
    pattern?: { preset?: string; backend: string; uniforms: PatternUniforms };
}

const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 24 * 3600 * 1000;

/** The instance title when an app holds the lease, else the name the client gave. */
export function overlayHolderLabel(lease: OverlayLeaseInfo): string {
    return lease.owner?.title ?? lease.name;
}

/** An exclusive lease asked for nodes another exclusive lease holds. */
export class OverlayConflictError extends Error {
    constructor(
        readonly target: string,
        readonly heldBy: OverlayLeaseInfo,
    ) {
        super(`${target} is in use by ${overlayHolderLabel(heldBy)}`);
        this.name = 'OverlayConflictError';
    }
}

/** The canonical nodes a lease paints: a run, or a list when they are scattered. */
type NodeSpan = { start: number; count: number } | Int32Array;

function spansOverlap(a: NodeSpan, b: NodeSpan): boolean {
    if (!(a instanceof Int32Array) && !(b instanceof Int32Array)) {
        return a.start < b.start + b.count && b.start < a.start + a.count;
    }
    const list = a instanceof Int32Array ? a : (b as Int32Array);
    const other = a instanceof Int32Array ? b : a;
    if (other instanceof Int32Array) {
        const set = new Set(other);
        return list.some((n) => set.has(n));
    }
    return list.some((n) => n >= other.start && n < other.start + other.count);
}

/** The nodes, coordinates and program a pattern renderer paints. */
export interface PatternLeaseSpec {
    program: PatternProgram;
    /** World x, y, z per node, in payload order. */
    world: Float32Array;
    /** Model-local x, y, z per node, when every node has them. */
    local?: Float32Array;
    nodeCount: number;
}

export interface PatternRenderer {
    /** 'js' or 'gpu'; shown in the lease info. */
    readonly backend: string;
    /** RGBA per node, straight alpha, into the first nodeCount * 4 bytes of out. */
    render(uniforms: PatternUniforms, t: number, out: Uint8Array): void;
    dispose(): void;
}

/** Makes the renderer for a pattern lease; the player supplies a GPU one when it can. */
export type PatternBackend = (spec: PatternLeaseSpec) => PatternRenderer;

/** The evaluator every player has: the program compiled to JavaScript. */
export function jsPatternBackend(spec: PatternLeaseSpec): PatternRenderer {
    const fn = compilePatternJs(spec.program);
    return {
        backend: 'js',
        render: (uniforms, t, out) => fn(spec.world, spec.local, spec.nodeCount, t, uniforms, out),
        dispose: () => undefined,
    };
}

interface LayerPattern {
    renderer: PatternRenderer;
    program: PatternProgram;
    uniforms: PatternUniforms;
}

class OverlayLayer {
    info: OverlayLeaseInfo;
    blendMode: BlendMode;
    /** Committed pixels in payload node order: RGB for 3-channel payloads, RGBA for 4-channel and pattern leases. */
    front: Uint8Array;
    /** Bytes per node in `front`. */
    private readonly fs: 3 | 4;
    /** Payload being assembled from packets. */
    staging: Uint8Array;
    stagingSeq = -1;
    stagingBytes = 0;
    hasFrame = false;
    /** Nearest-neighbour map from target node to payload cell, or null for 1:1 rows. */
    private nodeToCell: Int32Array | null = null;
    /** (target node, payload cell) pairs for 'buffer', in the order the cells were listed. */
    private cellPairs: Int32Array | null = null;
    /** Canonical node per payload node; null when the nodes are the run from nodeStart. */
    private readonly nodes: Int32Array | null;
    private readonly target?: PixelTarget;
    readonly pattern?: LayerPattern;

    constructor(
        info: OverlayLeaseInfo,
        target: PixelTarget | undefined,
        nodes: Int32Array | null,
        pattern?: LayerPattern,
    ) {
        this.info = info;
        this.target = target;
        this.nodes = nodes;
        this.pattern = pattern;
        this.blendMode = blendModeFromName(info.blend, BLEND_REPLACE);
        this.fs = info.format === 'pattern' || info.channels === 4 ? 4 : 3;
        this.front = new Uint8Array(info.nodeCount * this.fs);
        this.staging = new Uint8Array(info.format === 'pattern' ? PATTERN_PAYLOAD_MAX : info.frameBytes);
        if (info.format === 'grid') this.buildGridMap();
        if (info.format === 'buffer') this.buildBufferMap();
        // A pattern paints from its first frame; nothing has to arrive first.
        if (pattern) this.hasFrame = true;
    }

    get span(): NodeSpan {
        return this.nodes ?? { start: this.info.nodeStart, count: this.info.nodeCount };
    }

    private buildBufferMap() {
        const { width, height } = this.info;
        const b = this.target!.buffer!;
        const pairs = new Int32Array((b.cells.length / 3) * 2);
        for (let k = 0, p = 0; k < b.cells.length; k += 3, p += 2) {
            const bx = Math.max(0, Math.min(b.width - 1, b.cells[k + 1]));
            const by = Math.max(0, Math.min(b.height - 1, b.cells[k + 2]));
            const x = Math.min(width - 1, Math.floor(((bx + 0.5) * width) / b.width));
            // Payload rows run top first; buffer rows run bottom first.
            const y = height - 1 - Math.min(height - 1, Math.floor(((by + 0.5) * height) / b.height));
            pairs[p] = b.cells[k];
            pairs[p + 1] = y * width + x;
        }
        this.cellPairs = pairs;
    }

    private buildGridMap() {
        const { width, height, nodeCount } = this.info;
        const grid = this.target?.grid;
        // Canonical grid models are row-major, bottom row first; payload rows are top first.
        if (grid && grid.width === width && grid.height === height) {
            this.nodeToCell = null;
            return;
        }
        const map = new Int32Array(nodeCount);
        if (grid) {
            for (let n = 0; n < nodeCount; ++n) {
                const gy = Math.floor(n / grid.width);
                const gx = n - gy * grid.width;
                const x = Math.min(width - 1, Math.floor(((gx + 0.5) * width) / grid.width));
                // Payload rows run top first; canonical rows run bottom first.
                const y = height - 1 - Math.min(height - 1, Math.floor(((gy + 0.5) * height) / grid.height));
                map[n] = y * width + x;
            }
        } else {
            // No grid: the target is a strip; each node takes its nearest cell along it.
            const cells = width * height;
            for (let n = 0; n < nodeCount; ++n)
                map[n] = Math.min(cells - 1, Math.floor(((n + 0.5) * cells) / nodeCount));
        }
        this.nodeToCell = map;
    }

    /** Write a payload fragment; commits the frame when `last` completes it. Returns true on commit. */
    write(seq: number, offset: number, data: Uint8Array, last: boolean): boolean {
        if (seq !== this.stagingSeq) {
            this.stagingSeq = seq;
            this.stagingBytes = 0;
        }
        if (offset < 0 || offset + data.length > this.staging.length) return false;
        this.staging.set(data, offset);
        this.stagingBytes = Math.max(this.stagingBytes, offset + data.length);
        if (!last) return false;
        if (this.pattern) return this.commitUniforms();
        this.commit();
        return true;
    }

    /** A pattern payload is a JSON object of uniform values; unknown names are ignored, wrong shapes refuse the whole update. */
    private commitUniforms(): boolean {
        const p = this.pattern!;
        let values: unknown;
        try {
            values = JSON.parse(new TextDecoder().decode(this.staging.subarray(0, this.stagingBytes)));
        } catch {
            return false;
        }
        if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
        let next: PatternUniforms;
        try {
            next = normalizeUniforms(p.program, values as Record<string, never>);
        } catch {
            return false;
        }
        for (const k of Object.keys(values as object)) if (k in next) p.uniforms[k] = next[k];
        this.info.frames++;
        return true;
    }

    /** Copy payload cell s to front node d. */
    private put(d: number, s: number): void {
        const ch = this.info.channels;
        const src = this.staging;
        const dst = this.front;
        const o = d * this.fs;
        const q = s * ch;
        dst[o] = src[q];
        dst[o + 1] = src[q + 1];
        dst[o + 2] = src[q + 2];
        if (this.fs === 4) dst[o + 3] = ch === 4 ? src[q + 3] : 255;
    }

    /** Commit the staging payload into the front buffer. */
    commit(): void {
        const { width, height, nodeCount, format, channels } = this.info;
        const src = this.staging;
        const dst = this.front;
        if (format === 'nodes') {
            if (channels === this.fs) dst.set(src.subarray(0, nodeCount * channels));
            else for (let n = 0; n < nodeCount; ++n) this.put(n, n);
        } else if (this.cellPairs) {
            const pairs = this.cellPairs;
            const rule = this.info.overlap;
            if (rule === 'max') {
                dst.fill(0);
                for (let p = 0; p < pairs.length; p += 2) {
                    const d = pairs[p] * this.fs;
                    const s = pairs[p + 1] * channels;
                    for (let c = 0; c < channels; ++c) if (src[s + c] > dst[d + c]) dst[d + c] = src[s + c];
                    if (channels === 3 && this.fs === 4) dst[d + 3] = 255;
                }
            } else {
                // The cell written last wins: walk backwards for 'first'.
                const back = rule === 'first';
                for (let i = 0; i < pairs.length; i += 2) {
                    const p = back ? pairs.length - 2 - i : i;
                    this.put(pairs[p], pairs[p + 1]);
                }
            }
        } else if (!this.nodeToCell) {
            // Same-size grid: flip rows (payload top-first, canonical bottom-first).
            if (channels === this.fs) {
                const rowBytes = width * channels;
                for (let y = 0; y < height; ++y) {
                    dst.set(src.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes);
                }
            } else {
                for (let y = 0; y < height; ++y)
                    for (let x = 0; x < width; ++x) this.put((height - 1 - y) * width + x, y * width + x);
            }
        } else {
            const map = this.nodeToCell;
            for (let n = 0; n < nodeCount; ++n) this.put(n, map[n]);
        }
        this.hasFrame = true;
        this.info.frames++;
    }

    /** Pattern leases paint themselves for the moment nowMs. */
    evaluate(nowMs: number): void {
        const p = this.pattern;
        if (!p) return;
        const t0 = performance.now();
        p.renderer.render(p.uniforms, (nowMs - this.info.openedAt) / 1000, this.front);
        const took = performance.now() - t0;
        // What a client asking "is the GPU keeping up?" wants: a count to rate, and a smoothed cost.
        this.info.renders = (this.info.renders ?? 0) + 1;
        this.info.renderMs =
            this.info.renderMs === undefined ? took : this.info.renderMs + (took - this.info.renderMs) / 32;
    }

    /** Blend the committed layer into a canonical frame. */
    composite(frame: Uint8Array, stride: number): void {
        if (!this.hasFrame) return;
        if (this.fs === 4) {
            this.compositeAlpha(frame, stride);
            return;
        }
        const { nodeStart, nodeCount, opacity } = this.info;
        const front = this.front;
        const nodes = this.nodes;
        const op = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
        if (!nodes && stride === 3 && op === 255) {
            blendNodes(
                this.blendMode,
                frame.subarray(nodeStart * 3, (nodeStart + nodeCount) * 3),
                front,
                3,
                0,
                nodeCount,
            );
            return;
        }
        // Generic path: per node through a 1-node scratch so the blend kernel sees matching strides.
        for (let n = 0; n < nodeCount; ++n) {
            const d = (nodes ? nodes[n] : nodeStart + n) * stride;
            const s = n * 3;
            scratchDst[0] = frame[d];
            scratchDst[1] = frame[d + 1];
            scratchDst[2] = frame[d + 2];
            scratchSrc[0] = front[s];
            scratchSrc[1] = front[s + 1];
            scratchSrc[2] = front[s + 2];
            if (op < 255) {
                // Opacity applies to the source before its own blend mode.
                scratchSrc[0] = ((scratchSrc[0] * op + 127) / 255) | 0;
                scratchSrc[1] = ((scratchSrc[1] * op + 127) / 255) | 0;
                scratchSrc[2] = ((scratchSrc[2] * op + 127) / 255) | 0;
            }
            blendNodes(this.blendMode, scratchDst, scratchSrc, 3, 0, 1);
            frame[d] = scratchDst[0];
            frame[d + 1] = scratchDst[1];
            frame[d + 2] = scratchDst[2];
        }
    }

    /**
     * RGBA layers: each node's alpha times the lease opacity scales the source before
     * its blend mode; 'over' (and 'replace') also fade the frame by the same amount, so
     * a transparent cell leaves the frame alone and a half-covered one shows both.
     */
    private compositeAlpha(frame: Uint8Array, stride: number): void {
        const { nodeStart, nodeCount, opacity } = this.info;
        const front = this.front;
        const nodes = this.nodes;
        const op = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
        const mode = this.blendMode;
        for (let n = 0; n < nodeCount; ++n) {
            const s = n * 4;
            const a = ((front[s + 3] * op + 127) / 255) | 0;
            if (a === 0) continue;
            const d = (nodes ? nodes[n] : nodeStart + n) * stride;
            let r = front[s];
            let g = front[s + 1];
            let b = front[s + 2];
            if (a < 255) {
                r = ((r * a + 127) / 255) | 0;
                g = ((g * a + 127) / 255) | 0;
                b = ((b * a + 127) / 255) | 0;
            }
            switch (mode) {
                case BLEND_ADD: {
                    const r2 = frame[d] + r;
                    const g2 = frame[d + 1] + g;
                    const b2 = frame[d + 2] + b;
                    frame[d] = r2 > 255 ? 255 : r2;
                    frame[d + 1] = g2 > 255 ? 255 : g2;
                    frame[d + 2] = b2 > 255 ? 255 : b2;
                    break;
                }
                case BLEND_MAX:
                    if (r > frame[d]) frame[d] = r;
                    if (g > frame[d + 1]) frame[d + 1] = g;
                    if (b > frame[d + 2]) frame[d + 2] = b;
                    break;
                case BLEND_REPLACE:
                case BLEND_ALPHA:
                    if (a === 255) {
                        frame[d] = r;
                        frame[d + 1] = g;
                        frame[d + 2] = b;
                    } else {
                        const inv = 255 - a;
                        frame[d] = (((frame[d] * inv + 127) / 255) | 0) + r;
                        frame[d + 1] = (((frame[d + 1] * inv + 127) / 255) | 0) + g;
                        frame[d + 2] = (((frame[d + 2] * inv + 127) / 255) | 0) + b;
                    }
                    break;
                default:
                    scratchDst[0] = frame[d];
                    scratchDst[1] = frame[d + 1];
                    scratchDst[2] = frame[d + 2];
                    scratchSrc[0] = r;
                    scratchSrc[1] = g;
                    scratchSrc[2] = b;
                    blendNodes(mode, scratchDst, scratchSrc, 3, 0, 1);
                    frame[d] = scratchDst[0];
                    frame[d + 1] = scratchDst[1];
                    frame[d + 2] = scratchDst[2];
            }
        }
    }

    dispose(): void {
        this.pattern?.renderer.dispose();
    }
}

const scratchDst = new Uint8Array(3);
const scratchSrc = new Uint8Array(3);

export interface OverlayManagerOptions {
    /** Renders pattern leases; the JavaScript evaluator when absent. */
    patternBackend?: PatternBackend;
}

export class OverlayManager {
    private layers = new Map<number, OverlayLayer>();
    private nextId = 1;
    readonly layout: DisplayLayout;
    /** Models and submodels by name; effects can resolve their targets here too. */
    readonly catalog: TargetCatalog;
    private readonly patternBackend: PatternBackend;

    constructor(layout: DisplayLayout, specs?: LayoutModelSpec[], opts: OverlayManagerOptions = {}) {
        this.layout = layout;
        this.catalog = new TargetCatalog(layout, specs);
        this.patternBackend = opts.patternBackend ?? jsPatternBackend;
    }

    /** What a client can target. Models only unless more detail is asked for. */
    targets(q: OverlayTargetQuery = {}): OverlayTargetInfo[] {
        const out: OverlayTargetInfo[] = [];
        const one = q.model ? this.catalog.find(q.model) : undefined;
        if (q.model && !one) return out;
        const detail = q.detail === 'submodels' || q.detail === 'nodes' ? q.detail : undefined;
        for (const name of one ? [one.model] : this.catalog.modelNames()) {
            const subs = this.catalog.subModelNames(name);
            if (!one?.subModel) {
                const info = this.describe(this.catalog.find(name)!, detail);
                if (subs.length) info.subModels = subs.length;
                out.push(info);
            }
            if (!detail) continue;
            for (const sub of subs) {
                if (one?.subModel && one.subModel !== sub) continue;
                const t = this.catalog.find(name, sub);
                if (t) out.push(this.describe(t, detail));
            }
        }
        return out;
    }

    private describe(t: PixelTarget, detail: OverlayTargetQuery['detail']): OverlayTargetInfo {
        const info: OverlayTargetInfo = {
            model: t.model,
            nodeCount: t.nodes.length,
            width: t.grid?.width,
            height: t.grid?.height,
        };
        if (!detail) return info;
        if (t.subModel) info.subModel = t.subModel;
        info.target = t.name;
        info.kind = t.kind;
        info.strands = t.strands;
        if (t.buffer) {
            info.buffer = { width: t.buffer.width, height: t.buffer.height };
            info.overlaps = overlappingNodes(t.buffer, t.nodes.length);
        }
        if (t.subModel) {
            info.vertical = t.vertical;
            info.bufferStyle = t.bufferStyle;
        }
        if (detail === 'nodes') {
            const round = (v: number) => Math.round(v * 100) / 100;
            info.nodes = {};
            const world = this.layout.world;
            if (world) {
                info.nodes.world = [];
                for (const n of t.nodes)
                    info.nodes.world.push(round(world[n * 3]), round(world[n * 3 + 1]), round(world[n * 3 + 2]));
            }
            if (t.local) info.nodes.local = Array.from(t.local, round);
            if (t.buffer) info.nodes.cells = Array.from(t.buffer.cells);
        }
        return info;
    }

    open(req: OverlayLeaseRequest, now: number): OverlayLeaseInfo {
        if (req.mode !== 'exclusive' && req.mode !== 'layer')
            throw new Error("overlay: mode must be 'exclusive' or 'layer'");
        const name = typeof req.name === 'string' ? req.name.trim() : '';
        if (!name) throw new Error('overlay: name is required');
        let target: PixelTarget | undefined;
        let nodes: Int32Array | null = null;
        let nodeStart = 0;
        let nodeCount = this.layout.nodeCount;
        let models: string[] | undefined;
        if (req.models !== undefined) {
            // Several targets: their nodes concatenated in the order given.
            if (!Array.isArray(req.models) || req.models.length === 0)
                throw new Error('overlay: models must list at least one target');
            const found: PixelTarget[] = [];
            for (const m of req.models) {
                const t = this.catalog.find(String(m));
                if (!t) throw new Error(`overlay: no pixel model named ${String(m)}`);
                found.push(t);
            }
            models = found.map((t) => t.name);
            if (found.length === 1) {
                target = found[0];
                nodeStart = target.nodeStart;
                nodeCount = target.nodes.length;
                if (nodeStart < 0) nodes = target.nodes;
            } else {
                nodeCount = found.reduce((a, t) => a + t.nodes.length, 0);
                nodes = new Int32Array(nodeCount);
                let at = 0;
                for (const t of found) {
                    nodes.set(t.nodes, at);
                    at += t.nodes.length;
                }
                nodeStart = -1;
            }
        } else if (req.model) {
            target = this.catalog.find(req.model, req.subModel);
            if (!target)
                throw new Error(
                    `overlay: no pixel model named ${req.subModel ? req.model + '/' + req.subModel : req.model}`,
                );
            nodeStart = target.nodeStart;
            nodeCount = target.nodes.length;
            if (nodeStart < 0) nodes = target.nodes;
        }
        if (req.mode === 'exclusive') {
            const span: NodeSpan = nodes ?? { start: nodeStart, count: nodeCount };
            for (const l of this.layers.values()) {
                if (l.info.mode === 'exclusive' && spansOverlap(span, l.span)) {
                    throw new OverlayConflictError(
                        target?.name ?? (models ? models.join(', ') : 'The display'),
                        l.info,
                    );
                }
            }
        }
        const format: OverlayFormat =
            req.format ??
            (req.pattern ? 'pattern' : target?.subModel ? 'buffer' : target?.grid || req.width ? 'grid' : 'nodes');
        if (req.channels !== undefined && req.channels !== 3 && req.channels !== 4)
            throw new Error('overlay: channels must be 3 or 4');
        const channels: 3 | 4 = format === 'pattern' ? 4 : (req.channels ?? 3);
        let width = nodeCount;
        let height = 1;
        let pattern: LayerPattern | undefined;
        let patternInfo: OverlayLeaseInfo['pattern'];
        if (format === 'buffer') {
            if (models && models.length > 1) throw new Error('overlay: the buffer format takes one target');
            if (!target?.buffer)
                throw new Error('overlay: the buffer format needs a model or submodel with a known buffer');
            width = req.width ?? target.buffer.width;
            height = req.height ?? target.buffer.height;
        } else if (format === 'grid') {
            if (models && models.length > 1) throw new Error('overlay: the grid format takes one target');
            width = req.width ?? target?.grid?.width ?? nodeCount;
            height = req.height ?? target?.grid?.height ?? 1;
        } else if (format === 'pattern') {
            if (!req.pattern) throw new Error('overlay: the pattern format needs pattern: { preset } or { program }');
            const world = this.layout.world;
            if (!world) throw new Error('overlay: the layout has no node coordinates, so no pattern can run');
            let resolved;
            try {
                resolved = resolvePattern(req.pattern);
            } catch (e) {
                throw new Error(`overlay: ${(e as Error).message}`, { cause: e });
            }
            const spec = this.patternSpec(resolved.program, world, target, nodes, nodeStart, nodeCount, models);
            const renderer = this.patternBackend(spec);
            pattern = { renderer, program: resolved.program, uniforms: resolved.uniforms };
            patternInfo = { preset: resolved.preset, backend: renderer.backend, uniforms: resolved.uniforms };
            width = nodeCount;
            height = 1;
        } else if (format !== 'nodes') {
            throw new Error(`overlay: unknown format ${String(format)}`);
        }
        if (format !== 'nodes' && format !== 'pattern' && !(width > 0 && height > 0 && width * height <= 4_000_000))
            throw new Error('overlay: bad grid size');
        const overlap: OverlayOverlap | undefined =
            format !== 'buffer' ? undefined : req.overlap === 'first' || req.overlap === 'max' ? req.overlap : 'last';
        const ttlMs = Math.min(MAX_TTL_MS, Math.max(1000, req.ttlMs ?? DEFAULT_TTL_MS));
        const info: OverlayLeaseInfo = {
            id: this.nextId++,
            token: (Math.random() * 0xffffffff) >>> 0,
            name,
            mode: req.mode,
            owner: req.owner,
            model: target?.model ?? (models ? undefined : req.model),
            subModel: target?.subModel,
            models,
            group: typeof req.group === 'string' ? req.group : undefined,
            format,
            channels,
            overlap,
            width,
            height,
            nodeStart,
            nodeCount,
            frameBytes:
                format === 'pattern' ? 0 : format === 'nodes' ? nodeCount * channels : width * height * channels,
            blend: req.blend ?? (format === 'pattern' || channels === 4 ? 'over' : 'replace'),
            opacity: req.opacity ?? 1,
            ttlMs,
            expiresAt: now + ttlMs,
            openedAt: now,
            frames: 0,
            renders: patternInfo ? 0 : undefined,
            renderMs: patternInfo ? 0 : undefined,
            pattern: patternInfo,
        };
        this.layers.set(info.id, new OverlayLayer(info, target, nodes, pattern));
        return info;
    }

    /** Coordinates per payload node for a pattern: world always, local when every target has it. */
    private patternSpec(
        program: PatternProgram,
        world: Float32Array,
        target: PixelTarget | undefined,
        nodes: Int32Array | null,
        nodeStart: number,
        nodeCount: number,
        models: string[] | undefined,
    ): PatternLeaseSpec {
        const w = new Float32Array(nodeCount * 3);
        for (let n = 0; n < nodeCount; ++n) {
            const c = (nodes ? nodes[n] : nodeStart + n) * 3;
            w[n * 3] = world[c];
            w[n * 3 + 1] = world[c + 1];
            w[n * 3 + 2] = world[c + 2];
        }
        let local: Float32Array | undefined;
        if (target?.local) {
            local = target.local;
        } else if (models && models.length > 1) {
            const parts = models.map((m) => this.catalog.find(m)?.local);
            if (parts.every((p) => p !== undefined)) {
                local = new Float32Array(nodeCount * 3);
                let at = 0;
                for (const p of parts as Float32Array[]) {
                    local.set(p, at);
                    at += p.length;
                }
            }
        }
        return { program, world: w, local, nodeCount };
    }

    close(id: number): boolean {
        const l = this.layers.get(id);
        if (!l) return false;
        l.dispose();
        return this.layers.delete(id);
    }

    get(id: number): OverlayLeaseInfo | undefined {
        return this.layers.get(id)?.info;
    }

    list(): OverlayLeaseInfo[] {
        return [...this.layers.values()].map((l) => l.info);
    }

    /** Extend a lease; returns false when unknown. */
    touch(id: number, now: number): boolean {
        const l = this.layers.get(id);
        if (!l) return false;
        l.info.expiresAt = now + l.info.ttlMs;
        return true;
    }

    /** Ingest a payload fragment (a whole payload when offset 0 and last). */
    write(
        id: number,
        token: number,
        seq: number,
        offset: number,
        data: Uint8Array,
        last: boolean,
        now: number,
    ): boolean {
        const l = this.layers.get(id);
        if (!l || l.info.token !== token) return false;
        l.info.expiresAt = now + l.info.ttlMs;
        return l.write(seq, offset, data, last);
    }

    /** Drop expired leases; returns their ids. */
    expire(now: number): number[] {
        const gone: number[] = [];
        for (const [id, l] of this.layers) {
            if (l.info.expiresAt <= now) {
                l.dispose();
                this.layers.delete(id);
                gone.push(id);
            }
        }
        return gone;
    }

    get size(): number {
        return this.layers.size;
    }

    /** Blend every live layer into the frame, in lease order; patterns are evaluated for nowMs first. */
    composite(frame: Uint8Array, stride: number, nowMs = Date.now()): void {
        for (const l of this.layers.values()) {
            if (l.pattern) l.evaluate(nowMs);
            l.composite(frame, stride);
        }
    }
}

/** Wire format for overlay payload packets over UDP. */
export const OVERLAY_MAGIC = 0x455a4f31; // 'EZO1'
export const OVERLAY_HEADER_BYTES = 24;
export const OVERLAY_MAX_DATA = 1400;

export interface OverlayPacket {
    id: number;
    token: number;
    seq: number;
    last: boolean;
    offset: number;
    data: Uint8Array;
}

export function encodeOverlayPacket(p: OverlayPacket, out?: Uint8Array): Uint8Array {
    const buf =
        out && out.length >= OVERLAY_HEADER_BYTES + p.data.length
            ? out
            : new Uint8Array(OVERLAY_HEADER_BYTES + p.data.length);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    dv.setUint32(0, OVERLAY_MAGIC);
    dv.setUint32(4, p.id >>> 0);
    dv.setUint32(8, p.token >>> 0);
    dv.setUint32(12, p.seq >>> 0);
    dv.setUint8(16, p.last ? 1 : 0);
    dv.setUint32(17, p.offset >>> 0);
    dv.setUint16(21, p.data.length);
    dv.setUint8(23, 0);
    buf.set(p.data, OVERLAY_HEADER_BYTES);
    return buf.subarray(0, OVERLAY_HEADER_BYTES + p.data.length);
}

export function decodeOverlayPacket(buf: Uint8Array): OverlayPacket | undefined {
    if (buf.length < OVERLAY_HEADER_BYTES) return undefined;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint32(0) !== OVERLAY_MAGIC) return undefined;
    const len = dv.getUint16(21);
    if (OVERLAY_HEADER_BYTES + len > buf.length) return undefined;
    return {
        id: dv.getUint32(4),
        token: dv.getUint32(8),
        seq: dv.getUint32(12),
        last: (dv.getUint8(16) & 1) === 1,
        offset: dv.getUint32(17),
        data: buf.subarray(OVERLAY_HEADER_BYTES, OVERLAY_HEADER_BYTES + len),
    };
}

/** Split a whole payload into packets; the last one carries the commit flag. */
export function packetizeOverlayFrame(id: number, token: number, seq: number, payload: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = [];
    if (payload.length === 0) {
        out.push(encodeOverlayPacket({ id, token, seq, last: true, offset: 0, data: payload }));
        return out;
    }
    for (let off = 0; off < payload.length; off += OVERLAY_MAX_DATA) {
        const end = Math.min(payload.length, off + OVERLAY_MAX_DATA);
        out.push(
            encodeOverlayPacket({
                id,
                token,
                seq,
                last: end === payload.length,
                offset: off,
                data: payload.subarray(off, end),
            }),
        );
    }
    return out;
}
