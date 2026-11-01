import { describe, expect, it } from 'vitest';
import { audioTooLongMessage, formatAudioLength, growReservation, maxAudioSeconds } from './audioLengthLimit';

describe('maxAudioSeconds', () => {
    it('gives a quarter of RAM in 48 kHz stereo Float32, rounded down to a chunk', () => {
        expect(maxAudioSeconds(2e9, 0.25)).toBe(1300);
        expect(maxAudioSeconds(4e9, 0.25)).toBe(2600);
        expect(maxAudioSeconds(8e9, 0.25)).toBe(5205);
    });
    it('never goes below one chunk', () => {
        expect(maxAudioSeconds(1000, 0.25)).toBe(5);
    });
});

describe('growReservation', () => {
    it('doubles without a limit', () => {
        expect(growReservation(900, undefined, 0)).toBe(1800);
    });
    it('stops at the limit', () => {
        expect(growReservation(900, 1300, 2e9)).toBe(1300);
    });
    it('throws once the reservation already meets the limit', () => {
        expect(() => growReservation(1300, 1300, 2e9)).toThrow(/maximum is 21:40/);
    });
});

describe('messages', () => {
    it('formats lengths as m:ss', () => {
        expect(formatAudioLength(1300)).toBe('21:40');
        expect(formatAudioLength(5205)).toBe('86:45');
    });
    it('names the length, the memory, and the maximum', () => {
        expect(audioTooLongMessage(1330, 1300, 2e9)).toBe(
            "Audio of 22:10 is too long for this player's 2.0 GB of memory; the maximum is 21:40.",
        );
        expect(audioTooLongMessage(undefined, 1300, 2e9)).toMatch(/^This audio is too long/);
    });
});
