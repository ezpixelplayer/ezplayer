import type { PlayerPStatusContent, PlayingItem } from '../types/DataTypes';

/**
 * Whether the player is in the middle of playback: playing, paused, or winding
 * down.  A graceful stop ("Stopping") still has the rest of a song and possibly
 * an outro to play, so it counts; it can still be paused, skipped or aborted.
 */
export function isPlaybackActive(status: PlayerPStatusContent['status'] | undefined): boolean {
    return status === 'Playing' || status === 'Paused' || status === 'Stopping' || status === 'Suppressed';
}

/**
 * The id of the request that is playing, or about to play, this song or playlist
 * on demand; `deleterequest` with that id stops it.  Undefined when the song is
 * playing only as part of a schedule or playlist, which is not this request's to
 * stop, or when a request for it is merely waiting its turn in the queue.
 */
export function activeRequestFor(
    player: PlayerPStatusContent | undefined,
    target: { songId: string } | { playlistId: string },
): string | undefined {
    const matches = (item: PlayingItem | undefined): boolean => {
        if (!item?.request_id) return false;
        if ('playlistId' in target) return item.playlist_id === target.playlistId;
        return item.sequence_id === target.songId && !item.playlist_id && !item.schedule_id;
    };
    if (matches(player?.now_playing)) return player?.now_playing?.request_id;
    // Accepted but not on yet: an immediate request starts after a short prefetch delay.
    return player?.queue?.find((item) => item.type === 'Immediate' && matches(item))?.request_id;
}
