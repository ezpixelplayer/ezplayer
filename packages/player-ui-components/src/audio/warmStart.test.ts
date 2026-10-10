import { describe, expect, it } from 'vitest';

import { WARMUP_CLOCK_WAIT_MS, stillPlayable, warmupReady } from './warmStart';

const ready = {
    contextState: 'running' as AudioContextState,
    contextTime: 0.2,
    decoderReady: true,
    haveClockSample: true,
    elapsedMs: 300,
};

describe('warmupReady', () => {
    it('opens once the context runs, the decoder is up and a clock sample exists', () => {
        expect(warmupReady(ready)).toBe(true);
    });

    it('waits for the context to actually be running with a moving clock', () => {
        expect(warmupReady({ ...ready, contextState: 'suspended' })).toBe(false);
        expect(warmupReady({ ...ready, contextState: undefined })).toBe(false);
        expect(warmupReady({ ...ready, contextTime: 0 })).toBe(false);
    });

    it('waits for the decoder, with no deadline', () => {
        expect(warmupReady({ ...ready, decoderReady: false, elapsedMs: 60_000 })).toBe(false);
    });

    it('waits for the clock sample only up to the deadline', () => {
        expect(warmupReady({ ...ready, haveClockSample: false, elapsedMs: WARMUP_CLOCK_WAIT_MS - 1 })).toBe(false);
        expect(warmupReady({ ...ready, haveClockSample: false, elapsedMs: WARMUP_CLOCK_WAIT_MS })).toBe(true);
    });
});

describe('stillPlayable', () => {
    const hop = { hopFrames: 4800, sampleRate: 48000 }; // 100 ms
    it('keeps frames whose hop has not finished on the player clock', () => {
        const frames = [
            { playAt: 1000, ...hop }, // ended at 1100: gone
            { playAt: 1100, ...hop }, // ends at 1200: partly playable
            { playAt: 1200, ...hop },
        ];
        expect(stillPlayable(frames, 1150).map((f) => f.playAt)).toEqual([1100, 1200]);
    });
    it('keeps everything when nothing is late', () => {
        const frames = [{ playAt: 5000, ...hop }];
        expect(stillPlayable(frames, 1000)).toHaveLength(1);
    });
});
