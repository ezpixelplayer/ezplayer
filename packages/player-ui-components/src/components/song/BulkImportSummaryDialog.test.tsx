// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
vi.mock('react-redux', () => ({
    useSelector: (select: (state: unknown) => unknown) => select({ playbackSettings: { settings: {} } }),
}));
vi.mock('@ezplayer/shared-ui-components', () => ({ isElectron: () => false }));
import { BulkImportSummaryDialog } from './BulkImportSummaryDialog';
beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
const empty = { total: 0, imported: 0, failed: 0, successes: [], failures: [] };
describe('Upload results by file type', () => {
    it('shows audio success without a zero-sequence row', () => {
        render(<BulkImportSummaryDialog open summary={{ ...empty, uploadedFiles: ['Song.MP3'] }} onClose={vi.fn()} />);
        expect(screen.getByText(/Audio files: uploaded/).textContent).toBe(
            'Audio files: uploaded 1 of 1 successfully.',
        );
        expect(screen.queryByText(/Imported/)).toBeNull();
        expect(screen.queryByText(/Sequences:/)).toBeNull();
    });
    it('shows separate counts for mixed uploads', () => {
        render(
            <BulkImportSummaryDialog
                open
                summary={{
                    ...empty,
                    uploadedFiles: ['One.fseq', 'Two.FSEQ', 'Song.mp3', 'Other.wav', 'Intro.mp4', 'Cover.png'],
                }}
                onClose={vi.fn()}
            />,
        );
        for (const [label, count] of [
            ['Sequences', 2],
            ['Audio files', 2],
            ['Video files', 1],
            ['Artwork files', 1],
        ]) {
            expect(screen.getByText(new RegExp(`${label}: uploaded`)).textContent).toBe(
                `${label}: uploaded ${count} of ${count} successfully.`,
            );
        }
    });
    it('keeps catalog failures visible separately from saved file counts', () => {
        render(
            <BulkImportSummaryDialog
                open
                summary={{
                    ...empty,
                    total: 1,
                    failed: 1,
                    uploadedFiles: ['Bad.fseq'],
                    failures: [{ fseqName: 'Bad.fseq', fseqPath: 'Bad.fseq', reason: 'Invalid FSEQ' }],
                }}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText(/Sequences: uploaded/).textContent).toContain('1 of 1 successfully');
        expect(screen.getByText(/Imported/).textContent).toContain('0 of 1');
        expect(screen.getByText('Invalid FSEQ')).toBeTruthy();
    });
});
