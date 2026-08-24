import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SequenceRecord } from '@ezplayer/ezplayer-core';
import type { AutoDetectedSongFiles } from './song-file-autodetect.js';

const detectMock = vi.fn<(fseqPath: string) => Promise<AutoDetectedSongFiles>>();
const ensureMp3Mock = vi.fn<(audioPath: string) => Promise<string>>();

vi.mock('./song-file-autodetect.js', () => ({
    autoDetectSongFilesFromFseq: (fseqPath: string) => detectMock(fseqPath),
    listFseqFilesInDirectory: async () => [],
}));

vi.mock('./audio-convert.js', () => ({
    needsMp3Conversion: (audioPath: string) => !audioPath.toLowerCase().endsWith('.mp3'),
    ensureMp3AudioFile: (audioPath: string) => ensureMp3Mock(audioPath),
}));

const { batchImportSequences } = await import('./batch-sequence-import.js');

const putSequences = async (recs: SequenceRecord[]) => recs;

describe('batchImportSequences audio gating', () => {
    beforeEach(() => {
        detectMock.mockReset();
        ensureMp3Mock.mockReset();
    });

    it('imports an animation (no media named in the header) without audio', async () => {
        detectMock.mockResolvedValue({ audioRequired: false, durationSecs: 42 });
        const summary = await batchImportSequences(['C:/show/Animation.fseq'], { putSequences });
        expect(summary.failed).toBe(0);
        expect(summary.imported).toBe(1);
        expect(summary.successes[0]).toMatchObject({ fseqName: 'Animation.fseq', mediaFound: false });
        expect(ensureMp3Mock).not.toHaveBeenCalled();
    });

    it('fails a musical sequence whose header-named audio is missing', async () => {
        detectMock.mockResolvedValue({ audioRequired: true, headerAudioName: 'song.mp3', durationSecs: 42 });
        const summary = await batchImportSequences(['C:/show/Song.fseq'], { putSequences });
        expect(summary.imported).toBe(0);
        expect(summary.failures[0].reason).toBe('Audio file not found (song.mp3)');
        expect(ensureMp3Mock).not.toHaveBeenCalled();
    });

    it('imports a musical sequence when its MP3 audio resolves (unchanged path)', async () => {
        detectMock.mockResolvedValue({
            audioRequired: true,
            headerAudioName: 'song.mp3',
            audioFile: 'C:/show/song.mp3',
            durationSecs: 42,
        });
        const summary = await batchImportSequences(['C:/show/Song.fseq'], { putSequences });
        expect(summary.imported).toBe(1);
        expect(summary.successes[0].mediaFound).toBe(true);
        expect(ensureMp3Mock).not.toHaveBeenCalled();
    });

    it('converts non-MP3 companion audio before import', async () => {
        detectMock.mockResolvedValue({
            audioRequired: true,
            headerAudioName: 'song.wav',
            audioFile: 'C:/show/song.wav',
            durationSecs: 42,
        });
        ensureMp3Mock.mockResolvedValue('C:/show/song.mp3');
        const putSpy = vi.fn(async (recs: SequenceRecord[]) => recs);
        const summary = await batchImportSequences(['C:/show/Song.fseq'], { putSequences: putSpy });
        expect(summary.imported).toBe(1);
        expect(ensureMp3Mock).toHaveBeenCalledWith('C:/show/song.wav');
        const saved = putSpy.mock.calls[0]?.[0]?.[0];
        expect(saved?.files?.audio).toBe('C:/show/song.mp3');
    });

    it('fails only the sequence whose conversion fails; others still import', async () => {
        detectMock
            .mockResolvedValueOnce({
                audioRequired: true,
                headerAudioName: 'a.wav',
                audioFile: 'C:/show/a.wav',
                durationSecs: 10,
            })
            .mockResolvedValueOnce({
                audioRequired: true,
                headerAudioName: 'b.mp3',
                audioFile: 'C:/show/b.mp3',
                durationSecs: 10,
            });
        ensureMp3Mock.mockRejectedValueOnce(new Error('ffmpeg missing'));
        const summary = await batchImportSequences(['C:/show/A.fseq', 'C:/show/B.fseq'], { putSequences });
        expect(summary.imported).toBe(1);
        expect(summary.failed).toBe(1);
        expect(summary.failures[0].fseqName).toBe('A.fseq');
        expect(summary.failures[0].reason).toMatch(/Audio conversion failed/);
        expect(summary.successes[0].fseqName).toBe('B.fseq');
    });

    it('fails when the FSEQ header could not be read', async () => {
        detectMock.mockResolvedValue({});
        const summary = await batchImportSequences(['C:/show/Broken.fseq'], { putSequences });
        expect(summary.imported).toBe(0);
        expect(summary.failures[0].reason).toBe('Could not read FSEQ header');
    });
});
