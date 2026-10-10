import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PlayerPStatusContent, PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';
import { buildFppdPlaylistConfig, buildFppdPlaylists, buildPlayerCurrent, buildPlayerStatus } from './fpp-player';
import { gaps } from './shape-check';

// Captured from a real FPP; see __fixtures__/fpp-10.1/README.md.
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'fpp-10.1');
const fpp = (name: string): unknown => JSON.parse(readFileSync(path.join(fixtureDir, `${name}.json`), 'utf8'));

const NOW = 1_789_816_800_000;

// The same show FPP played for the capture: one sequence, no audio.
const song: SequenceRecord = {
    id: 'seq1',
    instanceId: 'i1',
    work: { title: 'RefSong', artist: '', length: 60 },
    files: { fseq: 'RefSong.fseq' },
};
const show: PlaylistRecord = {
    id: 'pl1',
    title: 'RefShow',
    tags: [],
    createdAt: NOW - 60_000,
    items: [{ id: 'seq1', sequence: 1 }],
};

const idle: PlayerPStatusContent = { ptype: 'EZP', status: 'Stopped', reported_time: NOW };
const playing: PlayerPStatusContent = {
    ptype: 'EZP',
    status: 'Playing',
    reported_time: NOW,
    now_playing: {
        type: 'Immediate',
        item: 'Playlist',
        title: 'RefShow',
        at: NOW - 5_000,
        until: NOW + 55_000,
        sequence_id: 'seq1',
        playlist_id: 'pl1',
    },
};
const src = (pStatus: PlayerPStatusContent) => ({ pStatus, sequences: [song], playlists: [show] });

describe('/api/player* against FPP 10.1', () => {
    it('matches FPP’s structure idle and playing', () => {
        // Idle after something has played: the steady state of a running player.
        expect(gaps(buildPlayerStatus(src(idle), NOW), fpp('stopped.player-status'))).toEqual([]);
        expect(gaps(buildPlayerStatus(src(playing), NOW), fpp('playing.player-status'))).toEqual([]);
        expect(gaps(buildPlayerCurrent(src(idle), NOW), fpp('stopped.player-current'))).toEqual([]);
        expect(gaps(buildPlayerCurrent(src(playing), NOW), fpp('playing.player-current'))).toEqual([]);
    });

    it('reports the running playlist and its position', () => {
        const [pl] = buildPlayerStatus(src(playing), NOW).playlists as Record<string, unknown>[];
        expect(pl).toMatchObject({
            name: 'RefShow',
            currentState: 'playing',
            status: 1,
            position: 1,
            size: 1,
            scheduled: false,
            startTime: Math.floor((NOW - 5_000) / 1000),
            currentEntry: {
                type: 'sequence',
                sequenceName: 'RefSong.fseq',
                isPlaying: 1,
                secondsElapsed: 5,
                millisecondsElapsed: 5_000,
                secondsRemaining: 55,
            },
        });
        const [idlePl] = buildPlayerStatus(src(idle), NOW).playlists as Record<string, unknown>[];
        expect(idlePl).toMatchObject({ name: '', currentState: 'idle', status: 0, currentEntry: null });
    });

    it('marks entries before and after the current one', () => {
        const three: PlaylistRecord = {
            ...show,
            items: [
                { id: 'seqA', sequence: 1 },
                { id: 'seq1', sequence: 2 },
                { id: 'seqB', sequence: 3 },
            ],
        };
        const others: SequenceRecord[] = ['seqA', 'seqB'].map((id) => ({
            id,
            instanceId: id,
            work: { title: id, artist: '', length: 30 },
            files: { fseq: `${id}.fseq` },
        }));
        const out = buildFppdPlaylistConfig(
            { pStatus: playing, sequences: [song, ...others], playlists: [three] },
            NOW,
        ) as { mainPlaylist: Record<string, number>[] };
        expect(out.mainPlaylist.map((e) => [e.isStarted, e.isPlaying, e.isFinished])).toEqual([
            [1, 0, 1],
            [1, 1, 0],
            [0, 0, 0],
        ]);
    });
});

