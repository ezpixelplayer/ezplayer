import { darken, lighten } from '@mui/material/styles';
import type { PaletteColor } from '@mui/material/styles';

export type ScheduleColorIdentity = {
    id: string;
    /** Links all dated repeats of one logical schedule. Empty/undefined → one-off. */
    baseScheduleId?: string;
    /** Used to decide which series is "first" (earliest date gets theme color). */
    date?: number;
};

export type ScheduleColorSwatch = {
    main: string;
    dark: string;
    contrastText: string;
};

/**
 * Strong lighten/darken steps of the theme base color.
 * Index 0 keeps the exact theme color; later indices are clearly lighter or darker.
 */
const VARIANT_AMOUNTS = [0, 0.42, -0.32, 0.58, -0.48, 0.28, -0.2] as const;

/**
 * Series identity used for coloring: one logical schedule and all of its repeats
 * share the same key (`baseScheduleId` when present, otherwise `id`).
 */
export function getScheduleColorSeriesKey(schedule: ScheduleColorIdentity): string {
    return schedule.baseScheduleId || schedule.id;
}

/**
 * Return a light/dark variation of the theme base color.
 * Index 0 returns the base color unchanged.
 */
export function getScheduleColorVariant(baseColor: string, index: number): string {
    const amount =
        VARIANT_AMOUNTS[((index % VARIANT_AMOUNTS.length) + VARIANT_AMOUNTS.length) % VARIANT_AMOUNTS.length];
    if (amount === 0) return baseColor;
    return amount > 0 ? lighten(baseColor, amount) : darken(baseColor, -amount);
}

/**
 * Build a fill/hover/text swatch from a theme palette color and schedule index.
 * Index 0 matches the theme exactly (primary/secondary as provided).
 */
export function getScheduleColorSwatch(base: PaletteColor, index: number): ScheduleColorSwatch {
    if (index === 0) {
        return {
            main: base.main,
            dark: base.dark,
            contrastText: base.contrastText,
        };
    }
    const main = getScheduleColorVariant(base.main, index);
    return {
        main,
        dark: darken(main, 0.18),
        contrastText: base.contrastText,
    };
}

/**
 * Assign color indices by logical schedule series.
 * The earliest series (by date, then series key) gets index 0 → exact theme color.
 * Repeats of the same series share one index so they stay the same color every day.
 */
export function buildScheduleColorIndexById(schedules: ReadonlyArray<ScheduleColorIdentity>): Map<string, number> {
    const earliestBySeries = new Map<string, number>();
    for (const schedule of schedules) {
        const seriesKey = getScheduleColorSeriesKey(schedule);
        const date = typeof schedule.date === 'number' ? schedule.date : Number.MAX_SAFE_INTEGER;
        const existing = earliestBySeries.get(seriesKey);
        if (existing === undefined || date < existing) {
            earliestBySeries.set(seriesKey, date);
        }
    }

    const orderedSeries = [...earliestBySeries.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([seriesKey]) => seriesKey);

    const indexBySeries = new Map(orderedSeries.map((seriesKey, index) => [seriesKey, index]));

    const result = new Map<string, number>();
    for (const schedule of schedules) {
        result.set(schedule.id, indexBySeries.get(getScheduleColorSeriesKey(schedule)) ?? 0);
    }
    return result;
}
