/** Decoded audio is two Float32 channels, pooled in chunks of a bit over 5 s. */
export const DECODED_BYTES_PER_SAMPLE = 8;
export const AUDIO_CHUNK_SECONDS = 5;
export const DEFAULT_AUDIO_SAMPLE_RATE = 48000;

/** Seconds of decoded audio that a fraction of RAM holds, rounded down to a chunk. */
export function maxAudioSeconds(
    totalMemBytes: number,
    memFraction: number,
    sampleRate = DEFAULT_AUDIO_SAMPLE_RATE,
): number {
    const seconds = (totalMemBytes * memFraction) / (DECODED_BYTES_PER_SAMPLE * sampleRate);
    return Math.max(AUDIO_CHUNK_SECONDS, Math.floor(seconds / AUDIO_CHUNK_SECONDS) * AUDIO_CHUNK_SECONDS);
}

/** Audio cache budget: a fraction of RAM, no more than the ceiling. */
export function audioCacheSeconds(totalMemBytes: number, memFraction: number, ceilingSeconds: number): number {
    return Math.min(maxAudioSeconds(totalMemBytes, memFraction), ceilingSeconds);
}

/** Longest song the cache admits while still leaving room to prefetch the next one. */
export function maxSongSeconds(cacheSeconds: number, nextSongHeadroomSeconds: number): number {
    return Math.max(AUDIO_CHUNK_SECONDS, cacheSeconds - nextSongHeadroomSeconds);
}

/** Next decode reservation after one came up short; throws once the limit is reached. */
export function growReservation(currentSeconds: number, maxSeconds: number | undefined, totalMemBytes: number): number {
    if (maxSeconds === undefined) return currentSeconds * 2;
    if (currentSeconds >= maxSeconds) throw new Error(audioTooLongMessage(undefined, maxSeconds, totalMemBytes));
    return Math.min(currentSeconds * 2, maxSeconds);
}

export function formatAudioLength(seconds: number): string {
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function audioTooLongMessage(
    lengthSeconds: number | undefined,
    maxSeconds: number,
    totalMemBytes: number,
): string {
    const subject = lengthSeconds === undefined ? 'This audio' : `Audio of ${formatAudioLength(lengthSeconds)}`;
    const gb = (totalMemBytes / 1e9).toFixed(1);
    return `${subject} is too long for this player's ${gb} GB of memory; the maximum is ${formatAudioLength(maxSeconds)}.`;
}
