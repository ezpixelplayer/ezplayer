import { describe, expect, it } from 'vitest';
import { getAudioNameFromFseqHeader } from './song-file-autodetect';

describe('getAudioNameFromFseqHeader', () => {
    it('takes the file name from a Windows path on any host', () => {
        expect(getAudioNameFromFseqHeader({ mf: 'C:\\Users\\me\\Music\\song.mp3' })).toBe('song.mp3');
    });
    it('takes the file name from a POSIX path', () => {
        expect(getAudioNameFromFseqHeader({ mf: '/home/me/Music/song.wav' })).toBe('song.wav');
    });
    it('keeps a bare file name', () => {
        expect(getAudioNameFromFseqHeader({ mu: 'song.ogg' })).toBe('song.ogg');
    });
    it('ignores non-audio values and missing headers', () => {
        expect(getAudioNameFromFseqHeader({ mf: 'C:\\show\\notes.txt' })).toBeUndefined();
        expect(getAudioNameFromFseqHeader(undefined)).toBeUndefined();
    });
});
