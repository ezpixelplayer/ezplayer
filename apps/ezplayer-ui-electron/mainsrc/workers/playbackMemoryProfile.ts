export type PlaybackMemoryProfile = {
    mp3CacheSeconds: number;
    fseqSpace: number;
    fseqCacheAgeoutMs: number;
    fseqPoolBytes: number;
    fseqMaxConcurrency: number;
    mp3CacheAgeoutMs: number;
    mp3DecodePoolBytes: number;
    mp3DecodeReserveSeconds: number;
    mp3ScratchRetainBytes: number;
};

/** Keep decoded playback data within the practical RAM available on the host. */
export function playbackMemoryProfile(totalMemBytes: number): PlaybackMemoryProfile {
    const totalMemGB = totalMemBytes / 1e9;
    if (totalMemGB < 2.5) {
        return {
            // About two six-minute stereo tracks. One longer current track may exceed
            // the budget temporarily, but completed tracks age out promptly.
            mp3CacheSeconds: 720,
            fseqSpace: 64_000_000,
            fseqCacheAgeoutMs: 5_000,
            fseqPoolBytes: 16_000_000,
            fseqMaxConcurrency: 1,
            // Drop completed tracks promptly instead of retaining a playlist's PCM all day.
            mp3CacheAgeoutMs: 5_000,
            // A small pool still avoids churn without pinning hundreds of MiB after eviction.
            mp3DecodePoolBytes: 16_000_000,
            mp3DecodeReserveSeconds: 300,
            mp3ScratchRetainBytes: 16_000_000,
        };
    }
    if (totalMemGB < 6) {
        return {
            mp3CacheSeconds: 1000,
            fseqSpace: 256_000_000,
            fseqCacheAgeoutMs: 60_000,
            fseqPoolBytes: 64_000_000,
            fseqMaxConcurrency: 4,
            mp3CacheAgeoutMs: 25 * 3600 * 1000,
            mp3DecodePoolBytes: 128_000_000,
            mp3DecodeReserveSeconds: 15 * 60,
            mp3ScratchRetainBytes: 32_000_000,
        };
    }
    return {
        mp3CacheSeconds: 3600,
        fseqSpace: 1_000_000_000,
        fseqCacheAgeoutMs: 60_000,
        fseqPoolBytes: 256_000_000,
        fseqMaxConcurrency: 4,
        mp3CacheAgeoutMs: 25 * 3600 * 1000,
        mp3DecodePoolBytes: 512_000_000,
        mp3DecodeReserveSeconds: 15 * 60,
        mp3ScratchRetainBytes: 64_000_000,
    };
}
