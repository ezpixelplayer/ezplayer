import { describe, it, expect } from 'vitest';
import { AudioChunkRingBuffer } from '../src/util/AudioChunkRingBuffer';

function makeRing(slots = 4, maxSamples = 8) {
    const sab = AudioChunkRingBuffer.allocate(slots, maxSamples);
    return { writer: new AudioChunkRingBuffer(sab, true), reader: new AudioChunkRingBuffer(sab, false) };
}

describe('AudioChunkRingBuffer', () => {
    it('round-trips a chunk and its metadata', () => {
        const { writer, reader } = makeRing();
        const samples = new Float32Array([0.5, -0.5, 1, -1]);
        const seq = writer.publish(samples, 1234.5, 7, 48000, 2, 2);
        const [chunk] = reader.readAfter(seq - 1);
        expect(chunk.seq).toBe(seq);
        expect(chunk.playAtRealTime).toBe(1234.5);
        expect(chunk.incarnation).toBe(7);
        expect(chunk.sampleRate).toBe(48000);
        expect(chunk.channels).toBe(2);
        expect(chunk.advanceSamples).toBe(2);
        expect(Array.from(chunk.samples)).toEqual([0.5, -0.5, 1, -1]);
    });

    it('applies gain during the copy without touching the source', () => {
        const { writer, reader } = makeRing();
        const samples = new Float32Array([0.5, -0.5, 1, -1]);
        const seq = writer.publish(samples, 0, 1, 48000, 2, 4, 0.25);
        const [chunk] = reader.readAfter(seq - 1);
        expect(Array.from(chunk.samples)).toEqual([0.125, -0.125, 0.25, -0.25]);
        expect(Array.from(samples)).toEqual([0.5, -0.5, 1, -1]);
    });

    it('skips slots that were overwritten', () => {
        const { writer, reader } = makeRing(2, 2);
        for (let i = 1; i <= 3; i++) writer.publish(new Float32Array([i, i]), 0, 1, 48000, 1);
        const seqs = reader.readAfter(0).map((c) => c.seq);
        expect(seqs).toEqual([2, 3]);
    });
});
