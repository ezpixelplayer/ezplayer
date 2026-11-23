import { describe, it, expect } from 'vitest';

// Schedule extensions: a single sequence as intro / outro, "start every" spacing of a
// looped playlist, and interstitials between songs.

import { PlaylistRecord, ScheduledPlaylist, ScheduleEndPolicy, SequenceRecord } from '../src/types/DataTypes';
import { getNextStartEverySlot, getStartEveryMS, PlaybackLogDetail, PlayerRunState } from '../src/util/schedulecomp';

const SEC = 1000;
const MIN = 60 * SEC;

function seq(id: string, lengthSec: number = 10): SequenceRecord {
    return { id, instanceId: id, work: { length: lengthSec, artist: id, title: id }, files: { fseq: `f${id}` } };
}

function pl(id: string, ids: string[]): PlaylistRecord {
    return { id, title: id, tags: [], createdAt: 0, items: ids.map((s, i) => ({ id: s, sequence: i + 1 })) };
}

function sched(over: Partial<ScheduledPlaylist>): ScheduledPlaylist {
    return {
        id: 'show',
        title: 'show',
        playlistTitle: '',
        playlistId: 'p3',
        date: 0,
        fromTime: '18:00',
        toTime: '18:05',
        duration: 0,
        ...over,
    };
}

// Songs a..i are 10 s; I and J are short interstitials; X, Y bracket as intro / outro; L is long.
const seqs = [
    ...'abcdefghi'.split('').map((id) => seq(id, 10)),
    seq('I', 4),
    seq('J', 3),
    seq('X', 5),
    seq('Y', 6),
    seq('L', 30),
];
const pls = [
    pl('p1', ['a']),
    pl('p2', ['a', 'b']),
    pl('p3', ['a', 'b', 'c']),
    pl('p6', ['a', 'b', 'c', 'd', 'e', 'f']),
    pl('p9', 'abcdefghi'.split('')),
    pl('amb', ['g', 'h']),
    pl('pIJ', ['I', 'J']),
    pl('pXY', ['X', 'Y']),
];

const bdate = new Date(0);
bdate.setHours(0, 0, 0, 0);
const bt = bdate.getTime();
/** 18:00, where the schedules here start. */
const h = bt + 18 * 3600 * SEC;

function setup(schedules: ScheduledPlaylist[], at: number = bt) {
    const errs: string[] = [];
    const plr = new PlayerRunState(at);
    plr.setUpSequences(seqs, pls, schedules, errs);
    expect(errs).toEqual([]);
    return plr;
}

function run(schedules: ScheduledPlaylist[], until: number = h + 10 * MIN, at: number = bt) {
    return setup(schedules, at).readOutScheduleUntil(until, 100000);
}

interface Play {
    id: string;
    /** ms after 18:00 */
    at: number;
    part: number;
    inter: boolean;
    sched?: string;
}

function plays(log: PlaybackLogDetail[], schedId?: string): Play[] {
    return log
        .filter((e) => e.eventType === 'Sequence Started' && (!schedId || e.scheduleId === schedId))
        .map((e) => ({
            id: e.sequenceId!,
            at: e.eventTime - h,
            part: e.entryIntoPlaylist![0],
            inter: !!e.interstitial,
            sched: e.scheduleId,
        }));
}

const order = (log: PlaybackLogDetail[], schedId?: string) =>
    plays(log, schedId)
        .map((p) => p.id)
        .join('');

const startsOf = (log: PlaybackLogDetail[], schedId: string = 'show') =>
    log.filter((e) => e.eventType === 'Schedule Started' && e.scheduleId === schedId).map((e) => e.eventTime - h);

const lastTime = (log: PlaybackLogDetail[]) => log[log.length - 1].eventTime - h;

function text(log: PlaybackLogDetail[]) {
    return log
        .map(
            (e) =>
                // Only a sequence's start or resume has a position that does not depend on
                // how far the advance before it happened to reach.
                // Likewise whether an item that ran out is logged as ended or stopped.
                `${e.eventType.replace('Schedule Stopped', 'Schedule Ended')}:${e.stackDepth}@${e.eventTime - h}(${/Sequence (Started|Resumed)/.test(e.eventType) ? `${e.entryIntoPlaylist?.join(',')}@${e.timeIntoSeqMS}` : ''})${e.scheduleId ?? e.requestId}.${(e.eventType.startsWith('Sequence') && e.sequenceId) || '-'}${e.interstitial ? '*' : ''}`,
        )
        .join('\n');
}

