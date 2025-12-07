import { describe, it, expect } from 'vitest';
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache } from './PrefetchCache';

export class TestPrefetchCache extends PrefetchCache<string, string, NeededTimePriority> {
    counts: Map<string, number> = new Map();
    clearCounts() {this.counts = new Map();}
    constructor(budget: number) {
        super({
            fetchFunction: async (key, abort) => {
                this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
                return key;
            },
            budgetPredictor: (key) => {
                return parseInt(key.split('-')[1] ?? '1')
            },
            budgetCalculator: (key) => {
                return parseInt(key.split('-')[1] ?? '1')
            },
            keyToId: (key) => key,
            budgetLimit: budget,
            maxConcurrency: 1,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => { }
        });
    }

    placeRequests(s: number, e: number, now: number, prefix = '', suffix = '') {
        for (let i = s; i<= e; ++i) {
            this.prefetch({
                key: `${prefix}${i}${suffix}`,
                now,
                expiry: 1000, 
                priority: {neededTime: i}
            });
        }
    }
}

describe('findMatchingScheduleEntry', () => {
    it('behaves ok when oversubscribed', async () => {
        const cache = new TestPrefetchCache(2);

        // The budget is 2, so we expect 1-3 to be populated
        // As the concurrency is 1, it will take multiple dispatches to get it filled

        cache.placeRequests(1, 8, 0);
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('1', 0)).toBe(true);
        expect(cache.check('2', 0)).toBe(false);
        expect(cache.check('3', 0)).toBe(false);
        expect(cache.check('4', 0)).toBe(false);
        expect(true).toBe(true);

        cache.placeRequests(1, 8, 0);
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('1', 0)).toBe(true);
        expect(cache.check('2', 0)).toBe(true);
        expect(cache.check('3', 0)).toBe(false);

        cache.placeRequests(1, 8, 0);
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('1', 0)).toBe(true);
        expect(cache.check('2', 0)).toBe(true);
        expect(cache.check('3', 0)).toBe(false);
        expect(cache.check('4', 0)).toBe(false);

        // Add a second stream that is needed later
        cache.placeRequests(3, 8, 0, 'l');
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('1', 0)).toBe(true);
        expect(cache.check('2', 0)).toBe(true);
        expect(cache.check('3', 0)).toBe(false);
        expect(cache.check('l1', 0)).toBe(false);
        expect(cache.check('l3', 0)).toBe(false);

        // Add a second stream that is needed at the same time
        cache.placeRequests(1, 8, 0, 'a', '');
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('1', 0)).toBe(true);
        expect(cache.check('2', 0)).toBe(false);
        expect(cache.check('a1', 0)).toBe(true);
        expect(cache.check('a2', 0)).toBe(false);
    });

    // Test evictions
    it('keeps a reasonable set of things', async () => {
        const cache = new TestPrefetchCache(6);
        for (let i=0; i<4; ++i) {
            cache.placeRequests(i+1, 10, i, 'f');
            cache.placeRequests(i+1, 10, i, 'b');
            for (let j=0; j<4; ++j) {
                cache.cleanupAndDispatchRequests(i, i-1);
                await cache.finishFetches();
            }
        }
        expect(cache.check('f4', 3)).toBe(true);
        expect(cache.check('b4', 3)).toBe(true);
        expect(cache.check('f3', 3)).toBe(true);
        expect(cache.check('b3', 3)).toBe(true);
        expect(cache.check('f5', 3)).toBe(true);
        expect(cache.check('b5', 3)).toBe(true);
        expect(cache.check('f6', 3)).toBe(false);
        expect(cache.check('b6', 3)).toBe(false);
        expect(cache.check('f2', 3)).toBe(false);
        expect(cache.check('b2', 3)).toBe(false);
    });

    // Test mixed sizes
    // Test errors
});