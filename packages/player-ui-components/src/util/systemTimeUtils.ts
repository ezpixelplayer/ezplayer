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
