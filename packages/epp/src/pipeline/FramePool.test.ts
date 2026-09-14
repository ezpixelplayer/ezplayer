import { describe, expect, it } from 'vitest';
import { FramePool, SLOT_COMPOSING, SLOT_FREE, SLOT_READY, X_MEANING_WHITE } from './FramePool';

/** What ezplayer-core's LatestFrameRingBuffer reader does, inlined to avoid a package cycle. */
function legacyReadLatest(buffer: SharedArrayBuffer, lastSeq?: number) {
    const hdr = new Int32Array(buffer, 0, 8);
    const seq = Atomics.load(hdr, 4);
    if (seq === lastSeq) return null;
    const slot = Atomics.load(hdr, 3);
    const frameSize = hdr[1];
    return { seq, frameSizeBytes: frameSize, bytes: new Uint8Array(buffer, 32 + slot * frameSize, frameSize) };
}

const meta = (n: number) => ({ frameNumber: n, pipelineId: 7, paramsSlot: n & 1, timeMs: 1e12 + n, sourceStamp: 3 });

describe('FramePool', () => {
    it('allocates, composes, publishes, and pins the latest slot', () => {
        const pool = FramePool.allocate({ frameBytes: 10, slotCount: 3, layoutVersion: 42, pixelStride: 4, xMeaning: X_MEANING_WHITE });
        expect(pool.layoutVersion).toBe(42);
        expect(pool.pixelStride).toBe(4);
        expect(pool.xMeaning).toBe(X_MEANING_WHITE);
        expect(pool.latestSeq()).toBe(0);
        expect(pool.acquireLatest()).toBeNull();

        const s = pool.acquire();
        expect(s).toBe(0);
        expect(pool.stateOf(s)).toBe(SLOT_COMPOSING);
        pool.slotBytes(s).fill(9);
        const seq = pool.publish(s, meta(1));
        expect(seq).toBe(1);
        expect(pool.stateOf(s)).toBe(SLOT_READY);
        expect(pool.refcountOf(s)).toBe(0);
        expect(pool.latestSlot()).toBe(0);

        const m = pool.metaOf(0);
        expect(m.frameNumber).toBe(1);
        expect(m.pipelineId).toBe(7);
        expect(m.timeMs).toBe(1e12 + 1);

        // Latest is pinned: publishing more frames never recycles it until it is superseded.
        const s2 = pool.acquire();
        pool.publish(s2, meta(2));
        expect(pool.stateOf(0)).toBe(SLOT_FREE); // superseded, no refs
        expect(pool.stateOf(1)).toBe(SLOT_READY);
    });

    it('keeps a referenced frame alive after it is superseded, then frees on release', () => {
        const pool = FramePool.allocate({ frameBytes: 4, slotCount: 3 });
        const a = pool.acquire();
        pool.slotBytes(a).set([1, 2, 3, 4]);
        pool.publish(a, meta(1));

        const held = pool.acquireLatest();
        expect(held).not.toBeNull();
        expect(held!.slot).toBe(a);
        expect(pool.refcountOf(a)).toBe(1);
        expect(pool.acquireLatest(held!.seq)).toBeNull(); // nothing newer

        const b = pool.acquire();
        pool.publish(b, meta(2));
        expect(pool.stateOf(a)).toBe(SLOT_READY); // still held
        expect(Array.from(held!.bytes)).toEqual([1, 2, 3, 4]);

        pool.release(a);
        expect(pool.stateOf(a)).toBe(SLOT_FREE);
        // The latest slot stays even at zero refs.
        expect(pool.stateOf(b)).toBe(SLOT_READY);
    });

    it('reports exhaustion instead of recycling in-use slots', () => {
        const pool = FramePool.allocate({ frameBytes: 4, slotCount: 2 });
        const a = pool.acquire();
        pool.publish(a, meta(1));
        const ref = pool.acquireLatest()!;
        const b = pool.acquire();
        pool.publish(b, meta(2));
        // a held by ref, b is latest: nothing free.
        expect(pool.acquire()).toBe(-1);
        expect(pool.stats().exhausted).toBe(1);
        pool.release(ref.slot);
        expect(pool.acquire()).toBe(a);
    });

    it('abandon returns a composing slot without publishing', () => {
        const pool = FramePool.allocate({ frameBytes: 4, slotCount: 2 });
        const a = pool.acquire();
        pool.abandon(a);
        expect(pool.stateOf(a)).toBe(SLOT_FREE);
        expect(pool.latestSeq()).toBe(0);
    });

    it('is readable by a legacy LatestFrameRingBuffer reader', () => {
        const pool = FramePool.allocate({ frameBytes: 6, slotCount: 4 });
        const a = pool.acquire();
        pool.slotBytes(a).set([10, 20, 30, 40, 50, 60]);
        pool.publish(a, meta(1));
        const r = legacyReadLatest(pool.buffer);
        expect(r).not.toBeNull();
        expect(r!.seq).toBe(1);
        expect(r!.frameSizeBytes).toBe(6);
        expect(Array.from(r!.bytes)).toEqual([10, 20, 30, 40, 50, 60]);
        expect(legacyReadLatest(pool.buffer, 1)).toBeNull();
    });

    it('attaches from another view of the same buffer', () => {
        const pool = FramePool.allocate({ frameBytes: 4, slotCount: 2, layoutVersion: 5 });
        const a = pool.acquire();
        pool.slotBytes(a).set([1, 1, 2, 2]);
        pool.publish(a, meta(9));
        const client = new FramePool(pool.buffer);
        expect(client.layoutVersion).toBe(5);
        const f = client.acquireLatest()!;
        expect(f.meta.frameNumber).toBe(9);
        expect(Array.from(f.bytes)).toEqual([1, 1, 2, 2]);
        client.release(f.slot);
    });

    it('waitForSeq resolves immediately when a newer frame exists and times out otherwise', async () => {
        const pool = FramePool.allocate({ frameBytes: 4, slotCount: 2 });
        const t0 = performance.now();
        expect(await pool.waitForSeq(0, 20)).toBe(0);
        expect(performance.now() - t0).toBeGreaterThanOrEqual(15);
        const a = pool.acquire();
        pool.publish(a, meta(1));
        expect(await pool.waitForSeq(0, 20)).toBe(1);
    });
});
