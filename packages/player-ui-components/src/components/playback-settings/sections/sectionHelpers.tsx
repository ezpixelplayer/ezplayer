import { TextField } from '@mui/material';
import React from 'react';
import type { ViewerControlScheduleEntry } from '@ezplayer/ezplayer-core';

const isTimeValid = (time: string): boolean => {
    if (!time) return true;
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    return timeRegex.test(time);
};

const isExtendedTimeValid = (time: string): boolean => {
    if (!time) return true;
    const timeRegex = /^([0-9]|[1-9][0-9]|1[0-6][0-9]|16[0-8]):([0-5][0-9])$/;
    return timeRegex.test(time);
};

/** Time input matching the schedule screen format. Used by viewer & audio sections. */
export const TimeInput: React.FC<{
    value: string;
    onChange: (value: string) => void;
    label: string;
    size?: 'small' | 'medium';
    sx?: any;
    disabled?: boolean;
    isFromTime?: boolean;
}> = React.memo(({ value, onChange, label, size = 'small', sx, disabled, isFromTime = false }) => {
    const [localValue, setLocalValue] = React.useState(value);
    const [isEditing, setIsEditing] = React.useState(false);

    React.useEffect(() => {
        if (!isEditing) setLocalValue(value);
    }, [value, isEditing]);

    const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value: inputValue } = event.target;
        const formatTimeInput = (timeValue: string): string => {
            let cleaned = timeValue.replace(/[^0-9:]/g, '');
            if (cleaned.length > 5) cleaned = cleaned.substring(0, 5);
            const digitsOnly = cleaned.replace(/[^0-9]/g, '');
            if (digitsOnly.length === 4 && !cleaned.includes(':')) {
                cleaned = `${digitsOnly.substring(0, 2)}:${digitsOnly.substring(2)}`;
            }
            return cleaned;
        };
        setLocalValue(formatTimeInput(inputValue));
    };

    const handleTimeBlur = () => {
        setIsEditing(false);
        let cleaned = localValue.replace(/[^0-9:]/g, '');
        if (cleaned.length >= 3 && cleaned.length <= 4 && !cleaned.includes(':')) {
            const hours = cleaned.substring(0, 2);
            const minutes = cleaned.substring(2).padEnd(2, '0');
            cleaned = `${hours}:${minutes}`;
        }
        if (cleaned.includes(':')) {
            const [hoursStr, minutesStr] = cleaned.split(':');
            const hours = parseInt(hoursStr, 10);
            const minutes = parseInt(minutesStr, 10);
            const maxHours = isFromTime ? 23 : 168;
            if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours <= maxHours && minutes >= 0 && minutes <= 59) {
                const formatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                setLocalValue(formatted);
                onChange(formatted);
            } else {
                setLocalValue(value);
            }
        } else if (cleaned.length > 0) {
            setLocalValue(value);
        } else {
            onChange('');
        }
    };

    const handleTimeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const { key, target } = event;
        const input = target as HTMLInputElement;
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete'].includes(key)) return;
        if (key === ':') return;
        if (event.ctrlKey && ['a', 'c', 'v', 'x'].includes(key.toLowerCase())) return;
        if (/^[0-9]$/.test(key)) {
            const cursorPosition = input.selectionStart || 0;
            if (cursorPosition === 2 && !input.value.includes(':')) return;
            if (cursorPosition >= 5) {
                event.preventDefault();
                return;
            }
            return;
        }
        if (key === 'Tab') return;
        event.preventDefault();
    };

    const handleTimeFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        setIsEditing(true);
        event.target.select();
    };

    const handleTimePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
        const pastedText = event.clipboardData.getData('text');
        if (!/^[0-9:]+$/.test(pastedText)) {
            event.preventDefault();
            return;
        }
        if (pastedText.length >= 4 && pastedText.includes(':')) {
            const [hoursStr, minutesStr] = pastedText.split(':');
            const hours = parseInt(hoursStr, 10);
            const minutes = parseInt(minutesStr, 10);
            if (!isNaN(hours) && !isNaN(minutes) && minutes >= 0 && minutes <= 59) return;
        }
        if (/^[0-9]+$/.test(pastedText)) return;
        event.preventDefault();
    };

    return (
        <TextField
            size={size}
            label={label}
            value={localValue}
            onChange={handleTimeChange}
            onBlur={handleTimeBlur}
            onKeyDown={handleTimeKeyDown}
            onFocus={handleTimeFocus}
            onPaste={handleTimePaste}
            onDoubleClick={(e) => (e.currentTarget as HTMLInputElement).select()}
            disabled={disabled}
            type="text"
            InputLabelProps={{ shrink: true }}
            inputProps={{
                placeholder: isFromTime ? 'HH:MM (0-23)' : 'HH:MM (25:00+)',
                inputMode: 'numeric',
                maxLength: 5,
            }}
            helperText={
                isFromTime
                    ? '24-hour format (e.g., 14:30, 22:00). Start time must be within the same day.'
                    : 'Extended time format (e.g., 14:30, 25:00, 26:30). Use 25:00 for 1:00 AM next day, 48:00 for midnight 2 days later.'
            }
            error={Boolean(localValue && (!isFromTime ? !isExtendedTimeValid(localValue) : !isTimeValid(localValue)))}
            sx={sx}
        />
    );
});

export type DayKey = ViewerControlScheduleEntry['days'];

export const DAY_OPTIONS: { id: DayKey; name: string }[] = [
    { id: 'all', name: 'All Days' },
    { id: 'weekend-fri-sat', name: 'Weekend (Fri+Sat)' },
    { id: 'weekend-sat-sun', name: 'Weekend (Sat+Sun)' },
    { id: 'weekday-mon-fri', name: 'Weekday (Mon–Fri)' },
    { id: 'weekday-sun-thu', name: 'Weekday (Sun–Thu)' },
    { id: 'monday', name: 'Monday' },
    { id: 'tuesday', name: 'Tuesday' },
    { id: 'wednesday', name: 'Wednesday' },
    { id: 'thursday', name: 'Thursday' },
    { id: 'friday', name: 'Friday' },
    { id: 'saturday', name: 'Saturday' },
    { id: 'sunday', name: 'Sunday' },
];

export const getDaysDisplayName = (days: DayKey): string => {
    return DAY_OPTIONS.find((d) => d.id === days)?.name ?? days;
};

export const formatTime24Hour = (timeString: string): string => {
    if (!timeString) return '';
    if (/^\d{2}:\d{2}$/.test(timeString)) return timeString;
    if (/^\d{1}:\d{2}$/.test(timeString)) return `0${timeString}`;
    return timeString;
};

export const isValidTimeFormat = (timeString: string): boolean => {
    if (!timeString) return false;
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeString);
};

export const isValidExtendedTimeFormat = (timeString: string): boolean => {
    if (!timeString) return false;
    return /^([0-9]|[1-9][0-9]|1[0-6][0-9]|16[0-8]):[0-5][0-9]$/.test(timeString);
};

export const generateId = () => Math.random().toString(36).substr(2, 9);
