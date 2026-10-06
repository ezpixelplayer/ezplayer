import type { PlayerPStatusContent } from '../types/DataTypes';

/**
 * Whether the player is in the middle of playback: playing, paused, or winding
 * down.  A graceful stop ("Stopping") still has the rest of a song and possibly
 * an outro to play, so it counts; it can still be paused, skipped or aborted.
 */
export function isPlaybackActive(status: PlayerPStatusContent['status'] | undefined): boolean {
    return status === 'Playing' || status === 'Paused' || status === 'Stopping' || status === 'Suppressed';
}
