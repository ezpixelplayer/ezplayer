/*
 * Pool of frame slots in one SharedArrayBuffer, shared by the conductor that
 * composes frames, the output workers that send them, and the preview readers.
 *
 * Layout: [32-byte control header][slotCount * frameBytes payload][slot table][counters]
 * The control header is the same one LatestFrameRingBuffer readers already
 * understand (slotCount, frameSize, writeSlot, latestSlot, latestSeq), so a
 * preview that only wants "the latest frame" keeps working unchanged. Per-slot
 * state lives in a table after the payloads, where those readers never look.
 *
 * Lifecycle: FREE -acquire-> COMPOSING -publish-> READY (latest, pinned)
 *   -> READY (not latest, held by refs) -> FREE when the last ref drops.
 * The latest READY slot is never recycled, so previews may read it without a ref.
 */

export const SLOT_FREE = 0;
export const SLOT_COMPOSING = 1;
export const SLOT_READY = 2;

export const X_MEANING_NONE = 0;
export const X_MEANING_ALPHA = 1;
export const X_MEANING_WHITE = 2;
export const X_MEANING_PRIORITY = 3;
export type XMeaning = 0 | 1 | 2 | 3;

/** Format version stamped in the control header so readers can tell a pool from a plain ring. */
export const FRAME_POOL_FORMAT = 2;

const HDR_SLOT_COUNT = 0;
const HDR_FRAME_BYTES = 1;
const HDR_WRITE_SLOT = 2;
const HDR_LATEST_SLOT = 3;
const HDR_LATEST_SEQ = 4;
const HDR_FORMAT = 5;
const HDR_LAYOUT_VERSION = 6;
const HDR_PIXEL_FORMAT = 7; // pixelStride | xMeaning << 8
const HEADER_BYTES = 32;

// Slot table entries (Int32 per slot)
const SLOT_INTS = 16;
const S_STATE = 0;
const S_REFCOUNT = 1;
const S_FRAME_NUMBER = 2;
const S_PIPELINE_ID = 3;
const S_PARAMS_SLOT = 4;
const S_TIME_LO = 5;
const S_TIME_HI = 6;
const S_SEQ = 7;
const S_SOURCE_STAMP = 8;

// Pool counters (Int32)
const COUNTER_INTS = 8;
const C_EXHAUSTED = 0;
const C_PUBLISHED = 1;

export interface FrameMeta {
    frameNumber: number;
    pipelineId: number;
    paramsSlot: number;
    /** Wall or perf time in ms; stored as two Int32 halves of the integer part. */
    timeMs: number;
    sourceStamp: number;
}

export interface FramePoolOptions {
    frameBytes: number;
    slotCount: number;
    layoutVersion?: number;
    pixelStride?: 3 | 4;
    xMeaning?: XMeaning;
}

export interface AcquiredFrame {
    slot: number;
    seq: number;
    bytes: Uint8Array;
    meta: FrameMeta;
}

function align4(n: number): number {
    return (n + 3) & ~3;
}

export class FramePool {
    readonly buffer: SharedArrayBuffer;
    readonly slotCount: number;
    readonly frameBytes: number;
    readonly layoutVersion: number;
    readonly pixelStride: number;
    readonly xMeaning: XMeaning;

    private readonly header: Int32Array;
    private readonly table: Int32Array;
    private readonly counters: Int32Array;
    private readonly slots: Uint8Array[];

    static requiredBytes(frameBytes: number, slotCount: number): number {
        return HEADER_BYTES + align4(frameBytes) * slotCount + slotCount * SLOT_INTS * 4 + COUNTER_INTS * 4;
    }

    /** Allocate and initialize a pool; the caller becomes its owner. */
    static allocate(opts: FramePoolOptions): FramePool {
        if (!Number.isInteger(opts.frameBytes) || opts.frameBytes <= 0) throw new Error(`frameBytes must be > 0`);
        if (!Number.isInteger(opts.slotCount) || opts.slotCount < 2) throw new Error(`slotCount must be >= 2`);
        const sab = new SharedArrayBuffer(FramePool.requiredBytes(opts.frameBytes, opts.slotCount));
        const header = new Int32Array(sab, 0, HEADER_BYTES / 4);
        header[HDR_SLOT_COUNT] = opts.slotCount;
        header[HDR_FRAME_BYTES] = opts.frameBytes;
        header[HDR_WRITE_SLOT] = 0;
        header[HDR_LATEST_SLOT] = -1;
        header[HDR_LATEST_SEQ] = 0;
        header[HDR_FORMAT] = FRAME_POOL_FORMAT;
        header[HDR_LAYOUT_VERSION] = opts.layoutVersion ?? 0;
        header[HDR_PIXEL_FORMAT] = (opts.pixelStride ?? 3) | ((opts.xMeaning ?? 0) << 8);
        return new FramePool(sab);
    }