describe('sequence as intro / outro', () => {
    it('plays a single sequence before and after the playlist', () => {
        const log = run([sched({ preSequenceId: 'X', postSequenceId: 'Y' })]);
        expect(plays(log).map((p) => `${p.id}${p.part}@${p.at / SEC}`)).toEqual([
            'X0@0',
            'a1@5',
            'b1@15',
            'c1@25',
            'Y2@35',
        ]);
        expect(lastTime(log)).toBe(41 * SEC);
        expect(log[log.length - 1].eventType).toBe('Schedule Ended');
    });

    it('prefers the playlist when both are given', () => {
        const log = run([
            sched({ prePlaylistId: 'p2', preSequenceId: 'X', postPlaylistId: 'pXY', postSequenceId: 'I' }),
        ]);
        expect(order(log)).toBe('ababcXY');
    });

    it('ignores a sequence that is not in the library', () => {
        const log = run([sched({ preSequenceId: 'nope', postSequenceId: 'gone' })]);
        expect(order(log)).toBe('abc');
    });

    it('mixes a playlist intro with a sequence outro', () => {
        const log = run([sched({ prePlaylistId: 'pXY', postSequenceId: 'I' })]);
        expect(order(log)).toBe('XYabcI');
    });

    it('leaves room for a sequence outro at the end of a loop', () => {
        // 18:00–18:01 looping 10 s songs with a 6 s outro: the last song that fits ends at :50.
        const log = run([sched({ toTime: '18:01', loop: true, postSequenceId: 'Y', endPolicy: 'seqboundearly' })]);
        expect(order(log)).toBe('abcabY');
        expect(lastTime(log)).toBe(56 * SEC);
    });

    it('cuts a song for a sequence outro under hard cut', () => {
        const log = run([sched({ toTime: '18:01', loop: true, postSequenceId: 'Y', endPolicy: 'hardcut' })]);
        expect(order(log)).toBe('abcabcY');
        const y = plays(log).find((p) => p.id === 'Y')!;
        expect(y.at).toBe(54 * SEC);
        expect(lastTime(log)).toBe(60 * SEC);
    });

    it('reports the sequences as the baked intro / outro', () => {
        const plr = setup([sched({ preSequenceId: 'X', postSequenceId: 'Y' })]);
        plr.readOutScheduleUntil(h + SEC, 1000);
        const o = plr.getItemOrder('show')!;
        expect(o.intro.map((s) => s.sequence_id)).toEqual(['X']);
        expect(o.outro.map((s) => s.sequence_id)).toEqual(['Y']);
        expect(plr.getStatusView().stack[0].section).toBe('intro');
    });
});

