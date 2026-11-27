import { describe, expect, it } from 'vitest';

import type { BrightnessScheduleEntry } from '../types/DataTypes';
import { COLOR_TEMPERATURE_NEUTRAL_K, clampColorTemperature, scheduledBrightness } from './brightnessLevel';

// Wednesday 2026-10-07 21:30 local.
const WED_2130 = new Date(2026, 9, 7, 21, 30);
const WED_0900 = new Date(2026, 9, 7, 9, 0);

const dimNights: BrightnessScheduleEntry = {
    id: 'd',
    days: 'all',
    startTime: '21:00',
    endTime: '23:00',
    brightness: 40,
};
const warmNights: BrightnessScheduleEntry = { ...dimNights, id: 'w', colorTemperature: 2700 };

describe('scheduledBrightness', () => {
    it('window, else default, else full and neutral', () => {
        expect(scheduledBrightness({ defaultBrightness: 80, schedule: [dimNights] }, WED_2130)).toMatchObject({
            brightness: 40,
            window: dimNights,
        });
        expect(scheduledBrightness({ defaultBrightness: 80, schedule: [dimNights] }, WED_0900)).toMatchObject({
            brightness: 80,
            window: null,
        });
        expect(scheduledBrightness(undefined, WED_2130)).toEqual({
            brightness: 100,
            colorTemperature: COLOR_TEMPERATURE_NEUTRAL_K,
            window: null,
        });
        expect(scheduledBrightness({ defaultBrightness: 250 }, WED_2130).brightness).toBe(100);
    });
    it('a window without a color temperature keeps the default one', () => {
        const base = { defaultBrightness: 80, defaultColorTemperature: 3000 };
        expect(scheduledBrightness({ ...base, schedule: [dimNights] }, WED_2130).colorTemperature).toBe(3000);
        expect(scheduledBrightness({ ...base, schedule: [warmNights] }, WED_2130).colorTemperature).toBe(2700);
        expect(scheduledBrightness({ defaultBrightness: 80 }, WED_2130).colorTemperature).toBe(
            COLOR_TEMPERATURE_NEUTRAL_K,
        );
    });
    it('clamps color temperature and treats 0 as neutral', () => {
        expect(clampColorTemperature(0)).toBe(COLOR_TEMPERATURE_NEUTRAL_K);
        expect(clampColorTemperature(100)).toBe(2000);
        expect(clampColorTemperature(50000)).toBe(12000);
    });
});
