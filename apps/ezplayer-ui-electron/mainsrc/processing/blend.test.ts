import { describe, expect, it } from 'vitest';
import { maxUint8 } from './blend';

describe('maxUint8', () => {
    it('takes the brighter of each channel', () => {
        const out = new Uint8Array(3);
        maxUint8(out, Uint8Array.of(1, 200, 3), Uint8Array.of(100, 2, 3));
        expect(Array.from(out)).toEqual([100, 200, 3]);
    });

    it.each([
        ['first', Uint8Array.of(9, 9, 9, 9), Uint8Array.of(5, 5)],
        ['second', Uint8Array.of(5, 5), Uint8Array.of(9, 9, 9, 9)],
    ])('keeps the rest of the %s input when the other is shorter', (_name, a, b) => {
        const out = new Uint8Array(4);
        maxUint8(out, a, b);
        expect(Array.from(out)).toEqual([9, 9, 9, 9]);
    });

    it('blacks out whatever both inputs stop short of', () => {
        const out = new Uint8Array(4).fill(77);
        maxUint8(out, Uint8Array.of(1), Uint8Array.of(2, 3));
        expect(Array.from(out)).toEqual([2, 3, 0, 0]);
    });

    it('stops at the end of the output', () => {
        const out = new Uint8Array(2);
        maxUint8(out, Uint8Array.of(1, 1, 1), Uint8Array.of(2, 2, 2, 2));
        expect(Array.from(out)).toEqual([2, 2]);
    });
});
