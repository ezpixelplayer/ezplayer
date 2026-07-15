import { describe, expect, it } from 'vitest';
import type { PlayerPStatusContent, PlaylistRecord, SequenceRecord, ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { buildFppStatus, buildFppdVersion, buildSystemInfo, fppTimeStr } from './fpp-status';

const identity = { hostName: 'testhost', appVersion: '0.5.3', uuid: 'EZP-test', ips: ['192.168.1.50'] };

const seq: SequenceRecord = {
    id: 'seq1',
    instanceId: 'i1',
    work: { title: 'Carol', artist: 'Band', length: 180 },
    files: { fseq: 'C:\\show\\Carol.fseq', audio: 'C:\\show\\Carol.mp3' },
};

const pl: PlaylistRecord = {
    id: 'pl1',
    title: 'Main Show',
    tags: [],
    createdAt: 0,
    items: [
        { id: 'seq0', sequence: 1 },
        { id: 'seq1', sequence: 2 },
        { id: 'seq2', sequence: 3 },
    ],
};

const sched: ScheduledPlaylist = {
    id: 'sch1',
    playlistId: 'pl1',
    title: 'Nightly',
    playlistTitle: 'Main Show',
    date: 0,
    fromTime: '17:00',
    toTime: '22:00',
    duration: 5,
    loop: true,
};

const NOW = 1_784_000_100_000;

function playingPStatus(): PlayerPStatusContent {
    return {
        ptype: 'EZP',
        status: 'Playing',
        reported_time: NOW - 5_000,
        now_playing: {
            type: 'Scheduled',
            item: 'Song',
            title: 'Main Show',
            at: NOW - 65_000, // 65s in
            until: NOW + 115_000, // 115s remaining
            sequence_id: 'seq1',
            playlist_id: 'pl1',
            schedule_id: 'sch1',
        },
        upcoming: [{ type: 'Scheduled', item: 'Schedule', title: 'Late Show', at: NOW + 3_600_000 }],
        volume: { level: 70 },
    };
}

describe('buildFppStatus', () => {
    it('produces the exact FPP playing shape (string/int field types)', () => {
        const s = buildFppStatus(
            { pStatus: playingPStatus(), sequences: [seq], playlists: [pl], schedule: [sched] },
            identity,
            NOW,
        );

        // Golden shape — field types are load-bearing for FPP integrators.
        expect(s).toMatchObject({
            fppd: 'running',
            mode: 2,
            mode_name: 'player',
            status: 1,
            status_name: 'playing',
            volume: 70,
            current_playlist: {
                playlist: 'Main Show',
                description: '',
                type: 'both',
                index: '2', // STRING, 1-based
                count: '3', // STRING
            },
            current_sequence: 'Carol.fseq',
            current_song: 'Carol.mp3',
            seconds_played: '65', // STRING
            seconds_elapsed: '65', // STRING
            milliseconds_elapsed: 65_000, // INT
            seconds_remaining: '115', // STRING
            time_elapsed: '01:05',
            time_remaining: '01:55',
            repeat_mode: '1',
        });
        expect(typeof s.status).toBe('number');
        expect(typeof s.volume).toBe('number');
        expect(typeof s.milliseconds_elapsed).toBe('number');
        expect((s.next_playlist as any).playlist).toBe('Late Show');
        expect((s.scheduler as any).status).toBe('playing');
        expect((s.scheduler as any).nextPlaylist.playlistName).toBe('Late Show');
        expect(s.version).toBe('8.0-EZPlayer-0.5.3');
    });

    it('produces the exact FPP idle shape', () => {
        const s = buildFppStatus(
            { pStatus: { ptype: 'EZP', status: 'Stopped', reported_time: NOW } },
            identity,
            NOW,
        );
        expect(s).toMatchObject({
            status: 0,
            status_name: 'idle',
            current_playlist: { playlist: '', description: '', type: '', index: '0', count: '0' },
            current_sequence: '',
            current_song: '',
            seconds_played: '0',
            seconds_elapsed: '0',
            milliseconds_elapsed: 0,
            seconds_remaining: '0',
            time_elapsed: '00:00',
            time_remaining: '00:00',
            repeat_mode: '0',
        });
    });

    it('freezes elapsed at the pause-time push while paused', () => {
        const p = playingPStatus();
        p.status = 'Paused';
        p.reported_time = NOW - 30_000; // paused 30s ago
        const s = buildFppStatus({ pStatus: p, sequences: [seq], playlists: [pl] }, identity, NOW);
        expect(s.status).toBe(5);
        expect(s.status_name).toBe('paused');
        // elapsed measured to the pause push, not to `now`
        expect(s.seconds_elapsed).toBe('35');
    });

    it('handles a missing pStatus as idle', () => {
        const s = buildFppStatus({}, identity, NOW);
        expect(s.status).toBe(0);
        expect(s.status_name).toBe('idle');
    });

    it('maps graceful stop and suppressed', () => {
        const stopping = buildFppStatus(
            { pStatus: { ...playingPStatus(), status: 'Stopping' } },
            identity,
            NOW,
        );
        expect(stopping.status).toBe(2);
        expect(stopping.status_name).toBe('stopping gracefully');

        const suppressed = buildFppStatus(
            { pStatus: { ...playingPStatus(), status: 'Suppressed' }, sequences: [seq], playlists: [pl] },
            identity,
            NOW,
        );
        expect(suppressed.status).toBe(1);
        expect(suppressed.status_name).toBe('playing');
    });
});

describe('identity endpoints', () => {
    it('system/info advertises an FPP-parseable identity', () => {
        const info = buildSystemInfo(identity, { freemem: 4e9, totalmem: 8e9 });
        expect(info).toMatchObject({
            HostName: 'testhost',
            Platform: 'EZPlayer',
            Mode: 'player',
            Version: '8.0-EZPlayer-0.5.3',
            majorVersion: 8,
            minorVersion: 0,
            uuid: 'EZP-test',
            IPs: ['192.168.1.50'],
        });
        expect(typeof info.majorVersion).toBe('number');
        expect((info.Utilization as any).Memory).toBeCloseTo(50);
    });

    it('fppd/version matches FPP shape', () => {
        expect(buildFppdVersion(identity)).toEqual({
            version: '8.0-EZPlayer-0.5.3',
            majorVersion: 8,
            minorVersion: 0,
            branch: 'EZPlayer',
            fppdAPI: 4,
            Status: 'OK',
        });
    });
});

describe('fppTimeStr', () => {
    it('formats MM:SS and H:MM:SS', () => {
        expect(fppTimeStr(0)).toBe('00:00');
        expect(fppTimeStr(65)).toBe('01:05');
        expect(fppTimeStr(3599)).toBe('59:59');
        expect(fppTimeStr(3661)).toBe('1:01:01');
    });
});
