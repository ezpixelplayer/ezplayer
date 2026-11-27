// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * The xLights Ruler view object: a line of a known real length drawn in the layout, which is the
 * one place a layout says how big its world units are. xLights stores the second end as an offset
 * (X2, Y2, Z2) from the position, the real length in `Length` (1 when absent) and the unit as a
 * code in `Units` (RulerObject.h: 0 m, 1 cm, 2 mm, 3 yd, 4 ft, 5 in; meters when absent).
 */

import type { LayoutRuler } from './playbacktypes';

/** Enough of a DOM to read view objects from; a parsed xlights_rgbeffects.xml is one. */
export interface RulerDocument {
    getElementsByTagName(name: string): ArrayLike<{ getAttribute(name: string): string | null }>;
}

const UNITS: Record<number, { name: string; meters: number }> = {
    0: { name: 'm', meters: 1 },
    1: { name: 'cm', meters: 0.01 },
    2: { name: 'mm', meters: 0.001 },
    3: { name: 'yd', meters: 0.9144 },
    4: { name: 'ft', meters: 0.3048 },
    5: { name: 'in', meters: 0.0254 },
};

/** The layout's active ruler, or undefined when it has none or the ruler has no length. */
export function rulerFromLayout(doc: RulerDocument): LayoutRuler | undefined {
    const objects = doc.getElementsByTagName('view_object');
    for (let i = 0; i < objects.length; ++i) {
        const el = objects[i];
        if (el.getAttribute('DisplayAs') !== 'Ruler' || el.getAttribute('Active') === '0') continue;
        const num = (name: string, dflt: number) => {
            const v = parseFloat(el.getAttribute(name) ?? '');
            return Number.isFinite(v) ? v : dflt;
        };
        const from: [number, number, number] = [num('WorldPosX', 0), num('WorldPosY', 0), num('WorldPosZ', 0)];
        const d: [number, number, number] = [num('X2', 0), num('Y2', 0), num('Z2', 0)];
        const worldLength = Math.hypot(d[0], d[1], d[2]);
        const length = num('Length', 1);
        const unit = UNITS[num('Units', 0)];
        if (!(worldLength > 0) || !(length > 0) || !unit) continue;
        return {
            name: el.getAttribute('name') ?? 'Ruler',
            units: num('Units', 0),
            unitName: unit.name,
            length,
            from,
            to: [from[0] + d[0], from[1] + d[1], from[2] + d[2]],
            worldLength,
            unitsPerMeter: worldLength / (length * unit.meters),
        };
    }
    return undefined;
}
