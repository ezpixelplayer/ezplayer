import { describe, expect, it } from 'vitest';
import { ArrayBufferPool } from './BufferRecycler';

describe('ArrayBufferPool', () => {
    it('drops returned buffers once the retained-byte limit is reached', () => {
        const pool = new ArrayBufferPool(1024);
        const first = pool.get(1024);
        const second = pool.get(1024);

        pool.release(first);
        pool.release(second);

        expect(pool.getStats()).toEqual([{ size: 1024, inUse: 0, inPool: 1, total: 1 }]);

        const reused = pool.get(1024);
        expect(reused).toBe(first);
        expect(pool.getStats()).toEqual([{ size: 1024, inUse: 1, inPool: 0, total: 1 }]);
    });

    it('does not retain a single buffer larger than the limit', () => {
        const pool = new ArrayBufferPool(1024);
        pool.release(pool.get(2048));
        expect(pool.getStats()).toEqual([{ size: 2048, inUse: 0, inPool: 0, total: 0 }]);
    });
});
