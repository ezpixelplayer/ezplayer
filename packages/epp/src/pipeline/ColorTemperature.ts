/*
 * Color temperature as a tint that only ever dims: per-channel factors in
 * (0, 1] that pull a frame toward the look of a blackbody at the chosen
 * temperature. Neutral (6500 K) leaves every channel at 1; warmer reduces
 * green and blue, cooler reduces red (and a little green). Nothing is ever
 * boosted, so full brightness stays full brightness.
 */

export const COLOR_TEMP_MIN_K = 2000;
export const COLOR_TEMP_NEUTRAL_K = 6500;
export const COLOR_TEMP_MAX_K = 12000;

/** Tanner Helland's blackbody approximation, 0..255 per channel. */
function blackbodyRgb(kelvin: number): [number, number, number] {
    const t = kelvin / 100;
    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
    let r: number, g: number, b: number;
    if (t <= 66) {
        r = 255;
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
        b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
        g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
        b = 255;
    }
    return [clamp(r), clamp(g), clamp(b)];
}

const NEUTRAL = blackbodyRgb(COLOR_TEMP_NEUTRAL_K);

/**
 * Per-channel scale factors for a color temperature in kelvin, relative to
 * neutral and normalised so the largest factor is exactly 1. Out-of-range
 * temperatures are clamped to [COLOR_TEMP_MIN_K, COLOR_TEMP_MAX_K].
 */
export function colorTemperatureScale(kelvin: number): [number, number, number] {
    const k = Math.min(COLOR_TEMP_MAX_K, Math.max(COLOR_TEMP_MIN_K, kelvin || COLOR_TEMP_NEUTRAL_K));
    if (k === COLOR_TEMP_NEUTRAL_K) return [1, 1, 1];
    const rgb = blackbodyRgb(k);
    const f = rgb.map((v, i) => v / NEUTRAL[i]) as [number, number, number];
    const m = Math.max(f[0], f[1], f[2]);
    return [f[0] / m, f[1] / m, f[2] / m];
}
