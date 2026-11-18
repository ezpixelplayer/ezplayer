/**
 * The viewer's copy of the scene: how deltas from the player turn into what
 * is drawn, and when React is told to re-render.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SceneDelta, SceneObjectDelta } from '@ezplayer/ezplayer-core';
import { pollSceneObjects, SceneObjectsStore } from './sceneObjectsStore';

const beam = { type: 'beam', length: 100 } as const;

function entry(key: string, rev: number, extra: Partial<SceneObjectDelta> = {}): SceneObjectDelta {
    return { key, rev, contentRev: rev, view: 'both', placement: {}, appearance: {}, ...extra };
}

function delta(rev: number, keys: string[], objects: SceneObjectDelta[], epoch = 'e1'): SceneDelta {
    return { epoch, rev, keys, objects };
}

describe('SceneObjectsStore', () => {
    it('keeps content across deltas that only move an object', () => {
        const store = new SceneObjectsStore();
        const changed = vi.fn();
        store.subscribe(changed);

        store.apply(delta(1, ['a'], [entry('a', 1, { content: beam, assets: {} })]));
        expect(changed).toHaveBeenCalledTimes(1);
        const before = store.get('a')!;

        store.apply(delta(2, ['a'], [entry('a', 2, { contentRev: 1, placement: { position: [1, 2, 3] } })]));
        const after = store.get('a')!;
        expect(after.content).toBe(before.content);
        expect(after.placement.position).toEqual([1, 2, 3]);
        expect(after).not.toBe(before);
        // Movement is not a structural change.
        expect(changed).toHaveBeenCalledTimes(1);
        expect(store.rev).toBe(2);
    });

    it('tells React when content changes or an object leaves', () => {
        const store = new SceneObjectsStore();
        const changed = vi.fn();
        store.subscribe(changed);
        store.apply(
            delta(
                2,
                ['a', 'b'],
                [entry('a', 1, { content: beam, assets: {} }), entry('b', 2, { content: beam, assets: {} })],
            ),
        );
        const first = store.getStructure();
        expect(first.map((e) => e.key)).toEqual(['a', 'b']);

        store.apply(delta(3, ['a', 'b'], [entry('b', 3, { content: { type: 'beam', length: 5 }, assets: {} })]));
        expect(store.getStructure()).not.toBe(first);
        expect(store.getStructure()[1].contentRev).toBe(3);

        store.apply(delta(4, ['b'], []));
        expect(store.getStructure().map((e) => e.key)).toEqual(['b']);
        expect(store.get('a')).toBeUndefined();
        expect(changed).toHaveBeenCalledTimes(3);
    });

    it('starts over when the player restarts', () => {
        const store = new SceneObjectsStore();
        store.apply(delta(9, ['old'], [entry('old', 9, { content: beam, assets: {} })]));
        store.apply(delta(1, ['new'], [entry('new', 1, { content: beam, assets: {} })], 'e2'));
        expect(store.getStructure().map((e) => e.key)).toEqual(['new']);
        expect(store.epoch).toBe('e2');
    });

    it('asks for everything again when it is sent a move for content it never saw', () => {
        const store = new SceneObjectsStore();
        store.apply(delta(5, ['ghost'], [entry('ghost', 5, { contentRev: 2 })]));
        expect(store.get('ghost')).toBeUndefined();
        expect(store.rev).toBe(0);
    });
});

describe('pollSceneObjects', () => {
    it('sends what it has, applies what comes back, and clears when the player goes away', async () => {
        const store = new SceneObjectsStore();
        const urls: string[] = [];
        let mode: 'first' | 'idle' | 'down' = 'first';
        const fetchFn = (async (url: string) => {
            urls.push(url);
            if (mode === 'down') throw new Error('offline');
            if (mode === 'idle') return new Response(null, { status: 204 });
            mode = 'idle';
            return new Response(JSON.stringify(delta(7, ['a'], [entry('a', 7, { content: beam, assets: {} })])));
        }) as typeof fetch;

        vi.useFakeTimers();
        try {
            const stop = pollSceneObjects('http://player/', store, {
                fetchFn,
                activeMs: 10,
                idleMs: 10,
                isHidden: () => false,
            });
            await vi.advanceTimersByTimeAsync(25);
            expect(urls[0]).toBe('http://player/api/ezp/scene?since=0');
            expect(urls[1]).toBe('http://player/api/ezp/scene?since=7&epoch=e1');
            expect(store.size).toBe(1);

            mode = 'down';
            await vi.advanceTimersByTimeAsync(20_000);
            expect(store.size).toBe(0);

            stop();
            const seen = urls.length;
            await vi.advanceTimersByTimeAsync(120_000);
            expect(urls.length).toBe(seen);
        } finally {
            vi.useRealTimers();
        }
    });
});
