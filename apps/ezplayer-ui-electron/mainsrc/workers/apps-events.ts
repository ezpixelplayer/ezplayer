import type { AppEvent } from '@ezplayer/ezplayer-core';

/** Oldest events fall off once an instance has this many unread. */
const RING_SIZE = 1000;
/** One sender, unless the app asks for more: a game is many taps a second, so this only stops a runaway page. */
export const DEFAULT_CLIENT_PER_SECOND = 10;
const CLIENT_FORGET_MS = 10 * 60_000;
/** The whole instance, unless the app or the owner says otherwise: ten a second, sustained. */
export const DEFAULT_EVENTS_PER_MINUTE = 600;

interface Waiter {
    since: number;
    resolve: (events: AppEvent[]) => void;
    timer: NodeJS.Timeout;
}

class Bucket {
    tokens: number;
    last = Date.now();
    constructor(
        public burst: number,
        public perSecond: number,
        now = Date.now(),
    ) {
        this.tokens = burst;
        this.last = now;
    }
    take(now = Date.now()): boolean {
        // A clock that went backwards refills nothing rather than going negative.
        this.tokens = Math.min(this.burst, this.tokens + (Math.max(0, now - this.last) / 1000) * this.perSecond);
        this.last = now;
        if (this.tokens < 1) return false;
        this.tokens -= 1;
        return true;
    }
}

/**
 * The ordered event feed of one app instance: bounded ring, long-poll waiters,
 * and two rate limits (whole instance, each sender).
 */
export class AppEventFeed {
    private readonly ring: AppEvent[] = [];
    private nextId = 1;
    private waiters: Waiter[] = [];
    private readonly instanceBucket: Bucket;
    private readonly clientBuckets = new Map<string, Bucket>();
    private lastSweep = Date.now();

    private readonly clientPerSecond: number;

    constructor(eventsPerMinute = DEFAULT_EVENTS_PER_MINUTE, clientPerSecond = DEFAULT_CLIENT_PER_SECOND) {
        const perMinute = Math.max(1, eventsPerMinute);
        // The burst is a sixth of the minute, so a quiet instance can absorb a flurry of taps.
        this.instanceBucket = new Bucket(Math.max(10, Math.ceil(perMinute / 6)), perMinute / 60);
        this.clientPerSecond = Math.max(1, clientPerSecond);
    }

    /** The highest id handed out so far; 0 before any event. */
    get lastId(): number {
        return this.nextId - 1;
    }

    /** Append one event. Returns the event, or the reason it was refused. */
    push(source: string, client: string, data: unknown, now = Date.now()): AppEvent | { refused: string } {
        this.sweep(now);
        let cb = this.clientBuckets.get(client);
        if (!cb) {
            // Three seconds' worth of burst, never less than 30 taps.
            cb = new Bucket(Math.max(30, this.clientPerSecond * 3), this.clientPerSecond, now);
            this.clientBuckets.set(client, cb);
        }
        if (!cb.take(now)) return { refused: 'too many events from this sender' };
        if (!this.instanceBucket.take(now)) return { refused: 'this app is receiving too many events' };
        const ev: AppEvent = { id: this.nextId++, ts: now, source, client, data };
        this.ring.push(ev);
        if (this.ring.length > RING_SIZE) this.ring.shift();
        const woken = this.waiters;
        this.waiters = [];
        for (const w of woken) {
            clearTimeout(w.timer);
            w.resolve(this.after(w.since));
        }
        return ev;
    }

    /** Events with id above `since`, oldest first. */
    after(since: number): AppEvent[] {
        return this.ring.filter((e) => e.id > since);
    }

    /** Resolve at once when something is waiting; otherwise hold up to `waitMs` for the next push. */
    poll(since: number, waitMs: number): Promise<AppEvent[]> {
        const ready = this.after(since);
        if (ready.length > 0 || waitMs <= 0) return Promise.resolve(ready);
        return new Promise((resolve) => {
            const waiter: Waiter = {
                since,
                resolve,
                timer: setTimeout(() => {
                    this.waiters = this.waiters.filter((w) => w !== waiter);
                    resolve([]);
                }, waitMs),
            };
            waiter.timer.unref?.();
            this.waiters.push(waiter);
        });
    }

    /** Let every waiter go, when the instance stops. */
    close(): void {
        for (const w of this.waiters) {
            clearTimeout(w.timer);
            w.resolve([]);
        }
        this.waiters = [];
    }

    private sweep(now: number): void {
        if (now - this.lastSweep < CLIENT_FORGET_MS) return;
        this.lastSweep = now;
        for (const [k, b] of this.clientBuckets) if (now - b.last > CLIENT_FORGET_MS) this.clientBuckets.delete(k);
    }
}
