/**
 * What the output brightness and color temperature should be right now.
 *
 * One resolver for everyone: the playback worker slews toward these targets and
 * reports the live values in `PlayerPStatusContent.brightness`; the API and the
 * settings UI describe the same thing.
 */

import type { BrightnessControlState, BrightnessScheduleEntry } from '../types/DataTypes';
import { getActiveBrightnessSchedule } from './SettingsScheduleUtils';

export const COLOR_TEMPERATURE_MIN_K = 2000;
export const COLOR_TEMPERATURE_NEUTRAL_K = 6500;
export const COLOR_TEMPERATURE_MAX_K = 12000;

export interface BrightnessTarget {
    /** 0..100. */
    brightness: number;
    /** Kelvin, clamped to the supported range. */
    colorTemperature: number;
    /** The window in effect, when one is. */
    window: BrightnessScheduleEntry | null;
}

export function clampBrightness(level: number | undefined): number {
    if (level === undefined || !Number.isFinite(level)) return 100;
    return Math.max(0, Math.min(100, level));
}

export function clampColorTemperature(kelvin: number | undefined): number {
    if (kelvin === undefined || !Number.isFinite(kelvin) || kelvin === 0) return COLOR_TEMPERATURE_NEUTRAL_K;
    return Math.max(COLOR_TEMPERATURE_MIN_K, Math.min(COLOR_TEMPERATURE_MAX_K, kelvin));
}

/** The brightness and color temperature a control calls for at `now`: its
 *  active window, else its defaults, else full and neutral. A window without a
 *  color temperature keeps the default one. */
export function scheduledBrightness(
    control: BrightnessControlState | undefined,
    now: Date = new Date(),
): BrightnessTarget {
    if (!control) return { brightness: 100, colorTemperature: COLOR_TEMPERATURE_NEUTRAL_K, window: null };
    const window = getActiveBrightnessSchedule(control, now);
    return {
        brightness: clampBrightness(window?.brightness ?? control.defaultBrightness),
        colorTemperature: clampColorTemperature(window?.colorTemperature ?? control.defaultColorTemperature),
        window,
    };
}
