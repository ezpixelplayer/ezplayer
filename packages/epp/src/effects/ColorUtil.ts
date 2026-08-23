// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Generates an RGB color based on a time-based cycling through hues.
 * @param time - A time value (e.g., milliseconds, frame count, etc.)
 * @param speed - Speed of cycling (higher = faster)
 * @returns [r, g, b] tuple (0-255 range)
 */
export function getColorCycle(time: number, speed: number = 1, l:number = .5): [number, number, number] {
    const hue = (time * speed) % 360; // Cycle through 0-360 degrees
    return hslToRgb(hue, 1.0, l); // Full saturation, 50% lightness
}
  
/**
 * Converts HSL to RGB (0-255 range).
 * @param h Hue (0-360)
 * @param s Saturation (0-1)
 * @param l Lightness (0-1)
 * @returns [r, g, b] tuple (0-255 range)
 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let [r, g, b] = [0, 0, 0];
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ];
}
