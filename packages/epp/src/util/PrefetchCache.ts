//
// A flexible prefetching and caching component
// Requests have a key, for deduplication
//   Examples - a file + offset + range
//            - a decompressed song (by name/id)
//            - an fseq file + frame number
//
// How priority is implemented:
//   After a batch of requests is made, do cleanup and call sort explicitly and kick off
//   This is simpler to implement and more controlled that making it purely reactive, because the whole batch
//      is added for analysis before any tasks are started
//   (Especially since the passage of time is a factor, and failure to refresh the requests too.)
//   Also we have plenty of opportunity to do this between frames that are requested.

import { sleepms } from './Utils';

// Hence, the idea is, at least within the player, to (on each frame or therebouts):
//   Cancel all old requests
//   Place new requests
//   Do LRU budget
//   Kick off priority tasks if sensible
// A wrinkle is if those tasks beget tasks in another system.
//   This will probably be handled outside.  We will place the request, and request's requests,
//     in all systems before doing the next things.

// Priority comparison, often the deadline that is nearer unless something is higher priority tier
//   Note for missed deadlines, relative priority can change to irrelevant.
//   A negative return means a is higher priority than b.
export type PriorityComparator<P> = (a: P, b: P, now: number) => number;
export type BudgetPredictor<K> = (key: K) => number; // Predict budget from key (like file space)
export type BudgetCalculator<K, V> = (key: K, value: V) => number; // Full known budget (like decompressed size)
export type DisposeCallback<K, V> = (key: K, value: V) => void | Promise<void>; // TODO: Add reason?
export type FetchFunction<K, V> = (key: K, signal: AbortSignal) => Promise<V>; // GPT version suggests abort, not clear the value

/**
 * The things you need to set up a prefetch+cache
 */
export interface PrefetchCacheOptions<K, V, P> {
    /** Function to fetch values for keys */
    fetchFunction: FetchFunction<K, V>;

    /** Condense a K to a key string */
    keyToId: (k: K) => string; // caller supplies how to serialize keys for dedupe

    /** Function to compare priorities (lower return value = higher priority) */
    priorityComparator: PriorityComparator<P>;

    /** Callback when items are disposed/evicted */
    onDispose?: DisposeCallback<K, V>;

    /** Function to calculate budget estimate for each item */
    budgetPredictor: BudgetPredictor<K>;

    /** Function to calculate budget cost for each item */
    budgetCalculator: BudgetCalculator<K, V>;

    /** Total budget limit */
    budgetLimit: number;

    /** Maximum parallel dispatch slots */
    maxConcurrency: number;
}

export interface PrefetchRequest<K, P> {
    key: K;
    priority: P;
    now: number;
    expiry: number; // Not valid after this point
}

export interface AwaitRequest<K, P> {
    key: K;
    priority: P; // if prefetching, use this priority; if absent, use the current time as smallest number (example)
    now: number; // override for determinism/tests
    expiry: number;
    prefetchIfMissing: boolean;
}

interface CacheStatCounters {
    // Hit count (counters)
    checkHits: number;
    checkMisses: number;
    checkNotReady: number;
    refHits: number;
    refMisses: number;
    awaitHits: number;
    awaitMisses: number;

    // TODO: Prefetch requests made?

    expiredItems: number; // Thrown out due to cleanup criteria
    evictedItems: number; // Thrown out due to budget

    // Request counts to underlying service (counters)
    completedRequests: number;
    erroredRequests: number;
    // TODO: Aborted requests?
}

export interface CacheStats extends CacheStatCounters {
    // Item counts (gauge)
    totalItems: number;
    referencedItems: number;
    readyItems: number;
    erroredItems: number;
    pendingItems: number;
    fetchesInProgress: number;

    // Budgeting (gauge)
    totalBudgetLimit: number;
    totalBudgetUsed: number;
    cacheBudgetUsed: number;
    prefetchBudgetUsed: number;
}

class Deferred<T> {
    promise: Promise<T>;
    resolve!: (v: T) => void;
    reject!: (e: any) => void;
    constructor() {
        this.promise = new Promise<T>((res, rej) => {
            this.resolve = res;
            this.reject = rej;
        });
    }
}

interface CacheItem<K, V, P> {
    key: K;
    value?: V;
    error?: Error;
    state: 'queued' | 'fetching' | 'ready' | 'error';
    priority: P;
    generation: number; // the prefetch generation in which this was last (re)requested

