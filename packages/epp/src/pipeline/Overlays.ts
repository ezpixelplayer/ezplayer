/*
 * Overlay leases: pixels produced outside the compose path (an API client, a
 * game, a GPU producer) land in a double-buffered layer aimed at a model or
 * the whole display, and the compositor blends the latest complete layer
 * into each frame until the lease expires.
 */

import { DisplayLayout, LayoutModelSpec } from './Layout';
import { overlappingNodes, PixelTarget, StrandKind, TargetCatalog } from './Targets';
import { BlendMode, blendModeFromName, blendNodes, BLEND_REPLACE } from './Kernels';

/** 'buffer' is the target's own render buffer, sparse where it has no node. */
export type OverlayFormat = 'grid' | 'nodes' | 'buffer';

/** Which cell colors a node that sits in several buffer cells. */
export type OverlayOverlap = 'last' | 'first' | 'max';

export interface OverlayLeaseRequest {
    /** Model name or "Model/Submodel"; the whole display when absent. */
    model?: string;
    /** Submodel of `model`, when not given in the name. */
    subModel?: string;
    /** 'grid' and 'buffer': width x height RGB rows, top row first; 'nodes': one RGB per node. */
    format?: OverlayFormat;
    /** Payload size; defaults to the target's own grid or buffer (or nodeCount x 1). */
    width?: number;
    height?: number;
    /** 'buffer' only; 'last' is the cell listed latest, as xLights picks. */
    overlap?: OverlayOverlap;
    blend?: string;
    /** 0..1 */
    opacity?: number;
    ttlMs?: number;
    name?: string;
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
    name?: string;
    model?: string;
    subModel?: string;
    format: OverlayFormat;
    overlap?: OverlayOverlap;
    width: number;
    height: number;
    /** First canonical node; -1 when the target's nodes are not one run. */
    nodeStart: number;
    nodeCount: number;
    /** Bytes one full payload carries. */
    frameBytes: number;
    blend: string;
    opacity: number;
    ttlMs: number;
    expiresAt: number;
    /** Frames committed so far. */
    frames: number;
}

const DEFAULT_TTL_MS = 30_000;
const MAX_TTL_MS = 24 * 3600 * 1000;

class OverlayLayer {
    info: OverlayLeaseInfo;
    blendMode: BlendMode;
    /** Committed pixels in canonical node order (3 bytes per node). */
    front: Uint8Array;
    /** Payload being assembled from packets. */
    staging: Uint8Array;
    stagingSeq = -1;
    stagingBytes = 0;
    hasFrame = false;
    /** Nearest-neighbour map from target node to payload cell, or null for 1:1 rows. */
    private nodeToCell: Int32Array | null = null;
    /** (target node, payload cell) pairs for 'buffer', in the order the cells were listed. */
    private cellPairs: Int32Array | null = null;
    /** Canonical node per target node; null when the target is the run from nodeStart. */
    private readonly nodes: Int32Array | null;
    private readonly target?: PixelTarget;

    constructor(info: OverlayLeaseInfo, target: PixelTarget | undefined) {
        this.info = info;
        this.target = target;
        this.nodes = target && target.nodeStart < 0 ? target.nodes : null;
        this.blendMode = blendModeFromName(info.blend, BLEND_REPLACE);
        this.front = new Uint8Array(info.nodeCount * 3);
        this.staging = new Uint8Array(info.frameBytes);
        if (info.format === 'grid') this.buildGridMap();
        if (info.format === 'buffer') this.buildBufferMap();
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
            for (let n = 0; n < nodeCount; ++n) map[n] = Math.min(cells - 1, Math.floor(((n + 0.5) * cells) / nodeCount));
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
        this.stagingBytes += data.length;
        if (!last) return false;
        this.commit();
        return true;
    }

    /** Commit the staging payload into the front buffer. */
    commit(): void {
        const { width, height, nodeCount, format } = this.info;
        const src = this.staging;
        const dst = this.front;
        if (format === 'nodes') {
            dst.set(src.subarray(0, nodeCount * 3));
        } else if (this.cellPairs) {
            const pairs = this.cellPairs;
            const rule = this.info.overlap;
            if (rule === 'max') {
                dst.fill(0);
                for (let p = 0; p < pairs.length; p += 2) {
                    const d = pairs[p] * 3;
                    const s = pairs[p + 1] * 3;
                    if (src[s] > dst[d]) dst[d] = src[s];
                    if (src[s + 1] > dst[d + 1]) dst[d + 1] = src[s + 1];
                    if (src[s + 2] > dst[d + 2]) dst[d + 2] = src[s + 2];
                }
            } else {
                // The cell written last wins: walk backwards for 'first'.
                const back = rule === 'first';
                for (let i = 0; i < pairs.length; i += 2) {
                    const p = back ? pairs.length - 2 - i : i;
                    const d = pairs[p] * 3;
                    const s = pairs[p + 1] * 3;
                    dst[d] = src[s];
                    dst[d + 1] = src[s + 1];
                    dst[d + 2] = src[s + 2];
                }
            }
        } else if (!this.nodeToCell) {
            // Same-size grid: flip rows (payload top-first, canonical bottom-first).
            const rowBytes = width * 3;
            for (let y = 0; y < height; ++y) {
                dst.set(src.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes);
            }
        } else {
            const map = this.nodeToCell;
            for (let n = 0; n < nodeCount; ++n) {
                const s = map[n] * 3;
                const d = n * 3;
                dst[d] = src[s];
                dst[d + 1] = src[s + 1];
                dst[d + 2] = src[s + 2];
            }
        }
        this.hasFrame = true;
        this.info.frames++;
    }

