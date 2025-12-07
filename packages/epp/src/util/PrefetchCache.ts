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

import { sleepms } from "./Utils";

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
    keyToId: (k: K) => string // caller supplies how to serialize keys for dedupe

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
    key: K,
    priority: P;                // if prefetching, use this priority; if absent, use the current time as smallest number (example)
    now: number;                // override for determinism/tests
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
        this.promise = new Promise<T>((res, rej) => { this.resolve = res; this.reject = rej; });
    }
}

interface CacheItem<K, V, P> {
    key: K,
    value?: V;
    error?: Error;
    state: 'queued' | 'fetching' | 'ready' | 'error';
    priority: P;

    refCount: number;
    waiters: Set<Deferred<V>>;
    fetchPromise?: Promise<V>; // Wait on cleanup
    lastPrefetchedAt: number;  // for staleness of prefetch requests that haven't been renewed in a while
    lastAccessedAt: number;    // for LRU (check/await/materialize touches)
    expiry: number; // if not fetched by this point, no value

    // Perf monitoring - how much time does this take?
    queuedAt?: number;
    fetchingSince?: number;
    abort?: AbortController;

    // cost tracking
    estCost: number;     // pending cost (key-based)
    actualCost: number;
}

export class RefHandle<V> {
    private static registry = new FinalizationRegistry<string>((info) => {
        // Runs sometime after the wrapper is GC'd.
        // If we get here, the wrapper was collected without being dereferenced.
        const msg = `Leaked RefHandle (not dereferenced): ${info}\n`;
        // Be noisy. You can escalate to process.abort() if you want to fail hard.
        process.emitWarning(msg, { code: "REF_LEAK" });
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

    get v(): V | undefined { return this._v; }

    get isReleased(): boolean {
        return this._v == undefined;
    }
}

export class PrefetchCache<K, V, P> {
    private cache = new Map<string, CacheItem<K, V, P>>();
    private activeFetches = new Set<string>();

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
            evictedItems: 0
        };
    }
    private stats: CacheStatCounters = PrefetchCache.clearedStats();