    refCount: number;
    waiters: Set<Deferred<V>>;
    fetchPromise?: Promise<V>; // Wait on cleanup
    lastPrefetchedAt: number; // for staleness of prefetch requests that haven't been renewed in a while
    lastAccessedAt: number; // for LRU (check/await/materialize touches)
    expiry: number; // if not fetched by this point, no value

    // Perf monitoring - how much time does this take?
    queuedAt?: number;
    fetchingSince?: number;
    abort?: AbortController;

    // cost tracking
    estCost: number; // pending cost (key-based)
    actualCost: number;
}

export class RefHandle<V> {
    private static registry = new FinalizationRegistry<string>((info) => {
        // Runs sometime after the wrapper is GC'd.
        // If we get here, the wrapper was collected without being dereferenced.
        const msg = `Leaked RefHandle (not dereferenced): ${info}\n`;
        // Be noisy. You can escalate to process.abort() if you want to fail hard.
        process.emitWarning(msg, { code: 'REF_LEAK' });
    });

    private _releaseCallback: (v: V) => void;
    _v: V | undefined;
    private readonly token = {};

    constructor(id: string, v: V, releaseCallback: (v: V) => void) {
        this._v = v;
        this._releaseCallback = releaseCallback;
        RefHandle.registry.register(this, id, this.token);
    }

    release(): void {
        if (this._v) {
            this._releaseCallback(this._v);
            this._v = undefined;
            RefHandle.registry.unregister(this.token);
        }
    }

    get v(): V | undefined {
        return this._v;
    }

    get isReleased(): boolean {
        return this._v == undefined;
    }
}

export class PrefetchCache<K, V, P> {
    private cache = new Map<string, CacheItem<K, V, P>>();
    private activeFetches = new Set<string>();

    /**
     * Monotonic "generation" of prefetch requests. The driver bumps this once per
     * pass (beginGeneration) before re-placing the requests that are still wanted.
     * Items stamped with the current generation are "live" (in the current plan);
     * older ones are "stale" and kept only as an LRU cache, below anything live.
     */
    private currentGeneration = 0;

    /** Start a new prefetch generation. Call once per pass, before placing requests. */
    beginGeneration(): number {
        return ++this.currentGeneration;
    }

    private static clearedStats(): CacheStatCounters {
        return {
            checkHits: 0,
            checkMisses: 0,
            checkNotReady: 0,
            refHits: 0,
            refMisses: 0,
            awaitHits: 0,
            awaitMisses: 0,

            completedRequests: 0,
            erroredRequests: 0,
            expiredItems: 0,
            evictedItems: 0,
        };
    }
    private stats: CacheStatCounters = PrefetchCache.clearedStats();

    constructor(private options: PrefetchCacheOptions<K, V, P>) {}

    /**
     * Place a prefetch request
     * Note that this just makes note of the request;
     *  we expect a whole batch of these to come in before doing any actions.
     * It is acceptable to immeditately reference after this...
     *    if something is driving the queue
     */
    prefetch(request: PrefetchRequest<K, P>): void {
        const now = request.now;
        const id = this.options.keyToId(request.key);

        const existing = this.cache.get(id);

        if (existing) {
            // Update existing item
            existing.lastPrefetchedAt = now;
            existing.lastAccessedAt = now;
            existing.generation = this.currentGeneration; // re-requested this pass → live
            existing.expiry = Math.max(existing.expiry, request.expiry);
            if (this.options.priorityComparator(request.priority, existing.priority, now) < 0) {
                existing.priority = request.priority;
            }

            if (existing.state === 'error') {
                // Requeue after error if requested again
                existing.state = 'queued';
                // existing.error = undefined; // Interesting semantic - error stays but not marked
                existing.queuedAt = performance.now();
            }
            // There is no need to recalculate the queue, as this occurs before dispatch.
        } else {
            // Create new cache item
            const item: CacheItem<K, V, P> = {
                key: request.key,
                waiters: new Set(),
                lastPrefetchedAt: now,
                lastAccessedAt: now,
                generation: this.currentGeneration,
                queuedAt: performance.now(),
                expiry: request.expiry,
                priority: request.priority,
                refCount: 0,
                estCost: this.options.budgetPredictor(request.key),
                actualCost: 0,
                state: 'queued',
            };

            this.cache.set(id, item);

            // There is no need to recalculate the queue, as this occurs before dispatch.
        }
        // There is no need to process any items now.  Once the batch is done, the highet priorities are calculated to run.
    }

