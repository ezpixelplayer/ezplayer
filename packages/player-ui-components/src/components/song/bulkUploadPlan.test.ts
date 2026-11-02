import { describe, expect, it } from 'vitest';
import { kindOf, planBulkUpload, type PlayerFiles, type StagedFile } from './bulkUploadPlan';

const none: PlayerFiles = { sequences: [], music: [], media: [] };
const fseq = (name: string, headerAudio?: string | null): StagedFile => ({ name, size: 10, kind: 'fseq', headerAudio });
const file = (name: string): StagedFile => ({ name, size: 10, kind: kindOf(name) });

describe('planBulkUpload', () => {
    it('pairs a sequence with the audio its header names, from the selection', () => {
        const plan = planBulkUpload([fseq('Show.fseq', 'Song.mp3'), file('song.MP3')], none, [], true);
        expect(plan.fseqs[0]).toMatchObject({ outcome: 'add', audio: { name: 'song.MP3', source: 'selection' } });
        expect(plan.companions[0].claimedBy).toEqual(['Show.fseq']);
        expect(plan.uploadNames).toEqual(['song.MP3', 'Show.fseq']);
        expect(plan.importFseqNames).toEqual(['Show.fseq']);
        expect(plan.companionAudioNames).toEqual(['song.MP3']);
        expect(plan.stored).toEqual([]);
    });

    it('accepts the same stem with another audio extension, then the sequence stem', () => {
        const plan = planBulkUpload(
            [fseq('A.fseq', 'Song.mp3'), file('Song.wav'), fseq('B.fseq'), file('b.flac')],
            none,
            [],
            true,
        );
        expect(plan.fseqs[0].audio).toEqual({ name: 'Song.wav', source: 'selection' });
        expect(plan.fseqs[1]).toMatchObject({ outcome: 'add', audio: { name: 'b.flac', source: 'selection' } });
    });

    it('uses audio already on the player or in the media folder, preferring the player copy', () => {
        const player: PlayerFiles = { sequences: [], music: ['Song.mp3'], media: ['Song.mp3', 'Other.mp3'] };
        const plan = planBulkUpload([fseq('A.fseq', 'Song.mp3'), fseq('B.fseq', 'Other.mp3')], player, [], true);
        expect(plan.fseqs[0].audio).toEqual({ name: 'Song.mp3', source: 'player' });
        expect(plan.fseqs[1].audio).toEqual({ name: 'Other.mp3', source: 'media' });
        // Media folder audio is not gated by the allowlist, so only the player copy is sent.
        expect(plan.companionAudioNames).toEqual(['Song.mp3']);
        expect(plan.importFseqNames).toEqual(['A.fseq', 'B.fseq']);
    });

    it('stores a sequence whose audio is nowhere, without adding a song', () => {
        const plan = planBulkUpload([fseq('Wait.fseq', 'C:\\Music\\Missing.mp3')], none, [], true);
        expect(plan.fseqs[0]).toMatchObject({ outcome: 'missingAudio', wanted: 'Missing.mp3' });
        expect(plan.uploadNames).toEqual(['Wait.fseq']);
        expect(plan.importFseqNames).toEqual([]);
        expect(plan.stored).toEqual([{ name: 'Wait.fseq', reason: 'Needs Missing.mp3' }]);
    });

    it('imports an animation that names no audio', () => {
        const plan = planBulkUpload([fseq('Anim.fseq')], none, [], true);
        expect(plan.fseqs[0].outcome).toBe('animation');
        expect(plan.importFseqNames).toEqual(['Anim.fseq']);
    });

    it('stores loose audio and artwork for later', () => {
        const plan = planBulkUpload([file('Loose.mp3'), file('Cover.png')], none, [], true);
        expect(plan.importFseqNames).toEqual([]);
        expect(plan.stored).toEqual([
            { name: 'Loose.mp3', reason: 'No sequence in this upload uses it' },
            { name: 'Cover.png', reason: 'Artwork' },
        ]);
    });

    it('attributes artwork to a sequence by stem, or through its audio', () => {
        const plan = planBulkUpload(
            [fseq('Show.fseq', 'Song.mp3'), file('Song.mp3'), file('Song.jpg'), file('Show.png')],
            none,
            [],
            true,
        );
        expect(plan.companions.find((c) => c.name === 'Song.jpg')?.claimedBy).toEqual(['Show.fseq']);
        expect(plan.companions.find((c) => c.name === 'Show.png')?.claimedBy).toEqual(['Show.fseq']);
        expect(plan.stored).toEqual([]);
    });

    it('skips sequences already in the song list and files that cannot be read', () => {
        const plan = planBulkUpload([fseq('Old.fseq', 'Old.mp3'), fseq('Bad.fseq', null)], none, ['old.FSEQ'], true);
        expect(plan.fseqs.map((p) => p.outcome)).toEqual(['alreadyImported', 'unreadable']);
        expect(plan.importFseqNames).toEqual([]);
        expect(plan.uploadNames).toEqual(['Old.fseq']);
    });

    it('keeps player copies when overwrite is off, but still uses them', () => {
        const player: PlayerFiles = { sequences: ['Show.fseq'], music: ['Song.mp3'], media: [] };
        const staged = [fseq('Show.fseq', 'Song.mp3'), file('Song.mp3')];
        const keep = planBulkUpload(staged, player, [], false);
        expect(keep.uploadNames).toEqual([]);
        expect(keep.fseqs[0]).toMatchObject({ outcome: 'add', existsOnPlayer: true, upload: false });
        expect(keep.importFseqNames).toEqual(['Show.fseq']);
        const replace = planBulkUpload(staged, player, [], true);
        expect(replace.uploadNames).toEqual(['Song.mp3', 'Show.fseq']);
    });

    it('ignores files of other kinds', () => {
        const plan = planBulkUpload([file('notes.txt')], none, [], true);
        expect(plan.ignored).toEqual([{ name: 'notes.txt', reason: 'Not a sequence, audio, or image file' }]);
        expect(plan.uploadNames).toEqual([]);
    });
});
