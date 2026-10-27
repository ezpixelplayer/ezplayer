import { describe, expect, it } from 'vitest';

import type { ViewerControlState } from '../types/DataTypes';
import {
    hasViewerControlBackend,
    primaryViewerControlType,
    viewerControlBackends,
    viewerControlSchedule,
    viewerControlScheduleList,
    withViewerControlBackends,
} from './viewerControlBackends';

const base: ViewerControlState = { enabled: true, type: 'disabled', schedule: [] };

describe('viewerControlBackends', () => {
    it('derives the set from the legacy single type when backends is absent', () => {
        expect(viewerControlBackends({ ...base, type: 'remote-falcon' })).toEqual(['remote-falcon']);
        expect(viewerControlBackends({ ...base, type: 'ezplayer' })).toEqual(['ezplayer']);
        expect(viewerControlBackends({ ...base, type: 'disabled' })).toEqual([]);
        expect(viewerControlBackends(undefined)).toEqual([]);
    });

    it('prefers the explicit array, in canonical order, ignoring junk', () => {
        const vc = { ...base, type: 'ezplayer' as const, backends: ['ezplayer', 'remote-falcon', 'bogus'] };
        expect(viewerControlBackends(vc as ViewerControlState)).toEqual(['remote-falcon', 'ezplayer']);
    });

    it('is empty whenever the master enabled flag is off', () => {
        expect(viewerControlBackends({ ...base, enabled: false, type: 'ezplayer', backends: ['ezplayer'] })).toEqual(
            [],
        );
        expect(hasViewerControlBackend({ ...base, enabled: false, type: 'ezplayer' }, 'ezplayer')).toBe(false);
    });

    it('names built-in as the primary type when both are on', () => {
        expect(primaryViewerControlType(['remote-falcon', 'ezplayer'])).toBe('ezplayer');
        expect(primaryViewerControlType(['remote-falcon'])).toBe('remote-falcon');
        expect(primaryViewerControlType([])).toBe('disabled');
    });

    it('keeps type and enabled consistent when the set changes', () => {
        const both = withViewerControlBackends(base, ['ezplayer', 'remote-falcon']);
        expect(both).toMatchObject({ backends: ['remote-falcon', 'ezplayer'], type: 'ezplayer', enabled: true });
        const none = withViewerControlBackends(both, []);
        expect(none).toMatchObject({ backends: [], type: 'disabled', enabled: false });
    });
});

describe('viewerControlSchedule', () => {
    const page = { id: 'p', days: 'all' as const, startTime: '17:00', endTime: '23:00', playlist: 'Page' };
    const rf = { id: 'r', days: 'all' as const, startTime: '18:00', endTime: '22:00', playlist: 'RF' };
    const vc: ViewerControlState = { ...base, schedule: [page], remoteFalconSchedule: [rf] };

    it('shares the main schedule unless Remote Falcon is separated', () => {
        expect(viewerControlScheduleList(vc, 'remote-falcon')).toBe('schedule');
        expect(viewerControlSchedule(vc, 'remote-falcon')).toEqual([page]);
        expect(viewerControlSchedule(vc, 'ezplayer')).toEqual([page]);
    });

    it('gives Remote Falcon its own list when separated; the viewer page keeps the main one', () => {
        const sep = { ...vc, separateRemoteFalconSchedule: true };
        expect(viewerControlScheduleList(sep, 'remote-falcon')).toBe('remoteFalconSchedule');
        expect(viewerControlSchedule(sep, 'remote-falcon')).toEqual([rf]);
        expect(viewerControlSchedule(sep, 'ezplayer')).toEqual([page]);
        expect(viewerControlSchedule({ ...base, separateRemoteFalconSchedule: true }, 'remote-falcon')).toEqual([]);
    });
});
