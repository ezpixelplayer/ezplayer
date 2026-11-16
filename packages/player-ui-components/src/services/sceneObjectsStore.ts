/*
 * Viewer-side copy of the player's injected scene objects.
 *
 * The store lives outside React: the render loop reads objects by key every
 * frame, and React only hears about structural changes (an object arriving,
 * leaving, or getting new content).
 */

import {
    SCENE_FEED_PATH,
    type SceneAssetInfo,
    type SceneContent,
    type SceneDelta,
    type SceneObjectDelta,
    type SceneView,
} from '@ezplayer/ezplayer-core';

export type SceneObjectState = Omit<SceneObjectDelta, 'content' | 'assets'> & {
    content: SceneContent;
    assets: Record<string, SceneAssetInfo>;
};

/** What React renders from: one entry per live object, replaced only on a structural change. */
export interface SceneStructureEntry {
    key: string;
    contentRev: number;
    view: SceneView;
}

const NO_OBJECTS: readonly SceneStructureEntry[] = Object.freeze([]);

export class SceneObjectsStore {
    private objects = new Map<string, SceneObjectState>();
    private structure: readonly SceneStructureEntry[] = NO_OBJECTS;
    private listeners = new Set<() => void>();
    epoch: string | undefined;
    rev = 0;

    get size(): number {
        return this.objects.size;
    }

    /** Latest state of one object; a new object identity each time it changes. */
    get(key: string): SceneObjectState | undefined {
        return this.objects.get(key);
    }

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getStructure = (): readonly SceneStructureEntry[] => this.structure;

    apply(delta: SceneDelta): void {
        if (delta.epoch !== this.epoch) this.objects.clear();
        this.epoch = delta.epoch;
        let complete = true;
        for (const d of delta.objects) {
            const prior = this.objects.get(d.key);
            const content = d.content ?? prior?.content;
            if (!content) {
                // We missed this object's content; ask for everything next time.
                complete = false;
                continue;
            }
            this.objects.set(d.key, { ...d, content, assets: d.assets ?? prior?.assets ?? {} });
        }
        const live = new Set(delta.keys);
        for (const key of [...this.objects.keys()]) if (!live.has(key)) this.objects.delete(key);
        this.rev = complete ? delta.rev : 0;
        this.restructure(delta.keys);
    }

    clear(): void {
        this.objects.clear();
        this.epoch = undefined;
        this.rev = 0;
        this.restructure([]);
    }

    private restructure(order: string[]): void {
        const next: SceneStructureEntry[] = [];
        for (const key of order) {
            const o = this.objects.get(key);
            if (o) next.push({ key, contentRev: o.contentRev, view: o.view });
        }
        const prev = this.structure;
        const same =
            next.length === prev.length &&
            next.every(
                (e, i) => e.key === prev[i].key && e.contentRev === prev[i].contentRev && e.view === prev[i].view,
            );
        if (same) return;
        this.structure = next.length ? next : NO_OBJECTS;
        for (const l of this.listeners) l();
    }
}

export interface ScenePollOptions {
    /** Delay between polls while objects exist. */
    activeMs?: number;
    /** Delay between polls while the scene is empty. */
    idleMs?: number;
    fetchFn?: typeof fetch;
    isHidden?: () => boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Keep `store` in step with the player at `baseUrl`. Returns a stop function. */
export function pollSceneObjects(baseUrl: string, store: SceneObjectsStore, opts: ScenePollOptions = {}): () => void {
    const { activeMs = 100, idleMs = 1000 } = opts;
    const fetchFn = opts.fetchFn ?? fetch;
    const isHidden = opts.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
    const base = baseUrl.replace(/\/+$/, '');
    let stopped = false;

    void (async () => {
        let failures = 0;
        while (!stopped) {
            if (isHidden()) {
                await sleep(idleMs);
                continue;
            }
            let wait: number;
            try {
                const epoch = store.epoch ? `&epoch=${encodeURIComponent(store.epoch)}` : '';
                const res = await fetchFn(`${base}${SCENE_FEED_PATH}?since=${store.rev}${epoch}`);
                if (stopped) return;
                if (res.status === 200) store.apply((await res.json()) as SceneDelta);
                else if (res.status !== 204) throw new Error(`status ${res.status}`);
                failures = 0;
                wait = store.size > 0 ? activeMs : idleMs;
            } catch {
                if (stopped) return;
                // A player without this API, or one that went away: drop what we show and retry slowly.
                if (++failures >= 3) store.clear();
                wait = Math.min(30_000, 2000 * failures);
            }
            await sleep(wait);
        }
    })();

    return () => {
        stopped = true;
    };
}
