/*
 * N-slot "latest frame wins" ring buffer.
 *
 * - Single writer publishes complete frames into successive slots.
 * - Readers always jump to the latest published slot/seq and may drop frames.
 * -  (Of course, the writing process may have already dropped frames too.)
 * - Works with ArrayBuffer or SharedArrayBuffer (Atomics for SAB).
 * Nothing intrinsically prevents tearing, we're just sizing it to make it unlikely;
 *  external flow control is possible.
 */

export type FrameBackingBuffer = ArrayBuffer | SharedArrayBuffer;

export type FrameBufferReadResult = {
    seq: number;
    slot: number;
    bytes: Uint8Array; // View of the published slot
    frameSizeBytes: number;
};

export class LatestFrameRingBuffer {
    // Header layout (Int32 indices):
    // 0: slotCount (e.g. 4)
    // 1: frameSize (# of channels)
    // 2: writeSlot (next slot the writer will write into)
    // 3: latestSlot (slot index of latest published complete frame)
    // 4: latestSeq  (monotonic increasing; commit indicator)
    // 5..7: reserved, but 32 is a nice byte count
    static SLOT_COUNT_HDRIDX = 0;
    static FRAME_SIZE_HDRIDX = 1;
    static WRITE_SLOT_HDRIDX = 2;
    static LATEST_SLOT_HDRIDX = 3;
    static LATEST_WRITESEQ_HDRIDX = 4;
    private readonly header: Int32Array;

    private readonly frameSize: number;
    private readonly slotCount: number;
    private readonly slots: Uint8Array[];
    private readonly isShared: boolean;

    private readonly headerBytes: number;
    private readonly payloadOffset: number;

    constructor(opts: { buffer: FrameBackingBuffer; frameSize: number; slotCount: number; isWriter: boolean }) {
        const { buffer, frameSize, slotCount } = opts;

        // Initial
        this.frameSize = frameSize;
        this.slotCount = slotCount;
        this.isShared = buffer instanceof SharedArrayBuffer;

        // Fixed 32-byte header (8 Int32s).
        this.headerBytes = 32;
        this.payloadOffset = this.headerBytes;
        this.header = new Int32Array(buffer, 0, this.headerBytes / 4);

        if (opts.isWriter) {
            if (!Number.isInteger(frameSize) || frameSize <= 0) {
                throw new Error(`frameSize must be positive integer; got ${frameSize}`);
            }
            if (!Number.isInteger(slotCount) || slotCount < 2) {
                throw new Error(`slotCount must be integer >= 2; got ${slotCount}`);
            }

            const needed = LatestFrameRingBuffer.requiredBytes(frameSize, slotCount);
            if (buffer.byteLength < needed) {
                throw new Error(`Buffer too small: need >= ${needed} bytes, got ${buffer.byteLength}`);
            }

            this._storeHeader(LatestFrameRingBuffer.SLOT_COUNT_HDRIDX, this.slotCount);
            this._storeHeader(LatestFrameRingBuffer.FRAME_SIZE_HDRIDX, this.frameSize);
            this._storeHeader(LatestFrameRingBuffer.WRITE_SLOT_HDRIDX, 0);
            this._storeHeader(LatestFrameRingBuffer.LATEST_SLOT_HDRIDX, 0);
            this._storeHeader(LatestFrameRingBuffer.LATEST_WRITESEQ_HDRIDX, 0);
            this._storeHeader(5, 0);
            this._storeHeader(6, 0);
            this._storeHeader(7, 0);
        } else {
            this.slotCount = this._loadHeader(LatestFrameRingBuffer.SLOT_COUNT_HDRIDX);
            this.frameSize = this._loadHeader(LatestFrameRingBuffer.FRAME_SIZE_HDRIDX);
        }

        // Create slot views
        this.slots = new Array<Uint8Array>(slotCount);
        for (let i = 0; i < slotCount; i++) {
            this.slots[i] = new Uint8Array(buffer, this.payloadOffset + i * this.frameSize, this.frameSize);
        }
    }

    // ----- static helpers -----

    static requiredBytes(frameSize: number, slotCount: number): number {
        const headerBytes = 32;
        return headerBytes + slotCount * frameSize;
    }

    static allocate(frameSize: number, slotCount: number, shared: boolean): FrameBackingBuffer {
        const bytes = LatestFrameRingBuffer.requiredBytes(frameSize, slotCount);
        return shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
    }

    // ----- writer API -----

