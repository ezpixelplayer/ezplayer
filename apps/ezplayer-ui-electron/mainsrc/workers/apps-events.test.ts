import { describe, expect, it } from 'vitest';
import { AppEventFeed } from './apps-events';

describe('AppEventFeed', () => {
    it('numbers events from 1 and replays after a cursor', () => {
        const f = new AppEventFeed(600);
        const a = f.push('lan', 'phone-a', { type: 'left' });
        const b = f.push('lan', 'phone-b', { type: 'right' });
        expect('id' in a && a.id).toBe(1);
        expect('id' in b && b.id).toBe(2);
        expect(f.after(0).map((e) => e.id)).toEqual([1, 2]);
        expect(f.after(1).map((e) => e.id)).toEqual([2]);
        expect(f.after(2)).toEqual([]);
        expect(f.lastId).toBe(2);
    });

    it('resolves a waiting poll when an event arrives', async () => {
        const f = new AppEventFeed(600);
        const waiting = f.poll(0, 5_000);
        f.push('cloud', 'c1', { type: 'start' });
        const got = await waiting;
        expect(got).toHaveLength(1);
        expect(got[0].source).toBe('cloud');
        expect(got[0].client).toBe('c1');
    });

    it('returns at once when events are already waiting, and empty after the wait', async () => {
        const f = new AppEventFeed(600);
        f.push('lan', 'c1', 1);
        expect(await f.poll(0, 5_000)).toHaveLength(1);
        const t0 = Date.now();
        expect(await f.poll(1, 20)).toEqual([]);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(15);
    });

    it('limits one sender to a burst of 30, then ten a second', () => {
        const f = new AppEventFeed(6000);
        const now = 1_000_000;
        const results = Array.from({ length: 35 }, () => f.push('lan', 'same-phone', 1, now));
        expect(results.filter((r) => 'refused' in r)).toHaveLength(5);
        // A second later ten more have refilled.
        const later = Array.from({ length: 11 }, () => f.push('lan', 'same-phone', 1, now + 1_000));
        expect(later.filter((r) => 'refused' in r)).toHaveLength(1);
    });

    it('limits the whole instance to its events per minute', () => {
        // 60 a minute: a burst of 10, then one a second.
        const f = new AppEventFeed(60);
        const now = 1_000_000;
        for (let i = 0; i < 10; i++) expect('refused' in f.push('lan', `p${i}`, 1, now)).toBe(false);
        const r = f.push('lan', 'p-extra', 1, now);
        expect('refused' in r && r.refused).toMatch(/too many events/);
        // Two seconds later the minute budget has two more.
        expect('refused' in f.push('lan', 'p-extra', 1, now + 2_000)).toBe(false);
        expect('refused' in f.push('lan', 'p-extra', 1, now + 2_000)).toBe(false);
        expect('refused' in f.push('lan', 'p-extra', 1, now + 2_000)).toBe(true);
    });

    it('close lets waiters go with nothing', async () => {
        const f = new AppEventFeed(600);
        const waiting = f.poll(0, 60_000);
        f.close();
        expect(await waiting).toEqual([]);
    });
});
