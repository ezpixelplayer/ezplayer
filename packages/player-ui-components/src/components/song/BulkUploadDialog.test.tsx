// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    upload: vi.fn(),
    headerAudio: vi.fn(),
}));
vi.mock('react-redux', () => ({
    useDispatch: () => mocks.dispatch,
    useSelector: (select: (state: unknown) => unknown) =>
        select({
            sequences: {
                sequenceData: [{ id: 'old', files: { fseq: 'C:\\show\\Old.fseq' } }],
            },
        }),
}));
vi.mock('../../store/slices/SequenceStore', () => ({
    listShowFiles: (dir: string) => ({ kind: 'list', dir }),
    batchUploadImportShowSequences: (args: unknown) => ({ kind: 'upload', args }),
}));
vi.mock('../../util/fsequtil', () => ({
    getFSEQAudioNameBrowser: (file: File) => mocks.headerAudio(file),
}));

import { BulkUploadDialog } from './BulkUploadDialog';

const listings: Record<string, string[]> = {
    sequences: ['Old.fseq'],
    music: ['OnPlayer.mp3'],
    media: ['InMedia.mp3'],
};

beforeEach(() => {
    vi.stubGlobal('React', React);
    mocks.upload.mockReset().mockResolvedValue({
        total: 1,
        imported: 1,
        failed: 0,
        successes: [],
        failures: [],
        uploadedFiles: ['Song.mp3', 'Show.fseq', 'Wait.fseq'],
    });
    mocks.headerAudio.mockReset().mockImplementation(async (file: File) => {
        if (file.name === 'Show.fseq') return 'C:\\Music\\Song.mp3';
        if (file.name === 'Wait.fseq') return 'Missing.mp3';
        if (file.name === 'Player.fseq') return 'OnPlayer.mp3';
        if (file.name === 'Old.fseq') return 'Old.mp3';
        return undefined;
    });
    mocks.dispatch.mockReset().mockImplementation((action: { kind: string; dir?: string; args?: unknown }) => ({
        unwrap: () =>
            action.kind === 'list' ? Promise.resolve(listings[action.dir!] ?? []) : mocks.upload(action.args),
    }));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function addFiles(names: string[]) {
    const input = screen.getByLabelText('Add files') as HTMLInputElement;
    fireEvent.change(input, { target: { files: names.map((name) => new File(['x'], name)) } });
}

describe('BulkUploadDialog', () => {
    it('shows what each file will become before anything is sent', async () => {
        render(<BulkUploadDialog open onClose={vi.fn()} onDone={vi.fn()} />);
        await screen.findByText('No files chosen yet.');
        addFiles(['Show.fseq', 'Song.mp3', 'Wait.fseq', 'Player.fseq', 'Old.fseq', 'Loose.wav', 'notes.txt']);
        await screen.findByText('Songs to add (2)');
        expect(screen.getByText(/Audio Song.mp3 from this upload/)).toBeTruthy();
        expect(screen.getByText(/Audio OnPlayer.mp3 already on the player/)).toBeTruthy();
        expect(screen.getByText('Stored for later (2)')).toBeTruthy();
        expect(screen.getByText(/Needs Missing.mp3/)).toBeTruthy();
        expect(screen.getByText('Not added (2)')).toBeTruthy();
        expect(screen.getByText(/Already in the song list/)).toBeTruthy();
        expect(screen.getByText('Not a sequence, audio, or image file')).toBeTruthy();
        expect(screen.getByText(/Upload 6 files/).textContent).toMatch(/add 2 songs/);
        expect(mocks.upload).not.toHaveBeenCalled();
    });

    it('uploads the batch with the exact import set and reports stored files', async () => {
        const onDone = vi.fn();
        render(<BulkUploadDialog open onClose={vi.fn()} onDone={onDone} />);
        await screen.findByText('No files chosen yet.');
        addFiles(['Show.fseq', 'Song.mp3', 'Wait.fseq']);
        await screen.findByText('Songs to add (1)');
        fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
        await waitFor(() => expect(onDone).toHaveBeenCalled());
        const args = mocks.upload.mock.calls[0][0] as {
            files: { name: string }[];
            companionAudioNames: string[];
            importFseqNames: string[];
        };
        expect(args.files.map((f) => f.name)).toEqual(['Song.mp3', 'Show.fseq', 'Wait.fseq']);
        expect(args.companionAudioNames).toEqual(['Song.mp3']);
        expect(args.importFseqNames).toEqual(['Show.fseq']);
        expect(onDone.mock.calls[0][1]).toEqual([{ name: 'Wait.fseq', reason: 'Needs Missing.mp3' }]);
    });

    it('keeps player copies when replace is unchecked', async () => {
        render(<BulkUploadDialog open onClose={vi.fn()} onDone={vi.fn()} />);
        await screen.findByText('No files chosen yet.');
        addFiles(['Player.fseq', 'OnPlayer.mp3']);
        await screen.findByText('Songs to add (1)');
        fireEvent.click(screen.getByLabelText('Replace files already on the player'));
        await screen.findByText(/Upload 1 file\b/);
        expect(screen.getByText(/Keeps the copy on the player/)).toBeTruthy();
    });
});
