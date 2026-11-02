// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-redux', () => ({
    useSelector: (select: (state: unknown) => unknown) => select({ playbackSettings: { settings: {} } }),
}));
vi.mock('@ezplayer/shared-ui-components', () => ({ isElectron: () => false }));

import { BulkImportSummaryDialog, uploadedFileRows } from './BulkImportSummaryDialog';

const empty = { total: 0, imported: 0, failed: 0, successes: [], failures: [] };

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('uploadedFileRows', () => {
    it('counts each file once by type, in a fixed order', () => {
        expect(uploadedFileRows(['Song.mp3', 'One.fseq', 'Cover.png', 'Two.FSEQ', 'notes.txt'])).toEqual([
            { label: 'Sequences', count: 2 },
            { label: 'Audio files', count: 1 },
            { label: 'Artwork files', count: 1 },
            { label: 'Other files', count: 1 },
        ]);
    });
});

describe('BulkImportSummaryDialog after a bulk upload', () => {
    it('reports uploads by type and what was stored for later', () => {
        render(
            <BulkImportSummaryDialog
                open
                summary={{ ...empty, uploadedFiles: ['Wait.fseq', 'Loose.mp3'] }}
                stored={[{ name: 'Wait.fseq', reason: 'Needs Song.mp3' }]}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText('Bulk Upload Summary')).toBeTruthy();
        expect(screen.getByText(/Sequences uploaded:/).textContent).toBe('Sequences uploaded: 1');
        expect(screen.getByText(/Audio files uploaded:/).textContent).toBe('Audio files uploaded: 1');
        expect(screen.queryByText(/Added/)).toBeNull();
        expect(screen.getByText('Stored for later')).toBeTruthy();
        expect(screen.getByText('Needs Song.mp3')).toBeTruthy();
    });

    it('keeps the song count for an import that added songs', () => {
        render(
            <BulkImportSummaryDialog
                open
                summary={{
                    ...empty,
                    total: 1,
                    imported: 1,
                    successes: [{ fseqPath: '', fseqName: 'Show.fseq', title: 'T', artist: 'A', mediaFound: true }],
                }}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText('Bulk Import Summary')).toBeTruthy();
        expect(screen.getByText(/Added/).textContent).toBe('Added 1 of 1 song.');
    });
});