describe('/api/fppd/playlists and /api/fppd/playlist/config against FPP 10.1', () => {
    it('matches FPP’s structure idle and playing', () => {
        expect(gaps(buildFppdPlaylists(src(idle), NOW), fpp('idle.fppd-playlists'))).toEqual([]);
        expect(gaps(buildFppdPlaylists(src(playing), NOW), fpp('playing.fppd-playlists'))).toEqual([]);
        expect(gaps(buildFppdPlaylistConfig(src(idle), NOW), fpp('idle.fppd-playlist-config'))).toEqual([]);
        expect(gaps(buildFppdPlaylistConfig(src(playing), NOW), fpp('playing.fppd-playlist-config'))).toEqual([]);
    });

    it('names the running playlist', () => {
        expect(buildFppdPlaylists(src(playing), NOW)).toMatchObject({ playlists: ['RefShow'], Status: 'OK' });
        expect(buildFppdPlaylists(src(idle), NOW)).toMatchObject({ playlists: [] });
    });
});

describe('sequence+media entries against FPP 9.2 and 9.5', () => {
    const withAudio: SequenceRecord = { ...song, files: { fseq: 'RefSong.fseq', audio: 'RefSong.mp3' } };
    const other: SequenceRecord = {
        id: 'seq2',
        instanceId: 'i2',
        work: { title: 'Other', artist: '', length: 30 },
        files: { fseq: 'Other.fseq', audio: 'Other.mp3' },
    };
    const two: PlaylistRecord = {
        ...show,
        items: [
            { id: 'seq2', sequence: 1 },
            { id: 'seq1', sequence: 2 },
        ],
    };
    const bothSrc = { pStatus: playing, sequences: [withAudio, other], playlists: [two] };
    const fpp92 = JSON.parse(
        readFileSync(path.join(fixtureDir, '..', 'fpp-9.2', 'playing-both.player-status.json'), 'utf8'),
    ) as unknown;

    it('matches FPP’s structure', () => {
        expect(gaps(buildPlayerStatus(bothSrc, NOW), fpp92)).toEqual([]);
        // 9.5 adds the media clock to the playing media half; its playlist has
        // the one (playing) entry, so check that one against ours.
        const fpp95 = JSON.parse(
            readFileSync(path.join(fixtureDir, '..', 'fpp-9.5', 'playing-both.player-status.json'), 'utf8'),
        ) as unknown;
        const playingOnly = { ...bothSrc, playlists: [{ ...two, items: [{ id: 'seq1', sequence: 1 }] }] };
        expect(gaps(buildPlayerStatus(playingOnly, NOW), fpp95)).toEqual([]);
    });

    it('nests the media and sequence halves with elapsed time', () => {
        const [pl] = buildPlayerStatus(bothSrc, NOW).playlists as Record<string, unknown>[];
        const elapsed = { secondsElapsed: 5, millisecondsElapsed: 5_000, secondsRemaining: 55 };
        expect(pl.currentEntry).toMatchObject({
            type: 'both',
            duration: 60,
            timecode: 'Default',
            videoOut: '--Default--',
            media: { type: 'media', mediaFilename: 'RefSong.mp3', secondsTotal: 0, minutesTotal: 1, ...elapsed },
            sequence: { type: 'sequence', sequenceName: 'RefSong.fseq', ...elapsed },
        });
        const prev = (pl.details as { mainPlaylist: Record<string, Record<string, unknown>>[] }).mainPlaylist[0];
        expect(prev.media).toMatchObject({ type: 'media', mediaFilename: 'Other.mp3', isFinished: 1 });
        expect(prev.sequence).not.toHaveProperty('secondsElapsed');
    });

    it('sorts keys like FPP', () => {
        const [pl] = buildPlayerStatus(bothSrc, NOW).playlists as Record<string, unknown>[];
        const keys = Object.keys(pl);
        expect(keys).toEqual([...keys].sort());
    });
});
