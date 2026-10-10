import { describe, it, expect } from 'vitest';

import { PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '../src/types/DataTypes';
import { PlayerRunState } from '../src/util/schedulecomp';

// The detailed playback view: the engine's stack, what waits, and what comes,
// plus the on-demand song order and stopping one item by key.

const seq = (n: number): SequenceRecord => ({
    id: `${n}`,
    instanceId: `${n}`,
    work: { length: 10, artist: `Artist ${n}`, title: `Song ${n}` },
    files: { fseq: `f${n}` },
});
const songs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(seq);

const pl = (id: string, ids: number[]): PlaylistRecord => ({
    id,
    title: id,
    createdAt: 0,
    tags: [],
    items: ids.map((n, i) => ({ id: `${n}`, sequence: i + 1 })),
});
const plof2 = pl('plof2', [1, 2]);
const plof4 = pl('plof4', [1, 2, 3, 4]);
const plof9 = pl('plof9', [1, 2, 3, 4, 5, 6, 7, 8, 9]);

const scheduleOf2: ScheduledPlaylist = {
    id: 'scheduleOf2',
    title: 'Just2Songs',
    playlistTitle: 'plof2',
    playlistId: 'plof2',
    date: 0,
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0,
};
const parts3: ScheduledPlaylist = {
    id: 'parts3',
    title: 'ThreeParts',
    playlistTitle: 'plof9',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0,
};

function setUp(schedules: ScheduledPlaylist[]) {
    const bdate = new Date(0);
    bdate.setHours(0, 0, 0);
    const bt = bdate.getTime();
    const h = bt + 18 * 3600 * 1000;
    const plr = new PlayerRunState(bt);
    const errs: string[] = [];
    plr.setUpSequences(songs, [plof2, plof4, plof9], schedules, errs);
    expect(errs).toEqual([]);
    return { plr, h };
}

describe('getStatusView', () => {
    it('shows the show that is on, its cursor and what comes next', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);

        const view = plr.getStatusView();
        expect(view.stack).toHaveLength(1);
        const top = view.stack[0];
        expect(top).toMatchObject({
            key: 'scheduleOf2',
            origin: 'Scheduled',
            state: 'playing',
            title: 'Just2Songs',
            schedule_id: 'scheduleOf2',
            playlist_id: 'plof2',
            section: 'main',
            position: { index: 0, count: 2, loop: false },
            song: {
                sequence_id: '1',
                title: 'Song 1 - Artist 1',
                offset_ms: 3_000,
                at: h + 3_000,
                duration_ms: 10_000,
            },
            ends_at: h + 3600_000,
        });
        expect(top.order_key.startsWith('scheduleOf2#')).toBe(true);
        expect(view.pending).toEqual([]);
        expect(view.upcoming[0]).toMatchObject({ sequence_id: '2', at: h + 10_000, schedule_id: 'scheduleOf2' });
    });

    it('reports paused and ending for the top entry only', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);
        expect(plr.getStatusView({ paused: true }).stack[0].state).toBe('paused');
        expect(plr.getStatusView({ ending: true }).stack[0].state).toBe('ending');
        expect(plr.getStatusView({ paused: true, ending: true }).stack[0].state).toBe('paused');
    });

    it('stacks a request on top of the show it interrupted', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);
        plr.addInteractiveCommand({ immediate: true, startTime: h + 3_500, seqId: '4', requestId: 'r1' });
        plr.readOutScheduleUntil(h + 5_000, 100);

        const view = plr.getStatusView();
        expect(view.stack.map((e) => [e.key, e.origin, e.state])).toEqual([
            ['r1', 'Immediate', 'playing'],
            ['scheduleOf2', 'Scheduled', 'suspended'],
        ]);
        expect(view.stack[0]).toMatchObject({
            title: 'Song 4 - Artist 4',
            request_id: 'r1',
            song: { sequence_id: '4', offset_ms: 1_500, at: h + 5_000 },
        });
        expect(view.stack[0].ends_at).toBeUndefined();
        // The show stopped where it was, 3.5s into Song 1, and resumes there.
        expect(view.stack[1].song).toMatchObject({ sequence_id: '1', offset_ms: 3_500, at: h + 3_500 });
        expect(view.upcoming[0]).toMatchObject({ sequence_id: '1', at: h + 13_500 });
    });

    it('lists a queued request as waiting', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);
        plr.addInteractiveCommand({ immediate: false, startTime: h + 4_000, seqId: '5', requestId: 'q1' });

        const view = plr.getStatusView();
        expect(view.pending).toHaveLength(1);
        expect(view.pending[0]).toMatchObject({ why: 'waiting', type: 'Queued', request_id: 'q1', sequence_id: '5' });
    });

    it('names a requested playlist by the playlist and its cursor by the song', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);
        plr.addInteractiveCommand({ immediate: true, startTime: h + 3_500, playlistId: 'plof4', requestId: 'p1' });
        plr.readOutScheduleUntil(h + 15_000, 100); // second song of the request

        const top = plr.getStatusView().stack[0];
        expect(top).toMatchObject({
            title: 'plof4',
            playlist_id: 'plof4',
            request_id: 'p1',
            position: { index: 1, count: 4, loop: false },
            song: { sequence_id: '2', offset_ms: 1_500 },
        });
    });

    it('wraps the cursor of a looping show', () => {
        const { plr, h } = setUp([{ ...scheduleOf2, loop: true }]);
        plr.readOutScheduleUntil(h + 25_000, 100); // third play: Song 1 again

        expect(plr.getStatusView().stack[0]).toMatchObject({
            position: { index: 0, count: 2, loop: true },
            song: { sequence_id: '1', offset_ms: 5_000 },
        });
    });

    it('is empty with nothing on, but still names what comes', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.addTimeRangeToSchedule(h - 3600_000, h + 24 * 3600_000); // the day is loaded, as the player does
        const view = plr.getStatusView();
        expect(view.stack).toEqual([]);
        expect(view.pending).toEqual([]);
        // Songs are predicted ten minutes out; beyond that the show itself is listed.
        expect(view.upcoming[0]).toMatchObject({ item: 'Schedule', schedule_id: 'scheduleOf2', at: h });
    });
});

