import { LinearProgress, Typography } from '@mui/material';
import { needsAudioConversion } from '@ezplayer/ezplayer-core';
import { Box } from '../box/Box';

/** What a song save is waiting on. Derived audio (transcode, normalization) is
 *  built before the record commits, so a save can take a while for long songs. */
export function describeSongSave(audio?: string | null, normalize?: boolean): string {
    const steps: string[] = [];
    if (audio && needsAudioConversion(audio)) steps.push('converting audio to MP3');
    if (audio && normalize) steps.push('normalizing volume');
    if (!steps.length) return 'Saving...';
    return `Saving - ${steps.join(' and ')}. This can take a while for a long song.`;
}

/** Message from a rejected thunk (`unwrap()` throws a SerializedError, not an Error). */
export function saveErrorMessage(err: unknown, fallback: string): string {
    const m = (err as { message?: unknown } | undefined)?.message;
    return typeof m === 'string' && m.trim() ? m : fallback;
}

export function SongSaveProgress({
    saving,
    audio,
    normalize,
}: {
    saving: boolean;
    audio?: string | null;
    normalize?: boolean;
}) {
    if (!saving) return null;
    return (
        <Box sx={{ mt: 2 }}>
            <LinearProgress />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {describeSongSave(audio, normalize)}
            </Typography>
        </Box>
    );
}
