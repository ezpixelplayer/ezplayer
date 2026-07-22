import { describe, expect, it } from 'vitest';
import type { PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';
import { fppPlaylistToRecord, recordToFppPlaylist } from './fpp-playlists';

const sequences: SequenceRecord[] = [
    {
        id: 'seq1',
        instanceId: 'i1',
        work: { title: 'Carol', artist: '', length: 180 },
        files: { fseq: 'C:\\show\\Carol.fseq', audio: 'C:\\show\\Carol.mp3' },
    },
    {
        id: 'seq2',
        instanceId: 'i2',
        work: { title: 'Frosty', artist: '', length: 120 },
        files: { fseq: 'C:\\show\\Frosty.fseq' },
    },
];

describe('fppPlaylistToRecord', () => {
    it('flattens sections, resolves by name, skips media/pause with warnings', () => {
        const res = fppPlaylistToRecord(
            {
                name: 'Show',
                leadIn: [{ type: 'sequence', sequenceName: 'Frosty.fseq' }],
                mainPlaylist: [
                    { type: 'both', sequenceName: 'carol.fseq', mediaName: 'Carol.mp3' },
                    { type: 'media', mediaName: 'Announcement.mp3' },
                    { type: 'pause', duration: 5 },
                ],
                leadOut: [],
            },
            'Show',
            [],
            sequences,
        );
        expect(res.error).toBeUndefined();
        expect(res.record!.items.map((i) => i.id)).toEqual(['seq2', 'seq1']);
        expect(res.unresolved).toEqual([]);
        expect(res.warnings.some((w) => w.includes('audio-only'))).toBe(true);
        expect(res.warnings.some((w) => w.includes('pause'))).toBe(true);
        expect(res.warnings.some((w) => w.includes('leadIn/leadOut'))).toBe(true);
    });

    it('keeps id/createdAt when upserting an existing title', () => {
        const existing: PlaylistRecord[] = [
            { id: 'pl-old', title: 'Show', tags: ['x'], createdAt: 123, items: [] },
        ];
        const res = fppPlaylistToRecord(
            { name: 'Show', mainPlaylist: [{ type: 'sequence', sequenceName: 'Carol' }] },
            'show',
            existing,
            sequences,
        );
        expect(res.record!.id).toBe('pl-old');
        expect(res.record!.createdAt).toBe(123);
        expect(res.record!.items).toEqual([{ id: 'seq1', sequence: 1 }]);
    });

    it('reports unresolved sequences and rejects nested playlists', () => {
        const unresolved = fppPlaylistToRecord(
            { mainPlaylist: [{ type: 'sequence', sequenceName: 'Missing.fseq' }] },
            'P',
            [],
            sequences,
        );
        expect(unresolved.unresolved).toEqual(['Missing.fseq']);
        expect(unresolved.record!.items).toEqual([]);

        const nested = fppPlaylistToRecord(
            { mainPlaylist: [{ type: 'playlist', name: 'Inner' }] },
            'P',
            [],
            sequences,
        );
        expect(nested.error).toContain('nested playlist');
    });
});

describe('recordToFppPlaylist', () => {
    it('emits FPP v4 shape with both/sequence types and playlistInfo', () => {
        const pl: PlaylistRecord = {
            id: 'pl1',
            title: 'Show',
            tags: [],
            createdAt: 0,
            items: [
                { id: 'seq1', sequence: 1 },
                { id: 'seq2', sequence: 2 },
            ],
        };
        const fpp = recordToFppPlaylist(pl, sequences);
        expect(fpp.name).toBe('Show');
        expect(fpp.version).toBe(4);
        expect(fpp.mainPlaylist).toEqual([
            {
                type: 'both',
                enabled: 1,
                playOnce: 0,
                sequenceName: 'Carol.fseq',
                mediaName: 'Carol.mp3',
                duration: 180,
            },
            { type: 'sequence', enabled: 1, playOnce: 0, sequenceName: 'Frosty.fseq', duration: 120 },
        ]);
        expect(fpp.playlistInfo).toMatchObject({ total_duration: 300, total_items: 2 });
    });
});