describe('getItemOrder', () => {
    it('returns the baked sections of a loaded item, keyed to match the view', () => {
        const { plr, h } = setUp([parts3]);
        plr.readOutScheduleUntil(h + 25_000, 100); // into the main section

        const view = plr.getStatusView();
        const order = plr.getItemOrder('parts3');
        expect(order).toBeDefined();
        expect(order!.order_key).toBe(view.stack[0].order_key);
        expect(order!.intro.map((e) => e.sequence_id)).toEqual(['1', '2']);
        expect(order!.main.map((e) => e.sequence_id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
        expect(order!.outro.map((e) => e.sequence_id)).toEqual(['1', '2', '3', '4']);
        expect(order!.main[0]).toEqual({ sequence_id: '1', title: 'Song 1 - Artist 1', duration_ms: 10_000 });
    });

    it('keeps a shuffled order that only the engine knows', () => {
        const { plr, h } = setUp([{ ...parts3, shuffle: true, toTime: '18:03' }]);
        plr.readOutScheduleUntil(h + 25_000, 100);

        const order = plr.getItemOrder('parts3')!;
        expect(order.main.length).toBeGreaterThan(0);
        expect(new Set(order.main.map((e) => e.sequence_id)).size).toBeGreaterThan(1);
        // The cursor indexes into that same list.
        const top = plr.getStatusView().stack[0];
        expect(order.main[top.position!.index].sequence_id).toBe(top.song!.sequence_id);
    });

    it('is undefined for a key the engine does not hold', () => {
        const { plr } = setUp([scheduleOf2]);
        expect(plr.getItemOrder('nothing')).toBeUndefined();
    });
});

describe('stopItem', () => {
    it('stops the request that is on and leaves the queue alone', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);
        plr.addInteractiveCommand({ immediate: true, startTime: h + 3_500, seqId: '4', requestId: 'r1' });
        plr.addInteractiveCommand({ immediate: false, startTime: h + 4_000, seqId: '5', requestId: 'q1' });
        plr.readOutScheduleUntil(h + 5_000, 100);

        expect(plr.stopItem('r1', false, plr.currentTime)).toBe('playing');
        expect(plr.interactiveQueue.map((q) => q.requestId)).toEqual(['q1']);
        // The show resumes 3.5s into Song 1 and finishes it at 11.5s.
        const log = plr.readOutScheduleUntil(h + 12_000, 100);
        const ended = log.find((e) => e.eventType === 'Sequence Ended');
        expect(ended).toMatchObject({ sequenceId: '1', eventTime: h + 11_500 });
    });

    it('drops a suspended show so it does not resume, and keeps it stopped', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);
        plr.addInteractiveCommand({ immediate: true, startTime: h + 3_500, seqId: '4', requestId: 'r1' });
        plr.readOutScheduleUntil(h + 5_000, 100);
        expect(plr.depth).toBe(2);

        expect(plr.stopItem('scheduleOf2', false, plr.currentTime)).toBe('removed');
        expect(plr.getStatusView().stack.map((e) => e.key)).toEqual(['r1']);

        // The request plays out; the show neither resumes nor reloads.
        const log = plr.readOutScheduleUntil(h + 3600_000, 100);
        expect(log.filter((e) => e.eventType === 'Sequence Started').map((e) => e.sequenceId)).toEqual([]);
        expect(plr.depth).toBe(0);
    });

    it('ends the show that is on gracefully when asked', () => {
        const { plr, h } = setUp([parts3]);
        plr.readOutScheduleUntil(h + 25_000, 100); // 5s into main Song 1

        expect(plr.stopItem('parts3', true, plr.currentTime)).toBe('playing');
        const log = plr.readOutScheduleUntil(h + 3600_000, 100);
        const starts = log.filter((e) => e.eventType === 'Sequence Started').map((e) => e.sequenceId);
        expect(starts).toEqual(['1', '2', '3', '4']); // just the outro
    });

    it('removes a waiting request and reports an unknown key', () => {
        const { plr, h } = setUp([scheduleOf2]);
        plr.readOutScheduleUntil(h + 3_000, 100);
        plr.addInteractiveCommand({ immediate: false, startTime: h + 4_000, seqId: '5', requestId: 'q1' });

        expect(plr.stopItem('q1', false, plr.currentTime)).toBe('removed');
        expect(plr.interactiveQueue).toEqual([]);
        expect(plr.stopItem('q1', false, plr.currentTime)).toBe('none');
    });
});
