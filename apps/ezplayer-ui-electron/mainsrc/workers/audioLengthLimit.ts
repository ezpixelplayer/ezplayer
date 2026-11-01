/** Decoded audio is two Float32 channels, pooled in chunks of a bit over 5 s. */
export const DECODED_BYTES_PER_SAMPLE = 8;
export const AUDIO_CHUNK_SECONDS = 5;
export const DEFAULT_AUDIO_SAMPLE_RATE = 48000;

/** Longest audio this host may decode: a fraction of RAM, rounded down to a chunk. */
export function maxAudioSeconds(
    totalMemBytes: number,
    memFraction: number,
    sampleRate = DEFAULT_AUDIO_SAMPLE_RATE,
): number {
    const seconds = (totalMemBytes * memFraction) / (DECODED_BYTES_PER_SAMPLE * sampleRate);
    return Math.max(AUDIO_CHUNK_SECONDS, Math.floor(seconds / AUDIO_CHUNK_SECONDS) * AUDIO_CHUNK_SECONDS);
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