describe('start every', () => {
    it('computes slots from the schedule start', () => {
        const s = sched({ loop: true, startEveryMinutes: 2 });
        expect(getStartEveryMS(s)).toBe(2 * MIN);
        expect(getStartEveryMS(sched({}))).toBe(0);
        expect(getStartEveryMS(sched({ startEveryMinutes: 0 }))).toBe(0);
        expect(getStartEveryMS(sched({ startEveryMinutes: -5 }))).toBe(0);
        expect(getStartEveryMS(sched({ startEveryMinutes: NaN }))).toBe(0);
        expect(getNextStartEverySlot(s, h - MIN)).toBe(h);
        expect(getNextStartEverySlot(s, h)).toBe(h);
        expect(getNextStartEverySlot(s, h + 1)).toBe(h + 2 * MIN);
        expect(getNextStartEverySlot(s, h + 2 * MIN)).toBe(h + 2 * MIN);
        expect(getNextStartEverySlot(s, h + 4 * MIN)).toBe(h + 4 * MIN);
        // 18:05 is the end, and 18:06 is past it
        expect(getNextStartEverySlot(s, h + 4 * MIN + 1)).toBeUndefined();
        expect(getNextStartEverySlot(sched({}), h)).toBeUndefined();
    });

    it('leaves a gap between passes', () => {
        const log = run([sched({ loop: true, startEveryMinutes: 1 })]);
        expect(startsOf(log)).toEqual([0, 1, 2, 3, 4].map((m) => m * MIN));
        expect(order(log)).toBe('abc'.repeat(5));
        expect(plays(log).map((p) => p.at)).toEqual(
            [0, 1, 2, 3, 4].flatMap((m) => [0, 10, 20].map((s) => m * MIN + s * SEC)),
        );
        expect(log.filter((e) => e.eventType === 'Schedule Ended').map((e) => e.eventTime - h)).toEqual(
            [0, 1, 2, 3, 4].map((m) => m * MIN + 30 * SEC),
        );
    });

    it('plays the intro and outro at every start', () => {
        const log = run([sched({ loop: true, startEveryMinutes: 2, preSequenceId: 'X', postSequenceId: 'Y' })]);
        expect(startsOf(log)).toEqual([0, 2 * MIN, 4 * MIN]);
        expect(order(log)).toBe('XabcY'.repeat(3));
    });

    it('skips a start that comes due during a pass', () => {
        // 90 s of songs every minute: the :01 and :03 starts are passed over.
        const log = run([sched({ playlistId: 'p9', loop: true, startEveryMinutes: 1 })]);
        expect(startsOf(log)).toEqual([0, 2 * MIN, 4 * MIN]);
        expect(order(log)).toBe('abcdefghi'.repeat(2) + 'abcdef');
    });

    it('runs back to back when the playlist exactly fills the spacing', () => {
        const log = run([sched({ playlistId: 'p6', loop: true, startEveryMinutes: 1 })]);
        expect(startsOf(log)).toEqual([0, 1, 2, 3, 4].map((m) => m * MIN));
        expect(plays(log).map((p) => p.at)).toEqual(Array.from({ length: 30 }, (_v, i) => i * 10 * SEC));
    });

    it('has no start at the schedule end, and the end policy closes the last pass', () => {
        // 18:00–18:02:15, 30 s every minute: the :02 pass has 15 s.
        const early = run([
            sched({ toTime: '18:02:15', loop: true, startEveryMinutes: 1, endPolicy: 'seqboundearly' }),
        ]);
        expect(startsOf(early)).toEqual([0, MIN, 2 * MIN]);
        expect(order(early)).toBe('abcabca');
        expect(lastTime(early)).toBe(2 * MIN + 10 * SEC);

        const cut = run([sched({ toTime: '18:02:15', loop: true, startEveryMinutes: 1, endPolicy: 'hardcut' })]);
        expect(order(cut)).toBe('abcabcab');
        expect(lastTime(cut)).toBe(2 * MIN + 15 * SEC);

        const exact = run([sched({ toTime: '18:02', loop: true, startEveryMinutes: 1 })]);
        expect(startsOf(exact)).toEqual([0, MIN]);
    });

    it('waits for the next start when loaded part way through', () => {
        const s = [sched({ loop: true, startEveryMinutes: 2 })];
        // During what would have been the first pass
        expect(startsOf(run(s, h + 10 * MIN, h + 5 * SEC))).toEqual([2 * MIN, 4 * MIN]);
        // In a gap
        expect(startsOf(run(s, h + 10 * MIN, h + MIN))).toEqual([2 * MIN, 4 * MIN]);
        // Exactly on a start
        expect(startsOf(run(s, h + 10 * MIN, h + 2 * MIN))).toEqual([2 * MIN, 4 * MIN]);
        // After the last start
        expect(startsOf(run(s, h + 10 * MIN, h + 4 * MIN + 1))).toEqual([]);
    });

    it('shuffles each pass on its own, every song once', () => {
        const log = run([sched({ playlistId: 'p9', shuffle: true, loop: true, startEveryMinutes: 2 })]);
        expect(startsOf(log)).toEqual([0, 2 * MIN, 4 * MIN]);
        const o = order(log);
        expect(o.length).toBe(9 + 9 + 6);
        const passes = [o.slice(0, 9), o.slice(9, 18)];
        for (const p of passes) expect(p.split('').sort().join('')).toBe('abcdefghi');
        expect(passes[0]).not.toBe(passes[1]);
    });

    it('lets a lower schedule fill the gaps', () => {
        const amb = sched({ id: 'amb', playlistId: 'amb', loop: true, priority: 'low' });
        const show = sched({ playlistId: 'p2', loop: true, startEveryMinutes: 1, priority: 'high' });
        const log = run([amb, show]);
        expect(startsOf(log)).toEqual([0, 1, 2, 3, 4].map((m) => m * MIN));
        // Every 10 s slot of the five minutes plays something, the show for the first 20 s of each minute.
        const p = plays(log).filter((x) => x.at < 5 * MIN);
        const resumed = log.filter((e) => e.eventType === 'Sequence Resumed');
        expect(resumed).toEqual([]);
        expect(p.map((x) => x.at)).toEqual(Array.from({ length: 30 }, (_v, i) => i * 10 * SEC));
        for (const x of p) expect(x.sched).toBe(x.at % MIN < 20 * SEC ? 'show' : 'amb');
        // The ambient list carries on where it left off
        expect(order(log, 'amb').startsWith('ghgh')).toBe(true);
    });

    it('takes over from an equal-priority schedule at a song boundary and hands back', () => {
        const amb = sched({ id: 'amb', playlistId: 'p1', loop: true, fromTime: '17:59:55' });
        const show = sched({ playlistId: 'p2', loop: true, startEveryMinutes: 1 });
        const log = run([amb, show], h + 2 * MIN);
        // The ambient song runs :55–:05, so the show starts 5 s late and the next pass is on time.
        expect(startsOf(log)).toEqual([5 * SEC, 65 * SEC]);
        const deferred = log.filter((e) => e.eventType === 'Schedule Deferred');
        expect(deferred.length).toBe(0);
    });

    it('starts late after an interruption and returns to the grid', () => {
        const plr = setup([sched({ playlistId: 'p2', loop: true, startEveryMinutes: 1 })]);
        const log = plr.readOutScheduleUntil(h + 55 * SEC, 1000);
        plr.addInteractiveCommand({ immediate: true, startTime: h + 55 * SEC, seqId: 'L', requestId: 'req' });
        log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
        // L holds 0:55–1:25, the 1:00 start waits for it, and 2:00 onward are on time.
        expect(startsOf(log)).toEqual([0, 85 * SEC, 2 * MIN, 3 * MIN, 4 * MIN]);
        expect(log.some((e) => e.eventType === 'Schedule Deferred' && e.eventTime === h + MIN)).toBe(true);
    });

    it('skips starts that an interruption runs through', () => {
        const plr = setup([sched({ playlistId: 'p2', loop: true, startEveryMinutes: 0.25 })]);
        const log = plr.readOutScheduleUntil(h + 5 * SEC, 1000);
        // Interrupts the pass mid-song; the pass resumes at 0:35 with 5 s + 10 s to go.
        plr.addInteractiveCommand({ immediate: true, startTime: h + 5 * SEC, seqId: 'L', requestId: 'req' });
        log.push(...plr.readOutScheduleUntil(h + 80 * SEC, 1000));
        // 0:15, 0:30 and 0:45 fall inside the interrupted pass, which ends at 0:50;
        // 1:15 falls inside the pass that starts at 1:00.
        expect(startsOf(log)).toEqual([0, 60 * SEC]);
        expect(log.filter((e) => e.eventType === 'Schedule Resumed').map((e) => e.eventTime - h)).toEqual([35 * SEC]);
    });

    it('stays stopped once stopped by hand', () => {
        for (const graceful of [false, true]) {
            const plr = setup([sched({ loop: true, startEveryMinutes: 1, postSequenceId: 'Y' })]);
            const log = plr.readOutScheduleUntil(h + MIN + 5 * SEC, 1000);
            expect(plr.stopItem('show', graceful, h + MIN + 5 * SEC, log)).toBe('playing');
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0, MIN]);
            // Graceful: the song in progress finishes, then the outro.
            expect(lastTime(log)).toBe(graceful ? MIN + 16 * SEC : MIN + 5 * SEC);
            // More of the schedule window being loaded does not bring it back
            plr.addTimeRangeToSchedule(h, h + 10 * MIN);
            expect(plr.getUpcomingSchedules()).toEqual([]);
        }
    });

    it('a stop between passes finds nothing on, and the next start stands', () => {
        const plr = setup([sched({ loop: true, startEveryMinutes: 1 })]);
        const log = plr.readOutScheduleUntil(h + 45 * SEC, 1000);
        expect(plr.getUpcomingSchedules().map((u) => u.at)).toEqual([h + MIN]);
        // Nothing is on, so there is nothing for a stop to find; the next start stands.
        expect(plr.stopItem('show', false, h + 45 * SEC, log)).toBe('none');
        log.push(...plr.readOutScheduleUntil(h + 2 * MIN - 1, 1000));
        expect(startsOf(log)).toEqual([0, MIN]);
    });

    it('shows the next start as upcoming, and the pass as ending at the schedule end', () => {
        const plr = setup([sched({ loop: true, startEveryMinutes: 2 })]);
        expect(plr.getUpcomingSchedules().map((u) => u.at)).toEqual([]);
        plr.addTimeRangeToSchedule(bt, h + 10 * MIN);
        expect(plr.getUpcomingSchedules().map((u) => u.at)).toEqual([h]);
        plr.runUntil(h + 5 * SEC);
        expect(plr.getStatusView().stack[0].ends_at).toBe(h + 5 * MIN);
        expect(plr.getUpcomingSchedules()).toEqual([]);
        plr.runUntil(h + 45 * SEC);
        expect(plr.isPlaying).toBe(false);
        expect(plr.getUpcomingSchedules().map((u) => [u.at, u.until])).toEqual([[h + 2 * MIN, h + 5 * MIN]]);
    });

    it('predicting ahead does not disturb the passes', () => {
        const s = [sched({ loop: true, startEveryMinutes: 1, preSequenceId: 'X' })];
        const plain = run(s);
        const plr = setup(s);
        plr.addTimeRangeToSchedule(bt, h + 10 * MIN);
        const log: PlaybackLogDetail[] = [];
        for (let t = h - 10 * SEC; t <= h + 10 * MIN; t += 7 * SEC) {
            plr.runUntil(t, undefined, log);
            const up = plr.predictUpcoming(3 * MIN, 20);
            if (t > h && t < h + 3 * MIN) expect(up.length).toBeGreaterThan(3);
            plr.getUpcomingItems(2 * SEC, 25 * 3600 * SEC);
        }
        expect(text(log)).toBe(text(plain));
    });

    it('a played-by-hand start-every schedule runs one pass', () => {
        const plr = setup([sched({ loop: true, startEveryMinutes: 1, fromTime: '20:00', toTime: '21:00' })]);
        plr.addInteractiveCommand({ immediate: true, startTime: h, scheduleId: 'show', requestId: 'req' });
        const log = plr.readOutScheduleUntil(h + 10 * MIN, 1000);
        expect(order(log)).toBe('abc');
    });

    describe('edits', () => {
        const base = sched({ loop: true, startEveryMinutes: 2 });
        const update = (plr: PlayerRunState, schedules: ScheduledPlaylist[], at: number) => {
            const errs: string[] = [];
            plr.applyDataUpdate(seqs, pls, schedules, errs, at, h + 10 * MIN);
            expect(errs).toEqual([]);
        };

        it('an unrelated update in a gap adds no start', () => {
            const plr = setup([base]);
            const log = plr.readOutScheduleUntil(h + MIN, 1000);
            update(plr, [{ ...base, title: 'renamed' }], h + MIN);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0, 2 * MIN, 4 * MIN]);
        });

        it('an unrelated update during a pass neither restarts it nor adds a start', () => {
            const plr = setup([base]);
            const log = plr.readOutScheduleUntil(h + 15 * SEC, 1000);
            update(plr, [{ ...base, title: 'renamed' }], h + 15 * SEC);
            expect(plr.getUpcomingSchedules()).toEqual([]);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0, 2 * MIN, 4 * MIN]);
            expect(order(log)).toBe('abcabcabc');
        });

        it('a new spacing applies from the next start, in a gap', () => {
            const plr = setup([base]);
            const log = plr.readOutScheduleUntil(h + 40 * SEC, 1000);
            update(plr, [{ ...base, startEveryMinutes: 1.5 }], h + 40 * SEC);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0, 90 * SEC, 180 * SEC, 270 * SEC]);
        });

        it('a new spacing and playlist apply from the next start, during a pass', () => {
            const plr = setup([base]);
            const log = plr.readOutScheduleUntil(h + 15 * SEC, 1000);
            update(plr, [{ ...base, startEveryMinutes: 1, playlistId: 'p2' }], h + 15 * SEC);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0, 1, 2, 3, 4].map((m) => m * MIN));
            expect(order(log)).toBe('abc' + 'ab'.repeat(4));
        });

        it('an earlier end is accepted by the running pass and bounds later starts', () => {
            const plr = setup([{ ...base, endPolicy: 'hardcut' }]);
            const log = plr.readOutScheduleUntil(h + 2 * MIN + 5 * SEC, 1000);
            update(plr, [{ ...base, endPolicy: 'hardcut', toTime: '18:02:15' }], h + 2 * MIN + 5 * SEC);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0, 2 * MIN]);
            expect(lastTime(log)).toBe(2 * MIN + 15 * SEC);
        });

        it('deleting the schedule in a gap ends the starts', () => {
            const plr = setup([base]);
            const log = plr.readOutScheduleUntil(h + MIN, 1000);
            update(plr, [], h + MIN);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0]);
        });

        it('deleting the schedule during a pass winds it down with no further start', () => {
            const plr = setup([base]);
            const log = plr.readOutScheduleUntil(h + 15 * SEC, 1000);
            update(plr, [], h + 15 * SEC);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0]);
            expect(order(log)).toBe('ab');
        });

        it('turning start-every off during a pass lets the pass finish and stops there', () => {
            const plr = setup([base]);
            const log = plr.readOutScheduleUntil(h + 15 * SEC, 1000);
            update(plr, [{ ...base, startEveryMinutes: undefined }], h + 15 * SEC);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            expect(startsOf(log)).toEqual([0]);
            expect(order(log)).toBe('abc');
        });

        it('turning start-every on for a running loop applies when the loop is next loaded', () => {
            const loop = sched({ loop: true, toTime: '18:01' });
            const plr = setup([loop]);
            const log = plr.readOutScheduleUntil(h + 15 * SEC, 1000);
            update(plr, [{ ...loop, startEveryMinutes: 2 }], h + 15 * SEC);
            log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
            // The running item stays the loop it was
            expect(startsOf(log)).toEqual([0]);
            expect(order(log)).toBe('abcabc');
        });
    });
});

