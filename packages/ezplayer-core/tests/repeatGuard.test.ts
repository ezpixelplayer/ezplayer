import { describe, it, expect } from 'vitest';

import { PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '../src/types/DataTypes';
import { PlayerRunState, RepeatGuard } from '../src/util/schedulecomp';

const seq = (id: string): SequenceRecord => ({
    id,
    instanceId: id,
    work: { length: 10, artist: id, title: id },
    files: { fseq: `f${id}` },
});
const all9 = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(seq);

const playlist = (id: string, n: number): PlaylistRecord => ({
    title: id,
    createdAt: Date.now(),
    tags: [],
    id,
    items: all9.slice(0, n).map((s, i) => ({ id: s.id, sequence: i + 1 })),
});
const plof9 = playlist('plof9', 9);
const plof2 = playlist('plof2', 2);

const schedule = (playlistId: string): ScheduledPlaylist => ({
    id: `sched-${playlistId}`,
    title: playlistId,
    playlistTitle: playlistId,
    playlistId,
    date: 0,
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0,
});

const bdate = new Date(0);
bdate.setHours(0, 0, 0);
const showStart = bdate.getTime() + 18 * 3600 * 1000;

/** Runs `pl` from 18:00 with a request for `requestId` during the first song, and
 *  returns the songs started, in order. */
function startsWithRequest(pl: PlaylistRecord, spacing: number, requestId: string, until = 60_000): string[] {
    const errs: string[] = [];
    const plr = new PlayerRunState(bdate.getTime());
    plr.setUpSequences(all9, [pl], [schedule(pl.id)], errs);
    expect(errs).toEqual([]);
    plr.repeatGuard.spacing = spacing;
    const pre = plr.readOutScheduleUntil(showStart + 5_000, 100);
    plr.addInteractiveCommand({ immediate: false, startTime: showStart + 6_000, seqId: requestId, requestId: 'req' });
    const logs = [...pre, ...plr.readOutScheduleUntil(showStart + until, 200)];
    return logs.filter((l) => l.eventType === 'Sequence Started').map((l) => l.sequenceId!);
}

describe('RepeatGuard', () => {
    it('counts songs since a start', () => {
        const g = new RepeatGuard();
        g.noteStart('a', false);
        g.noteStart('b', false);
        g.noteStart('c', false);
        expect(g.songsSince('c')).toBe(0);
        expect(g.songsSince('a')).toBe(2);
        expect(g.songsSince('z')).toBeUndefined();
    });

    it('holds the playlist spacing to 40% of its distinct songs', () => {
        const g = new RepeatGuard();
        g.spacing = 10;
        g.noteStart('a', false);
        g.noteStart('b', false);
        g.noteStart('c', false);
        // 9 songs -> 3: 'a' (2 since) is skipped
        expect(g.playlistShouldSkip('a', 9)).toBe(true);
        // 5 songs -> 2: 'a' (2 since) may play
        expect(g.playlistShouldSkip('a', 5)).toBe(false);
        expect(g.playlistShouldSkip('b', 5)).toBe(true);
        // 2 songs -> 0: never skip
        expect(g.playlistShouldSkip('c', 2)).toBe(false);
    });

    it('lets a scheduled repeat of a scheduled start through', () => {
        const g = new RepeatGuard();
        g.spacing = 3;
        g.noteStart('a', true);
        g.noteStart('b', false);
        g.noteStart('a', false);
        g.noteStart('c', true);
        // 'c' last started from a schedule; 'a' last from a request.
        expect(g.playlistShouldSkip('c', 9)).toBe(false);
        expect(g.playlistShouldSkip('a', 9)).toBe(true);
    });
});

describe('playlist repeat skip', () => {
    it('passes over a song a request just played', () => {
        // 1, request 3, then the playlist resumes at 2 and would play 3 one song later.
        expect(startsWithRequest(plof9, 3, '3')).toEqual(['1', '3', '2', '4', '5', '6']);
    });

    it('plays the song again when the guard is off', () => {
        expect(startsWithRequest(plof9, 0, '3')).toEqual(['1', '3', '2', '3', '4', '5']);
    });

    it('lets the song play once enough others have started', () => {
        // Spacing 1: one other song (2) has started since 3, so 3 plays.
        expect(startsWithRequest(plof9, 1, '3')).toEqual(['1', '3', '2', '3', '4', '5']);
    });

    it('never skips in a playlist too short for the spacing', () => {
        expect(startsWithRequest(plof2, 5, '2', 40_000)).toEqual(['1', '2', '2']);
    });

    it('keeps a repeat the playlist itself lists', () => {
        const repeats: PlaylistRecord = {
            ...plof9,
            id: 'repeats',
            title: 'repeats',
            items: ['1', '2', '1', '3', '4', '5', '6', '7', '8'].map((id, i) => ({ id, sequence: i + 1 })),
        };
        expect(startsWithRequest(repeats, 3, '9')).toEqual(['1', '9', '2', '1', '3', '4']);
    });

    it('predicts the skip without touching the live history', () => {
        const errs: string[] = [];
        const plr = new PlayerRunState(bdate.getTime());
        plr.setUpSequences(all9, [plof9], [schedule(plof9.id)], errs);
        plr.repeatGuard.spacing = 3;
        plr.readOutScheduleUntil(showStart + 5_000, 100);
        plr.addInteractiveCommand({ immediate: false, startTime: showStart + 6_000, seqId: '3', requestId: 'req' });
        const before = [...plr.repeatGuard.recent];
        const predicted = plr.predictUpcoming(60_000, 4).map((p) => p.sequence_id);
        expect(predicted).toEqual(['3', '2', '4', '5']);
        expect(plr.repeatGuard.recent).toEqual(before);
    });
});
