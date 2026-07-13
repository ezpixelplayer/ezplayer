import { describe, it, expect } from 'vitest';
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache } from './PrefetchCache';

export class TestPrefetchCache extends PrefetchCache<string, string, NeededTimePriority> {
    counts: Map<string, number> = new Map();
    clearCounts() {
        this.counts = new Map();
    }
    constructor(budget: number) {
        super({
            fetchFunction: async (key, abort) => {
                this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
                if (key.includes('@')) throw new Error();
                return key;
            },
            // Cost of an item is the number after a dash, else 1 (e.g. 'big-10' costs 10).
            budgetPredictor: (key) => {
                return parseInt(key.split('-')[1] ?? '1');
            },
            budgetCalculator: (key) => {
                return parseInt(key.split('-')[1] ?? '1');
            },
            keyToId: (key) => key,
            budgetLimit: budget,
            maxConcurrency: 1,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => {},
        });
    }

    placeRequests(s: number, e: number, now: number, prefix = '', suffix = '', expiry?: number) {
        for (let i = s; i <= e; ++i) {
            this.prefetch({
                key: `${prefix}${i}${suffix}`,
                now,
                expiry: expiry ?? 1000,
                priority: { neededTime: i },
            });
        }
    }

    /** One player loop iteration: bump the generation, (re)place the plays that the
     *  forward-run would produce this pass, then dispatch + settle. */
    async frame(now: number, reqs: { key: string; neededTime: number; neededThroughTime?: number; tier?: number }[]) {
        this.beginGeneration();
        for (const r of reqs) {
            this.prefetch({
                key: r.key,
                now,
                expiry: now + 100000,
                priority: { neededTime: r.neededTime, neededThroughTime: r.neededThroughTime, tier: r.tier },
            });
        }
        this.cleanupAndDispatchRequests(now, -1);
        await this.finishFetches();
    }
}

describe('PrefetchCache dispatch & eviction', () => {
    // Budget counts only committed memory (fetching/ready). Highest-priority items fill
    // it; lower-priority ones stay queued. (maxConcurrency 1 → one dispatch per pass.)
    it('fills the budget with the highest-priority items', async () => {
        const cache = new TestPrefetchCache(3);
        for (let round = 0; round < 6; round++) {
            cache.beginGeneration();
            cache.placeRequests(1, 8, 0); // re-request all 8 each pass → all live
            cache.cleanupAndDispatchRequests(0, -1);
            await cache.finishFetches();
        }
        expect(cache.check('1', 0)).toBe(true);
        expect(cache.check('2', 0)).toBe(true);
        expect(cache.check('3', 0)).toBe(true);
        expect(cache.check('4', 0)).toBe(false);
    });

    // A queued item costs nothing until dispatched, so an unaffordable big item just
    // stays queued while the affordable one still gets cached.
    it('a pending item too big for the budget does not starve smaller ones', async () => {
        const cache = new TestPrefetchCache(2);
        cache.beginGeneration();
        cache.prefetch({ key: 'big-10', now: 0, expiry: 1000, priority: { neededTime: 0 } }); // higher priority, cost 10
        cache.prefetch({ key: 'small-1', now: 0, expiry: 1000, priority: { neededTime: 1 } }); // cost 1
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('small-1', 0)).toBe(true); // cached despite big's huge estimate
        expect(cache.check('big-10', 0)).toBe(false); // can't fit budget 2; stays queued, no saturation
    });

    // Generation liveness: an item re-requested this pass (live) is kept over one that
    // wasn't (stale) when the budget can't hold both.
    it('keeps live items over stale (not re-requested) ones under pressure', async () => {
        const cache = new TestPrefetchCache(1);
        cache.beginGeneration();
        cache.prefetch({ key: 'A', now: 0, expiry: 1000, priority: { neededTime: 0 } });
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('A', 0)).toBe(true);

        // Next pass: A is not re-requested (→ stale); B is (→ live).
        cache.beginGeneration();
        cache.prefetch({ key: 'B', now: 0, expiry: 1000, priority: { neededTime: 0 } });
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('B', 0)).toBe(true); // live kept
        expect(cache.check('A', 0)).toBe(false); // stale evicted for room
    });

    // A queued intention that drops out of the plan is removed (it holds no memory).
    it('drops stale queued intentions', async () => {
        const cache = new TestPrefetchCache(10);
        cache.beginGeneration();
        cache.prefetch({ key: 'X', now: 0, expiry: 1000, priority: { neededTime: 5 } }); // queued, never dispatched
        cache.beginGeneration();
        cache.prefetch({ key: 'Y', now: 0, expiry: 1000, priority: { neededTime: 0 } });
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('Y', 0)).toBe(true);
        expect(cache.getStats().totalItems).toBe(1); // X (stale + queued) was dropped
    });

    // Hard expiry still reclaims items past their deadline.
    it('removes expired items', async () => {
        const cache = new TestPrefetchCache(10);
        cache.beginGeneration();
        cache.prefetch({ key: 'E', now: 0, expiry: 5, priority: { neededTime: 0 } });
        cache.cleanupAndDispatchRequests(0, -1);
        await cache.finishFetches();
        expect(cache.check('E', 0)).toBe(true);
        cache.cleanupAndDispatchRequests(10, -1); // now=10 > expiry 5
        expect(cache.getStats().totalItems).toBe(0);
    });

    // Jukebox supersession via the priority comparator (both still "live"): an ended
    // song whose window hasn't elapsed must not out-prioritize the current play.
    it('prefers the current play over a superseded/ended one', async () => {
        const cache = new TestPrefetchCache(1); // room for exactly one
        cache.prefetch({ key: 'A', now: 6, expiry: 1000, priority: { neededTime: 0, neededThroughTime: 10 } });
        cache.prefetch({ key: 'B', now: 6, expiry: 1000, priority: { neededTime: 5, neededThroughTime: 15 } });
        cache.cleanupAndDispatchRequests(6, -1);
        await cache.finishFetches();
        expect(cache.check('B', 6)).toBe(true); // current play wins the slot
        expect(cache.check('A', 6)).toBe(false);
    });
});

