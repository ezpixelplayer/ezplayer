import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    getAudioListenSession,
    type AudioListenOptions,
    type AudioListenSession,
    type AudioListenStatus,
} from './audioListenSession';

export interface UseAudioListenSessionResult {
    session: AudioListenSession | undefined;
    status: AudioListenStatus;
    /** The listener has asked for audio (may be connecting / reconnecting). */
    active: boolean;
    /** Chunks are arriving and being scheduled. */
    isPlaying: boolean;
    start: () => void;
    stop: () => void;
    toggle: () => void;
}

/**
 * React view onto a shared {@link AudioListenSession}. Pass `undefined` while
 * the stream URL isn't known yet; everything comes back inert.
 */
export function useAudioListenSession(opts: AudioListenOptions | undefined): UseAudioListenSessionResult {
    const session = useMemo(
        () => (opts ? getAudioListenSession(opts) : undefined),
        // The session is keyed by wsUrl; timeUrl/title changes update it in place.
        [opts?.wsUrl, opts?.timeUrl, opts?.title], // eslint-disable-line react-hooks/exhaustive-deps
    );
    const [status, setStatus] = useState<AudioListenStatus>(session?.status ?? 'idle');
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        if (!session) {
            setStatus('idle');
            setIsPlaying(false);
            return;
        }
        const unsub = session.subscribe(setStatus);
        const tick = setInterval(() => setIsPlaying(session.isPlaying), 500);
        return () => {
            unsub();
            clearInterval(tick);
        };
    }, [session]);

    const start = useCallback(() => session?.start(), [session]);
    const stop = useCallback(() => session?.stop(), [session]);
    const toggle = useCallback(() => session?.toggle(), [session]);

    return {
        session,
        status,
        active: status !== 'idle',
        isPlaying,
        start,
        stop,
        toggle,
    };
}
