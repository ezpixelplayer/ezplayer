import { describe, expect, it } from 'vitest';
import { colorTemperatureScale, COLOR_TEMP_NEUTRAL_K } from './ColorTemperature';

describe('colorTemperatureScale', () => {
    it('is identity at neutral and never boosts a channel', () => {
        expect(colorTemperatureScale(COLOR_TEMP_NEUTRAL_K)).toEqual([1, 1, 1]);
        for (let k = 2000; k <= 12000; k += 250) {
            const f = colorTemperatureScale(k);
            expect(Math.max(...f)).toBe(1);
            for (const v of f) expect(v).toBeGreaterThan(0);
        }
    });
    it('warm dims blue most, cool dims red', () => {
        const warm = colorTemperatureScale(2700);
        expect(warm[0]).toBe(1);
        expect(warm[1]).toBeLessThan(1);
        expect(warm[2]).toBeLessThan(warm[1]);
        const cool = colorTemperatureScale(10000);
        expect(cool[2]).toBe(1);
        expect(cool[0]).toBeLessThan(1);
        expect(cool[0]).toBeLessThan(cool[1]);
    });
    it('clamps out-of-range and treats 0 as neutral', () => {
        expect(colorTemperatureScale(0)).toEqual([1, 1, 1]);
        expect(colorTemperatureScale(500)).toEqual(colorTemperatureScale(2000));
        expect(colorTemperatureScale(50000)).toEqual(colorTemperatureScale(12000));
    });
});
