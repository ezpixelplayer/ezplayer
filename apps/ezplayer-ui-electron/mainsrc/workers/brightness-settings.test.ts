import { describe, expect, it } from 'vitest';
import type { PlaybackSettings, PlayerPStatusContent } from '@ezplayer/ezplayer-core';
import {
    describeBrightness,
    describeWindow,
    replaceBrightnessSchedule,
    setDefaultBrightness,
} from './brightness-settings';

// Wednesday 2026-10-28 21:00 local: inside a 20:00-22:00 'all' window.
const IN_WINDOW = new Date(2026, 9, 28, 21, 0);
const OUT_OF_WINDOW = new Date(2026, 9, 28, 15, 0);

const dim = {
    id: 'w1',
    days: 'all' as const,
    startTime: '20:00',
    endTime: '22:00',
    brightness: 40,
    colorTemperature: 2700,
};

function settings(): PlaybackSettings {
    return { brightnessControl: { defaultBrightness: 70, schedule: [dim] } } as PlaybackSettings;
}

describe('describeBrightness', () => {
    it('reports defaults, the window in effect and the live values', () => {
        const pStatus = { brightness: { level: 41, colorTemperature: 2800 } } as PlayerPStatusContent;
        const ov = describeBrightness(settings(), pStatus, IN_WINDOW);
        expect(ov).toMatchObject({
            defaultBrightness: 70,
            defaultColorTemperature: 6500,
            activeWindow: dim,
            level: 41,
            colorTemperature: 2800,
        });
        expect(describeBrightness(settings(), undefined, OUT_OF_WINDOW).activeWindow).toBeNull();
        expect(describeWindow(dim)).toBe('20:00-22:00 at 40%, 2700 K');
    });
    it('describes an absent control as full and neutral', () => {
        const ov = describeBrightness({} as PlaybackSettings);
        expect(ov).toMatchObject({
            defaultBrightness: 100,
            defaultColorTemperature: 6500,
            schedule: [],
            activeWindow: null,
        });
    });
});

describe('setDefaultBrightness', () => {
    it('writes the default, clamped and rounded, without touching the schedule', () => {
        const r = setDefaultBrightness(settings(), 55.6);
        expect(r.ok && r.settings.brightnessControl).toEqual({ defaultBrightness: 56, schedule: [dim] });
        const hi = setDefaultBrightness(settings(), 500);
        expect(hi.ok && hi.settings.brightnessControl?.defaultBrightness).toBe(100);
    });
    it('writes color temperature alone, dropping it when neutral', () => {
        const warm = setDefaultBrightness(settings(), undefined, 3000);
        expect(warm.ok && warm.settings.brightnessControl).toMatchObject({
            defaultBrightness: 70,
            defaultColorTemperature: 3000,
        });
        const neutral = setDefaultBrightness(warm.ok ? warm.settings : settings(), undefined, 6500);
        expect(neutral.ok && 'defaultColorTemperature' in neutral.settings.brightnessControl!).toBe(false);
        const clamped = setDefaultBrightness(settings(), undefined, 100);
        expect(clamped.ok && clamped.settings.brightnessControl?.defaultColorTemperature).toBe(2000);
    });
    it('rejects missing or non-numeric values', () => {
        expect(setDefaultBrightness(settings(), undefined)).toMatchObject({ ok: false, status: 400 });
        expect(setDefaultBrightness(settings(), '50')).toMatchObject({ ok: false, status: 400 });
        expect(setDefaultBrightness(settings(), 50, 'warm')).toMatchObject({ ok: false, status: 400 });
    });
    it('does not mutate the cached settings object', () => {
        const s = settings();
        setDefaultBrightness(s, 10, 2000);
        expect(s.brightnessControl).toEqual({ defaultBrightness: 70, schedule: [dim] });
    });
    it('creates the control when the settings file has none', () => {
        const r = setDefaultBrightness({} as PlaybackSettings, 30);
        expect(r.ok && r.settings.brightnessControl).toEqual({ defaultBrightness: 30 });
    });
});

describe('replaceBrightnessSchedule', () => {
    it('validates each window, clamps, and fills in missing ids', () => {
        const r = replaceBrightnessSchedule(settings(), [
            { days: 'friday', startTime: '18:00', endTime: '26:00', brightness: 120 },
            { id: 'keep', days: 'all', startTime: '00:00', endTime: '06:00', brightness: 10, colorTemperature: 999 },
        ]);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const [a, b] = r.settings.brightnessControl!.schedule!;
        expect(a).toMatchObject({ days: 'friday', brightness: 100 });
        expect(a.id).toMatch(/[0-9a-f-]{36}/);
        expect('colorTemperature' in a).toBe(false);
        expect(b).toEqual({
            id: 'keep',
            days: 'all',
            startTime: '00:00',
            endTime: '06:00',
            brightness: 10,
            colorTemperature: 2000,
        });
        expect(r.settings.brightnessControl!.defaultBrightness).toBe(70);
    });
    it('rejects bad shapes with the offending field', () => {
        const bad = (w: unknown) => replaceBrightnessSchedule(settings(), [w]);
        expect(bad(null)).toMatchObject({ ok: false, status: 400, error: 'schedule[0] must be an object' });
        expect(bad({ days: 'someday', startTime: '1:00', endTime: '2:00', brightness: 1 })).toMatchObject({
            ok: false,
            error: expect.stringContaining('schedule[0].days'),
        });
        expect(bad({ days: 'all', startTime: '1', endTime: '2:00', brightness: 1 })).toMatchObject({
            ok: false,
            error: 'schedule[0].startTime must be HH:MM',
        });
        expect(bad({ days: 'all', startTime: '1:00', endTime: '2:00' })).toMatchObject({
            ok: false,
            error: 'schedule[0].brightness must be a number 0-100',
        });
        expect(
            bad({ days: 'all', startTime: '1:00', endTime: '2:00', brightness: 1, colorTemperature: 'x' }),
        ).toMatchObject({
            ok: false,
            error: expect.stringContaining('colorTemperature'),
        });
        expect(replaceBrightnessSchedule(settings(), {})).toMatchObject({ ok: false, status: 400 });
    });
});
