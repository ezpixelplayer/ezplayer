import { describe, expect, it } from 'vitest';
import type { VirtualMatrixOutput, VirtualMatrixReader } from '@ezplayer/ezplayer-core';
import { matrixRows } from './virtualMatrixHelpers';

const reader = (r: Partial<VirtualMatrixReader>): VirtualMatrixReader => ({
    model: 'Matrix',
    address: 'local',
    idleMs: 20,
    sourceFps: 40,
    servedFps: 40,
    paintedFps: 40,
    ...r,
});

const output = (o: Partial<VirtualMatrixOutput>): VirtualMatrixOutput => ({
    id: 'vm-1',
    model: 'Matrix',
    enabled: true,
    ...o,
});

describe('virtual matrix status rows', () => {
    it('matches a window to its own reader and reports what it shows', () => {
        const rows = matrixRows([output({})], [reader({ output: 'vm-1' })]);
        expect(rows).toEqual([
            { key: 'vm-1', model: 'Matrix', where: 'Full screen', state: 'showing', detail: '40 of 40 fps shown' },
        ]);
    });

    it('calls a window that paints well under the frames made slow', () => {
        const [row] = matrixRows([output({ mode: 'window' })], [reader({ output: 'vm-1', paintedFps: 21.6 })]);
        expect(row.where).toBe('Floating window');
        expect(row.state).toBe('slow');
        expect(row.detail).toBe('21.6 of 40 fps shown');
    });

    it('tells off from enabled but not showing', () => {
        const rows = matrixRows([output({ enabled: false }), output({ id: 'vm-2' })], []);
        expect(rows.map((r) => r.detail)).toEqual(['', 'Not showing']);
        expect(rows.map((r) => r.state)).toEqual(['off', 'unread']);
    });

    it('gives a link the viewers of its model, and says when there are none', () => {
        const link = output({ mode: 'url', enabled: false });
        expect(matrixRows([link], [])[0]).toMatchObject({
            where: 'Link',
            state: 'unread',
            detail: 'Nobody is reading it',
        });
        const rows = matrixRows(
            [link],
            [
                reader({ address: '10.0.0.7', paintedFps: undefined }),
                reader({ address: '10.0.0.8', paintedFps: undefined }),
            ],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].detail).toBe('2 viewers, 40 of 40 fps sent');
    });

    it('lists viewers nobody configured, and drops ones that went quiet', () => {
        const rows = matrixRows(
            [],
            [reader({ model: 'Tree', address: '10.0.0.9' }), reader({ model: 'Arch', idleMs: 20_000 })],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ model: 'Tree', where: 'Viewer at 10.0.0.9', state: 'showing' });
    });

    it('says so when nothing is being made', () => {
        const [row] = matrixRows([output({})], [reader({ output: 'vm-1', sourceFps: 0, servedFps: 0, paintedFps: 0 })]);
        expect(row).toMatchObject({ state: 'idle', detail: 'No frames are being made' });
    });
});
