import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SequenceRecord } from '@ezplayer/ezplayer-core';
import type { AutoDetectedSongFiles } from './song-file-autodetect.js';

const detectMock = vi.fn<(fseqPath: string) => Promise<AutoDetectedSongFiles>>();

vi.mock('./song-file-autodetect.js', () => ({
    autoDetectSongFilesFromFseq: (fseqPath: string) => detectMock(fseqPath),
    listFseqFilesInDirectory: async () => [],
}));

const { batchImportSequences } = await import('./batch-sequence-import.js');

const putSequences = async (recs: SequenceRecord[]) => recs;

describe('batchImportSequences audio gating', () => {
    beforeEach(() => detectMock.mockReset());

    it('imports an animation (no media named in the header) without audio', async () => {
        detectMock.mockResolvedValue({ audioRequired: false, durationSecs: 42 });
        const summary = await batchImportSequences(['C:/show/Animation.fseq'], { putSequences });
        expect(summary.failed).toBe(0);
        expect(summary.imported).toBe(1);
        expect(summary.successes[0]).toMatchObject({ fseqName: 'Animation.fseq', mediaFound: false });
    });

    it('fails a musical sequence whose header-named audio is missing', async () => {
        detectMock.mockResolvedValue({ audioRequired: true, headerAudioName: 'song.mp3', durationSecs: 42 });
        const summary = await batchImportSequences(['C:/show/Song.fseq'], { putSequences });
        expect(summary.imported).toBe(0);
        expect(summary.failures[0].reason).toBe('Audio file not found (song.mp3)');
    });

    it('imports a musical sequence when its audio resolves', async () => {
        detectMock.mockResolvedValue({
            audioRequired: true,
            headerAudioName: 'song.mp3',
            audioFile: 'C:/show/song.mp3',
            durationSecs: 42,
        });
        const summary = await batchImportSequences(['C:/show/Song.fseq'], { putSequences });
        expect(summary.imported).toBe(1);
        expect(summary.successes[0].mediaFound).toBe(true);
    });

    it('fails when the FSEQ header could not be read', async () => {
        detectMock.mockResolvedValue({});
        const summary = await batchImportSequences(['C:/show/Broken.fseq'], { putSequences });
        expect(summary.imported).toBe(0);
        expect(summary.failures[0].reason).toBe('Could not read FSEQ header');
    });
});