    /** Attach to an existing pool buffer (any thread). */
    constructor(buffer: SharedArrayBuffer) {
        this.buffer = buffer;
        this.header = new Int32Array(buffer, 0, HEADER_BYTES / 4);
        if (Atomics.load(this.header, HDR_FORMAT) !== FRAME_POOL_FORMAT) {
            throw new Error(`Not a frame pool buffer (format ${this.header[HDR_FORMAT]})`);
        }
        this.slotCount = this.header[HDR_SLOT_COUNT];
        this.frameBytes = this.header[HDR_FRAME_BYTES];
        this.layoutVersion = this.header[HDR_LAYOUT_VERSION];
        const pf = this.header[HDR_PIXEL_FORMAT];
        this.pixelStride = pf & 0xff;
        this.xMeaning = ((pf >> 8) & 0xff) as XMeaning;
        const stride = align4(this.frameBytes);
        const tableOff = HEADER_BYTES + stride * this.slotCount;
        this.table = new Int32Array(buffer, tableOff, this.slotCount * SLOT_INTS);
        this.counters = new Int32Array(buffer, tableOff + this.slotCount * SLOT_INTS * 4, COUNTER_INTS);
        this.slots = [];
        for (let i = 0; i < this.slotCount; ++i) {
            this.slots.push(new Uint8Array(buffer, HEADER_BYTES + i * stride, this.frameBytes));
        }
    }

    /** Payload view of a slot. Valid while the caller holds a ref (or is the composer). */
    slotBytes(slot: number): Uint8Array {
        return this.slots[slot];
    }

    // ----- owner (single composer thread) -----

    /** Take a FREE slot for composing. Returns -1 when the pool is exhausted. */
    acquire(): number {
        const t = this.table;
        for (let i = 0; i < this.slotCount; ++i) {
            const b = i * SLOT_INTS;
            if (Atomics.compareExchange(t, b + S_STATE, SLOT_FREE, SLOT_COMPOSING) === SLOT_FREE) {
                Atomics.add(t, b + S_REFCOUNT, 1); // composer's own ref
                this.header[HDR_WRITE_SLOT] = i;
                return i;
            }
        }
        Atomics.add(this.counters, C_EXHAUSTED, 1);
        return -1;
    }

    /** Publish a composed slot as the latest frame. Drops the composer's ref. Returns the new seq. */
    publish(slot: number, meta: FrameMeta): number {
        const t = this.table;
        const b = slot * SLOT_INTS;
        if (Atomics.load(t, b + S_STATE) !== SLOT_COMPOSING) {
            throw new Error(`publish: slot ${slot} is not being composed`);
        }
        const seq = (Atomics.load(this.header, HDR_LATEST_SEQ) + 1) | 0;
        const tInt = Math.floor(meta.timeMs);
        Atomics.store(t, b + S_FRAME_NUMBER, meta.frameNumber | 0);
        Atomics.store(t, b + S_PIPELINE_ID, meta.pipelineId | 0);
        Atomics.store(t, b + S_PARAMS_SLOT, meta.paramsSlot | 0);
        Atomics.store(t, b + S_TIME_LO, tInt % 0x80000000 | 0);
        Atomics.store(t, b + S_TIME_HI, Math.floor(tInt / 0x80000000) | 0);
        Atomics.store(t, b + S_SOURCE_STAMP, meta.sourceStamp | 0);
        Atomics.store(t, b + S_SEQ, seq);
        Atomics.store(t, b + S_STATE, SLOT_READY);

        const prev = Atomics.exchange(this.header, HDR_LATEST_SLOT, slot);
        Atomics.store(this.header, HDR_LATEST_SEQ, seq);
        Atomics.notify(this.header, HDR_LATEST_SEQ);
        Atomics.add(this.counters, C_PUBLISHED, 1);

        // Composer's ref goes away; the slot stays pinned as latest regardless.
        Atomics.sub(t, b + S_REFCOUNT, 1);
        // The previous latest loses its pin; free it if nobody holds it.
        if (prev >= 0 && prev !== slot) this.tryFree(prev);
        return seq;
    }

    /** Abandon a slot taken with acquire() without publishing it. */
    abandon(slot: number): void {
        const t = this.table;
        const b = slot * SLOT_INTS;
        if (Atomics.load(t, b + S_STATE) !== SLOT_COMPOSING) return;
        Atomics.sub(t, b + S_REFCOUNT, 1);
        Atomics.store(t, b + S_STATE, SLOT_FREE);
    }

