import { isElectron } from '@ezplayer/shared-ui-components';
import { useEffect, useState } from 'react';
import { useApiBase } from '../util/ApiBaseProvider';
import {
    ClockSkewSeverity,
    classifyClockSkew,
    formatClockSkew,
    formatClockTime,
    formatTimeZoneShortName,
    getSystemTimeZone,
    timeZonesDiffer,
} from '../util/systemTimeUtils';

const TICK_INTERVAL_MS = 1000;
const RESYNC_INTERVAL_MS = 5 * 60_000;
const SAMPLE_COUNT = 3;

interface PlayerTimeApiResponse {
    now?: number;
    timeZone?: string;
}

interface ClockSample {
    offsetMs: number;
    rttMs: number;
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
    /** Player clock minus viewer clock; undefined until a sample succeeds (always 0 on Electron). */
    clockOffsetMs?: number;
    skewSeverity: ClockSkewSeverity;
    skewLabel?: string;
}

function resolveApiBaseUrl(apiBase: string): string | undefined {
    const trimmed = apiBase.replace(/\/+$/, '');
    if (trimmed) return trimmed;
    if (typeof window !== 'undefined') return window.location.origin.replace(/\/+$/, '');
    return undefined;
}

async function samplePlayerClock(apiBaseUrl: string): Promise<ClockSample | undefined> {
    const t0 = Date.now();
    const response = await fetch(`${apiBaseUrl}/api/ezp/time`);
    const t1 = Date.now();
    if (!response.ok) return undefined;
    const data = (await response.json()) as PlayerTimeApiResponse;
    if (typeof data.now !== 'number') return undefined;
    // Midpoint compensation: worst-case error is rtt/2.
    return { offsetMs: data.now - (t0 + t1) / 2, rttMs: t1 - t0, timeZone: data.timeZone };
}

/** Best (lowest-RTT) of a few samples, to shake off transient network stalls. */
async function measurePlayerClock(apiBaseUrl: string): Promise<ClockSample | undefined> {
    let best: ClockSample | undefined;
    for (let i = 0; i < SAMPLE_COUNT; i++) {
        try {
            const sample = await samplePlayerClock(apiBaseUrl);
            if (sample && (!best || sample.rttMs < best.rttMs)) best = sample;
        } catch {
            // Ignore; a later sample may succeed.
        }
    }
    return best;
}

/**
 * Live player + local clock for the Player screen.
 * Desktop Electron uses the host system clock/timezone directly; LAN / cloud clients ask
 * `/api/ezp/time` for the player's IANA timezone and an RTT-compensated clock offset, via
 * `useApiBase()` (cloud proxy prefix) or same-origin. The player clock is rendered as
 * viewer clock + offset, so it tracks the player's actual clock, and the offset is
 * classified into a skew severity for display.
 */
export function usePlayerSystemTime(): PlayerSystemTimeState {
    const apiBase = useApiBase();
    const localTimeZone = getSystemTimeZone();
    const [now, setNow] = useState(() => new Date());
    const [playerTimeZone, setPlayerTimeZone] = useState<string | null>(() =>
        isElectron() ? localTimeZone : null,
    );
    const [clockOffsetMs, setClockOffsetMs] = useState<number | undefined>(() =>
        isElectron() ? 0 : undefined,
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
        const sync = () => {
            void measurePlayerClock(baseUrl).then((sample) => {
                if (cancelled || !sample) return;
                setClockOffsetMs(sample.offsetMs);
                if (sample.timeZone) setPlayerTimeZone(sample.timeZone);
            });
        };
        sync();
        const timer = window.setInterval(sync, RESYNC_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [apiBase]);

    const effectivePlayerTimeZone = playerTimeZone ?? localTimeZone;
    const playerNow = clockOffsetMs ? new Date(now.getTime() + clockOffsetMs) : now;
    const skewSeverity = clockOffsetMs !== undefined ? classifyClockSkew(clockOffsetMs) : 'none';
    // A skewed clock in the same zone still warrants showing both wall times.
    const showLocalTime =
        timeZonesDiffer(effectivePlayerTimeZone, localTimeZone) || skewSeverity !== 'none';

    return {
        playerTime: formatClockTime(playerNow, effectivePlayerTimeZone),
        playerTimeZone: effectivePlayerTimeZone,
        playerTimeZoneLabel: formatTimeZoneShortName(playerNow, effectivePlayerTimeZone),
        localTime: showLocalTime ? formatClockTime(now, localTimeZone) : undefined,
        localTimeZone: showLocalTime ? localTimeZone : undefined,
        localTimeZoneLabel: showLocalTime ? formatTimeZoneShortName(now, localTimeZone) : undefined,
        showLocalTime,
        clockOffsetMs,
        skewSeverity,
        skewLabel:
            skewSeverity !== 'none' && clockOffsetMs !== undefined
                ? formatClockSkew(clockOffsetMs)
                : undefined,
    };
}
