import { format } from 'date-fns';

/**
 * Formats a date to DD-Mon-YYYY format (e.g., 01-Dec-2025)
 * This format avoids ambiguity and ensures screenshots or shared data are easy to understand across different locales.
 * @param date Date object or timestamp in milliseconds
 * @returns Formatted date string in DD-Mon-YYYY format
 */
export function formatDateStandard(date: Date | number): string {
    const dateObj = typeof date === 'number' ? new Date(date) : date;
    return format(dateObj, 'dd-MMM-yyyy');
}

/**
 * Formats a date with time to DD-Mon-YYYY HH:mm:ss format (e.g., 01-Dec-2025 14:30:00)
 * @param date Date object or timestamp in milliseconds
 * @returns Formatted date-time string
 */
export function formatDateTimeStandard(date: Date | number): string {
    const dateObj = typeof date === 'number' ? new Date(date) : date;
    return format(dateObj, 'dd-MMM-yyyy HH:mm:ss');
}
