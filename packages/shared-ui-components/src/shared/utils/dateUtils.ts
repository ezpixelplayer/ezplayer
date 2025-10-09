import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Get the user's timezone from settings
 * @returns The user's timezone or 'UTC' as default
 */
export const getUserTimezone = (): string => {
    try {
        const savedSettings = localStorage.getItem('generalSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings);
            return settings.timeZone || 'UTC';
        }
    } catch (error) {
        console.error('Error getting user timezone:', error);
    }
    return 'UTC';
};

/**
 * Format a timestamp (in milliseconds) to a date string
 * @param timestamp milliseconds since epoch
 * @param format optional format string
 * @param userTimezone optional user timezone (if not provided, will be fetched from settings)
 * @returns formatted date string
 */
export const formatTimestamp = (timestamp: number, format?: string, userTimezone?: string): string => {
    if (!timestamp) return '';

    const date = dayjs(timestamp);
    if (!date.isValid()) return '';

    // Use the provided timezone, or get from settings, or use local timezone
    const tz = userTimezone || getUserTimezone();
    return date.tz(tz).format(format || 'MM/DD/YYYY');
};

/**
 * Format a timestamp (in milliseconds) to a UTC date string
 * @param timestamp milliseconds since epoch
 * @param format optional format string
 * @returns formatted UTC date string
 */
export const formatTimestampToUtc = (timestamp: number, format?: string): string => {
    if (!timestamp) return '';

    const date = dayjs(timestamp);
    if (!date.isValid()) return '';

    return date.utc().format(format || 'MM/DD/YYYY');
};

/**
 * Extract time from a timestamp (in milliseconds)
 * @param timestamp milliseconds since epoch
 * @param format optional format string
 * @param userTimezone optional user timezone (if not provided, will be fetched from settings)
 * @returns formatted time string
 */
export const getTimeFromTimestamp = (timestamp: number, format?: string, userTimezone?: string): string => {
    if (!timestamp) return '';

    const date = dayjs(timestamp);
    if (!date.isValid()) return '';

    // Use the provided timezone, or get from settings, or use local timezone
    const tz = userTimezone || getUserTimezone();
    return date.tz(tz).format(format || 'hh:mm a');
};

/**
 * Convert date to milliseconds
 * @param date Date object or date string
 * @returns date in milliseconds
 */
export const convertDateToMilliseconds = (date: Date | string): number => {
    return dayjs(date).isValid() ? dayjs(date).valueOf() : 0;
};

/**
 * Get current timestamp in milliseconds
 * @returns current timestamp in milliseconds
 */
export const getCurrentTimestamp = (): number => {
    return Date.now();
};

/**
 * Convert a timestamp to a Date object
 * @param timestamp milliseconds since epoch
 * @returns Date object
 */
export const timestampToDate = (timestamp: number): Date => {
    return new Date(timestamp);
};

/**
 * Apply user's timezone to a date
 * @param date Date object or timestamp
 * @param userTimezone optional user timezone (if not provided, will be fetched from settings)
 * @returns Date object adjusted to user's timezone
 */
export const applyUserTimezone = (date: Date | number, userTimezone?: string): Date => {
    const tz = userTimezone || getUserTimezone();
    const timestamp = typeof date === 'number' ? date : date.getTime();
    return new Date(dayjs(timestamp).tz(tz).valueOf());
};