describe('interstitial', () => {
    it('plays every N songs, first after N by default', () => {
        const log = run([sched({ playlistId: 'p9', interstitialSequenceId: 'I', interstitialEvery: 3 })]);
        expect(order(log)).toBe('abcIdefIghi');
        expect(
            plays(log)
                .filter((p) => p.inter)
                .map((p) => p.id),
        ).toEqual(['I', 'I']);
        expect(plays(log).every((p) => p.part === 1)).toBe(true);
        // The interstitial's end is flagged like its start
        expect(log.filter((e) => e.interstitial).map((e) => e.eventType)).toEqual([
            'Sequence Started',
            'Sequence Ended',
            'Sequence Started',
            'Sequence Ended',
        ]);
    });

    it('takes an offset for the first one', () => {
        const base = { playlistId: 'p9', interstitialSequenceId: 'I', interstitialEvery: 3 };
        expect(order(run([sched({ ...base, interstitialFirstAfter: 1 })]))).toBe('aIbcdIefgIhi');
        expect(order(run([sched({ ...base, interstitialFirstAfter: 2 })]))).toBe('abIcdeIfghIi');
        expect(order(run([sched({ ...base, interstitialFirstAfter: 0 })]))).toBe('IabcIdefIghi');
        expect(order(run([sched({ ...base, interstitialFirstAfter: 5 })]))).toBe('abcdeIfghIi');
        expect(order(run([sched({ ...base, interstitialFirstAfter: 20 })]))).toBe('abcdefghi');
    });

    it('never follows the last song of a single pass', () => {
        expect(order(run([sched({ interstitialSequenceId: 'I', interstitialEvery: 3 })]))).toBe('abc');
        expect(order(run([sched({ interstitialSequenceId: 'I', interstitialEvery: 1 })]))).toBe('aIbIc');
    });

    it('plays a whole playlist as the interstitial', () => {
        const log = run([sched({ playlistId: 'p6', interstitialPlaylistId: 'pIJ', interstitialEvery: 2 })]);
        expect(order(log)).toBe('abIJcdIJef');
        expect(plays(log).map((p) => p.at / SEC)).toEqual([0, 10, 20, 24, 27, 37, 47, 51, 54, 64]);
    });

    it('prefers the playlist when both are given, and is off without a count', () => {
        const both = sched({
            playlistId: 'p6',
            interstitialPlaylistId: 'pIJ',
            interstitialSequenceId: 'X',
            interstitialEvery: 3,
        });
        expect(order(run([both]))).toBe('abcIJdef');
        expect(order(run([sched({ interstitialSequenceId: 'I' })]))).toBe('abc');
        expect(order(run([sched({ interstitialSequenceId: 'I', interstitialEvery: 0 })]))).toBe('abc');
        expect(order(run([sched({ interstitialSequenceId: 'nope', interstitialEvery: 1 })]))).toBe('abc');
        expect(order(run([sched({ interstitialEvery: 1 })]))).toBe('abc');
    });

    it('counts through the wrap of a looped playlist', () => {
        // 2 songs, every 3: the count does not restart with the playlist.
        const log = run([
            sched({ playlistId: 'p2', loop: true, toTime: '18:02', interstitialSequenceId: 'I', interstitialEvery: 3 }),
        ]);
        expect(order(log)).toBe('abaIbabIabaIba');
        // The last song starts at 1:52, inside the schedule, and plays out.
        expect(lastTime(log)).toBe(2 * MIN + 2 * SEC);
    });

    it('goes into a shuffle by position', () => {
        const log = run([
            sched({
                playlistId: 'p9',
                shuffle: true,
                toTime: '18:02',
                interstitialSequenceId: 'I',
                interstitialEvery: 2,
            }),
        ]);
        const p = plays(log);
        let songs = 0;
        for (const x of p) {
            if (x.inter) {
                expect(songs).toBeGreaterThan(0);
                expect(songs % 2).toBe(0);
            } else {
                ++songs;
            }
        }
        // One after every second song, except that the one before the last song is left
        // out if it and the song would not both get to start.
        const due = Math.floor((songs - 1) / 2);
        const got = p.filter((x) => x.inter).length;
        expect(got === due || got === due - 1).toBe(true);
        expect(p[p.length - 1].inter).toBe(false);
    });

    it('restarts its count with each start-every pass', () => {
        const log = run([
            sched({
                loop: true,
                startEveryMinutes: 1,
                toTime: '18:03',
                interstitialSequenceId: 'I',
                interstitialEvery: 2,
                interstitialFirstAfter: 1,
            }),
        ]);
        expect(order(log)).toBe('aIbc'.repeat(3));
    });

    it('sits between intro and outro, not in them', () => {
        const log = run([
            sched({
                prePlaylistId: 'pXY',
                postPlaylistId: 'pXY',
                interstitialSequenceId: 'I',
                interstitialEvery: 1,
                interstitialFirstAfter: 0,
            }),
        ]);
        expect(order(log)).toBe('XYIaIbIcXY');
    });

    it('is not the last thing before the end or the outro', () => {
        // Songs are 10 s and the interstitial 4 s after every song. Under each policy and a
        // range of end times, whatever plays last in the main part is a song.
        for (const endPolicy of ['seqboundearly', 'seqboundlate', 'seqboundnearest'] as ScheduleEndPolicy[]) {
            for (const post of [undefined, 'Y']) {
                for (let endSec = 61; endSec <= 90; ++endSec) {
                    const toTime = `18:01:${String(endSec - 60).padStart(2, '0')}`;
                    const log = run([
                        sched({
                            loop: true,
                            toTime,
                            endPolicy,
                            postSequenceId: post,
                            interstitialSequenceId: 'I',
                            interstitialEvery: 1,
                        }),
                    ]);
                    const main = plays(log).filter((p) => p.part === 1);
                    const tag = `${endPolicy} ${toTime} ${post}`;
                    expect(main[main.length - 1].inter, tag).toBe(false);
                    expect(order(log).includes('II'), tag).toBe(false);
                    if (endPolicy === 'seqboundearly') expect(lastTime(log), tag).toBeLessThanOrEqual(endSec * SEC);
                    // Leaving an interstitial out does not cost "late" its promise to still be on at the end.
                    if (endPolicy === 'seqboundlate') expect(lastTime(log), tag).toBeGreaterThanOrEqual(endSec * SEC);
                    if (post) expect(order(log).endsWith('Y'), tag).toBe(true);
                }
            }
        }
    });

    it('is left out when it and the next song do not both fit, and the song still plays', () => {
        // a 0–10, I 10–14, b 14–24. Ending at :22 there is room for b alone, not for I and b.
        const fits = sched({
            loop: true,
            endPolicy: 'seqboundearly',
            interstitialSequenceId: 'I',
            interstitialEvery: 1,
        });
        expect(order(run([{ ...fits, toTime: '18:00:24' }]))).toBe('aIb');
        const tight = run([{ ...fits, toTime: '18:00:22' }]);
        expect(order(tight)).toBe('ab');
        expect(lastTime(tight)).toBe(20 * SEC);
        expect(order(run([{ ...fits, toTime: '18:00:19' }]))).toBe('a');
    });

    it('is cut like a song under hard cut', () => {
        const log = run([
            sched({
                loop: true,
                toTime: '18:00:26',
                endPolicy: 'hardcut',
                interstitialSequenceId: 'I',
                interstitialEvery: 1,
            }),
        ]);
        expect(order(log)).toBe('aIbI');
        expect(lastTime(log)).toBe(26 * SEC);
    });

    it('is dropped by a graceful stop that falls just ahead of it', () => {
        const plr = setup([
            sched({ loop: true, postSequenceId: 'Y', interstitialSequenceId: 'I', interstitialEvery: 1 }),
        ]);
        const log = plr.readOutScheduleUntil(h + 5 * SEC, 1000);
        plr.stopGracefully(h + 5 * SEC, log);
        log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
        expect(order(log)).toBe('aY');
    });

    it('is not held against the repeat spacing, and does not count toward it', () => {
        const plr = setup([sched({ playlistId: 'p9', loop: true, interstitialSequenceId: 'a', interstitialEvery: 1 })]);
        plr.repeatGuard.spacing = 3;
        const log = plr.readOutScheduleUntil(h + 2 * MIN, 1000);
        expect(log.filter((e) => e.eventType === 'Sequence Skipped')).toEqual([]);
        expect(order(log).startsWith('aabacada')).toBe(true);
        // Only playlist songs are remembered: 'a' once per pass of the playlist
        const recent = plr.repeatGuard.recent.map((r) => r.seqId).join('');
        expect(recent.includes('aa')).toBe(false);
    });

    it('can be skipped like a song', () => {
        const plr = setup([sched({ interstitialSequenceId: 'I', interstitialEvery: 1 })]);
        const log = plr.readOutScheduleUntil(h + 11 * SEC, 1000);
        plr.skipCurrentSequence('I', h + 11 * SEC, log);
        log.push(...plr.readOutScheduleUntil(h + 10 * MIN, 1000));
        expect(plays(log).map((p) => `${p.id}@${p.at / SEC}`)).toEqual(['a@0', 'I@10', 'b@11', 'I@21', 'c@25']);
    });

    it('appears in the baked order', () => {
        const plr = setup([sched({ interstitialSequenceId: 'I', interstitialEvery: 2 })]);
        plr.readOutScheduleUntil(h + SEC, 1000);
        expect(plr.getItemOrder('show')!.main.map((s) => s.sequence_id)).toEqual(['a', 'b', 'I', 'c']);
    });
});

