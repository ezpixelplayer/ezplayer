import { describe, it, expect } from 'vitest';

/*
If we "run" the schedule will it execute its state machine.
  That is, given the SequenceRecord[], PlaylistRecord[], ScheduledPlaylist[] and a time, will it produce PlaylistRunState and PlaybackLogEntry?

So, what I need to be doing is checking all these fields, and overlapping schedules:
  Song:
    Lead time + trail time + duration
  Playlist: 
    *** Lead items, items, trailItems... does that make sense or do I want those to be at the schedule level?
    *** Why does it have a 'duration' string?  Replace with calculation.
  Schedule:
    hard cut in: preferHardCutIn/hardCutIn
    end policy: endPolicy
    keep to schedule when preempted: keepToScheduleWhenPreempted
    priority
    external events
*/

import { PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '../src/types/DataTypes';
import {
    createShuffleList,
    getPlaylistDurationMS,
    getScheduleDurationMS,
    getScheduleTimes,
    getSeqTimesMS,
    getTotalSeqTimeMS,
    PlaybackLogDetail,
    PlayerRunState,
    seqsToMap,
} from '../src/util/schedulecomp';

///
// These are used in the random test
///
const s1: SequenceRecord = { id: '1', instanceId: '1', work: { length: 10, artist: '1', title: '1' } };
const s2: SequenceRecord = { id: '2', instanceId: '2', work: { length: 10, artist: '2', title: '2' } };
const s3: SequenceRecord = { id: '3', instanceId: '3', work: { length: 10, artist: '3', title: '3' } };
const s4: SequenceRecord = { id: '4', instanceId: '4', work: { length: 10, artist: '4', title: '4' } };
const s5: SequenceRecord = { id: '5', instanceId: '5', work: { length: 10, artist: '5', title: '5' } };
const s6: SequenceRecord = { id: '6', instanceId: '6', work: { length: 10, artist: '6', title: '6' } };
const s7: SequenceRecord = { id: '7', instanceId: '7', work: { length: 10, artist: '7', title: '7' } };
const s8: SequenceRecord = { id: '8', instanceId: '8', work: { length: 10, artist: '8', title: '8' } };
const s9: SequenceRecord = { id: '9', instanceId: '9', work: { length: 10, artist: '9', title: '9' } };

const all9 = [s1, s2, s3, s4, s5, s6, s7, s8, s9];

const plof2: PlaylistRecord = {
    title: 'plof2',
    createdAt: Date.now(),
    tags: [],
    id: 'plof2',
    items: [
        { id: '1', sequence: 1 },
        { id: '2', sequence: 2 },
    ],
};

const plof4: PlaylistRecord = {
    title: 'plof4',
    createdAt: Date.now(),
    tags: [],
    id: 'plof4',
    items: [
        { id: '1', sequence: 1 },
        { id: '2', sequence: 2 },
        { id: '3', sequence: 3 },
        { id: '4', sequence: 4 },
    ],
};

const plof9: PlaylistRecord = {
    title: 'plof9',
    createdAt: Date.now(),
    tags: [],
    id: 'plof9',
    items: [
        { id: '1', sequence: 1 },
        { id: '2', sequence: 2 },
        { id: '3', sequence: 3 },
        { id: '4', sequence: 4 },
        { id: '5', sequence: 5 },
        { id: '6', sequence: 6 },
        { id: '7', sequence: 7 },
        { id: '8', sequence: 8 },
        { id: '9', sequence: 9 },
    ],
};

const playlists_3_9 = [plof2, plof4, plof9];

const scheduleOf2: ScheduledPlaylist = {
    id: 'scheduleOf2',
    title: 'Just2Songs',
    playlistTitle: 'Just2Songs',
    playlistId: 'plof2',
    date: 0,
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0, // ???
};

const parts3straight: ScheduledPlaylist = {
    id: 'parts3straight',
    title: '3PartsStraight',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0, // ???
};

const rec1: SequenceRecord = {
    id: '1234',
    instanceId: 'abcd',
    work: {
        title: 'Lalala',
        length: 200,
        artist: '',
    },
    settings: {
        lead_time: 0.1,
        trail_time: -0.2,
    },
};

const pl1: PlaylistRecord = {
    id: 'pl1',
    title: 'PL1',
    tags: [],
    createdAt: Date.now(),
    items: [{ id: rec1.id, sequence: 1 }],
};

const ple1: PlaylistRecord = {
    id: 'ple1',
    title: 'PLE1',
    tags: [],
    createdAt: Date.now(),
    items: [{ id: 'nss', sequence: 1 }],
};

const ps1NoLoop: ScheduledPlaylist = {
    id: 'ps1NoLoop',
    title: 'PS1 No Loop',
    playlistId: 'pl1',
    playlistTitle: 'PL1 No Loop',
    date: 0,
    fromTime: '18:00',
    toTime: '19:00',
    duration: 0, // ???
};

const parts3loop: ScheduledPlaylist = {
    id: 'parts3loop',
    title: '3PartsLoop',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:03',
    loop: true,
    duration: 0, // ???
};

const parts3loopShort: ScheduledPlaylist = {
    id: 'parts3loopShort',
    title: '3 Parts Loop Short',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:02',
    loop: true,
    duration: 0, // ???
};

const parts3shuffle: ScheduledPlaylist = {
    id: 'parts3shuffle',
    title: '3 Parts Shuffle',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:03',
    loop: true,
    duration: 0, // ???
};

const parts3shuffleShort: ScheduledPlaylist = {
    id: 'parts3shuffleShort',
    title: '3 Parts Shuffle Short',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:02',
    loop: true,
    duration: 0, // ???
};

const parts3loopFracHard: ScheduledPlaylist = {
    id: 'parts3loopFracHard',
    title: '3 Parts Shuffle Hard cut',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:02:03',
    loop: true,
    endPolicy: 'hardcut',
    duration: 0, // ???
};

const parts3loopFracEarly: ScheduledPlaylist = {
    id: 'parts3loopFracEarly',
    title: '3 Parts Shuffle Early',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:02:03',
    loop: true,
    endPolicy: 'seqboundearly',
    duration: 0, // ???
};

const parts3loopFracLate: ScheduledPlaylist = {
    id: 'parts3loopFracLate',
    title: '3 Parts Shuffle Late',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:02:03',
    loop: true,
    endPolicy: 'seqboundlate',
    duration: 0, // ???
};

const parts3loopFracNearest1: ScheduledPlaylist = {
    id: 'parts3loopFracNearest1',
    title: '3 Parts Shuffle Closest (early)',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:02:03',
    loop: true,
    endPolicy: 'seqboundnearest',
    duration: 0, // ???
};

const parts3loopFracNearest2: ScheduledPlaylist = {
    id: 'parts3loopFracNearest2',
    title: '3 Parts Shuffle Closest (early)',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:02:07',
    loop: true,
    endPolicy: 'seqboundnearest',
    duration: 0, // ???
};

const parts3loopRealShort: ScheduledPlaylist = {
    id: 'parts3loopRealShort',
    title: '3 Parts real short',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:00:15',
    loop: true,
    endPolicy: 'seqboundnearest',
    duration: 0, // ???
};

const parts3loopRealShortCut: ScheduledPlaylist = {
    id: 'parts3loopRealShortCut',
    title: '3 Parts real short Cut',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:00:15',
    loop: true,
    endPolicy: 'hardcut',
    duration: 0, // ???
};

const parts3loopHigh: ScheduledPlaylist = {
    id: 'parts3loopHigh',
    title: '3PartsLoop',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:10',
    loop: true,
    duration: 0, // ???
    priority: 'high',
    endPolicy: 'seqboundnearest',
};

const parts3loopLow: ScheduledPlaylist = {
    id: 'parts3loopLow',
    title: '3PartsLoop Low',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:10',
    loop: true,
    duration: 0, // ???
    priority: 'low',
    endPolicy: 'seqboundnearest',
};

const parts3loopLowPHC: ScheduledPlaylist = {
    id: 'parts3loopLowPHC',
    title: '3PartsLoop Hard Cut',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:10',
    loop: true,
    duration: 0, // ???
    priority: 'low',
    preferHardCutIn: true,
    endPolicy: 'seqboundnearest',
};

const parts3loopLowPHCKR: ScheduledPlaylist = {
    id: 'parts3loopLowPHCKR',
    title: '3PartsLoop Low Hard Cut Keep Running',
    playlistTitle: '3PartsStraight',
    playlistId: 'plof9',
    prePlaylistId: 'plof2',
    postPlaylistId: 'plof4',
    date: 0,
    fromTime: '18:00',
    toTime: '18:10',
    loop: true,
    duration: 0, // ???
    priority: 'low',
    preferHardCutIn: true,
    keepToScheduleWhenPreempted: true,
    endPolicy: 'seqboundnearest',
};

const parts1Med: ScheduledPlaylist = {
    id: 'parts1Med',
    title: 'PS1 No Loop Med Pri',
    playlistId: 'pl1',
    playlistTitle: 'PL1 No Loop',
    date: 0,
    fromTime: '18:01',
    toTime: '18:05',
    duration: 0, // ???
};

const parts1MedEarly: ScheduledPlaylist = {
    id: 'parts1MedEarly',
    title: 'PS1 No Loop Med Pri Early',
    playlistId: 'pl1',
    playlistTitle: 'PL1 No Loop',
    date: 0,
    fromTime: '18:00:59',
    toTime: '18:05',
    duration: 0, // ???
};

const parts1MedHCEarly: ScheduledPlaylist = {
    id: 'parts1MedHCEarly',
    title: 'PS1 No Loop Med Pri HardCut Early',
    playlistId: 'pl1',
    playlistTitle: 'PL1 No Loop',
    date: 0,
    fromTime: '18:00:59',
    toTime: '18:05',
    duration: 0, // ???
    hardCutIn: true,
};

function toTextLog(log: PlaybackLogDetail[]) {
    return log
        .map(
            (e) =>
                `${e.eventType}: ${e.stackDepth} @${e.eventTime} (${e.entryIntoPlaylist ? e.entryIntoPlaylist.map((e) => e.toString()).join(',') : '?'}@${e.timeIntoSeqMS ? e.timeIntoSeqMS.toString() : ''}) : ${e.scheduleId}.${e.playlistId ? e.playlistId : 'N/A'}.${e.sequenceId ? e.sequenceId : 'N/A'}`,
        )
        .join('\n');
}

describe('calcschedule', () => {
    it('should know rec length', () => {
        const result = getTotalSeqTimeMS(rec1);
        expect(result.toFixed(3)).toBe((199900.0).toFixed(3));
    });

    it('should know the rest of rec details', () => {
        const result = getSeqTimesMS(rec1);
        expect(result).toStrictEqual({
            startLeadToSeqMS: 100,
            endTrailFromSeqMS: 0,
            startTrimOffSeqMS: 0,
            endTrimOffSeqMS: 200,
            totalSeqTimeMS: 199900,
        });
    });

    it('should be trivially calculated', () => {
        const errs: string[] = [];
        const result = getPlaylistDurationMS([rec1], pl1, errs);
        expect(errs.length).toBe(0);
        expect(result).toStrictEqual({
            totalMS: 199900,
            longestMS: 199900,
        });
    });

    it('should error', () => {
        const errs: string[] = [];
        const _result = getPlaylistDurationMS([rec1], ple1, errs);
        expect(errs.length).toBe(1);
    });

    it('should shuffle', () => {
        const res1a = createShuffleList(plof2, 1, 60000, seqsToMap(all9, []));
        expect(res1a).toStrictEqual(['1', '2', '1', '2', '1', '2']);
        const res1b = createShuffleList(plof2, 2, 60000, seqsToMap(all9, []));
        expect(res1b).toStrictEqual(['2', '1', '2', '1', '2', '1']);
        const res2a = createShuffleList(plof4, 2, 60000, seqsToMap(all9, []));
        expect(res2a).toStrictEqual(['3', '2', '4', '1', '2', '4']);
        const res3a = createShuffleList(plof9, 2, 150000, seqsToMap(all9, []));
        expect(res3a).toStrictEqual(['5', '3', '6', '8', '1', '2', '4', '9', '7', '6', '2', '3', '5', '4', '1']);
    });

    it('should calculate in a few ways depending on scheduling', () => {
        const errs: string[] = [];
        const result = getScheduleDurationMS([rec1], [pl1], ps1NoLoop, errs);
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        expect(errs.length).toBe(0);
        expect(result).toStrictEqual({
            startTimeMS: bt + 18 * 60 * 60 * 1000,
            hardStart: false,
            hardEnd: false,
            nominalEndTimeMS: bt + 19 * 60 * 60 * 1000,
            expectedEndMS: bt + 19 * 60 * 60 * 1000,
            earlyEndMS: bt + 19 * 60 * 60 * 1000 - 199900 / 2,
            lateEndMS: bt + 19 * 60 * 60 * 1000 + 199900 / 2,

            totalPLMS: 199900,
            longestPLItemMS: 199900,
        });
    });

    it('should run one thing', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1], [pl1], [ps1NoLoop], errs);
        expect(errs.length).toBe(0);

        const logs = plr.readOutScheduleUntil(bt + 24 * 3600 * 1000, 100);
        //console.log(toTextLog(logs));
        expect(logs.length).toBe(6);

        expect(logs[0].eventType).toBe('Schedule Started');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[0].scheduleId).toBe(ps1NoLoop.id);
        expect(logs[1].eventType).toBe('Playlist Started');
        expect(logs[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[1].scheduleId).toBe(ps1NoLoop.id);
        expect(logs[1].playlistId).toBe(pl1.id);
        expect(logs[2].eventType).toBe('Sequence Started');
        expect(logs[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[2].sequenceId).toBe(rec1.id);
        expect(logs[logs.length - 3].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 199900);
        expect(logs[logs.length - 3].sequenceId).toBe(rec1.id);
        expect(logs[logs.length - 2].eventType).toBe('Playlist Ended');
        expect(logs[logs.length - 2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 199900);
        expect(logs[logs.length - 2].playlistId).toBe(pl1.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Ended');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 199900);
        expect(logs[logs.length - 1].scheduleId).toBe(ps1NoLoop.id);
    });

    it('should run half a thing and stop', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1], [pl1], [ps1NoLoop], errs);
        expect(errs.length).toBe(0);

        const logs = plr.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 10000, 100);
        //console.log(toTextLog(logs));
        expect(logs.length).toBe(3);

        expect(logs[0].eventType).toBe('Schedule Started');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[0].scheduleId).toBe(ps1NoLoop.id);
        expect(logs[1].eventType).toBe('Playlist Started');
        expect(logs[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[1].scheduleId).toBe(ps1NoLoop.id);
        expect(logs[1].playlistId).toBe(pl1.id);
        expect(logs[2].eventType).toBe('Sequence Started');
        expect(logs[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[2].sequenceId).toBe(rec1.id);

        plr.stopAll(bt + 18 * 60 * 60 * 1000 + 10000, logs);

        expect(logs[logs.length - 3].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10000);
        expect(logs[logs.length - 3].sequenceId).toBe(rec1.id);
        expect(logs[logs.length - 2].eventType).toBe('Playlist Ended');
        expect(logs[logs.length - 2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10000);
        expect(logs[logs.length - 2].playlistId).toBe(pl1.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Stopped');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10000);
        expect(logs[logs.length - 1].scheduleId).toBe(ps1NoLoop.id);
    });

    it('should pause and resume', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1], [pl1], [ps1NoLoop], errs);
        expect(errs.length).toBe(0);

        const logs = plr.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 10000, 100);
        //console.log(toTextLog(logs));
        expect(logs.length).toBe(3);

        expect(logs[0].eventType).toBe('Schedule Started');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[0].scheduleId).toBe(ps1NoLoop.id);
        expect(logs[1].eventType).toBe('Playlist Started');
        expect(logs[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[1].scheduleId).toBe(ps1NoLoop.id);
        expect(logs[1].playlistId).toBe(pl1.id);
        expect(logs[2].eventType).toBe('Sequence Started');
        expect(logs[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[2].sequenceId).toBe(rec1.id);

        plr.pause(bt + 18 * 60 * 60 * 1000 + 10000, logs);

        plr.resume(bt + 18 * 60 * 60 * 1000 + 15000, logs);

        plr.runUntil(bt + 19 * 60 * 60 * 1000, 100, logs);
        //console.log(toTextLog(logs));

        expect(logs[logs.length - 4].eventType).toBe('Sequence Resumed');
        expect(logs[logs.length - 4].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 15000);
        expect(logs[logs.length - 4].sequenceId).toBe(rec1.id);
        expect(logs[logs.length - 3].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 199900 + 5000);
        expect(logs[logs.length - 3].sequenceId).toBe(rec1.id);
        expect(logs[logs.length - 2].eventType).toBe('Playlist Ended');
        expect(logs[logs.length - 2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 199900 + 5000);
        expect(logs[logs.length - 2].playlistId).toBe(pl1.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Ended');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 199900 + 5000);
        expect(logs[logs.length - 1].scheduleId).toBe(ps1NoLoop.id);
    });

    it('should run each thing once', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences(all9, playlists_3_9, [parts3straight], errs);
        expect(errs.length).toBe(0);

        const logs = plr.readOutScheduleUntil(bt + 24 * 3600 * 1000, 100); // This is plenty
        //console.log(toTextLog(logs));
        expect(logs.length).toBe(38);

        expect(logs[0].eventType).toBe('Schedule Started');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[0].scheduleId).toBe(parts3straight.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Ended');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 15 * 10 * 1000);
        expect(logs[logs.length - 1].scheduleId).toBe(parts3straight.id);
    });

    it('should run ends not starts', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences(all9, playlists_3_9, [parts3straight], errs);
        expect(errs.length).toBe(0);

        const logs1 = plr.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 1 * 10 * 1000, 100);
        //console.log(toTextLog(logs1)); // start, start, start, end
        expect(logs1.length).toBe(4);
        const logs2 = plr.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 2 * 10 * 1000, 100);
        //console.log(toTextLog(logs2)); // start, end, end
        expect(logs2.length).toBe(3);
        const logs3 = plr.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 5 * 10 * 1000 + 50, 100);
        //console.log(toTextLog(logs3)); // start, start, end, start, end, start, end, start
        expect(logs3.length).toBe(8);
        const logs4 = plr.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 11 * 10 * 1000, 100);
        //console.log(toTextLog(logs4)); // send, sstart, send, .. sstart, send, lend
        expect(logs4.length).toBe(12);
        const logs5 = plr.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 15 * 10 * 1000, 100);
        //console.log(toTextLog(logs5)); // lstart, 4x seq, lend, pend
        expect(logs5.length).toBe(11);
    });

    // Check loop and shuffle
    it('should loop or shuffle, full integer increments', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        // 3-minute loop
        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences(all9, playlists_3_9, [parts3loop], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(1 * 2 + 3 * 2 + 18 * 2);

        // 2-minute loop
        const plr2 = new PlayerRunState(bt);
        plr2.setUpSequences(all9, playlists_3_9, [parts3loopShort], errs);
        expect(errs.length).toBe(0);
        const logs2 = plr2.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs2));
        expect(logs2.length).toBe(1 * 2 + 3 * 2 + 12 * 2);

        // 3-minute shuffle
        const plr3 = new PlayerRunState(bt);
        plr3.setUpSequences(all9, playlists_3_9, [parts3shuffle], errs);
        expect(errs.length).toBe(0);
        const logs3 = plr3.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs3));
        expect(logs3.length).toBe(1 * 2 + 3 * 2 + 18 * 2);

        // 2-minute shuffle
        const plr4 = new PlayerRunState(bt);
        plr4.setUpSequences(all9, playlists_3_9, [parts3shuffleShort], errs);
        expect(errs.length).toBe(0);
        const logs4 = plr4.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs4));
        expect(logs4.length).toBe(1 * 2 + 3 * 2 + 12 * 2);
    });

    it('should loop, fractional increments', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        // 2:03 loop (hard)
        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences(all9, playlists_3_9, [parts3loopFracHard], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(1 * 2 + 3 * 2 + 13 * 2);
        expect(logs1[logs1.length - 13].eventType).toBe('Sequence Ended');
        expect(logs1[logs1.length - 12].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 23 * 1000);
        expect(logs1[logs1.length - 12].eventType).toBe('Playlist Ended');
        expect(logs1[logs1.length - 12].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 23 * 1000);
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 2 * 1000 + 3 * 1000);

        // 2:03 loop (early) (2:00)
        const plr2 = new PlayerRunState(bt);
        plr2.setUpSequences(all9, playlists_3_9, [parts3loopFracEarly], errs);
        expect(errs.length).toBe(0);
        const logs2 = plr2.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs2));
        expect(logs2.length).toBe(1 * 2 + 3 * 2 + 12 * 2);
        expect(logs2[logs2.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 2 * 1000 + 0 * 1000);

        // 2:03 loop (late) (2:10)
        const plr3 = new PlayerRunState(bt);
        plr3.setUpSequences(all9, playlists_3_9, [parts3loopFracLate], errs);
        expect(errs.length).toBe(0);
        const logs3 = plr3.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs3));
        expect(logs3.length).toBe(1 * 2 + 3 * 2 + 13 * 2);
        expect(logs3[logs3.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 2 * 1000 + 10 * 1000);

        // 2:03 loop (nearest -> early (2:00)
        const plr4 = new PlayerRunState(bt);
        plr4.setUpSequences(all9, playlists_3_9, [parts3loopFracNearest1], errs);
        expect(errs.length).toBe(0);
        const logs4 = plr4.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs4));
        expect(logs4.length).toBe(1 * 2 + 3 * 2 + 12 * 2);
        expect(logs4[logs4.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 2 * 1000 + 0 * 1000);

        // 2:07 loop (nearest -> late (2:10)
        const plr5 = new PlayerRunState(bt);
        plr5.setUpSequences(all9, playlists_3_9, [parts3loopFracNearest2], errs);
        expect(errs.length).toBe(0);
        const logs5 = plr5.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs5));
        expect(logs5.length).toBe(1 * 2 + 3 * 2 + 13 * 2);
        expect(logs5[logs5.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 2 * 1000 + 10 * 1000);
    });

    // Check slot way too short
    it('No time for main section', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        // soft
        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences(all9, playlists_3_9, [parts3loopRealShort], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(1 * 2 + 3 * 2 + 6 * 2);
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 0 * 1000);

        // hard
        const plr2 = new PlayerRunState(bt);
        plr2.setUpSequences(all9, playlists_3_9, [parts3loopRealShortCut], errs);
        expect(errs.length).toBe(0);
        const logs2 = plr2.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs2));
        // This should all be cut off ... but by the scheduler loop.
        expect(logs2.length).toBe(1 * 2 + 1 * 2 + 2 * 2);
        expect(logs2[logs2.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 15 * 1000);
    });

    // Check all the preemptions

    it('Should preempt normally', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopLow, parts1Med], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(2 * 2 + 4 * 2 + 41 * 2 + 2);
        // 16: 60 sec, 41 real sequences * 2 = 12, plus 3 playlist events and 1 schedule start
        expect(logs1[16].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 0 * 1000);
        expect(logs1[16].eventType).toBe('Schedule Suspended');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 0 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 0 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[22].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 199900);
        expect(logs1[22].eventType).toBe('Schedule Ended');
        expect(logs1[23].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 199900);
        expect(logs1[23].eventType).toBe('Schedule Resumed');
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 10 * 1000 - 100);
        expect(logs1[logs1.length - 1].eventType).toBe('Schedule Ended');
        //
    });

    it('Should not preempt', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopHigh, parts1Med], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 200);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(1 * 2 + 3 * 2 + 60 * 2 + 2);
        for (const l of logs1) expect(l.eventType).not.toBe('Schedule Suspended');
        expect(logs1.find((e) => e.eventType === 'Schedule Prevented')).toBeDefined();
        expect(logs1.find((e) => e.eventType === 'Schedule Deferred')).toBeDefined();
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 10 * 1000);
        expect(logs1[logs1.length - 1].eventType).toBe('Schedule Ended');
        //
    });

    it('Should cut off log count', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopHigh, parts1Med], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBeGreaterThanOrEqual(100); // Should really be 100, 101 is pretty close.
        expect(logs1.length).toBeLessThanOrEqual(101); // Should really be 100, 101 is pretty close.
    });

    it('Should preempt in even spot', () => {
        // IE it should be the same as the one above...
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopLow, parts1MedEarly], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(2 * 2 + 4 * 2 + 41 * 2 + 2);
        // 16: 60 sec, 6 real sequences * 2 = 12, plus 3 playlist events and 1 schedule start
        expect(logs1[16].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 0 * 1000);
        expect(logs1[16].eventType).toBe('Schedule Suspended');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 0 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 0 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[22].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 199900);
        expect(logs1[22].eventType).toBe('Schedule Ended');
        expect(logs1[23].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 199900);
        expect(logs1[23].eventType).toBe('Schedule Resumed');
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 10 * 1000 - 100);
        expect(logs1[logs1.length - 1].eventType).toBe('Schedule Ended');
    });

    it('Should preempt exactly', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopLow, parts1MedHCEarly], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(2 * 2 + 4 * 2 + 41 * 2 + 4);
        // 16: 60 sec, 6 real sequences * 2 = 12, plus 3 playlist events and 1 schedule start
        expect(logs1[15].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[15].eventType).toBe('Sequence Paused');
        expect(logs1[15].timeIntoSeqMS).toBe(9000);
        expect(logs1[16].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[16].eventType).toBe('Schedule Suspended');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[22].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[22].eventType).toBe('Schedule Ended');
        expect(logs1[23].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[23].eventType).toBe('Schedule Resumed');
        expect(logs1[24].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[24].eventType).toBe('Sequence Resumed');
        expect(logs1[24].timeIntoSeqMS).toBe(9000);
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 10 * 1000 - 100);
        expect(logs1[logs1.length - 1].eventType).toBe('Schedule Ended');
        //
    });

    it('Should preempt exactly (alt version where overridden prefers HC)', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopLowPHC, parts1MedEarly], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(2 * 2 + 4 * 2 + 41 * 2 + 4);
        // 16: 60 sec, 6 real sequences * 2 = 12, plus 3 playlist events and 1 schedule start
        expect(logs1[15].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[15].eventType).toBe('Sequence Paused');
        expect(logs1[15].timeIntoSeqMS).toBe(9000);
        expect(logs1[16].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[16].eventType).toBe('Schedule Suspended');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[22].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[22].eventType).toBe('Schedule Ended');
        expect(logs1[23].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[23].eventType).toBe('Schedule Resumed');
        expect(logs1[24].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[24].eventType).toBe('Sequence Resumed');
        expect(logs1[24].timeIntoSeqMS).toBe(9000);
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 10 * 1000 - 100);
        expect(logs1[logs1.length - 1].eventType).toBe('Schedule Ended');
        //
    });

    it('Should preempt exactly (and keep running)', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopLowPHCKR, parts1MedEarly], errs);
        expect(errs.length).toBe(0);
        const logs1 = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        //console.log(toTextLog(logs1));
        expect(logs1.length).toBe(2 * 2 + 4 * 2 + 41 * 2 + 4);
        // 16: 60 sec, 6 real sequences * 2 = 12, plus 3 playlist events and 1 schedule start
        expect(logs1[15].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[15].eventType).toBe('Sequence Paused');
        expect(logs1[15].timeIntoSeqMS).toBe(9000);
        expect(logs1[15].entryIntoPlaylist).toStrictEqual([1, 3]);
        expect(logs1[16].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[16].eventType).toBe('Schedule Suspended');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[17].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 - 1 * 1000);
        expect(logs1[17].eventType).toBe('Schedule Started');
        expect(logs1[22].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[22].eventType).toBe('Schedule Ended');
        expect(logs1[23].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[23].eventType).toBe('Schedule Resumed');
        expect(logs1[24].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1 * 1000 + 198900);
        expect(logs1[24].eventType).toBe('Sequence Resumed');
        expect(logs1[24].entryIntoPlaylist).toStrictEqual([1, 5]);
        expect(logs1[24].timeIntoSeqMS).toBe(8900);
        expect(logs1[logs1.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 10 * 1000);
        expect(logs1[logs1.length - 1].eventType).toBe('Schedule Ended');
    });

    it('Should get state', () => {
        const errs: string[] = [];
        const bdate = new Date(parts3straight.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();

        const plr1 = new PlayerRunState(bt);
        plr1.setUpSequences([...all9, rec1], [...playlists_3_9, pl1], [parts3loopLow, parts1MedHCEarly], errs);
        expect(errs.length).toBe(0);

        expect(plr1.getStatusSnapshot().length).toBe(0);

        // TODO Check upcoming items!

        const _logs1a = plr1.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 30 * 1000, 100);
        const ss1 = plr1.getStatusSnapshot();
        expect(ss1.length).toBe(1);
        expect(ss1[0].scheduleId).toBe('parts3loopLow');
        expect(ss1[0].playlistIds.length).toBe(9);
        expect(ss1[0].playlistNumber).toBe(1);
        expect(ss1[0].atTime).toBe(bt + 18 * 60 * 60 * 1000 + 30 * 1000);
        expect(ss1[0].offsetInto).toBe(0);
        expect(ss1[0].seqIdx).toBe(1); // 2nd seq, 3 having played
        const _logs1b = plr1.readOutScheduleUntil(bt + 18 * 60 * 60 * 1000 + 60 * 1000, 100);
        const ss2 = plr1.getStatusSnapshot();
        expect(ss2.length).toBe(2);
        expect(ss2[0].scheduleId).toBe('parts1MedHCEarly');
        expect(ss2[0].playlistIds.length).toBe(1);
        expect(ss2[0].playlistNumber).toBe(1);
        expect(ss2[0].atTime).toBe(bt + 18 * 60 * 60 * 1000 + 60 * 1000);
        expect(ss2[0].offsetInto).toBe(1000);
        expect(ss2[0].seqIdx).toBe(0); // 2nd seq, 3 having played
        expect(ss2[1].scheduleId).toBe('parts3loopLow');
        expect(ss2[1].playlistIds.length).toBe(9);
        expect(ss2[1].playlistNumber).toBe(1);
        expect(ss2[1].atTime).toBe(bt + 18 * 60 * 60 * 1000 + 59 * 1000);
        expect(ss2[1].offsetInto).toBe(9000);
        expect(ss2[1].seqIdx).toBe(3); // nd seq, 5 having played

        const _logs1c = plr1.readOutScheduleUntil(bt + 19 * 60 * 60 * 1000, 100);
        const ss3 = plr1.getStatusSnapshot();
        expect(ss3.length).toBe(0);
    });

    it('should indicate future time', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1], [pl1], [ps1NoLoop], errs);
        expect(errs.length).toBe(0);

        plr.addTimeRangeToSchedule(bt, bt + 24 * 3600_000);
        plr.runUntil(bt + 3600_000);
        const pla = plr.getUpcomingItems(24 * 3600_000, 24 * 3600_000);
        expect(pla.upcomingSchedules?.length).toBe(1);
        expect(pla.upcomingSchedules![0].actions.length).toBe(2);
        expect(pla.upcomingSchedules![0].actions[0].seqId).toBe(rec1.id);
        expect(pla.upcomingSchedules![0].actions[0].atTime).toBe(getScheduleTimes(ps1NoLoop).startTimeMS);

        const logs = plr.readOutScheduleUntil(bt + 24 * 3600 * 1000, 100);
        //console.log(toTextLog(logs));
        expect(logs.length).toBe(6);
    });

    // Simple schedule, in bits
    it('should just run 2 songs', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1, ...all9], [plof2], [scheduleOf2], errs);
        expect(errs.length).toBe(0);

        // This should put it in the middle of the first song
        const logs = plr.readOutScheduleUntil(bt + 18 * 3600 * 1000 + 30 * 1000, 100);
        expect(logs.length).toBe(8);

        expect(logs[0].eventType).toBe('Schedule Started');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[0].scheduleId).toBe(scheduleOf2.id);
        expect(logs[1].eventType).toBe('Playlist Started');
        expect(logs[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[1].scheduleId).toBe(scheduleOf2.id);
        expect(logs[1].playlistId).toBe(plof2.id);
        expect(logs[2].eventType).toBe('Sequence Started');
        expect(logs[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[2].sequenceId).toBe(s1.id);
        expect(logs[3].eventType).toBe('Sequence Ended');
        expect(logs[3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[3].sequenceId).toBe(s1.id);
        expect(logs[4].eventType).toBe('Sequence Started');
        expect(logs[4].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[4].sequenceId).toBe(s2.id);

        expect(logs[logs.length - 3].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 3].sequenceId).toBe(s2.id);
        expect(logs[logs.length - 2].eventType).toBe('Playlist Ended');
        expect(logs[logs.length - 2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 2].playlistId).toBe(plof2.id);
        expect(logs[logs.length - 2].scheduleId).toBe(scheduleOf2.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Ended');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 1].scheduleId).toBe(scheduleOf2.id);
    });

    // Simple schedule, in bits
    it('should just run 2 songs even if 2 calls', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1, ...all9], [plof2], [scheduleOf2], errs);
        expect(errs.length).toBe(0);

        // This should put it in the middle of the first song
        const logs = plr.readOutScheduleUntil(bt + 18 * 3600 * 1000 + 5 * 1000, 100);
        logs.push(...plr.readOutScheduleUntil(bt + 18 * 3600 * 1000 + 30 * 1000, 100));
        //console.log(toTextLog(logs));
        expect(logs.length).toBe(8);

        expect(logs[0].eventType).toBe('Schedule Started');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[0].scheduleId).toBe(scheduleOf2.id);
        expect(logs[1].eventType).toBe('Playlist Started');
        expect(logs[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[1].scheduleId).toBe(scheduleOf2.id);
        expect(logs[1].playlistId).toBe(plof2.id);
        expect(logs[2].eventType).toBe('Sequence Started');
        expect(logs[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logs[2].sequenceId).toBe(s1.id);
        expect(logs[3].eventType).toBe('Sequence Ended');
        expect(logs[3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[3].sequenceId).toBe(s1.id);
        expect(logs[4].eventType).toBe('Sequence Started');
        expect(logs[4].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[4].sequenceId).toBe(s2.id);

        expect(logs[logs.length - 3].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 3].sequenceId).toBe(s2.id);
        expect(logs[logs.length - 2].eventType).toBe('Playlist Ended');
        expect(logs[logs.length - 2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 2].playlistId).toBe(plof2.id);
        expect(logs[logs.length - 2].scheduleId).toBe(scheduleOf2.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Ended');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 1].scheduleId).toBe(scheduleOf2.id);
    });

    // External events
    it('queue should go back to what it was doing', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1, ...all9], [plof2], [scheduleOf2], errs);
        expect(errs.length).toBe(0);

        // This should put it in the middle of the first song
        const logspre = plr.readOutScheduleUntil(bt + 18 * 3600 * 1000 + 5 * 1000, 100);
        //console.log(toTextLog(logs));
        expect(logspre.length).toBe(3);

        expect(logspre[0].eventType).toBe('Schedule Started');
        expect(logspre[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logspre[0].scheduleId).toBe(scheduleOf2.id);
        expect(logspre[1].eventType).toBe('Playlist Started');
        expect(logspre[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logspre[1].scheduleId).toBe(scheduleOf2.id);
        expect(logspre[1].playlistId).toBe(plof2.id);
        expect(logspre[2].eventType).toBe('Sequence Started');
        expect(logspre[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logspre[2].sequenceId).toBe(s1.id);
        plr.addInteractiveCommand({
            immediate: false,
            startTime: bt + 18 * 3600 * 1000 + 6 * 1000,
            seqId: s3.id,
            requestId: 'aaaaaa',
        });
        const logs = plr.readOutScheduleUntil(bt + 19 * 3600 * 1000, 100);
        expect(logs.length).toBe(13);
        // song ended, sched suspended ; ...(new 1-songsched) ; sched resumed, pl resumed, song start, song end, pl end, sched end
        //console.log(toTextLog(logs));
        expect(logs[0].eventType).toBe('Sequence Ended');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[0].sequenceId).toBe(s1.id);
        expect(logs[1].eventType).toBe('Schedule Suspended');
        expect(logs[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[1].scheduleId).toBe(scheduleOf2.id);

        expect(logs[2].eventType).toBe('Schedule Started');
        expect(logs[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[2].requestId).toBe('aaaaaa');
        expect(logs[3].eventType).toBe('Playlist Started');
        expect(logs[3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[3].requestId).toBe('aaaaaa');
        expect(logs[4].eventType).toBe('Sequence Started');
        expect(logs[4].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 10_000);
        expect(logs[4].sequenceId).toBe(s3.id);
        expect(logs[5].eventType).toBe('Sequence Ended');
        expect(logs[5].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[5].sequenceId).toBe(s3.id);
        expect(logs[6].eventType).toBe('Playlist Ended');
        expect(logs[6].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[6].requestId).toBe('aaaaaa');
        expect(logs[7].eventType).toBe('Schedule Ended');
        expect(logs[7].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[7].requestId).toBe('aaaaaa');

        expect(logs[logs.length - 5].eventType).toBe('Schedule Resumed');
        expect(logs[logs.length - 5].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 5].scheduleId).toBe(scheduleOf2.id);
        expect(logs[logs.length - 4].eventType).toBe('Sequence Started');
        expect(logs[logs.length - 4].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 4].sequenceId).toBe(s2.id);
        expect(logs[logs.length - 3].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 30_000);
        expect(logs[logs.length - 3].sequenceId).toBe(s2.id);
        expect(logs[logs.length - 2].eventType).toBe('Playlist Ended');
        expect(logs[logs.length - 2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 30_000);
        expect(logs[logs.length - 2].playlistId).toBe(plof2.id);
        expect(logs[logs.length - 2].scheduleId).toBe(scheduleOf2.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Ended');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 30_000);
        expect(logs[logs.length - 1].scheduleId).toBe(scheduleOf2.id);
    });

    it('immediate should go back to what it was doing', () => {
        const errs: string[] = [];
        const bdate = new Date(ps1NoLoop.date);
        bdate.setHours(0, 0, 0);
        const bt = bdate.getTime();
        const plr = new PlayerRunState(bt);
        plr.setUpSequences([rec1, ...all9], [plof2], [scheduleOf2], errs);
        expect(errs.length).toBe(0);

        // This should put it in the middle of the first song
        const logspre = plr.readOutScheduleUntil(bt + 18 * 3600 * 1000 + 5 * 1000, 100);
        //console.log(toTextLog(logs));
        expect(logspre.length).toBe(3);

        expect(logspre[0].eventType).toBe('Schedule Started');
        expect(logspre[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logspre[0].scheduleId).toBe(scheduleOf2.id);
        expect(logspre[1].eventType).toBe('Playlist Started');
        expect(logspre[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logspre[1].scheduleId).toBe(scheduleOf2.id);
        expect(logspre[1].playlistId).toBe(plof2.id);
        expect(logspre[2].eventType).toBe('Sequence Started');
        expect(logspre[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000);
        expect(logspre[2].sequenceId).toBe(s1.id);
        plr.addInteractiveCommand({
            immediate: true,
            startTime: bt + 18 * 3600 * 1000 + 6 * 1000,
            seqId: s3.id,
            requestId: 'aaaaaa',
        });
        const logs = plr.readOutScheduleUntil(bt + 19 * 3600 * 1000, 100);
        console.log(toTextLog(logs));
        expect(logs.length).toBe(15);
        // song ended, sched suspended ; ...(new 1-songsched) ; sched resumed, pl resumed, song start, song end, pl end, sched end
        expect(logs[0].eventType).toBe('Sequence Paused');
        expect(logs[0].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 6_000);
        expect(logs[0].sequenceId).toBe(s1.id);
        expect(logs[1].eventType).toBe('Schedule Suspended');
        expect(logs[1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 6_000);
        expect(logs[1].scheduleId).toBe(scheduleOf2.id);

        expect(logs[2].eventType).toBe('Schedule Started');
        expect(logs[2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 6_000);
        expect(logs[2].requestId).toBe('aaaaaa');
        expect(logs[3].eventType).toBe('Playlist Started');
        expect(logs[3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 6_000);
        expect(logs[3].requestId).toBe('aaaaaa');
        expect(logs[4].eventType).toBe('Sequence Started');
        expect(logs[4].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 6_000);
        expect(logs[4].sequenceId).toBe(s3.id);
        expect(logs[5].eventType).toBe('Sequence Ended');
        expect(logs[5].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 16_000);
        expect(logs[5].sequenceId).toBe(s3.id);
        expect(logs[6].eventType).toBe('Playlist Ended');
        expect(logs[6].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 16_000);
        expect(logs[6].requestId).toBe('aaaaaa');
        expect(logs[7].eventType).toBe('Schedule Ended');
        expect(logs[7].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 16_000);
        expect(logs[7].requestId).toBe('aaaaaa');

        expect(logs[logs.length - 7].eventType).toBe('Schedule Resumed');
        expect(logs[logs.length - 7].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 16_000);
        expect(logs[logs.length - 7].scheduleId).toBe(scheduleOf2.id);
        expect(logs[logs.length - 6].eventType).toBe('Sequence Resumed');
        expect(logs[logs.length - 6].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 16_000);
        expect(logs[logs.length - 6].sequenceId).toBe(s1.id);
        expect(logs[logs.length - 5].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 5].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 5].sequenceId).toBe(s1.id);
        expect(logs[logs.length - 4].eventType).toBe('Sequence Started');
        expect(logs[logs.length - 4].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 20_000);
        expect(logs[logs.length - 4].sequenceId).toBe(s2.id);
        expect(logs[logs.length - 3].eventType).toBe('Sequence Ended');
        expect(logs[logs.length - 3].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 30_000);
        expect(logs[logs.length - 3].sequenceId).toBe(s2.id);
        expect(logs[logs.length - 2].eventType).toBe('Playlist Ended');
        expect(logs[logs.length - 2].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 30_000);
        expect(logs[logs.length - 2].playlistId).toBe(plof2.id);
        expect(logs[logs.length - 2].scheduleId).toBe(scheduleOf2.id);
        expect(logs[logs.length - 1].eventType).toBe('Schedule Ended');
        expect(logs[logs.length - 1].eventTime).toBe(bt + 18 * 60 * 60 * 1000 + 30_000);
        expect(logs[logs.length - 1].scheduleId).toBe(scheduleOf2.id);
    });
});