// Drive the cache the way the player does each loop: a generation per frame, placing
// the resolved plays (current + next, plus tiered background / speculative branches).
describe('PrefetchCache player-loop simulation', () => {
    const HAPPY = 0;
    const BG = 1;
    const SPEC = 2;

    it('keeps foreground over background over speculative (tiers)', async () => {
        const cache = new TestPrefetchCache(2); // room for two
        for (let i = 0; i < 6; i++) {
            await cache.frame(0, [
                { key: 'fg', neededTime: 0, neededThroughTime: 100, tier: HAPPY },
                { key: 'bg', neededTime: 0, neededThroughTime: 100, tier: BG },
                { key: 'spec', neededTime: 0, neededThroughTime: 100, tier: SPEC },
            ]);
        }
        expect(cache.check('fg', 0)).toBe(true);
        expect(cache.check('bg', 0)).toBe(true);
        expect(cache.check('spec', 0)).toBe(false); // lowest tier, no room
    });

    it('evicts speculative before committed when room is needed', async () => {
        const cache = new TestPrefetchCache(2);
        // Warm fg + speculative into the two slots.
        for (let i = 0; i < 6; i++) {
            await cache.frame(0, [
                { key: 'fg', neededTime: 0, neededThroughTime: 100, tier: HAPPY },
                { key: 'spec', neededTime: 0, neededThroughTime: 100, tier: SPEC },
            ]);
        }
        expect(cache.check('spec', 0)).toBe(true);
        // A real background sequence appears — it must take the slot from speculative.
        for (let i = 0; i < 6; i++) {
            await cache.frame(0, [
                { key: 'fg', neededTime: 0, neededThroughTime: 100, tier: HAPPY },
                { key: 'bg', neededTime: 0, neededThroughTime: 100, tier: BG },
                { key: 'spec', neededTime: 0, neededThroughTime: 100, tier: SPEC },
            ]);
        }
        expect(cache.check('fg', 0)).toBe(true);
        expect(cache.check('bg', 0)).toBe(true);
        expect(cache.check('spec', 0)).toBe(false);
    });

    it('never lets speculative starve the current play (tight budget)', async () => {
        const cache = new TestPrefetchCache(1); // room for one
        for (let i = 0; i < 4; i++) {
            await cache.frame(0, [
                { key: 'cur', neededTime: 0, neededThroughTime: 100, tier: HAPPY },
                { key: 'skip', neededTime: 0, neededThroughTime: 100, tier: SPEC },
            ]);
        }
        expect(cache.check('cur', 0)).toBe(true);
        expect(cache.check('skip', 0)).toBe(false);
    });

    it('slides the current+next window forward and drops the past', async () => {
        const cache = new TestPrefetchCache(2); // current + next
        // now=0: A playing [0,10], B next [10,20].
        for (let i = 0; i < 6; i++) {
            await cache.frame(0, [
                { key: 'A', neededTime: 0, neededThroughTime: 10, tier: HAPPY },
                { key: 'B', neededTime: 10, neededThroughTime: 20, tier: HAPPY },
            ]);
        }
        expect(cache.check('A', 0)).toBe(true);
        expect(cache.check('B', 0)).toBe(true);
        // now=10: B playing [10,20], C next [20,30]; A is no longer in the plan.
        for (let i = 0; i < 6; i++) {
            await cache.frame(10, [
                { key: 'B', neededTime: 10, neededThroughTime: 20, tier: HAPPY },
                { key: 'C', neededTime: 20, neededThroughTime: 30, tier: HAPPY },
            ]);
        }
        expect(cache.check('B', 10)).toBe(true);
        expect(cache.check('C', 10)).toBe(true);
        expect(cache.check('A', 10)).toBe(false); // past play, evicted
    });
});

describe('needTimePriorityCompare', () => {
    const now = 100;
    const current = { neededTime: 90, neededThroughTime: 110 }; // now inside window
    const future = { neededTime: 120, neededThroughTime: 130 }; // window not started
    const past = { neededTime: 10, neededThroughTime: 20 }; // window elapsed

    it('ranks current > future > past', () => {
        expect(needTimePriorityCompare(current, future, now)).toBeLessThan(0);
        expect(needTimePriorityCompare(current, past, now)).toBeLessThan(0);
        expect(needTimePriorityCompare(future, past, now)).toBeLessThan(0);
        expect(needTimePriorityCompare(past, current, now)).toBeGreaterThan(0);
    });

    it('among current, prefers the most-recently-started (supersession)', () => {
        const superseded = { neededTime: 0, neededThroughTime: 10 };
        const currentPlay = { neededTime: 5, neededThroughTime: 15 };
        expect(needTimePriorityCompare(currentPlay, superseded, 6)).toBeLessThan(0);
    });

    it('among future, prefers the sooner need (deeper in queue = less valuable)', () => {
        expect(needTimePriorityCompare({ neededTime: 5 }, { neededTime: 9 }, 0)).toBeLessThan(0);
    });

    it('among past, prefers the more recently needed', () => {
        const recentPast = { neededTime: 80, neededThroughTime: 90 };
        const olderPast = { neededTime: 10, neededThroughTime: 20 };
        expect(needTimePriorityCompare(recentPast, olderPast, now)).toBeLessThan(0);
    });
});