describe('combinations', () => {
    // Every combination is run two ways, in one go and in small steps the way the player
    // advances it, and both must tell the same story; then the story is checked.
    const policies: (ScheduleEndPolicy | undefined)[] = [
        undefined,
        'seqboundearly',
        'seqboundlate',
        'seqboundnearest',
        'hardcut',
    ];
    const mains = ['p1', 'p3', 'p9'];
    const modes: Partial<ScheduledPlaylist>[] = [
        {},
        { loop: true },
        { shuffle: true },
        { loop: true, startEveryMinutes: 1 },
        { loop: true, startEveryMinutes: 0.5 },
        { shuffle: true, loop: true, startEveryMinutes: 1 },
    ];
    const inters: Partial<ScheduledPlaylist>[] = [
        {},
        { interstitialSequenceId: 'I', interstitialEvery: 1 },
        { interstitialSequenceId: 'I', interstitialEvery: 2, interstitialFirstAfter: 1 },
        { interstitialPlaylistId: 'pIJ', interstitialEvery: 3, interstitialFirstAfter: 0 },
    ];
    const brackets: Partial<ScheduledPlaylist>[] = [
        {},
        { preSequenceId: 'X', postSequenceId: 'Y' },
        { prePlaylistId: 'pXY' },
        { postPlaylistId: 'pXY' },
    ];
    const ends = ['18:03', '18:02:47'];

    function check(s: ScheduledPlaylist, interrupt: boolean) {
        const tag = JSON.stringify({ ...s, interrupt });
        const endMS = h + (s.toTime === '18:03' ? 180 : 167) * SEC;
        const until = h + 6 * MIN;
        const cmd = { immediate: true, startTime: h + 47 * SEC, seqId: 'L', requestId: 'req' };

        // The schedule is loaded once: loading the same window again would bring back a
        // single-pass schedule that has already finished.
        const one = setup([s]);
        one.addTimeRangeToSchedule(bt, until);
        const whole: PlaybackLogDetail[] = [];
        if (interrupt) {
            one.runUntil(cmd.startTime, undefined, whole);
            one.addInteractiveCommand(cmd);
        }
        one.runUntil(until, undefined, whole);

        const two = setup([s]);
        two.addTimeRangeToSchedule(bt, until);
        const stepped: PlaybackLogDetail[] = [];
        let sent = !interrupt;
        for (let t = h - SEC; t < until; t += 700) {
            if (!sent && t >= cmd.startTime) {
                two.runUntil(cmd.startTime, undefined, stepped);
                two.addInteractiveCommand(cmd);
                sent = true;
            }
            two.runUntil(t, undefined, stepped);
            two.getUpcomingItems(2 * SEC, 25 * 3600 * SEC);
        }
        two.runUntil(until, undefined, stepped);
        expect(text(stepped), tag).toBe(text(whole));

        const log = whole.filter((e) => e.scheduleId === 'show');
        expect(log.length, tag).toBeGreaterThan(0);

        // Time never runs backward, and a sequence is over before the next begins.
        let open: string | undefined = undefined;
        let prev = -Infinity;
        for (const e of log) {
            expect(e.eventTime, tag).toBeGreaterThanOrEqual(prev);
            prev = e.eventTime;
            if (e.eventType === 'Sequence Started' || e.eventType === 'Sequence Resumed') {
                expect(open, tag).toBeUndefined();
                open = e.sequenceId;
            } else if (e.eventType === 'Sequence Ended' || e.eventType === 'Sequence Paused') {
                expect(open, tag).toBe(e.sequenceId);
                open = undefined;
            }
        }
        expect(open, tag).toBeUndefined();

        // Starts are on the grid, or wait out the interruption.
        const every = getStartEveryMS(s);
        const starts = startsOf(log);
        expect(starts.length, tag).toBeGreaterThan(0);
        if (every) {
            for (const st of starts) {
                if (st % every !== 0) {
                    expect(interrupt, tag).toBe(true);
                    expect(st, tag).toBe(77 * SEC); // when L (0:47–1:17) ends
                }
                expect(h + st, tag).toBeLessThan(endMS);
            }
            expect(new Set(starts).size, tag).toBe(starts.length);
        } else {
            expect(starts, tag).toEqual([0]);
        }

        // Starts and ends pair up.
        const ended = log.filter((e) => e.eventType === 'Schedule Ended' || e.eventType === 'Schedule Stopped');
        expect(ended.length, tag).toBe(starts.length);

        // The end is kept: exactly under hard cut, by the last song under "early".
        const last = log[log.length - 1].eventTime;
        if (!interrupt && (s.endPolicy === 'hardcut' || s.endPolicy === 'seqboundearly')) {
            expect(last, tag).toBeLessThanOrEqual(endMS);
        }

        // Per pass: intro first, outro last, and no interstitial stranded at the end of the main part.
        const passes: Play[][] = [];
        for (const e of log) {
            if (e.eventType === 'Schedule Started') passes.push([]);
            if (e.eventType === 'Sequence Started') {
                passes[passes.length - 1].push({
                    id: e.sequenceId!,
                    at: e.eventTime - h,
                    part: e.entryIntoPlaylist![0],
                    inter: !!e.interstitial,
                });
            }
        }
        for (const p of passes) {
            const parts = p.map((x) => x.part);
            expect([...parts].sort(), tag).toEqual(parts);
            const main = p.filter((x) => x.part === 1);
            if (main.length && s.endPolicy !== 'hardcut') expect(main[main.length - 1].inter, tag).toBe(false);
            if (!s.interstitialEvery)
                expect(
                    main.some((x) => x.inter),
                    tag,
                ).toBe(false);
            // Interstitials keep their spacing in songs.
            if (s.interstitialEvery && !interrupt) {
                const n = s.interstitialEvery;
                const first = s.interstitialFirstAfter ?? n;
                const size = s.interstitialPlaylistId ? 2 : 1;
                let songs = 0;
                let run = 0;
                main.forEach((x, i) => {
                    if (x.inter) {
                        ++run;
                        expect(songs >= first && (songs - first) % n === 0, tag).toBe(true);
                    } else {
                        // A song where an interstitial was due is preceded by a whole one, unless
                        // it is the last song: there the interstitial is dropped if the two do
                        // not both fit.
                        if (songs >= first && (songs - first) % n === 0 && i > 0) {
                            if (i < main.length - 1 || run > 0) expect(run, tag).toBe(size);
                        }
                        run = 0;
                        ++songs;
                    }
                });
            }
        }
    }

    it('hold together across modes, interstitials, brackets, end policies and interruption', () => {
        let n = 0;
        for (const endPolicy of policies)
            for (const playlistId of mains)
                for (const mode of modes)
                    for (const inter of inters)
                        for (const bracket of brackets)
                            for (const toTime of ends)
                                for (const interrupt of [false, true]) {
                                    // Thin the grid: every combination of two dimensions still occurs.
                                    if (++n % 3 !== 0 && !(interrupt === false && toTime === '18:03')) continue;
                                    check(
                                        sched({ playlistId, endPolicy, toTime, ...mode, ...inter, ...bracket }),
                                        interrupt,
                                    );
                                }
    }, 120_000);
});
