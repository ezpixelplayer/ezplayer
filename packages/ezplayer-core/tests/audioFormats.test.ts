import { describe, it, expect } from 'vitest';
import {
    CONVERTIBLE_AUDIO_EXTENSIONS,
    audioExtension,
    isSupportedAudioName,
    needsAudioConversion,
    songVolumeScale,
} from '../src/util/audioFormats';

describe('audioFormats', () => {
    it('extracts lower-cased extensions across path styles', () => {
        expect(audioExtension('Song.MP3')).toBe('.mp3');
        expect(audioExtension('C:\\show\\Song.Wav')).toBe('.wav');
        expect(audioExtension('/show/song.flac')).toBe('.flac');
        expect(audioExtension('noext')).toBe('');
        expect(audioExtension('dir.with.dot/noext')).toBe('');
    });

    it('classifies supported and convertible names', () => {
        expect(isSupportedAudioName('a.mp3')).toBe(true);
        expect(needsAudioConversion('a.mp3')).toBe(false);
        for (const ext of CONVERTIBLE_AUDIO_EXTENSIONS) {
            expect(isSupportedAudioName(`a${ext}`)).toBe(true);
            expect(needsAudioConversion(`a${ext}`)).toBe(true);
        }
        expect(isSupportedAudioName('a.txt')).toBe(false);
        expect(needsAudioConversion('a.txt')).toBe(false);
    });

    it('maps volume_adj percent to an amplitude scale', () => {
        expect(songVolumeScale(0)).toBe(1);
        expect(songVolumeScale(-100)).toBe(0);
        expect(songVolumeScale(100)).toBe(2);
        expect(songVolumeScale(50)).toBe(1.5);
        expect(songVolumeScale(-25)).toBe(0.75);
        // Out-of-range and junk inputs are safe.
        expect(songVolumeScale(1000)).toBe(2);
        expect(songVolumeScale(-1000)).toBe(0);
        expect(songVolumeScale(undefined)).toBe(1);
        expect(songVolumeScale(Number.NaN)).toBe(1);
    });
});
