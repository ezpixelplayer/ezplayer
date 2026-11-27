import { describe, it, expect } from 'vitest';

import { PlaylistRecord, SequenceRecord } from '../src/types/DataTypes';
import { createShuffleList, getSeqTimesMS, seqsToMap, Xoroshiro128Plus } from '../src/util/schedulecomp';

const seq = (id: string, lengthS = 180): SequenceRecord => ({
    id,
    instanceId: id,
    work: { length: lengthS, artist: id, title: id },
    files: { fseq: `f${id}` },
});

const playlist = (id: string, ids: string[]): PlaylistRecord => ({
    title: id,
    createdAt: 0,
    tags: [],
    id,
    items: ids.map((sid, i) => ({ id: sid, sequence: i + 1 })),
});

const PLAYLIST_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SHOW_MS = 4.5 * 3600_000;
const SEED0 = Date.UTC(2026, 10, 26, 23);

/** The algorithm before picks were tracked by position, for playlists without repeats. */
function legacyShuffle(
    plist: PlaylistRecord,
    seed: number,
    minMS: number,
    smap: Map<string, SequenceRecord>,
    maxCount = Infinity,
) {
    const rng = new Xoroshiro128Plus(BigInt(seed).valueOf() + Xoroshiro128Plus.uuidToseed(plist.id));
    for (let i = 0; i < 10; ++i) rng.nextInt(100);
    if (!plist.items.length) return [];
    const ndontuse = Math.floor(plist.items.length / 2);
    const doNotUse = new Set<string>();
    const sellist = plist.items.map((e) => e.id);
    const selections: string[] = [];
    let totalMS = 0;
    while (totalMS < minMS && selections.length < maxCount) {
        while (doNotUse.size > ndontuse) doNotUse.delete(selections[selections.length - doNotUse.size]);
        if (!sellist.length) sellist.push(...plist.items.map((e) => e.id));
        while (true) {
            const pick = rng.nextInt(sellist.length);
            const sid = sellist[pick];
            if (doNotUse.has(sid)) continue;
            doNotUse.add(sid);
            selections.push(sid);
            if (pick < sellist.length - 1) sellist[pick] = sellist.pop()!;
            else sellist.pop();
            const s = smap.get(sid);
            totalMS += s ? getSeqTimesMS(s).totalSeqTimeMS || 1000 : 1000;
            break;
        }
    }
    return selections;
}

describe('createShuffleList', () => {
    it('keeps the existing order for playlists without repeats', () => {
        for (const n of [1, 2, 3, 4, 9, 40]) {
            const ids = Array.from({ length: n }, (_, i) => `s${i}`);
            const pl = playlist(PLAYLIST_ID, ids);
            const smap = seqsToMap(
                ids.map((id, i) => seq(id, 60 + 17 * i)),
                [],
            );
            for (let k = 0; k < 50; ++k) {
                const seed = SEED0 + k * 86400_000;
                expect(createShuffleList(pl, seed, SHOW_MS, smap)).toStrictEqual(
                    legacyShuffle(pl, seed, SHOW_MS, smap),
                );
                expect(createShuffleList(pl, seed, SHOW_MS, smap, n)).toStrictEqual(
                    legacyShuffle(pl, seed, SHOW_MS, smap, n),
                );
            }
        }
    });

    it('finishes for a song listed twice, on every night', () => {
        // 40 entries, one song at positions 5 and 9: the shape that hung a player.
        const ids = Array.from({ length: 39 }, (_, i) => `s${i}`);
        ids.splice(8, 0, ids[4]);
        const pl = playlist(PLAYLIST_ID, ids);
        const smap = seqsToMap(
            ids.slice(0, 39).map((id) => seq(id)),
            [],
        );
        for (let k = 0; k < 400; ++k) {
            const out = createShuffleList(pl, SEED0 + k * 86400_000, SHOW_MS, smap);
            expect(out.length).toBeGreaterThanOrEqual(SHOW_MS / 180_000);
        }
    });

    it('plays a song listed twice about twice as often, never twice in a row', () => {
        const ids = ['a', 'a', 'b', 'c', 'd', 'e'];
        const pl = playlist(PLAYLIST_ID, ids);
        const smap = seqsToMap(
            ['a', 'b', 'c', 'd', 'e'].map((id) => seq(id)),
            [],
        );
        const counts = new Map<string, number>();
        for (let k = 0; k < 200; ++k) {
            const out = createShuffleList(pl, SEED0 + k * 86400_000, SHOW_MS, smap);
            for (let i = 1; i < out.length; ++i) expect(out[i]).not.toBe(out[i - 1]);
            for (const id of out) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        const others = ['b', 'c', 'd', 'e'].map((id) => counts.get(id)!);
        const ratio = counts.get('a')! / (others.reduce((x, y) => x + y) / others.length);
        expect(ratio).toBeGreaterThan(1.8);
        expect(ratio).toBeLessThan(2.2);
    });

    it('plays every entry once when one pass is asked for', () => {
        const ids = ['a', 'a', 'b', 'c', 'a'];
        const pl = playlist(PLAYLIST_ID, ids);
        const smap = seqsToMap(
            ['a', 'b', 'c'].map((id) => seq(id)),
            [],
        );
        for (let k = 0; k < 200; ++k) {
            const out = createShuffleList(pl, SEED0 + k * 86400_000, SHOW_MS, smap, ids.length);
            expect([...out].sort()).toStrictEqual([...ids].sort());
        }
    });

    it('repeats the song when the playlist has nothing else', () => {
        const pl = playlist(PLAYLIST_ID, ['a', 'a', 'a']);
        const out = createShuffleList(pl, SEED0, 10 * 180_000, seqsToMap([seq('a')], []));
        expect(out).toStrictEqual(Array(10).fill('a'));
    });
});
