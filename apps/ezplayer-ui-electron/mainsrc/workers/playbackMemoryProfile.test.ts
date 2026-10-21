import { describe, expect, it } from 'vitest';
import { playbackMemoryProfile } from './playbackMemoryProfile';

describe('playbackMemoryProfile', () => {
    it('promptly releases completed audio on a 1 GB Pi', () => {
        const profile = playbackMemoryProfile(949_000_000);
        expect(profile).toEqual({
            mp3CacheSeconds: 720,
            fseqSpace: 64_000_000,
            fseqCacheAgeoutMs: 5_000,
            fseqPoolBytes: 16_000_000,
            fseqMaxConcurrency: 1,
            mp3CacheAgeoutMs: 5_000,
            mp3DecodePoolBytes: 16_000_000,
            mp3DecodeReserveSeconds: 300,
            mp3ScratchRetainBytes: 16_000_000,
        });
    });

    it('keeps larger cache profiles for hosts with more RAM', () => {
        expect(playbackMemoryProfile(4_000_000_000).fseqSpace).toBe(256_000_000);
        expect(playbackMemoryProfile(8_000_000_000).mp3CacheSeconds).toBe(3600);
    });
});
