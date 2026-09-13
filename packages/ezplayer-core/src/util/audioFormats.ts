/** Audio formats accepted for a song's `files.audio`. MP3 plays directly; the
 *  rest are transcoded by the player into a cached MP3 at prepare/prefetch time.
 *  The record always keeps the user's original file. */
export const MP3_EXTENSION = '.mp3';
export const CONVERTIBLE_AUDIO_EXTENSIONS = ['.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mp4'] as const;
export const SUPPORTED_AUDIO_EXTENSIONS = [MP3_EXTENSION, ...CONVERTIBLE_AUDIO_EXTENSIONS] as const;

/** Lower-cased extension including the dot, or '' when there is none. */
export function audioExtension(name: string): string {
    const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
    const i = base.lastIndexOf('.');
    return i < 0 ? '' : base.slice(i).toLowerCase();
}

export function isSupportedAudioName(name: string): boolean {
    return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(audioExtension(name));
}

export function needsAudioConversion(name: string): boolean {
    return (CONVERTIBLE_AUDIO_EXTENSIONS as readonly string[]).includes(audioExtension(name));
}

/** Per-song `volume_adj` (-100..100, percent) as an amplitude scale factor:
 *  -100 mutes, 0 is unchanged, +100 doubles. Baked into the sent samples,
 *  composing with the global volume applied per sink. */
export function songVolumeScale(volumeAdj?: number): number {
    if (typeof volumeAdj !== 'number' || !Number.isFinite(volumeAdj)) return 1;
    const clamped = Math.max(-100, Math.min(100, volumeAdj));
    return 1 + clamped / 100;
}