    constructor(private options: PrefetchCacheOptions<K, V, P>) {
    }

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
        const d = new Deferred<V>;
        item.waiters.add(d);
        this.addRefInternal(item, req.now);
        try {
            const v = await (d.promise);
            return new RefHandle<V>(id, item.value!, (_v: V) => {
                this.releaseRefInternal(item);
            });
        }
        catch (e) {
            this.releaseRefInternal(item);
            throw e;
        }
    }

    /**
     * Create a reference handle to pin an item in cache
     */
    reference(key: K, now: number): {ref?: RefHandle<V>, err?:Error} | undefined {
        const kid = this.options.keyToId(key);
        const item = this.cache.get(kid);

        if (!item) {
            ++this.stats.refMisses;
            return undefined;
        }
        if (item.error) {
            ++this.stats.refHits;
            return {err: item.error}; // May not be it, but can't hurt to check
        }
        if (!item.value) {
            ++this.stats.refMisses;
            return {};
        }

        ++this.stats.refHits;
        this.addRefInternal(item, now);

        return {ref: new RefHandle<V>(kid, item.value, (_v: V) => {
            this.releaseRefInternal(item);
        })};
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
                }
                catch (e) {
                }
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
     */
    cleanupAndDispatchRequests(now: number, notRequestedAfter: number): void {
        const toRemove: K[] = [];

        for (const [key, item] of this.cache.entries()) {
            // Don't expire referenced items or active fetches
            if (item.refCount > 0 || this.activeFetches.has(key)) {
                continue;
            }

            // Expire if not requested recently
            if (item.lastPrefetchedAt < notRequestedAfter) {
                toRemove.push(item.key);
                continue;
            }

            // Expire if not useful in the future
            if (item.expiry < now) {
                toRemove.push(item.key);
                continue;
            }
        }

        for (const key of toRemove) {
            this.removeItem(key);
            this.stats.expiredItems++;
        }

        // Also run LRU eviction
        this.evictLRU(now);

        // Dispatch requests
        this.dispatchRequests(now);
    }

    /**
     * Initiate any fetches
     * User must call this after a batch of new information is loaded.
     */
    private dispatchRequests(now: number) {
        // For this, we build 
        const maxConcurrency: number = this.options.maxConcurrency;
        if (this.activeFetches.size >= maxConcurrency) return;

        // Create the pending queue
        const pendingQueue: Array<{ key: K; priority: P }> = [];
        for (const [_k, item] of this.cache) {
            if (item.state === 'queued' && item.expiry > now) {
                pendingQueue.push({ key: item.key, priority: item.priority });
            }
        }
        pendingQueue.sort((a, b) =>
            this.options.priorityComparator(a.priority, b.priority, now)
        );

        while (
            this.activeFetches.size < maxConcurrency &&
            pendingQueue.length > 0
        ) {
            const { key } = pendingQueue.shift()!;

            const id = this.options.keyToId(key);
            if (this.activeFetches.has(id)) continue;

            const item = this.cache.get(id);
            if (!item || item.state !== 'queued') continue;

            this.activeFetches.add(id);
            item.state = 'fetching';
            item.fetchingSince = performance.now();
            const ac = new AbortController();
            item.abort = ac;

            this.fetchItem(item);
        }
    }

    private async evictLRU(now: number): Promise<void> {
        const curUsage = this.currentGaugeStats();
        if (curUsage.totalcost < this.options.budgetLimit) return;

        // There is a tension here between "LRU" and "Going To Use"
        //  Going to use far in the future - we won't do it.  Make it something requested again.
        //    Use priority
        //  Hasn't been used in a while, toss it.
        //  Initial heuristic is divide cache in half

        // Create array of evictable items (not referenced, completed)
        const lruEvictable: Array<CacheItem<K, V, P>> = [];
        const prefetchEvictable: Array<CacheItem<K, V, P>> = [];

        for (const [_key, item] of this.cache.entries()) {
            if (
                item.refCount === 0 &&
                (item.state === 'ready' || item.state === 'error')
            ) {
                lruEvictable.push(item);
            }
            else if (item.state === 'queued' && !this.activeFetches.has(this.options.keyToId(item.key))) {
                prefetchEvictable.push(item);
            }
        }

        // Sort by last requested time (LRU first)
        lruEvictable.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
        // Sort by priority (low first)
        prefetchEvictable.sort((a, b) =>
            -this.options.priorityComparator(a.priority, b.priority, now)
        );

        // First cut
        for (let i=0; i<lruEvictable.length; ++i) {
            if (curUsage.valcost <= this.options.budgetLimit / 2) break;
            const {key} = lruEvictable[i];
            const item = this.cache.get(this.options.keyToId(key));
            if (item) {
                curUsage.valcost -= item.actualCost;
                this.removeItem(key);
                this.stats.evictedItems++;
            }
        }

        for (let i=0; i<prefetchEvictable.length; ++i) {
            if (curUsage.estcost < this.options.budgetLimit / 2) break;
            const {key} = prefetchEvictable[i];
            const item = this.cache.get(this.options.keyToId(key));
            if (item) {
                curUsage.estcost -= item.estCost;
                this.removeItem(key);
                this.stats.evictedItems++;
            }
        }
    }

    private currentGaugeStats() {
        let estcost = 0, valcost = 0;
        let pinned = 0, ready = 0, errored = 0, pending = 0;
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
}
export const needTimePriorityCompare = (a: NeededTimePriority, b: NeededTimePriority, timeOfIrrelevance: number)=>{
    if (a.neededTime >= timeOfIrrelevance && b.neededTime >= timeOfIrrelevance) {
        // Sooner need is higher priority
        return a.neededTime-b.neededTime;
    }
    if (a.neededTime >= timeOfIrrelevance && b.neededTime < timeOfIrrelevance) {
        // Actual need is higher priority
        return -1;
    }
    if (b.neededTime >= timeOfIrrelevance && a.neededTime < timeOfIrrelevance) {
        // Actual need is higher priority
        return 1;
    }
    // LRU
    return b.neededTime-a.neededTime;
}