    /** Blend the committed layer into a canonical frame. */
    composite(frame: Uint8Array, stride: number): void {
        if (!this.hasFrame) return;
        const { nodeStart, nodeCount, opacity } = this.info;
        const front = this.front;
        const nodes = this.nodes;
        const op = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
        if (!nodes && stride === 3 && op === 255) {
            blendNodes(this.blendMode, frame.subarray(nodeStart * 3, (nodeStart + nodeCount) * 3), front, 3, 0, nodeCount);
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
                scratchSrc[0] = (scratchSrc[0] * op + 127) / 255 | 0;
                scratchSrc[1] = (scratchSrc[1] * op + 127) / 255 | 0;
                scratchSrc[2] = (scratchSrc[2] * op + 127) / 255 | 0;
            }
            blendNodes(this.blendMode, scratchDst, scratchSrc, 3, 0, 1);
            frame[d] = scratchDst[0];
            frame[d + 1] = scratchDst[1];
            frame[d + 2] = scratchDst[2];
        }
    }
}

const scratchDst = new Uint8Array(3);
const scratchSrc = new Uint8Array(3);

export class OverlayManager {
    private layers = new Map<number, OverlayLayer>();
    private nextId = 1;
    readonly layout: DisplayLayout;
    /** Models and submodels by name; effects can resolve their targets here too. */
    readonly catalog: TargetCatalog;

    constructor(layout: DisplayLayout, specs?: LayoutModelSpec[]) {
        this.layout = layout;
        this.catalog = new TargetCatalog(layout, specs);
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
        const info: OverlayTargetInfo = { model: t.model, nodeCount: t.nodes.length, width: t.grid?.width, height: t.grid?.height };
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
                for (const n of t.nodes) info.nodes.world.push(round(world[n * 3]), round(world[n * 3 + 1]), round(world[n * 3 + 2]));
            }
            if (t.local) info.nodes.local = Array.from(t.local, round);
            if (t.buffer) info.nodes.cells = Array.from(t.buffer.cells);
        }
        return info;
    }

    open(req: OverlayLeaseRequest, now: number): OverlayLeaseInfo {
        let target: PixelTarget | undefined;
        let nodeStart = 0;
        let nodeCount = this.layout.nodeCount;
        if (req.model) {
            target = this.catalog.find(req.model, req.subModel);
            if (!target) throw new Error(`overlay: no pixel model named ${req.subModel ? req.model + '/' + req.subModel : req.model}`);
            nodeStart = target.nodeStart;
            nodeCount = target.nodes.length;
        }
        const format: OverlayFormat = req.format ?? (target?.subModel ? 'buffer' : target?.grid || req.width ? 'grid' : 'nodes');
        let width = nodeCount;
        let height = 1;
        if (format === 'buffer') {
            if (!target?.buffer) throw new Error('overlay: the buffer format needs a model or submodel with a known buffer');
            width = req.width ?? target.buffer.width;
            height = req.height ?? target.buffer.height;
        } else if (format === 'grid') {
            width = req.width ?? target?.grid?.width ?? nodeCount;
            height = req.height ?? target?.grid?.height ?? 1;
        } else if (format !== 'nodes') {
            throw new Error(`overlay: unknown format ${String(format)}`);
        }
        if (format !== 'nodes' && !(width > 0 && height > 0 && width * height <= 4_000_000)) throw new Error('overlay: bad grid size');
        const overlap: OverlayOverlap | undefined =
            format !== 'buffer' ? undefined : req.overlap === 'first' || req.overlap === 'max' ? req.overlap : 'last';
        const ttlMs = Math.min(MAX_TTL_MS, Math.max(1000, req.ttlMs ?? DEFAULT_TTL_MS));
        const info: OverlayLeaseInfo = {
            id: this.nextId++,
            token: (Math.random() * 0xffffffff) >>> 0,
            name: req.name,
            model: target?.model ?? req.model,
            subModel: target?.subModel,
            format,
            overlap,
            width,
            height,
            nodeStart,
            nodeCount,
            frameBytes: format === 'nodes' ? nodeCount * 3 : width * height * 3,
            blend: req.blend ?? 'replace',
            opacity: req.opacity ?? 1,
            ttlMs,
            expiresAt: now + ttlMs,
            frames: 0,
        };
        this.layers.set(info.id, new OverlayLayer(info, target));
        return info;
    }

    close(id: number): boolean {
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
    write(id: number, token: number, seq: number, offset: number, data: Uint8Array, last: boolean, now: number): boolean {
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
                this.layers.delete(id);
                gone.push(id);
            }
        }
        return gone;
    }

    get size(): number {
        return this.layers.size;
    }

    /** Blend every live layer into the frame, in lease order. */
    composite(frame: Uint8Array, stride: number): void {
        for (const l of this.layers.values()) l.composite(frame, stride);
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
    const buf = out && out.length >= OVERLAY_HEADER_BYTES + p.data.length ? out : new Uint8Array(OVERLAY_HEADER_BYTES + p.data.length);
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
        out.push(encodeOverlayPacket({ id, token, seq, last: end === payload.length, offset: off, data: payload.subarray(off, end) }));
    }
    return out;
}
