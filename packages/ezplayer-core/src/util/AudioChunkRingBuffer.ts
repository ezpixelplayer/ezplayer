/*
 * N-slot sequential-read ring buffer for audio chunks.
 *
 * - Single writer publishes variable-length interleaved Float32 audio into successive slots.
 * - Readers request all chunks after a given sequence number (sequential reads — every chunk matters).
 * - Works with SharedArrayBuffer + Atomics for cross-thread/worker use.
 * - If a slow reader falls behind by more than slotCount, oldest chunks are silently lost.
 *
 * Memory layout:
 *   Global header  (64 bytes / 16 Int32s): slotCount, maxSamplesPerSlot, writeSeq (atomic), reserved…
 *   Per-slot meta  (32 bytes / 8 Int32s):  seq, playAtRealTimeLo, playAtRealTimeHi, incarnation, sampleRate, channels, sampleCount, reserved
 *   Per-slot audio (maxSamplesPerSlot * 4 bytes): Float32 interleaved samples
 */

export type AudioChunkReadResult = {
    seq: number;
    playAtRealTime: number;
    incarnation: number;
    sampleRate: number;
    channels: number;
    samples: Float32Array; // view into the SAB slot (caller should copy if needed)
};

// Header Int32 indices
const HDR_SLOT_COUNT = 0;
const HDR_MAX_SAMPLES = 1;
const HDR_WRITE_SEQ = 2;
// 3..15 reserved

const HEADER_BYTES = 64; // 16 × Int32
const SLOT_META_INT32S = 8;
const SLOT_META_BYTES = SLOT_META_INT32S * 4; // 32 bytes

// Per-slot metadata Int32 offsets (relative to slot meta start)
const SM_SEQ = 0;
const SM_PLAY_AT_LO = 1;
const SM_PLAY_AT_HI = 2;
const SM_INCARNATION = 3;
const SM_SAMPLE_RATE = 4;
const SM_CHANNELS = 5;
const SM_SAMPLE_COUNT = 6;
// 7 reserved

export class AudioChunkRingBuffer {
    private readonly header: Int32Array;
    private readonly slotCount: number;
    private readonly maxSamplesPerSlot: number;
    private readonly buffer: SharedArrayBuffer;

    // Byte offset where slot 0 meta begins
    private readonly slotsOffset: number;
    // Byte stride per slot (meta + audio data)
    private readonly slotStride: number;

    // Aliased Float64Array for reading/writing playAtRealTime
    private readonly float64Alias: Float64Array;

    constructor(buffer: SharedArrayBuffer, isWriter: boolean) {
        this.buffer = buffer;
        this.header = new Int32Array(buffer, 0, HEADER_BYTES / 4);

        if (isWriter) {
            // Writer will have already called allocate() which set header values
        }

        this.slotCount = Atomics.load(this.header, HDR_SLOT_COUNT);
        this.maxSamplesPerSlot = Atomics.load(this.header, HDR_MAX_SAMPLES);

        this.slotsOffset = HEADER_BYTES;
        this.slotStride = SLOT_META_BYTES + this.maxSamplesPerSlot * 4;

        // Float64 alias for playAtRealTime conversion — one element, positioned at a temp area
        // We'll use manual conversion instead since we need per-slot positioning
        this.float64Alias = new Float64Array(1);
    }

    // ── static helpers ──

    static requiredBytes(slotCount: number, maxSamplesPerSlot: number): number {
        const slotStride = SLOT_META_BYTES + maxSamplesPerSlot * 4;
        return HEADER_BYTES + slotCount * slotStride;
    }

    static allocate(slotCount: number, maxSamplesPerSlot: number): SharedArrayBuffer {
        const bytes = AudioChunkRingBuffer.requiredBytes(slotCount, maxSamplesPerSlot);
        const sab = new SharedArrayBuffer(bytes);
        const header = new Int32Array(sab, 0, HEADER_BYTES / 4);
        Atomics.store(header, HDR_SLOT_COUNT, slotCount);
        Atomics.store(header, HDR_MAX_SAMPLES, maxSamplesPerSlot);
        Atomics.store(header, HDR_WRITE_SEQ, 0);
        return sab;
    }

    // ── writer API ──

