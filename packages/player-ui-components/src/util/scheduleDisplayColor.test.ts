import { describe, expect, it } from 'vitest';
import {
    buildScheduleColorIndexById,
    getScheduleColorSeriesKey,
    getScheduleColorSwatch,
    getScheduleColorVariant,
} from './scheduleDisplayColor';
import type { PaletteColor } from '@mui/material/styles';

const base: PaletteColor = {
    main: '#1976d2',
    light: '#63a4ff',
    dark: '#004ba0',
    contrastText: '#ffffff',
} as PaletteColor;

describe('scheduleDisplayColor', () => {
    it('uses baseScheduleId as the series key when present', () => {
        expect(getScheduleColorSeriesKey({ id: 'a-2026-09-15', baseScheduleId: 'a' })).toBe('a');
        expect(getScheduleColorSeriesKey({ id: 'once-uuid' })).toBe('once-uuid');
        expect(getScheduleColorSeriesKey({ id: 'once-uuid', baseScheduleId: '' })).toBe('once-uuid');
    });

    it('keeps index 0 as the exact theme color', () => {
        expect(getScheduleColorVariant(base.main, 0)).toBe(base.main);
        expect(getScheduleColorSwatch(base, 0).main).toBe(base.main);
        expect(getScheduleColorSwatch(base, 0).dark).toBe(base.dark);
    });

    it('uses clearly different light/dark variants for later indices', () => {
        const c0 = getScheduleColorVariant(base.main, 0);
        const c1 = getScheduleColorVariant(base.main, 1);
        const c2 = getScheduleColorVariant(base.main, 2);
        expect(c1).not.toBe(c0);
        expect(c2).not.toBe(c0);
        expect(c2).not.toBe(c1);
    });

    it('gives all repeats of a series the same color index', () => {
        const map = buildScheduleColorIndexById([
            { id: 'morning-2026-09-15', baseScheduleId: 'morning', date: 100 },
            { id: 'morning-2026-09-16', baseScheduleId: 'morning', date: 200 },
            { id: 'afternoon-2026-09-15', baseScheduleId: 'afternoon', date: 150 },
            { id: 'afternoon-2026-09-16', baseScheduleId: 'afternoon', date: 250 },
        ]);

        expect(map.get('morning-2026-09-15')).toBe(0);
        expect(map.get('morning-2026-09-16')).toBe(0);
        expect(map.get('afternoon-2026-09-15')).toBe(1);
        expect(map.get('afternoon-2026-09-16')).toBe(1);
    });

    it('assigns the earliest schedule series to theme color index 0', () => {
        const map = buildScheduleColorIndexById([
            { id: 'later', date: 200 },
            { id: 'earlier', date: 100 },
        ]);
        expect(map.get('earlier')).toBe(0);
        expect(map.get('later')).toBe(1);
    });
});
