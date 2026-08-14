import { isElectron } from '@ezplayer/shared-ui-components';
import { useEffect, useState } from 'react';
import { useApiBase } from '../util/ApiBaseProvider';
import {
    formatClockTime,
    formatTimeZoneShortName,
    getSystemTimeZone,
    timeZonesDiffer,
} from '../util/systemTimeUtils';

const TICK_INTERVAL_MS = 1000;

interface PlayerTimeApiResponse {
    now?: number;
    timeZone?: string;
}

export interface PlayerSystemTimeState {
    playerTime: string;
    playerTimeZone: string;
    playerTimeZoneLabel: string;
    localTime?: string;
    localTimeZone?: string;
    localTimeZoneLabel?: string;
    showLocalTime: boolean;
}

function resolveApiBaseUrl(apiBase: string): string | undefined {
    const trimmed = apiBase.replace(/\/+$/, '');
    if (trimmed) return trimmed;
    if (typeof window !== 'undefined') return window.location.origin.replace(/\/+$/, '');
    return undefined;
}

async function fetchPlayerTimeZone(apiBaseUrl: string): Promise<string | undefined> {
    const response = await fetch(`${apiBaseUrl}/api/ezp/time`);
    if (!response.ok) return undefined;
    const data = (await response.json()) as PlayerTimeApiResponse;
    return data.timeZone;
}

/**
 * Live player + local clock for the Player screen.
 * Desktop Electron uses the host system timezone directly; LAN / cloud clients ask
 * `/api/ezp/time` for the player's IANA timezone, via `useApiBase()` (cloud proxy
 * prefix) or same-origin.
 */
export function usePlayerSystemTime(): PlayerSystemTimeState {
    const apiBase = useApiBase();
    const localTimeZone = getSystemTimeZone();
    const [now, setNow] = useState(() => new Date());
    const [playerTimeZone, setPlayerTimeZone] = useState<string | null>(() =>
        isElectron() ? localTimeZone : null,
    );

    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), TICK_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (isElectron()) return;

        const baseUrl = resolveApiBaseUrl(apiBase);
        if (!baseUrl) return;

        let cancelled = false;
        void fetchPlayerTimeZone(baseUrl)
            .then((timeZone) => {
                if (!cancelled && timeZone) setPlayerTimeZone(timeZone);
            })
            .catch(() => {
                if (!cancelled) setPlayerTimeZone(localTimeZone);
            });

        return () => {
            cancelled = true;
        };
    }, [apiBase, localTimeZone]);

    const effectivePlayerTimeZone = playerTimeZone ?? localTimeZone;
    const showLocalTime = timeZonesDiffer(effectivePlayerTimeZone, localTimeZone);

    return {
        playerTime: formatClockTime(now, effectivePlayerTimeZone),
        playerTimeZone: effectivePlayerTimeZone,
        playerTimeZoneLabel: formatTimeZoneShortName(now, effectivePlayerTimeZone),
        localTime: showLocalTime ? formatClockTime(now, localTimeZone) : undefined,
        localTimeZone: showLocalTime ? localTimeZone : undefined,
        localTimeZoneLabel: showLocalTime ? formatTimeZoneShortName(now, localTimeZone) : undefined,
        showLocalTime,
    };
}
