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
            budgetPredictor: (key) => key.length,
            budgetCalculator: (key) => key.length,
            keyToId: (key) => key,
            budgetLimit: budget,
            maxConcurrency: 1,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => { }
        });
    }

    placeRequests(s: number, e: number, now: number) {
        for (let i = s; i<= e; ++i) {
            this.prefetch({
                key: `${i}`,
                now,
                expiry: 1000, 
                priority: {neededTime: i}
            });
        }
    }
}

describe('findMatchingScheduleEntry', () => {
    it('behaves ok when oversubscribed', async () => {
        const cache = new TestPrefetchCache(3);

        // The budget is 3, so we expect 1-3 to be populated
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
        expect(cache.check('3', 0)).toBe(true);
        expect(cache.check('4', 0)).toBe(false);

        cache.placeRequests(1, 8, 0);
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('1', 0)).toBe(true);
        expect(cache.check('2', 0)).toBe(true);
        expect(cache.check('3', 0)).toBe(true);
        expect(cache.check('4', 0)).toBe(false);
    });

    // Test evictions
    // Test errors
});