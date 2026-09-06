import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SequenceRecord } from '@ezplayer/ezplayer-core';
import type { AutoDetectedSongFiles } from './song-file-autodetect.js';

const detectMock = vi.fn<(fseqPath: string) => Promise<AutoDetectedSongFiles>>();
const deriveMock = vi.fn<(item: { audio?: string; normalize?: boolean }, showFolder: string) => Promise<void>>();

vi.mock('./song-file-autodetect.js', () => ({
    autoDetectSongFilesFromFseq: (fseqPath: string) => detectMock(fseqPath),
    listFseqFilesInDirectory: async () => [],
}));

vi.mock('./derived-audio.js', () => ({
    deriveAudioForRecord: (item: { audio?: string; normalize?: boolean }, showFolder: string) =>
        deriveMock(item, showFolder),
}));

const { batchImportSequences } = await import('./batch-sequence-import.js');

const putSequences = async (recs: SequenceRecord[]) => recs;

describe('batchImportSequences audio gating', () => {
    beforeEach(() => {
        detectMock.mockReset();
        deriveMock.mockReset();
        deriveMock.mockResolvedValue(undefined);
    });

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

    it('derives audio before saving and stamps the normalize default on the record', async () => {
        detectMock.mockResolvedValue({
            audioRequired: true,
            headerAudioName: 'song.wav',
            audioFile: 'C:/show/song.wav',
            durationSecs: 42,
        });
        const putSpy = vi.fn(async (recs: SequenceRecord[]) => recs);
        const summary = await batchImportSequences(['C:/show/Song.fseq'], {
            putSequences: putSpy,
            showFolder: 'C:/show',
            normalize: true,
        });
        expect(summary.imported).toBe(1);
        expect(deriveMock).toHaveBeenCalledWith({ audio: 'C:/show/song.wav', normalize: true }, 'C:/show');
        const saved = putSpy.mock.calls[0]?.[0]?.[0];
        expect(saved?.files?.audio).toBe('C:/show/song.wav'); // record keeps the original
        expect(saved?.settings?.normalize).toBe(true);
    });

    it('fails only the sequence whose derivation fails; others still import', async () => {
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
        deriveMock.mockRejectedValueOnce(new Error('ffmpeg conversion failed (exit 1)'));
        const summary = await batchImportSequences(['C:/show/A.fseq', 'C:/show/B.fseq'], {
            putSequences,
            showFolder: 'C:/show',
        });
        expect(summary.imported).toBe(1);
        expect(summary.failed).toBe(1);
        expect(summary.failures[0].fseqName).toBe('A.fseq');
        expect(summary.failures[0].reason).toMatch(/Cannot derive playable audio/);
        expect(summary.successes[0].fseqName).toBe('B.fseq');
    });

    it('fails when the FSEQ header could not be read', async () => {
        detectMock.mockResolvedValue({});
        const summary = await batchImportSequences(['C:/show/Broken.fseq'], { putSequences });
        expect(summary.imported).toBe(0);
        expect(summary.failures[0].reason).toBe('Could not read FSEQ header');
    });
});
