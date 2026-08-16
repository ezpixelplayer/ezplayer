/** IANA timezone from the host system (not user settings). */
export function getSystemTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatClockTime(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone,
    }).format(date);
}

/** Short timezone label (e.g. EST, PDT) including DST where applicable. */
export function formatTimeZoneShortName(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat(undefined, {
        timeZone,
        timeZoneName: 'short',
    }).formatToParts(date);
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

export function timeZonesDiffer(a: string, b: string): boolean {
    return a !== b;
}

export type ClockSkewSeverity = 'none' | 'info' | 'warning' | 'error';

export const SKEW_INFO_MS = 10_000;
export const SKEW_WARNING_MS = 60_000;
export const SKEW_ERROR_MS = 600_000;

/** Severity of a player-vs-viewer clock offset. Below 10s is treated as noise. */
export function classifyClockSkew(offsetMs: number): ClockSkewSeverity {
    const abs = Math.abs(offsetMs);
    if (abs >= SKEW_ERROR_MS) return 'error';
    if (abs >= SKEW_WARNING_MS) return 'warning';
    if (abs >= SKEW_INFO_MS) return 'info';
    return 'none';
}

/** e.g. "Player clock ~3m ahead" (positive offset = player clock ahead of viewer's). */
export function formatClockSkew(offsetMs: number): string {
    const direction = offsetMs > 0 ? 'ahead' : 'behind';
    const totalSeconds = Math.round(Math.abs(offsetMs) / 1000);
    let magnitude: string;
    if (totalSeconds < 60) {
        magnitude = `${totalSeconds}s`;
    } else if (totalSeconds < 3600) {
        magnitude = `${Math.round(totalSeconds / 60)}m`;
    } else {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.round((totalSeconds % 3600) / 60);
        magnitude = minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `Player clock ~${magnitude} ${direction}`;
}
