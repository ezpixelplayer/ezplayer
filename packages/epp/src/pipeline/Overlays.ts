/*
 * Overlay leases: pixels produced outside the compose path (an API client, a
 * game, a GPU producer) land in a double-buffered layer aimed at a model or
 * the whole display, and the compositor blends the latest complete layer
 * into each frame until the lease expires.
 */

import { DisplayLayout, LayoutModel } from './Layout';
import { BlendMode, blendModeFromName, blendNodes, BLEND_REPLACE } from './Kernels';

export type OverlayFormat = 'grid' | 'nodes';

export interface OverlayLeaseRequest {
    /** Model name; the whole display when absent. */
    model?: string;
    /** 'grid': width x height RGB rows, top row first; 'nodes': one RGB per canonical node. */
    format?: OverlayFormat;
    /** Grid size; defaults to the model's own grid (or nodeCount x 1). */
    width?: number;
    height?: number;
    blend?: string;
    /** 0..1 */
    opacity?: number;
    ttlMs?: number;
    name?: string;
}

export interface OverlayLeaseInfo {
    id: number;
    token: number;
    name?: string;
    model?: string;
    format: OverlayFormat;
    width: number;
    height: number;
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
    /** Nearest-neighbour map from canonical node (within the target) to payload cell, or null for 1:1 rows. */
    private nodeToCell: Int32Array | null = null;
    private readonly model?: LayoutModel;

    constructor(info: OverlayLeaseInfo, model: LayoutModel | undefined, layout: DisplayLayout) {
        this.info = info;
        this.model = model;
        this.blendMode = blendModeFromName(info.blend, BLEND_REPLACE);
        this.front = new Uint8Array(info.nodeCount * 3);
        this.staging = new Uint8Array(info.frameBytes);
        if (info.format === 'grid') this.buildGridMap(layout);
    }

    private buildGridMap(_layout: DisplayLayout) {
        const { width, height, nodeCount } = this.info;
        const grid = this.model?.grid;
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
        const op = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
        if (stride === 3 && op === 255) {
            blendNodes(this.blendMode, frame.subarray(nodeStart * 3, (nodeStart + nodeCount) * 3), front, 3, 0, nodeCount);
            return;
        }
        // Generic path: per node through a 1-node scratch so the blend kernel sees matching strides.
        for (let n = 0; n < nodeCount; ++n) {
            const d = (nodeStart + n) * stride;
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

    constructor(layout: DisplayLayout) {
        this.layout = layout;
    }

    /** Models a client can target, with their grid sizes. */
    targets(): { model: string; nodeCount: number; width?: number; height?: number }[] {
        return this.layout.models
            .filter((m) => m.nodeStart >= 0)
            .map((m) => ({ model: m.name, nodeCount: m.nodeCount, width: m.grid?.width, height: m.grid?.height }));
    }

    open(req: OverlayLeaseRequest, now: number): OverlayLeaseInfo {
        let model: LayoutModel | undefined;
        let nodeStart = 0;
        let nodeCount = this.layout.nodeCount;
        if (req.model) {
            model = this.layout.models.find((m) => m.name === req.model);
            if (!model || model.nodeStart < 0) throw new Error(`overlay: no pixel model named ${req.model}`);
            nodeStart = model.nodeStart;
            nodeCount = model.nodeCount;
        }
        const format: OverlayFormat = req.format ?? (model?.grid || req.width ? 'grid' : 'nodes');
        let width = nodeCount;
        let height = 1;
        if (format === 'grid') {
            width = req.width ?? model?.grid?.width ?? nodeCount;
            height = req.height ?? model?.grid?.height ?? 1;
            if (width <= 0 || height <= 0 || width * height > 4_000_000) throw new Error('overlay: bad grid size');
        }
        const ttlMs = Math.min(MAX_TTL_MS, Math.max(1000, req.ttlMs ?? DEFAULT_TTL_MS));
        const info: OverlayLeaseInfo = {
            id: this.nextId++,
            token: (Math.random() * 0xffffffff) >>> 0,
            name: req.name,
            model: req.model,
            format,
            width,
            height,
            nodeStart,
            nodeCount,
            frameBytes: format === 'grid' ? width * height * 3 : nodeCount * 3,
            blend: req.blend ?? 'replace',
            opacity: req.opacity ?? 1,
            ttlMs,
            expiresAt: now + ttlMs,
            frames: 0,
        };
        this.layers.set(info.id, new OverlayLayer(info, model, this.layout));
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
