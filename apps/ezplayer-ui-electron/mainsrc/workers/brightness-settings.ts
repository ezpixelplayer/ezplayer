/**
 * Output brightness as a setting, for the API surfaces that read or write it.
 *
 * The playback worker slews the live brightness and color temperature toward
 * what the settings say (`brightnessLevel.ts` in ezplayer-core): the defaults,
 * or the schedule window in effect. So a brightness "set" here is a write of
 * the default, not a live override; a live override would be slewed straight
 * back. Mirrors `volume-settings.ts`, with one control instead of one per output.
 */

import * as crypto from 'crypto';
import type {
    BrightnessControlState,
    BrightnessScheduleEntry,
    PlaybackSettings,
    PlayerPStatusContent,
} from '@ezplayer/ezplayer-core';
import {
    clampColorTemperature,
    COLOR_TEMPERATURE_MAX_K,
    COLOR_TEMPERATURE_MIN_K,
    COLOR_TEMPERATURE_NEUTRAL_K,
    getActiveBrightnessSchedule,
} from '@ezplayer/ezplayer-core';

type ScheduleDays = BrightnessScheduleEntry['days'];

export interface BrightnessOverview {
    /** 0-100. */
    defaultBrightness: number;
    /** Kelvin; `COLOR_TEMPERATURE_NEUTRAL_K` when unset. */
    defaultColorTemperature: number;
    schedule: BrightnessScheduleEntry[];
    /** The window in effect now; the defaults apply while this is null. */
    activeWindow: BrightnessScheduleEntry | null;
    /** Live (slewed) values from player status, when known. */
    level?: number;
    colorTemperature?: number;
}

export type BrightnessWriteResult =
    { ok: true; settings: PlaybackSettings } | { ok: false; status: number; error: string };

export const FALLBACK_BRIGHTNESS_CONTROL: BrightnessControlState = { defaultBrightness: 100 };

function clampLevel(level: number): number {
    return Math.max(0, Math.min(100, Math.round(level)));
}

export function describeBrightness(
    settings: PlaybackSettings,
    pStatus?: PlayerPStatusContent,
    now: Date = new Date(),
): BrightnessOverview {
    const control = settings.brightnessControl ?? FALLBACK_BRIGHTNESS_CONTROL;
    return {
        defaultBrightness: clampLevel(control.defaultBrightness ?? 100),
        defaultColorTemperature: clampColorTemperature(control.defaultColorTemperature),
        schedule: control.schedule ?? [],
        activeWindow: getActiveBrightnessSchedule(control, now),
        level: pStatus?.brightness?.level,
        colorTemperature: pStatus?.brightness?.colorTemperature,
    };
}

export function describeWindow(w: BrightnessScheduleEntry): string {
    const temp = w.colorTemperature !== undefined ? `, ${w.colorTemperature} K` : '';
    return `${w.startTime}-${w.endTime} at ${w.brightness}%${temp}`;
}

function withControl(
    settings: PlaybackSettings,
    update: (control: BrightnessControlState) => BrightnessControlState,
): BrightnessWriteResult {
    return {
        ok: true,
        settings: { ...settings, brightnessControl: update(settings.brightnessControl ?? FALLBACK_BRIGHTNESS_CONTROL) },
    };
}

/** Set the default brightness and/or color temperature. Either may be omitted. */
export function setDefaultBrightness(
    settings: PlaybackSettings,
    brightness: unknown,
    colorTemperature?: unknown,
): BrightnessWriteResult {
    if (brightness === undefined && colorTemperature === undefined) {
        return { ok: false, status: 400, error: 'brightness (0-100) and/or colorTemperature (kelvin) required' };
    }
    if (brightness !== undefined && (typeof brightness !== 'number' || !Number.isFinite(brightness))) {
        return { ok: false, status: 400, error: 'brightness must be a number 0-100' };
    }
    if (
        colorTemperature !== undefined &&
        (typeof colorTemperature !== 'number' || !Number.isFinite(colorTemperature))
    ) {
        return {
            ok: false,
            status: 400,
            error: `colorTemperature must be a number of kelvin ${COLOR_TEMPERATURE_MIN_K}-${COLOR_TEMPERATURE_MAX_K}`,
        };
    }
    return withControl(settings, (c) => {
        const next = { ...c };
        if (brightness !== undefined) next.defaultBrightness = clampLevel(brightness as number);
        if (colorTemperature !== undefined) {
            const k = clampColorTemperature(colorTemperature as number);
            if (k === COLOR_TEMPERATURE_NEUTRAL_K) delete next.defaultColorTemperature;
            else next.defaultColorTemperature = k;
        }
        return next;
    });
}

const SCHEDULE_DAYS = new Set<ScheduleDays>([
    'all',
    'weekend-fri-sat',
    'weekend-sat-sun',
    'weekday-mon-fri',
    'weekday-sun-thu',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
]);
// HH:MM; HH may run past 24 for a window that crosses midnight.
const TIME_RE = /^\d{1,3}:[0-5]\d$/;

function parseWindow(raw: unknown, index: number): BrightnessScheduleEntry | string {
    const at = `schedule[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `${at} must be an object`;
    const w = raw as Record<string, unknown>;
    if (!SCHEDULE_DAYS.has(w.days as ScheduleDays)) return `${at}.days must be one of ${[...SCHEDULE_DAYS].join(', ')}`;
    if (typeof w.startTime !== 'string' || !TIME_RE.test(w.startTime)) return `${at}.startTime must be HH:MM`;
    if (typeof w.endTime !== 'string' || !TIME_RE.test(w.endTime)) return `${at}.endTime must be HH:MM`;
    if (typeof w.brightness !== 'number' || !Number.isFinite(w.brightness)) {
        return `${at}.brightness must be a number 0-100`;
    }
    if (
        w.colorTemperature !== undefined &&
        (typeof w.colorTemperature !== 'number' || !Number.isFinite(w.colorTemperature))
    ) {
        return `${at}.colorTemperature must be a number of kelvin ${COLOR_TEMPERATURE_MIN_K}-${COLOR_TEMPERATURE_MAX_K}`;
    }
    if (w.id !== undefined && typeof w.id !== 'string') return `${at}.id must be a string`;
    const entry: BrightnessScheduleEntry = {
        id: typeof w.id === 'string' && w.id ? w.id : crypto.randomUUID(),
        days: w.days as ScheduleDays,
        startTime: w.startTime,
        endTime: w.endTime,
        brightness: clampLevel(w.brightness),
    };
    if (w.colorTemperature !== undefined) entry.colorTemperature = clampColorTemperature(w.colorTemperature as number);
    return entry;
}

/** Replace the schedule windows with a validated list. */
export function replaceBrightnessSchedule(settings: PlaybackSettings, raw: unknown): BrightnessWriteResult {
    if (!Array.isArray(raw)) return { ok: false, status: 400, error: 'schedule must be an array of windows' };
    const windows: BrightnessScheduleEntry[] = [];
    for (let i = 0; i < raw.length; i++) {
        const parsed = parseWindow(raw[i], i);
        if (typeof parsed === 'string') return { ok: false, status: 400, error: parsed };
        windows.push(parsed);
    }
    return withControl(settings, (c) => ({ ...c, schedule: windows }));
}
