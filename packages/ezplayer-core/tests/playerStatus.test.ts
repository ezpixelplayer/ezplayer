import { describe, it, expect } from 'vitest';

import type { PlayerPStatusContent, PlayingItem } from '../src/types/DataTypes';
import { activeRequestFor, isPlaybackActive } from '../src/util/playerStatus';

describe('isPlaybackActive', () => {
    it('counts a graceful stop as still playing', () => {
        // The current song and any outro still play, so it must stay controllable.
        expect(isPlaybackActive('Stopping')).toBe(true);
    });

    it('is true while playing or paused, false once stopped or unknown', () => {
        expect(isPlaybackActive('Playing')).toBe(true);
        expect(isPlaybackActive('Paused')).toBe(true);
        expect(isPlaybackActive('Stopped')).toBe(false);
        expect(isPlaybackActive(undefined)).toBe(false);
    });

    it('is false for FPP heartbeat states, which say nothing about playback', () => {
        expect(isPlaybackActive('Up')).toBe(false);
        expect(isPlaybackActive('Down')).toBe(false);
    });
});

describe('activeRequestFor', () => {
    const base: PlayerPStatusContent = { ptype: 'EZP', status: 'Playing', reported_time: 0 };
    const song = (extra: Partial<PlayingItem>): PlayingItem => ({
        type: 'Scheduled',
        item: 'Song',
        title: 'A',
        sequence_id: 'A',
        ...extra,
    });

    it('finds the request playing a song on demand', () => {
        const p = { ...base, now_playing: song({ request_id: 'r1' }) };
        expect(activeRequestFor(p, { songId: 'A' })).toBe('r1');
        expect(activeRequestFor(p, { songId: 'B' })).toBeUndefined();
    });

    it('ignores a song that is playing as part of a schedule', () => {
        const p = { ...base, now_playing: song({ schedule_id: 'show' }) };
        expect(activeRequestFor(p, { songId: 'A' })).toBeUndefined();
    });

    it('attributes a requested playlist to the playlist, not to the song inside it', () => {
        const p = { ...base, now_playing: song({ request_id: 'r2', playlist_id: 'pl' }) };
        expect(activeRequestFor(p, { playlistId: 'pl' })).toBe('r2');
        expect(activeRequestFor(p, { playlistId: 'other' })).toBeUndefined();
        expect(activeRequestFor(p, { songId: 'A' })).toBeUndefined();
    });

    it('finds an immediate request that has been accepted but has not started', () => {
        const p: PlayerPStatusContent = {
            ...base,
            now_playing: song({ schedule_id: 'show', sequence_id: 'Z' }),
            queue: [song({ type: 'Immediate', request_id: 'r3' })],
        };
        expect(activeRequestFor(p, { songId: 'A' })).toBe('r3');
    });

    it('leaves a request that is only queued to the queue', () => {
        const p: PlayerPStatusContent = { ...base, queue: [song({ type: 'Queued', request_id: 'q1' })] };
        expect(activeRequestFor(p, { songId: 'A' })).toBeUndefined();
    });

    it('is undefined with no status', () => {
        expect(activeRequestFor(undefined, { songId: 'A' })).toBeUndefined();
    });
});
