import { useSelector } from 'react-redux';
import { activeRequestFor } from '@ezplayer/ezplayer-core';
import { RootState } from '../store/Store';

/**
 * The id of the on-demand request that is playing, or about to play, this song
 * or playlist — undefined when there is none.  Selects down to the id so a
 * caller re-renders only when that changes, not on every status push.
 */
export function useActiveRequest(target: { songId: string } | { playlistId: string }): string | undefined {
    return useSelector((s: RootState) => activeRequestFor(s.runtime.combined?.player, target));
}