    /**
     * Check if a key is present and return its value if available
     * Can safely be ref'd in the same turn of the event loop.  Node.js 'ya know.
     */
    check(key: K, now: number): boolean {
        // TODO STATS
        const id = this.options.keyToId(key);
        const item = this.cache.get(id);
        if (!item) {
            ++this.stats.checkMisses;
            return false;
        }
        if (item.state === 'ready' || item.state === 'error') {
            ++this.stats.checkHits;
            item.lastAccessedAt = now;
            return true;
        }
        ++this.stats.checkNotReady;
        return false;
    }

    /**
     * Await completion of a key's fetch
     */
    async await(req: AwaitRequest<K, P>): Promise<RefHandle<V>> {
        const id = this.options.keyToId(req.key);
        let item = this.cache.get(id);

        if (!item) {
            if (!req.prefetchIfMissing) throw new Error('Key missing and prefetchIfMissing=false');
            this.prefetch(req);
            item = this.cache.get(id)!;
        }

        // If already ready, return immediately (and optionally bump ref)
        if (item.state === 'ready') {
            ++this.stats.awaitHits;
            this.addRefInternal(item, req.now);
            return new RefHandle<V>(id, item.value!, (_v: V) => {
                this.releaseRefInternal(item);
            });
        }
        if (item.state === 'error') {
            ++this.stats.awaitHits;
            throw item.error!;
        }

        ++this.stats.awaitMisses;
        const d = new Deferred<V>();
        item.waiters.add(d);
        this.addRefInternal(item, req.now);
        try {
            const v = await d.promise;
            return new RefHandle<V>(id, item.value!, (_v: V) => {
                this.releaseRefInternal(item);
            });
        } catch (e) {
            this.releaseRefInternal(item);
            throw e;
        }
    }

    /**
     * Create a reference handle to pin an item in cache
     */
    reference(key: K, now: number): { ref?: RefHandle<V>; err?: Error } | undefined {
        const kid = this.options.keyToId(key);
        const item = this.cache.get(kid);

        if (!item) {
            ++this.stats.refMisses;
            return undefined;
        }
        if (item.error) {
            ++this.stats.refHits;
            return { err: item.error }; // May not be it, but can't hurt to check
        }
        if (!item.value) {
            ++this.stats.refMisses;
            return {};
        }

        ++this.stats.refHits;
        this.addRefInternal(item, now);

        return {
            ref: new RefHandle<V>(kid, item.value, (_v: V) => {
                this.releaseRefInternal(item);
            }),
        };
    }

    /** Set new budget; still need to run cleanup */
    setBudget(budget: number) {
        this.options.budgetLimit = budget;
    }

    /**
     * Get current cache statistics
     */
    getStats(): Readonly<CacheStats> {
        const bstat = this.currentGaugeStats();
        return {
            ...this.stats,
            totalItems: this.cache.size,
            referencedItems: bstat.pinned,
            pendingItems: bstat.pending,
            erroredItems: bstat.errored,
            readyItems: bstat.ready,
            fetchesInProgress: this.activeFetches.size,

            totalBudgetLimit: this.options.budgetLimit,
            totalBudgetUsed: bstat.totalcost,
            prefetchBudgetUsed: bstat.estcost,
            cacheBudgetUsed: bstat.valcost,
        };
    }

    /**
     * Reset the stats
     */
    resetStats() {
        this.stats = PrefetchCache.clearedStats();
    }

    /**
     * Abort and await all
     */
    async shutdown(): Promise<void> {
        const fps: Promise<unknown>[] = [];
        for (const [_key, item] of this.cache.entries()) {
            if (item.fetchPromise) {
                try {
                    item.abort?.abort();
                    fps.push(item.fetchPromise);
                } catch (e) {}
            }
        }
        await Promise.allSettled(fps);
        this.destroy();
    }

    /**
     * Destroy the cache and clean up resources
     */
    destroy(): void {
        // Dispose of all items
        for (const [_key, item] of this.cache.entries()) {
            this.removeItem(item.key);
        }

        this.cache.clear();
        this.activeFetches.clear();
    }

