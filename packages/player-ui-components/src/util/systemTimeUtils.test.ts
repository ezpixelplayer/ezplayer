import { describe, expect, it } from 'vitest';
import {
    formatClockTime,
    formatTimeZoneShortName,
    getSystemTimeZone,
    timeZonesDiffer,
} from './systemTimeUtils';

describe('systemTimeUtils', () => {
    it('reads the host IANA timezone', () => {
        expect(getSystemTimeZone()).toMatch(/\S+/);
    });

    it('formats clock time in a target timezone', () => {
        const date = new Date('2026-06-16T21:30:45.000Z');
        const formatted = formatClockTime(date, 'UTC');
        expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(formatted.startsWith('21:30:45') || formatted.startsWith('21:30:46')).toBe(true);
    });

    it('returns a short timezone label', () => {
        const date = new Date('2026-06-16T21:30:45.000Z');
        expect(formatTimeZoneShortName(date, 'UTC')).toBeTruthy();
    });

    it('detects timezone differences by IANA id', () => {
        expect(timeZonesDiffer('America/New_York', 'America/Los_Angeles')).toBe(true);
        expect(timeZonesDiffer('America/New_York', 'America/New_York')).toBe(false);
    });
});
