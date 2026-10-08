// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), upload: vi.fn(), post: vi.fn() }));
vi.mock('react-redux', () => ({
    useDispatch: () => mocks.dispatch,
    useSelector: (select: (state: unknown) => unknown) =>
        select({ sequences: { tags: [] }, playbackSettings: { settings: {} } }),
}));
vi.mock('../..', () => ({
    uploadShowFiles: (files: unknown) => ({ kind: 'upload', files }),
    postSequenceData: (records: unknown) => ({ kind: 'post', records }),
    autodetectShowSequence: () => ({ kind: 'detect' }),
    extractShowAudioMetadata: () => ({ kind: 'metadata' }),
    setSequenceTags: () => ({ kind: 'tags' }),
}));
vi.mock('@ezplayer/shared-ui-components', async () => {
    const { TextField } = await import('@mui/material');
    return {
        TextField,
        ToastMsgs: { showErrorMessage: vi.fn(), showSuccessMessage: vi.fn() },
        FileButton: ({
            fileType,
            onChange,
        }: {
            fileType: string[];
            onChange: React.ChangeEventHandler<HTMLInputElement>;
        }) => <input type="file" aria-label={fileType[0]} onChange={onChange} />,
    };
});
vi.mock('./ServerFilePickerDialog', () => ({ ServerFilePickerDialog: () => null }));
vi.mock('../../util/fsequtil', () => ({ getFSEQDurationMSBrowser: async () => 5000 }));
import { AddSongDialogBrowser } from './AddSongDialogBrowser';
beforeEach(() => {
    vi.stubGlobal('React', React);
    mocks.upload.mockReset().mockResolvedValue(undefined);
    mocks.post.mockReset().mockResolvedValue([]);
    mocks.dispatch.mockReset().mockImplementation((action: { kind: string; files?: unknown; records?: unknown }) => ({
        unwrap: () =>
            action.kind === 'upload'
                ? mocks.upload(action.files)
                : action.kind === 'post'
                  ? mocks.post(action.records)
                  : Promise.resolve({}),
    }));
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
describe('Add Song browser save', () => {
    it.each(['.mp3', '.fseq', '.mp4'])('accepts one %s file and uploads only on Save', async (ext) => {
        const close = vi.fn();
        render(<AddSongDialogBrowser open title="Add Song" onClose={close} />);
        const file = new File(['bytes'], `Song${ext}`);
        fireEvent.change(screen.getByLabelText(ext), { target: { files: [file] } });
        await waitFor(() => expect((screen.getByLabelText(/Song Title/) as HTMLInputElement).value).toBe('Song'));
        expect(mocks.upload).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        expect(mocks.upload).toHaveBeenCalledTimes(1);
        expect(mocks.post).toHaveBeenCalledTimes(1);
        expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.post.mock.invocationCallOrder[0]);
        const key = ext === '.fseq' ? 'fseq' : ext === '.mp3' ? 'audio' : 'video';
        expect(mocks.post.mock.calls[0][0][0].files[key]).toBe(file.name);
    });
    it('keeps upload progress open until the player finishes saving', async () => {
        let finishUpload: () => void = () => {};
        let finishSave: () => void = () => {};
        mocks.upload.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishUpload = resolve;
                }),
        );
        mocks.post.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishSave = resolve;
                }),
        );
        const close = vi.fn();
        render(<AddSongDialogBrowser open title="Add Song" onClose={close} />);
        fireEvent.change(screen.getByLabelText('.mp3'), { target: { files: [new File(['audio'], 'Song.mp3')] } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await screen.findByText('Uploading to player');
        expect(close).not.toHaveBeenCalled();
        finishUpload();
        await screen.findByText('Saving on player');
        await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
        expect(close).not.toHaveBeenCalled();
        finishSave();
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    });
    it('does not save a song when upload fails', async () => {
        mocks.upload.mockRejectedValue(new Error('Connection lost'));
        const close = vi.fn();
        render(<AddSongDialogBrowser open title="Add Song" onClose={close} />);
        fireEvent.change(screen.getByLabelText('.mp3'), { target: { files: [new File(['audio'], 'Song.mp3')] } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false));
        expect(mocks.post).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
});