    // ----- ref holders (any thread) -----

    addRef(slot: number): void {
        Atomics.add(this.table, slot * SLOT_INTS + S_REFCOUNT, 1);
    }

    release(slot: number): void {
        const prev = Atomics.sub(this.table, slot * SLOT_INTS + S_REFCOUNT, 1);
        if (prev === 1) this.tryFree(slot);
    }

    /**
     * Take a ref on the latest published frame if its seq differs from lastSeq.
     * Retries if the slot is recycled between the read and the ref.
     */
    acquireLatest(lastSeq?: number): AcquiredFrame | null {
        const t = this.table;
        for (let attempt = 0; attempt < 8; ++attempt) {
            const seq = Atomics.load(this.header, HDR_LATEST_SEQ);
            if (seq === lastSeq || seq === 0) return null;
            const slot = Atomics.load(this.header, HDR_LATEST_SLOT);
            if (slot < 0) return null;
            const b = slot * SLOT_INTS;
            Atomics.add(t, b + S_REFCOUNT, 1);
            if (Atomics.load(t, b + S_STATE) === SLOT_READY && Atomics.load(t, b + S_SEQ) === seq) {
                return { slot, seq, bytes: this.slots[slot], meta: this.metaOf(slot) };
            }
            this.release(slot);
        }
        return null;
    }

    /** Latest seq without taking a ref (0 when nothing has been published). */
    latestSeq(): number {
        return Atomics.load(this.header, HDR_LATEST_SEQ);
    }

    latestSlot(): number {
        return Atomics.load(this.header, HDR_LATEST_SLOT);
    }

    /** Resolve when latestSeq differs from lastSeq, or after timeoutMs (0 = no timeout). */
    async waitForSeq(lastSeq: number, timeoutMs = 0): Promise<number> {
        const cur = Atomics.load(this.header, HDR_LATEST_SEQ);
        if (cur !== lastSeq) return cur;
        const res = Atomics.waitAsync(this.header, HDR_LATEST_SEQ, lastSeq, timeoutMs > 0 ? timeoutMs : undefined);
        if (res.async) await res.value;
        return Atomics.load(this.header, HDR_LATEST_SEQ);
    }

    /** Block the calling thread (workers only) until latestSeq changes or timeout. */
    waitForSeqSync(lastSeq: number, timeoutMs: number): number {
        const cur = Atomics.load(this.header, HDR_LATEST_SEQ);
        if (cur !== lastSeq) return cur;
        Atomics.wait(this.header, HDR_LATEST_SEQ, lastSeq, timeoutMs);
        return Atomics.load(this.header, HDR_LATEST_SEQ);
    }

    metaOf(slot: number): FrameMeta {
        const t = this.table;
        const b = slot * SLOT_INTS;
        const lo = Atomics.load(t, b + S_TIME_LO);
        const hi = Atomics.load(t, b + S_TIME_HI);
        return {
            frameNumber: Atomics.load(t, b + S_FRAME_NUMBER),
            pipelineId: Atomics.load(t, b + S_PIPELINE_ID),
            paramsSlot: Atomics.load(t, b + S_PARAMS_SLOT),
            timeMs: hi * 0x80000000 + lo,
            sourceStamp: Atomics.load(t, b + S_SOURCE_STAMP),
        };
    }

    stateOf(slot: number): number {
        return Atomics.load(this.table, slot * SLOT_INTS + S_STATE);
    }

    refcountOf(slot: number): number {
        return Atomics.load(this.table, slot * SLOT_INTS + S_REFCOUNT);
    }

    freeCount(): number {
        let n = 0;
        for (let i = 0; i < this.slotCount; ++i) if (this.stateOf(i) === SLOT_FREE) ++n;
        return n;
    }

    stats() {
        return {
            slotCount: this.slotCount,
            frameBytes: this.frameBytes,
            free: this.freeCount(),
            exhausted: Atomics.load(this.counters, C_EXHAUSTED),
            published: Atomics.load(this.counters, C_PUBLISHED),
            latestSeq: this.latestSeq(),
        };
    }

    /** FREE a READY slot that is not latest and has no refs. Safe to race. */
    private tryFree(slot: number): void {
        const t = this.table;
        const b = slot * SLOT_INTS;
        if (Atomics.load(this.header, HDR_LATEST_SLOT) === slot) return;
        if (Atomics.load(t, b + S_REFCOUNT) !== 0) return;
        Atomics.compareExchange(t, b + S_STATE, SLOT_READY, SLOT_FREE);
    }
}
