import { darken, lighten } from '@mui/material/styles';
import type { PaletteColor } from '@mui/material/styles';

export type ScheduleColorIdentity = {
    id: string;
    /** Links all dated repeats of one logical schedule. Empty/undefined → one-off. */
    baseScheduleId?: string;
    /** Used to decide which series is "first" (earliest date gets theme color). */
    date?: number;
    /** Main and background schedules are indexed independently. */
    scheduleType?: string;
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
        contrastText: getContrastTextForColor(main),
    };
}

function parseCssColorToRgb(color: string): { r: number; g: number; b: number } | null {
    const trimmed = color.trim();
    const hex6 = /^#([0-9a-fA-F]{6})$/.exec(trimmed);
    if (hex6) {
        return {
            r: parseInt(hex6[1].slice(0, 2), 16),
            g: parseInt(hex6[1].slice(2, 4), 16),
            b: parseInt(hex6[1].slice(4, 6), 16),
        };
    }
    const hex3 = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
    if (hex3) {
        const [r, g, b] = hex3[1];
        return {
            r: parseInt(r + r, 16),
            g: parseInt(g + g, 16),
            b: parseInt(b + b, 16),
        };
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
    if (rgb) {
        return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
    }
    return null;
}

/** Light text on dark fills, dark text on light fills. */
export function getContrastTextForColor(background: string): string {
    const rgb = parseCssColorToRgb(background);
    if (!rgb) return '#ffffff';
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.55 ? '#111111' : '#ffffff';
}

/**
 * Prefer a user-saved color; otherwise keep the auto-assigned theme swatch.
 */
export function resolveScheduleDisplaySwatch(
    customColor: string | undefined,
    fallback: ScheduleColorSwatch,
): ScheduleColorSwatch {
    if (!customColor) return fallback;
    try {
        return {
            main: customColor,
            dark: darken(customColor, 0.18),
            contrastText: getContrastTextForColor(customColor),
        };
    } catch {
        return fallback;
    }
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

/**
 * Like {@link buildScheduleColorIndexById}, but main and background schedules are
 * indexed separately so each type's first series gets its exact theme color.
 * Use this wherever the list may mix types so calendar and timeline agree.
 */
export function buildScheduleColorIndexByType(schedules: ReadonlyArray<ScheduleColorIdentity>): Map<string, number> {
    const background = schedules.filter((s) => s.scheduleType === 'background');
    const main = schedules.filter((s) => s.scheduleType !== 'background');
    return new Map([...buildScheduleColorIndexById(background), ...buildScheduleColorIndexById(main)]);
}
