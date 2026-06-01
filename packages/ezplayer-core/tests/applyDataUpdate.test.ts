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

function baseTime(): number {
    const d = new Date(sched.date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Build a state already mid-playback: 10s into the 18:00 schedule, so seqA is on
 *  the active stack. Returns the run state and the moment it was advanced to. */
function runningState(): PlayerRunState {
    const bt = baseTime();
    const plr = new PlayerRunState(bt);
    const errs: string[] = [];
    plr.setUpSequences([seqA, seqB, seqC], [plAB], [sched], errs);
    expect(errs).toEqual([]);
    plr.addTimeRangeToSchedule(bt, bt + 24 * 3600_000); // load the day's occurrences
    plr.runUntil(bt + 18 * 3600_000 + 10_000); // 10s into the schedule
    expect(plr.depth).toBeGreaterThan(0); // something is actually playing
    return plr;
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

        plr.applyDataUpdate([seqA, seqB, seqC], [plAB], [sched], []);

        expect(plr.stack).toBe(stackBefore); // same array, not rebuilt
        expect(plr.stack[plr.stack.length - 1]).toBe(topBefore); // same entry
    });

    it('preserves the interactive queue, immediate item, and stoppedIds', () => {
        const plr = runningState();
        plr.interactiveQueue.push({ immediate: false, startTime: 0, seqId: 'C', requestId: 'q1' });
        plr.immediateItem = { immediate: true, startTime: 0, seqId: 'C', requestId: 'imm' };
        plr.stoppedIds.set('someSched', 999);

        plr.applyDataUpdate([seqA, seqB, seqC], [plAB], [sched], []);

        expect(plr.interactiveQueue.map((q) => q.requestId)).toEqual(['q1']);
        expect(plr.immediateItem?.requestId).toBe('imm');
        expect(plr.stoppedIds.get('someSched')).toBe(999);
    });

    it('keeps a playing sequence on its captured detail while the master map updates', () => {
        const plr = runningState();
        const editedA: SequenceRecord = { ...seqA, work: { ...seqA.work, length: 999 } };

        plr.applyDataUpdate([editedA, seqB, seqC], [plAB], [sched], []);

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
        plr.applyDataUpdate([seqB, seqC], [plAB], [sched], []);

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

        plr.applyDataUpdate([seqA, seqB, editedC, seqD], [plAB], [sched], []);

        expect(plr.sequencesById.get('C')?.work.length).toBe(42); // updated (not playing)
        expect(plr.sequencesById.has('D')).toBe(true); // newly added song present
    });

    it('pins files of loaded items for GC, even after the sequence is removed upstream', () => {
        const plr = runningState();
        expect(plr.referencedFileCounts().get('a.fseq')).toBeGreaterThanOrEqual(1);

        // seqA deleted upstream, but it is still on the active stack.
        plr.applyDataUpdate([seqB, seqC], [plAB], [sched], []);

        expect(plr.sequencesById.has('A')).toBe(false); // gone from current truth
        expect(plr.referencedFileCounts().get('a.fseq')).toBeGreaterThanOrEqual(1); // still pinned
    });
});
