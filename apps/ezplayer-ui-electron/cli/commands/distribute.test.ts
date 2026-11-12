import { describe, expect, it } from 'vitest';
import type { ContentDistReport } from '@ezplayer/ezplayer-core';
import { formatReport, parseArgs, resolveTargetIds } from './distribute.js';

describe('distribute arguments', () => {
    it('collects targets, sequences and flags', () => {
        const parsed = parseArgs([
            'Mega Tree',
            '192.168.1.5',
            '--sequence',
            'a.fseq',
            '--sequence',
            'b.fseq',
            '--check',
            '--json',
        ]);
        expect(parsed).toEqual({
            targets: ['Mega Tree', '192.168.1.5'],
            sequences: ['a.fseq', 'b.fseq'],
            check: true,
            force: false,
            json: true,
        });
    });

    it('refuses a check that is also forced, and an unknown option', () => {
        expect(parseArgs(['--check', '--force'])).toHaveProperty('error');
        expect(parseArgs(['--bogus'])).toHaveProperty('error');
        expect(parseArgs(['--sequence'])).toHaveProperty('error');
    });
});

describe('distribute targets', () => {
    const state = {
        known: [
            { name: 'Mega Tree', address: '192.168.1.60' },
            { name: 'Roof', address: 'roof.local' },
            { name: 'Unplaced' },
        ],
        devices: {
            '192.168.1.60|direct': { id: '192.168.1.60|direct', ip: '192.168.1.60' },
            '192.168.1.61|direct': { id: '192.168.1.61|direct', ip: '192.168.1.61', hostname: 'roof.local' },
        },
    };

    it('names a scanned device by its id, by record name or address', () => {
        expect(resolveTargetIds(state, ['mega tree', 'Roof', '192.168.1.61'])).toEqual({
            ids: ['192.168.1.60|direct', '192.168.1.61|direct', '192.168.1.61|direct'],
            errors: [],
        });
    });

    it('names an unscanned record by its address, and reports the rest', () => {
        expect(resolveTargetIds(state, ['192.168.1.99', 'Unplaced', 'Nobody'])).toEqual({
            ids: ['192.168.1.99|record'],
            errors: ["no known controller named 'Unplaced'", "no known controller named 'Nobody'"],
        });
    });
});

describe('distribute report text', () => {
    const report: ContentDistReport = {
        startedAt: '2026-11-12T14:17:48.000Z',
        finishedAt: '2026-11-12T14:17:50.300Z',
        checkOnly: true,
        cancelled: false,
        trigger: 'manual',
        totals: { targets: 2, targetsFailed: 1, uploaded: 0, skipped: 1, failed: 0, planned: 1, bytes: 0 },
        targets: [
            {
                id: '192.168.1.60|direct',
                label: 'K16MAX-LAB (192.168.1.60)',
                hostName: 'K16MAX-LAB',
                platform: 'FPP',
                version: '9.5',
                supported: true,
                bytesUploaded: 0,
                startedAt: '2026-11-12T14:17:48.000Z',
                finishedAt: '2026-11-12T14:17:50.000Z',
                items: [
                    {
                        kind: 'sequence',
                        name: 'Song.fseq',
                        action: 'planned',
                        reason: 'not on device',
                        bytes: 0,
                        ms: 0,
                    },
                    { kind: 'media', name: 'Song.mp3', action: 'skipped', reason: 'same size', bytes: 0, ms: 0 },
                ],
            },
            {
                id: '192.168.1.70|direct',
                label: 'OldBox (192.168.1.70)',
                hostName: 'OldBox',
                supported: false,
                note: 'FPP 5.5 is too old to take an upload',
                bytesUploaded: 0,
                startedAt: '2026-11-12T14:17:48.000Z',
                finishedAt: '2026-11-12T14:17:48.000Z',
                items: [],
            },
        ],
    };

    it('says what a check would send, device by device', () => {
        const text = formatReport(report);
        expect(text).toContain('Check (nothing sent)');
        expect(text).toContain('2 devices (1 behind): 1 to send, 1 current');
        expect(text).toContain('K16MAX-LAB (192.168.1.60)  FPP 9.5');
        expect(text).toContain('to send  sequence  Song.fseq  (not on device)');
        expect(text).toContain('current  media     Song.mp3  (same size)');
        expect(text).toContain('unsupported: FPP 5.5 is too old to take an upload');
    });

    it('carries the reason a run did nothing', () => {
        const empty: ContentDistReport = {
            ...report,
            targets: [],
            totals: { targets: 0, targetsFailed: 0, uploaded: 0, skipped: 0, failed: 0, planned: 0, bytes: 0 },
            note: 'This show has no songs yet, so there is nothing to send.',
        };
        expect(formatReport(empty)).toContain('This show has no songs yet');
    });
});
