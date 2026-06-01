import { describe, it, expect } from 'vitest';

import { PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '../src/types/DataTypes';
import { PlayerRunState } from '../src/util/schedulecomp';

// Two sequences that play (A then B), one that is merely present (C), exercised by a
// single one-hour schedule. applyDataUpdate folds new data into a RUNNING state; these
// tests pin the v0 nondisruptive guarantees.

const seqA: SequenceRecord = {
    id: 'A',
    instanceId: 'A',
    work: { length: 100, artist: 'a', title: 'A' },
    files: { fseq: 'a.fseq', audio: 'a.mp3' },
};
const seqB: SequenceRecord = {
    id: 'B',
    instanceId: 'B',
    work: { length: 100, artist: 'b', title: 'B' },
    files: { fseq: 'b.fseq', audio: 'b.mp3' },
};
const seqC: SequenceRecord = { id: 'C', instanceId: 'C', work: { length: 100, artist: 'c', title: 'C' } };

const plAB: PlaylistRecord = {
    id: 'plAB',
    title: 'plAB',
    tags: [],
    createdAt: 0,
    items: [
        { id: 'A', sequence: 1 },
        { id: 'B', sequence: 2 },
    ],
};

const sched: ScheduledPlaylist = {
    id: 'sched',
    scheduleType: 'main',
    title: 'sched',
    playlistId: 'plAB',
    playlistTitle: 'plAB',
    date: 0,
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0,
};

// A second schedule later the same day — future relative to the running state below,
// so it lands in upcoming rather than on the stack.
const sched2: ScheduledPlaylist = {
    id: 'sched2',
    scheduleType: 'main',
    title: 'sched2',
    playlistId: 'plAB',
    playlistTitle: 'plAB',
    date: 0,
    fromTime: '20:00',
    toTime: '21:00',
    duration: 0,
};

function baseTime(): number {
    const d = new Date(sched.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

const DAY = 24 * 3600_000;

/** Build a state already mid-playback: 10s into the 18:00 schedule, so seqA is on
 *  the active stack and any later schedule sits in upcoming. */
function runningStateWith(schedules: ScheduledPlaylist[]): PlayerRunState {
    const bt = baseTime();
    const plr = new PlayerRunState(bt);
    const errs: string[] = [];
    plr.setUpSequences([seqA, seqB, seqC], [plAB], schedules, errs);
    expect(errs).toEqual([]);
    plr.addTimeRangeToSchedule(bt, bt + DAY); // load the day's occurrences
    plr.runUntil(bt + 18 * 3600_000 + 10_000); // 10s into the schedule
    expect(plr.depth).toBeGreaterThan(0); // something is actually playing
    return plr;
}

function runningState(): PlayerRunState {
    return runningStateWith([sched]);
}

/** Reconcile, refilling the rest of the loaded day. */
function apply(plr: PlayerRunState, seqs: SequenceRecord[], pls: PlaylistRecord[], sch: ScheduledPlaylist[]) {
    plr.applyDataUpdate(seqs, pls, sch, [], plr.currentTime, baseTime() + DAY);
}

describe('isPlaying', () => {
    it('is false for an idle state and true for live, immediate, or queued playback', () => {
        const idle = new PlayerRunState(0);
        expect(idle.isPlaying).toBe(false);

        idle.interactiveQueue.push({ immediate: false, startTime: 0, seqId: 'A', requestId: 'q' });
        expect(idle.isPlaying).toBe(true);

        const imm = new PlayerRunState(0);
        imm.immediateItem = { immediate: true, startTime: 0, seqId: 'A', requestId: 'imm' };
        expect(imm.isPlaying).toBe(true);

        expect(runningState().isPlaying).toBe(true); // non-empty stack
    });
});

describe('applyDataUpdate', () => {
    it('leaves the active stack object untouched (no rebuild)', () => {
        const plr = runningState();
        const stackBefore = plr.stack;
        const topBefore = plr.stack[plr.stack.length - 1];

        apply(plr, [seqA, seqB, seqC], [plAB], [sched]);

        expect(plr.stack).toBe(stackBefore); // same array, not rebuilt
        expect(plr.stack[plr.stack.length - 1]).toBe(topBefore); // same entry
    });

    it('preserves the interactive queue, immediate item, and stoppedIds', () => {
        const plr = runningState();
        plr.interactiveQueue.push({ immediate: false, startTime: 0, seqId: 'C', requestId: 'q1' });
        plr.immediateItem = { immediate: true, startTime: 0, seqId: 'C', requestId: 'imm' };
        const stopUntil = baseTime() + 19 * 3600_000; // future, so not pruned by refill
        plr.stoppedIds.set('someSched', stopUntil);

        apply(plr, [seqA, seqB, seqC], [plAB], [sched]);

        expect(plr.interactiveQueue.map((q) => q.requestId)).toEqual(['q1']);
        expect(plr.immediateItem?.requestId).toBe('imm');
        expect(plr.stoppedIds.get('someSched')).toBe(stopUntil);
    });

    it('keeps a playing sequence on its captured detail while the master map updates', () => {
        const plr = runningState();
        const editedA: SequenceRecord = { ...seqA, work: { ...seqA.work, length: 999 } };

        apply(plr, [editedA, seqB, seqC], [plAB], [sched]);

        // The master map is now current truth.
        expect(plr.sequencesById.get('A')?.work.length).toBe(999);
        // The in-flight item keeps the record captured when it started.
        const top = plr.stack[plr.stack.length - 1];
        expect(top.item.mainSection[0]?.work.length).toBe(100);
        // The action handed to the renderer carries that captured record.
        const action = plr.getUpcomingItems(60_000, 24 * 3600_000).curPLActions?.actions?.[0];
        expect(action?.seqId).toBe('A');
        expect(action?.seq?.work.length).toBe(100);
    });

    it('keeps a deleted-while-playing sequence resolvable for the renderer', () => {
        const plr = runningState();

        // seqA omitted entirely from the new data (deleted/disabled upstream).
        apply(plr, [seqB, seqC], [plAB], [sched]);

        // Master map reflects the deletion...
        expect(plr.sequencesById.has('A')).toBe(false);
        // ...but the playing item still resolves it, so playback continues.
        const action = plr.getUpcomingItems(60_000, 24 * 3600_000).curPLActions?.actions?.[0];
        expect(action?.seqId).toBe('A');
        expect(action?.seq?.work.length).toBe(100);
    });

    it('adopts new details for sequences that are not on the active stack', () => {
        const plr = runningState();
        const editedC: SequenceRecord = { ...seqC, work: { ...seqC.work, length: 42 } };
        const seqD: SequenceRecord = { id: 'D', instanceId: 'D', work: { length: 7, artist: 'd', title: 'D' } };

        apply(plr, [seqA, seqB, editedC, seqD], [plAB], [sched]);

        expect(plr.sequencesById.get('C')?.work.length).toBe(42); // updated (not playing)
        expect(plr.sequencesById.has('D')).toBe(true); // newly added song present
    });

    it('pins files of loaded items for GC, even after the sequence is removed upstream', () => {
        const plr = runningState();
        expect(plr.referencedFileCounts().get('a.fseq')).toBeGreaterThanOrEqual(1);

        // seqA deleted upstream, but it is still on the active stack.
        apply(plr, [seqB, seqC], [plAB], [sched]);

        expect(plr.sequencesById.has('A')).toBe(false); // gone from current truth
        expect(plr.referencedFileCounts().get('a.fseq')).toBeGreaterThanOrEqual(1); // still pinned
    });

    it('admits a newly added schedule into the rebuilt upcoming', () => {
        const plr = runningState();
        expect(plr.upcomingById.has('sched2')).toBe(false);

        apply(plr, [seqA, seqB, seqC], [plAB], [sched, sched2]);

        expect(plr.upcomingById.has('sched2')).toBe(true);
    });

    it('drops a deleted future schedule from the rebuilt upcoming', () => {
        const plr = runningStateWith([sched, sched2]);
        expect(plr.upcomingById.has('sched2')).toBe(true);

        apply(plr, [seqA, seqB, seqC], [plAB], [sched]);

        expect(plr.upcomingById.has('sched2')).toBe(false);
    });

    it('rebuilds an upcoming occurrence from the edited playlist', () => {
        const plr = runningStateWith([sched, sched2]);
        expect(plr.upcomingById.get('sched2')?.mainSection.map((s) => s.id)).toEqual(['A', 'B']);

        const plJustA: PlaylistRecord = { ...plAB, items: [{ id: 'A', sequence: 1 }] };
        apply(plr, [seqA, seqB, seqC], [plJustA], [sched, sched2]);

        expect(plr.upcomingById.get('sched2')?.mainSection.map((s) => s.id)).toEqual(['A']);
    });

    it('drops an interactive request whose target no longer exists', () => {
        const plr = runningState();
        plr.interactiveQueue.push({ immediate: false, startTime: 0, seqId: 'B', requestId: 'keep' });
        plr.interactiveQueue.push({ immediate: false, startTime: 0, seqId: 'C', requestId: 'drop' });

        apply(plr, [seqA, seqB], [plAB], [sched]); // seqC removed upstream

        expect(plr.interactiveQueue.map((q) => q.requestId)).toEqual(['keep']);
    });

    it('accepts an end-time change to the active schedule', () => {
        const plr = runningState();
        const top = plr.stack[plr.stack.length - 1];
        expect(top.item.schedEnd).toBe(baseTime() + 19 * 3600_000);

        const extended: ScheduledPlaylist = { ...sched, toTime: '20:00' };
        apply(plr, [seqA, seqB, seqC], [plAB], [extended]);

        expect(top.item.schedEnd).toBe(baseTime() + 20 * 3600_000);
        expect(plr.depth).toBeGreaterThan(0); // still playing
    });

    it('winds down an active schedule that was deleted', () => {
        const plr = runningState();
        const top = plr.stack[plr.stack.length - 1];

        apply(plr, [seqA, seqB, seqC], [plAB], []); // schedule deleted

        expect(top.item.schedEnd).toBeLessThanOrEqual(plr.currentTime);
        plr.runUntil(plr.currentTime + 3600_000); // it ends as the player advances
        expect(plr.depth).toBe(0);
    });

    it('leaves the active schedule frozen when the start time moved', () => {
        const plr = runningState();
        const top = plr.stack[plr.stack.length - 1];

        // Both start and end changed; because the start moved, nothing is accepted.
        const moved: ScheduledPlaylist = { ...sched, fromTime: '17:00', toTime: '20:00' };
        apply(plr, [seqA, seqB, seqC], [plAB], [moved]);

        expect(top.item.schedStart).toBe(baseTime() + 18 * 3600_000); // unchanged
        expect(top.item.schedEnd).toBe(baseTime() + 19 * 3600_000); // unchanged
    });
});
