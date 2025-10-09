import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

//To convert any string to title case
/**
 * @param value
 * @returns title case string
 */
export const titleCase = (value: string) => {
    if (!value) {
        return '';
    }
    return value.replace(/^_*(.)|_+(.)/g, (s, c, d) => (c ? c.toUpperCase() : ' ' + d.toUpperCase()));
};

//To convert date string in specific format, by default MM/DD/YYYY
/**
 * @param date
 * @param format optional
 * @returns formated date
 */
export const formatDate = (date: string, format?: string) => {
    return date && dayjs(date).isValid() ? dayjs(date).format(format ? format : 'MM/DD/YYYY') : '';
};

//To convert date string to UTC in specific format, by default MM/DD/YYYY
/**
 * @param date
 * @param format optional
 * @returns formated utc date
 */
export const formatDateToUtc = (date: string, format?: string) => {
    dayjs.extend(utc);
    return dayjs(date).isValid()
        ? dayjs(date)
              .utc(true)
              .format(format ? format : 'MM/DD/YYYY')
        : '';
};

//To extract time from date string in specific format, by default hh:mm a
/**
 * @param date
 * @param format optional
 * @returns formated time
 */
export const getTimeStamp = (date: string, format?: string) => {
    return dayjs(date).isValid() ? dayjs(date).format(format ? format : 'hh:mm a') : '';
};

//Get the initials of any string value
/**
 * @param text
 * @returns initials of given text
 */
export const getInitials = (text: string) => {
    return text
        ? text
              .split(' ')
              .map((v) => v.slice(0, 1))
              .join('')
              .toUpperCase()
        : '';
};

//Remove underscore from any string value
/**
 * @param text
 * @returns given string without underscore
 */
export const removeUnderscore = (text: string) => {
    return text
        ? text.replace(/(?:_| |\b)(\w)/g, function ($1) {
              return $1.toUpperCase().replace('_', ' ');
          })
        : '';
};

//To conver bytes to kb
/**
 * @param value in bytes
 * @returns converted value in kb
 */
export const convertBytesToKb = (value: number) => {
    return value ? Math.round(value / Math.pow(1024, 1)) : 0;
};

//To get the today's date
/**
 * @returns current date in YYYY-MM-DD format
 */
export const getDate = () => {
    const today = new Date();
    const dayNum = today.getDate();
    const monthNum = today.getMonth() + 1;
    const yearNum = today.getFullYear();
    let day = dayNum.toString();
    let month = monthNum.toString();
    if (dayNum < 10) {
        day = '0' + dayNum;
    }

    if (monthNum < 10) {
        month = '0' + monthNum;
    }
    return `${yearNum}-${month}-${day}`;
};

//To convert hexa code to rgba format
/**
 * @param hex
 * @param opacity
 * @returns converted rgba value
 */
export const hexToRgbA = (hex: string, opacity: number) => {
    let colorData: any;
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        colorData = hex.substring(1).split('');
        if (colorData.length == 3) {
            colorData = [colorData[0], colorData[0], colorData[1], colorData[1], colorData[2], colorData[2]];
        }
        colorData = '0x' + colorData.join('');
        return 'rgba(' + [(colorData >> 16) & 255, (colorData >> 8) & 255, colorData & 255].join(',') + `,${opacity})`;
    }
    throw new Error('Bad Hex');
};

// The following functions have been moved to dateUtils.ts
// Keeping the original functions here for backward compatibility
// but importing from dateUtils.ts to ensure consistency
import {
    convertDateToMilliseconds,
    getCurrentTimestamp,
    timestampToDate,
    formatTimestamp,
    formatTimestampToUtc,
    getTimeFromTimestamp,
} from './dateUtils';

export {
    convertDateToMilliseconds,
    getCurrentTimestamp,
    timestampToDate,
    formatTimestamp,
    formatTimestampToUtc,
    getTimeFromTimestamp,
};