    /**
     * Publish one audio chunk into the next slot.
     * @returns the sequence number assigned to this chunk
     */
    publish(
        samples: Float32Array,
        playAtRealTime: number,
        incarnation: number,
        sampleRate: number,
        channels: number,
    ): number {
        const sampleCount = samples.length;
        if (sampleCount > this.maxSamplesPerSlot) {
            throw new Error(
                `AudioChunkRingBuffer.publish: sampleCount ${sampleCount} > maxSamplesPerSlot ${this.maxSamplesPerSlot}`,
            );
        }

        // Next seq (1-based so afterSeq=0 means "give me everything")
        const seq = Atomics.add(this.header, HDR_WRITE_SEQ, 1) + 1;
        const slotIdx = (seq - 1) % this.slotCount;

        // Write per-slot metadata
        const metaOffset = this.slotsOffset + slotIdx * this.slotStride;
        const meta = new Int32Array(this.buffer, metaOffset, SLOT_META_INT32S);

        // Encode playAtRealTime (Float64) as two Int32s
        this.float64Alias[0] = playAtRealTime;
        const lo = new Int32Array(this.float64Alias.buffer, 0, 1)[0];
        const hi = new Int32Array(this.float64Alias.buffer, 4, 1)[0];

        Atomics.store(meta, SM_INCARNATION, incarnation);
        Atomics.store(meta, SM_SAMPLE_RATE, sampleRate);
        Atomics.store(meta, SM_CHANNELS, channels);
        Atomics.store(meta, SM_SAMPLE_COUNT, sampleCount);
        Atomics.store(meta, SM_PLAY_AT_LO, lo);
        Atomics.store(meta, SM_PLAY_AT_HI, hi);

        // Write audio data
        const audioOffset = metaOffset + SLOT_META_BYTES;
        const audioView = new Float32Array(this.buffer, audioOffset, sampleCount);
        audioView.set(samples);

        // Commit: write seq last so readers see consistent data
        Atomics.store(meta, SM_SEQ, seq);

        return seq;
    }

    // ── reader API ──

    /**
     * Read all chunks published after `afterSeq`.
     * Returns chunks from max(afterSeq+1, writeSeq-slotCount+1) to writeSeq.
     * Chunks whose slot has been overwritten are silently skipped.
     */
    readAfter(afterSeq: number): AudioChunkReadResult[] {
        const writeSeq = Atomics.load(this.header, HDR_WRITE_SEQ);
        if (writeSeq <= afterSeq) return [];

        const startSeq = Math.max(afterSeq + 1, writeSeq - this.slotCount + 1);
        const results: AudioChunkReadResult[] = [];

        for (let seq = startSeq; seq <= writeSeq; seq++) {
            const slotIdx = (seq - 1) % this.slotCount;
            const metaOffset = this.slotsOffset + slotIdx * this.slotStride;
            const meta = new Int32Array(this.buffer, metaOffset, SLOT_META_INT32S);

            // Verify this slot still holds the expected seq (not overwritten)
            const slotSeq = Atomics.load(meta, SM_SEQ);
            if (slotSeq !== seq) continue; // overwritten by a newer write, skip

            const sampleCount = Atomics.load(meta, SM_SAMPLE_COUNT);
            const lo = Atomics.load(meta, SM_PLAY_AT_LO);
            const hi = Atomics.load(meta, SM_PLAY_AT_HI);

            // Decode Float64 from two Int32s
            const i32 = new Int32Array(this.float64Alias.buffer);
            i32[0] = lo;
            i32[1] = hi;
            const playAtRealTime = this.float64Alias[0];

            const incarnation = Atomics.load(meta, SM_INCARNATION);
            const sampleRate = Atomics.load(meta, SM_SAMPLE_RATE);
            const channels = Atomics.load(meta, SM_CHANNELS);

            const audioOffset = metaOffset + SLOT_META_BYTES;
            const samples = new Float32Array(this.buffer, audioOffset, sampleCount);

            results.push({ seq, playAtRealTime, incarnation, sampleRate, channels, samples });
        }

        return results;
    }

    /** Current highest published sequence number. */
    get latestSeq(): number {
        return Atomics.load(this.header, HDR_WRITE_SEQ);
    }
}