    /**
     * Manually trigger cleanup; this
     *   Discards any expired items
     *   Discards any stale prefetch requests
     *   Calculates budgets and total (including all prefetch)
     *   Discards down to budget (keeping room for prefetches)
     *   Discards far future prefetch requests if not room for all
     *   Dispatches the things that we want
     */
    cleanupAndDispatchRequests(now: number, notRequestedAfter: number): void {
        /*
         * Tiered priority. Lower tier number = kept first / dispatched first:
         *   PINNED  in use (refCount>0) or in flight (fetching) — never dropped here
         *   LIVE    re-requested in the current generation — sorted by the priority comparator
         *   STALE   cached but not re-requested this generation — sorted by LRU (recency)
         *   EXPIRED aged out / not touched in a long time — removed
         *
         * Budget counts COMMITTED MEMORY only: fetching (estCost, in flight) + ready
         * (actualCost). A queued item is just an intention — it costs nothing and is
         * freely droppable; it consumes budget only once we decide to dispatch it.
         */
        const PINNED = 0;
        const LIVE = 1;
        const STALE = 2;
        const EXPIRED = 3;

        interface PSortable {
            item: CacheItem<K, V, P>;
            tier: number;
        }

        const toSort: PSortable[] = [];
        for (const [key, item] of this.cache.entries()) {
            if (item.refCount > 0 || this.activeFetches.has(key)) {
                toSort.push({ item, tier: PINNED });
            } else if (
                (item.lastPrefetchedAt < notRequestedAfter && item.lastAccessedAt < notRequestedAfter) ||
                item.expiry < now
            ) {
                toSort.push({ item, tier: EXPIRED });
            } else if (item.generation === this.currentGeneration) {
                toSort.push({ item, tier: LIVE });
            } else {
                toSort.push({ item, tier: STALE });
            }
        }

        toSort.sort((a, b) => {
            if (a.tier !== b.tier) return a.tier - b.tier;
            if (a.tier === LIVE) return this.options.priorityComparator(a.item.priority, b.item.priority, now);
            if (a.tier === STALE) return b.item.lastAccessedAt - a.item.lastAccessedAt; // most-recently-used first
            return 0;
        });

        // Running total of committed memory (fetching + ready) in priority order.
        let committed = 0;
        for (const si of toSort) {
            const item = si.item;
            const id = this.options.keyToId(item.key);
            const pinned = si.tier === PINNED;

            if (si.tier === EXPIRED && !pinned) {
                this.removeItem(item.key);
                this.stats.expiredItems++;
                continue;
            }

            // A queued/errored intention that's no longer in the plan: drop it. It holds
            // no memory and will be re-requested next pass if it comes back into the plan.
            if (si.tier === STALE && (item.state === 'queued' || item.state === 'error')) {
                this.removeItem(item.key);
                continue;
            }

            if (item.state === 'ready' || item.state === 'fetching') {
                const cost = item.state === 'ready' ? item.actualCost : item.estCost;
                // Over the committed-memory budget → evict the lowest-priority ready item.
                // (Fetching items are in flight / PINNED and are left to finish.)
                if (!pinned && item.state === 'ready' && committed + cost > this.options.budgetLimit) {
                    this.removeItem(item.key);
                    this.stats.evictedItems++;
                    continue;
                }
                committed += cost;
                continue;
            }

            // Live queued item: dispatch if it fits the budget and a slot is free.
            if (item.state === 'queued') {
                if (
                    committed + item.estCost <= this.options.budgetLimit &&
                    this.activeFetches.size < this.options.maxConcurrency &&
                    !this.activeFetches.has(id)
                ) {
                    this.activeFetches.add(id);
                    item.state = 'fetching';
                    item.fetchingSince = performance.now();
                    item.abort = new AbortController();
                    committed += item.estCost; // now in-flight memory
                    this.fetchItem(item);
                }
                // else: leave it queued (live); retried next pass.
            }
        }
    }

    private currentGaugeStats() {
        let estcost = 0,
            valcost = 0;
        let pinned = 0,
            ready = 0,
            errored = 0,
            pending = 0;
        for (const item of this.cache.values()) {
            if (item.refCount > 0) ++pinned;
            if (item.state === 'queued' || item.state === 'fetching') {
                estcost += item.estCost;
                ++pending;
            }
            if (item.state === 'ready') {
                valcost += item.actualCost;
                ++ready;
            }
            if (item.state === 'error') {
                ++errored;
            }
        }
        return { estcost, valcost, totalcost: estcost + valcost, pinned, ready, errored, pending };
    }

