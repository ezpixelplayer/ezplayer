import { describe, expect, it } from 'vitest';
import type { PlaybackSettings, PlayerPStatusContent } from '@ezplayer/ezplayer-core';
import {
    activeWindowDescriptions,
    describeVolume,
    headlineDefaultVolume,
    replaceVolumeSchedule,
    setDefaultVolume,
} from './volume-settings';

// Wednesday 2026-10-28 21:00 local: inside a 20:00-22:00 'all' window.
const IN_WINDOW = new Date(2026, 9, 28, 21, 0);
const OUT_OF_WINDOW = new Date(2026, 9, 28, 15, 0);

const quiet = { id: 'w1', days: 'all' as const, startTime: '20:00', endTime: '22:00', volumeLevel: 40 };

function defaultModeSettings(): PlaybackSettings {
    return { volumeControl: { defaultVolume: 70, schedule: [quiet] } } as PlaybackSettings;
}

function outputsModeSettings(): PlaybackSettings {
    return {
        volumeControl: { defaultVolume: 70 },
        useDefaultAudioOutput: false,
        audioOutputs: [
            { id: 'o1', deviceId: 'd1', label: 'Yard', volumeControl: { defaultVolume: 80, schedule: [quiet] } },
            { id: 'o2', deviceId: 'd2', label: 'Porch', volumeControl: { defaultVolume: 60 } },
        ],
    } as PlaybackSettings;
}

describe('describeVolume', () => {
    it('reports the default output with its window and live level', () => {
        const pStatus = { volume: { level: 41 } } as PlayerPStatusContent;
        const ov = describeVolume(defaultModeSettings(), pStatus, IN_WINDOW);
        expect(ov.mode).toBe('default');
        expect(ov.targets).toHaveLength(1);
        expect(ov.targets[0]).toMatchObject({ id: 'default', defaultVolume: 70, activeWindow: quiet, level: 41 });
        expect(activeWindowDescriptions(ov)).toEqual(['System default: 20:00-22:00 at 40%']);
        expect(describeVolume(defaultModeSettings(), undefined, OUT_OF_WINDOW).targets[0].activeWindow).toBeNull();
    });

    it('reports one target per named output, with the loudest default as headline', () => {
        const pStatus = {
            volume: { level: 60, outputs: [{ id: 'o2', label: 'Porch', level: 60 }] },
        } as PlayerPStatusContent;
        const ov = describeVolume(outputsModeSettings(), pStatus, IN_WINDOW);
        expect(ov.mode).toBe('outputs');
        expect(ov.targets.map((t) => [t.id, t.defaultVolume, t.activeWindow?.id ?? null, t.level])).toEqual([
            ['o1', 80, 'w1', undefined],
            ['o2', 60, null, 60],
        ]);
        expect(headlineDefaultVolume(ov)).toBe(80);
        expect(activeWindowDescriptions(ov)).toEqual(['Yard: 20:00-22:00 at 40%']);
    });
});

describe('setDefaultVolume', () => {
    it('writes the default, clamped and rounded, without touching the schedule', () => {
        const r = setDefaultVolume(defaultModeSettings(), 120.4);
        expect(r.ok && r.settings.volumeControl).toEqual({ defaultVolume: 100, schedule: [quiet] });
        expect(setDefaultVolume(defaultModeSettings(), 'loud')).toMatchObject({ ok: false, status: 400 });
        expect(setDefaultVolume(defaultModeSettings(), 50, 'o1')).toMatchObject({ ok: false, status: 404 });
    });

    it('does not mutate the cached settings object', () => {
        const before = defaultModeSettings();
        setDefaultVolume(before, 10);
        expect(before.volumeControl.defaultVolume).toBe(70);
    });

    it('in outputs mode writes every output, or just the named one', () => {
        const all = setDefaultVolume(outputsModeSettings(), 55);
        expect(all.ok && all.settings.audioOutputs?.map((o) => o.volumeControl.defaultVolume)).toEqual([55, 55]);
        const one = setDefaultVolume(outputsModeSettings(), 55, 'o2');
        expect(one.ok && one.settings.audioOutputs?.map((o) => o.volumeControl.defaultVolume)).toEqual([80, 55]);
        expect(one.ok && one.settings.audioOutputs?.[0].volumeControl.schedule).toEqual([quiet]);
        expect(setDefaultVolume(outputsModeSettings(), 55, 'nope')).toMatchObject({ ok: false, status: 404 });
    });
});

describe('replaceVolumeSchedule', () => {
    it('validates each window and fills in missing ids', () => {
        const r = replaceVolumeSchedule(defaultModeSettings(), 'default', [
            { days: 'weekday-mon-fri', startTime: '08:00', endTime: '18:00', volumeLevel: 50 },
            { id: 'keep', days: 'all', startTime: '22:00', endTime: '25:30', volumeLevel: 101 },
        ]);
        expect(r.ok).toBe(true);
        const sched = r.ok ? r.settings.volumeControl.schedule! : [];
        expect(sched[0].id).toBeTruthy();
        expect(sched[1]).toEqual({ id: 'keep', days: 'all', startTime: '22:00', endTime: '25:30', volumeLevel: 100 });
    });

    it('rejects bad shapes with the offending field', () => {
        const bad = (entries: unknown) => replaceVolumeSchedule(defaultModeSettings(), 'default', entries);
        expect(bad({})).toMatchObject({ ok: false, status: 400 });
        expect(bad([{ days: 'someday', startTime: '08:00', endTime: '18:00', volumeLevel: 50 }])).toMatchObject({
            ok: false,
            error: expect.stringContaining('schedule[0].days'),
        });
        expect(bad([{ days: 'all', startTime: '8', endTime: '18:00', volumeLevel: 50 }])).toMatchObject({
            error: expect.stringContaining('startTime'),
        });
        expect(bad([{ days: 'all', startTime: '08:00', endTime: '18:60', volumeLevel: 50 }])).toMatchObject({
            error: expect.stringContaining('endTime'),
        });
        expect(bad([{ days: 'all', startTime: '08:00', endTime: '18:00', volumeLevel: 'x' }])).toMatchObject({
            error: expect.stringContaining('volumeLevel'),
        });
        expect(replaceVolumeSchedule(outputsModeSettings(), 'nope', [])).toMatchObject({ ok: false, status: 404 });
    });

    it('replaces only the named output’s windows', () => {
        const r = replaceVolumeSchedule(outputsModeSettings(), 'o2', [quiet]);
        expect(r.ok && r.settings.audioOutputs?.map((o) => o.volumeControl.schedule?.length ?? 0)).toEqual([1, 1]);
        const cleared = replaceVolumeSchedule(outputsModeSettings(), 'o1', []);
        expect(cleared.ok && cleared.settings.audioOutputs?.map((o) => o.volumeControl.schedule?.length ?? 0)).toEqual([
            0, 0,
        ]);
    });
});
