import { describe, expect, it } from 'vitest';

import { applyHttpClockOffset, createClockOffsetRef, refineClockOffset, resetClockWindow } from './clockSync';

describe('clockSync snap hysteresis', () => {
    it('applies the first HTTP sample (from 0, the gap is large)', () => {
        const ref = createClockOffsetRef();
        applyHttpClockOffset(ref, { offset: 850, rtt: 4 });
        expect(ref.value).toBe(850);
        expect(ref.snaps).toBe(1);
    });

    it('ignores a single noisy reading but follows a persistent change', () => {
        const ref = createClockOffsetRef();
        applyHttpClockOffset(ref, { offset: 850, rtt: 4 });
        // One chunk arrives with a clock reading 80 ms off (a quantized timer).
        const now = Date.now();
        refineClockOffset(ref, now + 930);
        expect(ref.value).toBe(850);
        expect(ref.pendingSnaps).toBe(1);
        // Back to normal: the pending count resets.
        resetClockWindow(ref);
        refineClockOffset(ref, now + 851);
        expect(ref.pendingSnaps).toBe(0);
        expect(ref.value).toBe(850);
        // A real shift of 80 ms seen three times in a row is applied.
        resetClockWindow(ref);
        applyHttpClockOffset(ref, { offset: 930, rtt: 4 });
        applyHttpClockOffset(ref, { offset: 930, rtt: 4 });
        expect(ref.value).toBe(850);
        applyHttpClockOffset(ref, { offset: 930, rtt: 4 });
        expect(ref.value).toBe(930);
        expect(ref.snaps).toBe(2);
    });

    it('applies a large step at once', () => {
        const ref = createClockOffsetRef();
        applyHttpClockOffset(ref, { offset: 850, rtt: 4 });
        applyHttpClockOffset(ref, { offset: 1200, rtt: 4 });
        expect(ref.value).toBe(1200);
    });

    it('small refinements never move the applied value', () => {
        const ref = createClockOffsetRef();
        applyHttpClockOffset(ref, { offset: 850, rtt: 4 });
        for (let i = 0; i < 20; i++) applyHttpClockOffset(ref, { offset: 850 + ((i * 7) % 40) - 20, rtt: 4 });
        expect(ref.value).toBe(850);
    });
});
