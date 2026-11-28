import { describe, expect, it } from 'vitest';
import { rulerFromLayout } from './layout-ruler';

/** A view_objects section as the parser would hand it over. */
function doc(objects: Record<string, string>[]) {
    return {
        getElementsByTagName: (name: string) =>
            name === 'view_object' ? objects.map((o) => ({ getAttribute: (k: string) => o[k] ?? null })) : [],
    };
}

describe('layout ruler', () => {
    it('reads a ruler in feet with the default length of one', () => {
        // The second end is an offset from the position; 10 units along a slanted line.
        const r = rulerFromLayout(
            doc([
                { name: 'Gridlines', DisplayAs: 'Gridlines' },
                {
                    name: 'Ruler',
                    DisplayAs: 'Ruler',
                    Units: '4',
                    WorldPosX: '-150',
                    WorldPosY: '0',
                    WorldPosZ: '-259.8',
                    X2: '8.660254',
                    Y2: '0',
                    Z2: '-5',
                },
            ]),
        );
        expect(r?.unitName).toBe('ft');
        expect(r?.length).toBe(1);
        expect(r?.worldLength).toBeCloseTo(10, 5);
        expect(r?.unitsPerMeter).toBeCloseTo(32.808, 2);
        expect(r?.to).toEqual([-150 + 8.660254, 0, -259.8 - 5]);
    });

    it('reads a long ruler in inches', () => {
        const r = rulerFromLayout(
            doc([{ name: 'R', DisplayAs: 'Ruler', Units: '5', Length: '60', X2: '108.36', Y2: '1.86', Z2: '-0.35' }]),
        );
        expect(r?.unitName).toBe('in');
        // 108.4 units for 60 in = 1.524 m.
        expect(r?.unitsPerMeter).toBeCloseTo(71.1, 1);
    });

    it('defaults to meters and skips inactive or zero-length rulers', () => {
        expect(rulerFromLayout(doc([{ name: 'R', DisplayAs: 'Ruler', Active: '0', X2: '10' }]))).toBeUndefined();
        expect(rulerFromLayout(doc([{ name: 'R', DisplayAs: 'Ruler', X2: '0', Y2: '0', Z2: '0' }]))).toBeUndefined();
        expect(rulerFromLayout(doc([]))).toBeUndefined();
        const r = rulerFromLayout(doc([{ name: 'R', DisplayAs: 'Ruler', X2: '250', Length: '2.5' }]));
        expect(r?.unitName).toBe('m');
        expect(r?.unitsPerMeter).toBe(100);
    });
});
