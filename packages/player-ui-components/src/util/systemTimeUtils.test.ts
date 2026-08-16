import { describe, expect, it } from 'vitest';
import {
    classifyClockSkew,
    formatClockSkew,
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

    it('classifies clock skew at the tier boundaries', () => {
        expect(classifyClockSkew(0)).toBe('none');
        expect(classifyClockSkew(9_999)).toBe('none');
        expect(classifyClockSkew(10_000)).toBe('info');
        expect(classifyClockSkew(-10_000)).toBe('info');
        expect(classifyClockSkew(59_999)).toBe('info');
        expect(classifyClockSkew(60_000)).toBe('warning');
        expect(classifyClockSkew(-599_999)).toBe('warning');
        expect(classifyClockSkew(600_000)).toBe('error');
        expect(classifyClockSkew(-3_600_000)).toBe('error');
    });

    it('formats clock skew with direction and magnitude', () => {
        expect(formatClockSkew(15_000)).toBe('Player clock ~15s ahead');
        expect(formatClockSkew(-15_000)).toBe('Player clock ~15s behind');
        expect(formatClockSkew(180_000)).toBe('Player clock ~3m ahead');
        expect(formatClockSkew(-3_900_000)).toBe('Player clock ~1h 5m behind');
        expect(formatClockSkew(7_200_000)).toBe('Player clock ~2h ahead');
    });
});