    private addRefInternal(item: CacheItem<K, V, P>, now: number) {
        item.refCount++;
        item.lastAccessedAt = now;
    }
    private releaseRefInternal(item: CacheItem<K, V, P>) {
        item.refCount = Math.max(0, item.refCount - 1);
    }

    private async fetchItem(item: CacheItem<K, V, P>): Promise<void> {
        try {
            const promise = this.options.fetchFunction(item.key, item.abort!.signal);
            item.fetchPromise = promise;
            const value = await promise;
            const budgetCost = this.options.budgetCalculator(item.key, value);

            item.value = value;
            item.error = undefined;
            item.actualCost = budgetCost;
            item.state = 'ready';
            this.stats.completedRequests++;

            // resolve waiters
            for (const w of item.waiters) w.resolve(value);
            item.waiters.clear();
        } catch (error) {
            item.state = 'error';
            item.error = error as Error;
            this.stats.erroredRequests++;

            // reject waiters
            for (const w of item.waiters) w.reject(error);
            item.waiters.clear();
        } finally {
            // TODO: Bump counters correctly
            item.fetchPromise = undefined;
            item.fetchingSince = undefined;
            item.abort = undefined;

            this.activeFetches.delete(this.options.keyToId(item.key));
        }
    }

    private removeItem(key: K): void {
        const id = this.options.keyToId(key);
        const item = this.cache.get(id);
        if (!item) return;

        // Cancel if queued or fetching
        item.abort?.abort();
        item.abort = undefined;

        if (item.value && this.options.onDispose) {
            try {
                this.options.onDispose(key, item.value);
            } catch (error) {
                console.error('Error disposing cache item:', error);
            }
        }

        // Notify waiters if any
        if (item.waiters.size > 0) {
            const err = new Error(`Discarded`);
            for (const w of item.waiters) w.reject(err);
            item.waiters.clear();
        }

        this.cache.delete(id);
    }

    // Test / shutdown
    async finishFetches() {
        while (this.activeFetches.size) {
            await sleepms(0);
        }
    }
}

export interface NeededTimePriority {
    neededTime: number;
    neededThroughTime?: number;
    /** Confidence tier: lower = higher priority. 0 = happy-path (foreground), then
     *  background, then speculative (skip/down-stack branches). Defaults to 0. */
    tier?: number;
}
/**
 * Priority for time-windowed needs. `timeOfIrrelevance` is "now". Each item has a
 * need window [neededTime, neededThroughTime]. Relative to now we bucket as:
 *
 *   current (0): now is inside the window  — being used right now; most valuable
 *   future  (1): now is before the window  — sooner need is more valuable
 *   past    (2): now is after the window    — need elapsed/superseded; evictable
 *
 * Lower return value = higher priority (kept; sorted/dispatched first). When a new
 * play supersedes an old one (both momentarily `current`), the most-recently-started
 * wins.
 */
export const needTimePriorityCompare = (a: NeededTimePriority, b: NeededTimePriority, timeOfIrrelevance: number) => {
    const now = timeOfIrrelevance;
    // Confidence tier dominates: happy-path (0) > background (1) > speculative (2).
    const tierA = a.tier ?? 0;
    const tierB = b.tier ?? 0;
    if (tierA !== tierB) return tierA - tierB;
    const classify = (p: NeededTimePriority): number => {
        const through = p.neededThroughTime ?? p.neededTime;
        if (now < p.neededTime) return 1; // future: need hasn't started
        if (now <= through) return 0; // current: now within [neededTime, neededThroughTime]
        return 2; // past: window elapsed / superseded
    };
    const ca = classify(a);
    const cb = classify(b);
    if (ca !== cb) return ca - cb; // current < future < past

    if (ca === 0) {
        // Both current (e.g. a fresh jukebox play overlapping a superseded one):
        // the most-recently-started is the real current play.
        return b.neededTime - a.neededTime;
    }
    if (ca === 1) {
        // Both future: sooner need is higher priority (deeper in the queue = later = less valuable).
        return a.neededTime - b.neededTime;
    }
    // Both past: more-recently-needed (later end) is higher priority (LRU-ish).
    const ta = a.neededThroughTime ?? a.neededTime;
    const tb = b.neededThroughTime ?? b.neededTime;
    return tb - ta;
};