    /** Copy src into the next slot and publish as latest. Returns published seq. */
    publishFrom(src: Uint8Array): number {
        const n = src.byteLength;
        if (n > this.frameSize) {
            throw new Error(`publishFrom: src too large (${n}) > frameSize (${this.frameSize})`);
        }

        const slot = this._loadWriteSlot();
        const view = this.slots[slot];

        view.set(src); // copy into slot (fixed-size frames => n === frameSize)

        // Advance writeSlot for next time (not part of the commit; writer-only state)
        this._storeWriteSlot((slot + 1) % this.slotCount);

        // Publish metadata in safe order:
        // 1) latestSlot
        // 2) latestSeq++ (commit)
        this._storeLatestSlot(slot);
        const nextSeq = this._incrementLatestSeq();
        this._notifyLatestSeqChange();
        return nextSeq;
    }

    /** Fill the next slot in-place and publish. fill() returns number of bytes written. */
    publishWithFill(fill: (dst: Uint8Array) => number): number {
        const slot = this._loadWriteSlot();
        const view = this.slots[slot];

        const n = fill(view);
        if (!Number.isInteger(n) || n < 0 || n > this.frameSize) {
            throw new Error(`publishWithFill: fill() must return 0..frameSize, got ${n}`);
        }

        this._storeWriteSlot((slot + 1) % this.slotCount);

        this._storeLatestSlot(slot);
        const nextSeq = this._incrementLatestSeq();
        this._notifyLatestSeqChange();
        return nextSeq;
    }

    /** Returns latest frame if seq changed since lastSeq; otherwise null. */
    tryReadLatest(lastSeq?: number): FrameBufferReadResult | null {
        // Commit indicator
        const seq1 = this._loadLatestSeq();
        if (seq1 === lastSeq) return null;

        const slot = this._loadLatestSlot();
        const bytes = this.slots[slot];

        return { seq: seq1, slot, bytes, frameSizeBytes: this.frameSize };
    }

    /** Optional: wait for next seq change in SAB contexts. */
    async waitForNextSeq(lastSeq: number, timeoutMs = 0): Promise<number> {
        if (!this.isShared) return Promise.resolve(this._loadLatestSeq());

        const idx = LatestFrameRingBuffer.LATEST_WRITESEQ_HDRIDX;
        const cur = this._loadLatestSeq();
        if (cur !== lastSeq) return cur;

        if (typeof Atomics.waitAsync === 'function') {
            await Atomics.waitAsync(this.header, idx, lastSeq, timeoutMs).value;
            return this._loadLatestSeq();
        }

        // Fallback poll
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                const s = this._loadLatestSeq();
                if (s !== lastSeq) return resolve(s);
                if (timeoutMs > 0 && Date.now() - start >= timeoutMs) return resolve(s);
                setTimeout(tick, 1);
            };
            tick();
        });
    }

    // ----- header ops -----

    private _loadHeader(i: number): number {
        return this.isShared ? Atomics.load(this.header, i) : this.header[i];
    }
    private _storeHeader(i: number, v: number): void {
        if (this.isShared) Atomics.store(this.header, i, v);
        else this.header[i] = v;
    }

    private _loadWriteSlot(): number {
        const v = this._loadHeader(LatestFrameRingBuffer.WRITE_SLOT_HDRIDX);
        return ((v % this.slotCount) + this.slotCount) % this.slotCount;
    }
    private _storeWriteSlot(slot: number): void {
        this._storeHeader(LatestFrameRingBuffer.WRITE_SLOT_HDRIDX, slot | 0);
    }

    private _loadLatestSlot(): number {
        const v = this._loadHeader(LatestFrameRingBuffer.LATEST_SLOT_HDRIDX);
        return ((v % this.slotCount) + this.slotCount) % this.slotCount;
    }
    private _storeLatestSlot(slot: number): void {
        this._storeHeader(LatestFrameRingBuffer.LATEST_SLOT_HDRIDX, slot | 0);
    }

    private _loadLatestSeq(): number {
        return this._loadHeader(LatestFrameRingBuffer.LATEST_WRITESEQ_HDRIDX) | 0;
    }
    private _incrementLatestSeq(): number {
        if (this.isShared) return (Atomics.add(this.header, LatestFrameRingBuffer.LATEST_WRITESEQ_HDRIDX, 1) + 1) | 0;
        const next = (this.header[LatestFrameRingBuffer.LATEST_WRITESEQ_HDRIDX] + 1) | 0;
        this.header[LatestFrameRingBuffer.LATEST_WRITESEQ_HDRIDX] = next;
        return next;
    }

    private _notifyLatestSeqChange(): void {
        if (!this.isShared) return;
        Atomics.notify(this.header, LatestFrameRingBuffer.LATEST_WRITESEQ_HDRIDX);
    }
}
