/**
 * Colors for the wiring overlay and string-start node markers.
 * String 1 is always green; later strings cycle through the rest.
 */

const FIRST_STRING_COLOR = 0x00ff33;

const OTHER_STRING_COLORS = [
    0xffab40, // light orange
    0x18ffff, // cyan
    0xb388ff, // light purple
    0xff80ab, // pink
    0x82b1ff, // light blue
    0xff6e40, // coral
    0x64ffda, // mint
    0xffcc80, // tan
];

/** Hex color for a 0-based physical string index. */
export function stringColorHex(stringIndex: number): number {
    if (stringIndex <= 0) return FIRST_STRING_COLOR;
    return OTHER_STRING_COLORS[(stringIndex - 1) % OTHER_STRING_COLORS.length];
}

/** Same color as normalized [r, g, b]. */
export function stringColorRgb(stringIndex: number): [number, number, number] {
    const hex = stringColorHex(stringIndex);
    return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}
