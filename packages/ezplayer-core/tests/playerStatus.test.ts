import { describe, it, expect } from 'vitest';

import { isPlaybackActive } from '../src/util/playerStatus';

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
