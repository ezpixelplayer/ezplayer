import { isElectron, PageHeader, Select, ToastMsgs } from '@ezplayer/shared-ui-components';
import { Add, Delete, Info } from '@mui/icons-material';
import PaletteIcon from '@mui/icons-material/Palette';
import {
    Button,
    Card,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    IconButton,
    List,
    ListItem,
    ListItemSecondaryAction,
    ListItemText,
    SelectChangeEvent,
    Slider,
    TextField,
    Typography,
} from '@mui/material';
import { Box } from '../box/Box';
import { createSelector } from '@reduxjs/toolkit';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../store/Store';
import { ezrgbThemeOptions, useThemeContext } from '../../theme/ThemeBase';
import { AboutDialog } from './AboutDialog';
import { EZPElectronAPI, ViewerControlScheduleEntry, VolumeScheduleEntry } from '@ezplayer/ezplayer-core';
import { LicenseDialog, LicenseEntry } from './LicenseDialog';
import { useMemo } from 'react';
import Licenses from '../../constants/licenses.json';
import { playerStatusActions } from '../../store/slices/PlayerStatusStore';
import { ColorPaletteDialog } from '../theme/ColorPaletteDialog';

interface UISettings {
    theme?: string;
}

interface PlaybackSettingsDrawerProps {
    title: string;
    statusArea?: React.ReactNode[];
}

// Time validation and formatting functions (from schedule screen)
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

// Time input component matching the schedule screen format
const TimeInput: React.FC<{
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

    // Update local value when prop value changes (but not when editing)
    React.useEffect(() => {
        if (!isEditing) {
            setLocalValue(value);
        }
    }, [value, isEditing]);

    const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value: inputValue } = event.target;

        // Simple, predictable time input formatting
        const formatTimeInput = (timeValue: string): string => {
            // Only allow digits and colons
            let cleaned = timeValue.replace(/[^0-9:]/g, '');

            // Limit to 5 characters max (HH:MM)
            if (cleaned.length > 5) {
                cleaned = cleaned.substring(0, 5);
            }

            // Auto-insert colon after 2 digits if user types 4 numbers without colon
            const digitsOnly = cleaned.replace(/[^0-9]/g, '');
            if (digitsOnly.length === 4 && !cleaned.includes(':')) {
                cleaned = `${digitsOnly.substring(0, 2)}:${digitsOnly.substring(2)}`;
            }

            return cleaned;
        };

        const formattedValue = formatTimeInput(inputValue);
        setLocalValue(formattedValue);
        // Don't call onChange here - only on blur to prevent focus loss
    };

    const handleTimeBlur = (event: React.FocusEvent<HTMLInputElement>) => {
        setIsEditing(false);

        // Simple formatting on blur - just add colon if missing and pad with zeros
        let cleaned = localValue.replace(/[^0-9:]/g, '');

        // If user typed 3-4 digits without colon, format as HH:MM
        if (cleaned.length >= 3 && cleaned.length <= 4 && !cleaned.includes(':')) {
            const hours = cleaned.substring(0, 2);
            const minutes = cleaned.substring(2).padEnd(2, '0');
            cleaned = `${hours}:${minutes}`;
        }

        // If we have a valid HH:MM format, pad with zeros
        if (cleaned.includes(':')) {
            const [hoursStr, minutesStr] = cleaned.split(':');
            const hours = parseInt(hoursStr, 10);
            const minutes = parseInt(minutesStr, 10);

            // Validate ranges
            const maxHours = isFromTime ? 23 : 168;

            if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours <= maxHours && minutes >= 0 && minutes <= 59) {
                const formatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                setLocalValue(formatted);
                onChange(formatted);
            } else {
                // If invalid, reset to original value
                setLocalValue(value);
            }
        } else if (cleaned.length > 0) {
            // If we have some input but it's not valid, reset to original value
            setLocalValue(value);
        } else {
            // Empty input, call onChange with empty string
            onChange('');
        }
    };

    const handleTimeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const { key, target } = event;
        const input = target as HTMLInputElement;

        // Allow all navigation and editing keys
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete'].includes(key)) {
            return;
        }

        // Allow colon key
        if (key === ':') {
            return;
        }

        // Allow Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X for copy/paste operations
        if (event.ctrlKey && ['a', 'c', 'v', 'x'].includes(key.toLowerCase())) {
            return;
        }

        // Allow numeric input
        if (/^[0-9]$/.test(key)) {
            // Check if adding this digit would exceed the expected format
            const currentValue = input.value;
            const cursorPosition = input.selectionStart || 0;

            // If cursor is at position 2 and there's no colon yet, allow colon insertion
            if (cursorPosition === 2 && !currentValue.includes(':')) {
                return; // Allow the digit, colon will be added automatically
            }

            // If cursor is at position 5, don't allow more input
            if (cursorPosition >= 5) {
                event.preventDefault();
                return;
            }

            return; // Allow numeric input
        }

        // Handle special keys for better UX
        if (key === 'Tab') {
            // Allow tab navigation
            return;
        }

        // Prevent other keys
        event.preventDefault();
    };

    const handleTimeFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        setIsEditing(true);
        // Select all text when focusing on time fields for easy editing
        event.target.select();
    };

    const handleTimePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
        const pastedText = event.clipboardData.getData('text');

        // Only allow numeric characters and colons
        if (!/^[0-9:]+$/.test(pastedText)) {
            event.preventDefault();
            return;
        }

        // If pasting a complete time format, format it properly
        if (pastedText.length >= 4 && pastedText.includes(':')) {
            const [hoursStr, minutesStr] = pastedText.split(':');
            const hours = parseInt(hoursStr, 10);
            const minutes = parseInt(minutesStr, 10);

            if (!isNaN(hours) && !isNaN(minutes) && minutes >= 0 && minutes <= 59) {
                // Allow the paste operation
                return;
            }
        }

        // If pasting just numbers, allow it
        if (/^[0-9]+$/.test(pastedText)) {
            return;
        }

        // Prevent other paste operations
        event.preventDefault();
    };

    const handleTimeDoubleClick = (event: React.MouseEvent<HTMLInputElement>) => {
        event.currentTarget.select();
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
            onDoubleClick={handleTimeDoubleClick}
            disabled={disabled}
            type="text"
            InputLabelProps={{
                shrink: true,
            }}
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

// Selectors
const selectAuth = (state: RootState) => state.auth;
const selectShowDirectory = (state: RootState) => state.auth.showDirectory;
const selectPlaylists = (state: RootState) => state.playlists.playlists;
const selectSettings = (state: RootState) => state.playerStatus.playbackSettings;
const selectVersionInfo = createSelector([selectAuth], (auth) => ({
    playerVersion: auth.playerVersion,
    cloudVersion: auth.cloudVersion,
}));

// Extend Window interface to include electronAPI
declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

export const PlaybackSettingsDrawer: React.FC<PlaybackSettingsDrawerProps> = ({ title, statusArea }) => {
    const { themeName, handleThemeChange } = useThemeContext();
    const [selectedDirectory, setSelectedDirectory] = useState<string>('');

    // New schedule entry form state
    const [newScheduleEntry, setNewScheduleEntry] = useState<Partial<ViewerControlScheduleEntry>>({
        days: 'all',
        startTime: '00:00',
        endTime: '23:59',
        playlist: '',
    });

    // Dialog state
    const [unifiedDialogOpen, setUnifiedDialogOpen] = useState<boolean>(false);
    const [dialogType, setDialogType] = useState<'schedule' | 'volume'>('schedule');

    // Delete confirmation dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState<boolean>(false);
    const [itemToDelete, setItemToDelete] = useState<{ id: string; type: 'schedule' | 'volume' } | null>(null);

    // About dialog state
    const [aboutDialogOpen, setAboutDialogOpen] = useState<boolean>(false);

    // New volume schedule entry form state
    const [newVolumeScheduleEntry, setNewVolumeScheduleEntry] = useState<Partial<VolumeScheduleEntry>>({
        days: 'all',
        startTime: '00:00',
        endTime: '23:59',
        volumeLevel: 100,
    });

    // License dialog state
    const [licenseDialogOpen, setLicenseDialogOpen] = useState<boolean>(false);

    // Color palette dialog state
    const [colorPaletteDialogOpen, setColorPaletteDialogOpen] = useState<boolean>(false);

    const licenseEntries: LicenseEntry[] = useMemo(() => {
        // Map each dependency to a license entry
        return Licenses;
    }, []);

    const dispatch = useDispatch<AppDispatch>();

    const storedShowDirectory = useSelector(selectShowDirectory);
    const playlists = useSelector(selectPlaylists);
    const versionInfo = useSelector(selectVersionInfo);
    const settings = useSelector(selectSettings);

    // Update the selectedDirectory state when storedShowDirectory changes
    useEffect(() => {
        if (storedShowDirectory) {
            setSelectedDirectory(storedShowDirectory);
        }
    }, [storedShowDirectory]);

    // Load settings from local storage on component mount
    useEffect(() => {
        const savedSettings = localStorage.getItem('playbackSettings');
        if (savedSettings) {
            const settings = JSON.parse(savedSettings) as UISettings;
            if (settings?.theme) {
                handleThemeChange(settings.theme);
            }
        }
    }, []);

    // Flag to track if settings were just loaded
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

    // Mark initial load as complete after the first render
    useEffect(() => {
        setInitialLoadComplete(true);
    }, []);

    // Save settings to local storage whenever they change
    useEffect(() => {
        // Only save settings after initial load is complete to avoid re-saving loaded settings
        if (initialLoadComplete) {
            const uiSettings = {
                theme: themeName,
            };
            localStorage.setItem('playbackSettings', JSON.stringify(uiSettings));
        }
    }, [themeName, selectedDirectory, initialLoadComplete]);

    const handleThemeSwitch = (event: SelectChangeEvent<unknown>) => {
        const currentTheme = event.target.value as string;
        handleThemeChange(currentTheme);
    };

    // Helper functions for schedule management
    const generateId = () => Math.random().toString(36).substr(2, 9);

    const addViewerControlScheduleEntry = () => {
        if (
            newScheduleEntry.days &&
            newScheduleEntry.startTime &&
            newScheduleEntry.endTime &&
            newScheduleEntry.playlist &&
            isValidTimeFormat(newScheduleEntry.startTime) &&
            isValidExtendedTimeFormat(newScheduleEntry.endTime)
        ) {
            const entry: ViewerControlScheduleEntry = {
                id: generateId(),
                days: newScheduleEntry.days,
                startTime: formatTime24Hour(newScheduleEntry.startTime),
                endTime: formatTime24Hour(newScheduleEntry.endTime),
                playlist: newScheduleEntry.playlist,
            };
            dispatch(playerStatusActions.addViewerControlScheduleEntry(entry));
            setNewScheduleEntry({
                days: 'all',
                startTime: '00:00',
                endTime: '23:59',
                playlist: '',
            });
            setUnifiedDialogOpen(false);
        }
    };

    const removeViewerControlScheduleEntry = (id: string) => {
        setItemToDelete({ id, type: 'schedule' });
        setDeleteDialogOpen(true);
    };

    const handleOpenScheduleDialog = () => {
        setNewScheduleEntry({
            days: 'all',
            startTime: '00:00',
            endTime: '23:59',
            playlist: '',
        });
        setDialogType('schedule');
        setUnifiedDialogOpen(true);
    };

    const handleOpenVolumeDialog = () => {
        setNewVolumeScheduleEntry({
            days: 'all',
            startTime: '00:00',
            endTime: '23:59',
            volumeLevel: 100,
        });
        setDialogType('volume');
        setUnifiedDialogOpen(true);
    };

    const handleCloseUnifiedDialog = (event?: any, reason?: string) => {
        setUnifiedDialogOpen(false);
    };

    // Unified Dialog content component
    const UnifiedDialogContent = () => (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                pt: 1,
                width: '100%',
                minWidth: '500px',
            }}
        >
            {/* Days Selection */}
            <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Select Days
                </Typography>
                <FormControl fullWidth size="small">
                    <Select
                        options={[
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
                        ]}
                        itemText="name"
                        itemValue="id"
                        onChange={(e) => {
                            if (dialogType === 'schedule') {
                                setNewScheduleEntry({
                                    ...newScheduleEntry,
                                    days: (e.target as HTMLSelectElement).value as ViewerControlScheduleEntry['days'],
                                });
                            } else {
                                setNewVolumeScheduleEntry({
                                    ...newVolumeScheduleEntry,
                                    days: (e.target as HTMLSelectElement).value as VolumeScheduleEntry['days'],
                                });
                            }
                        }}
                        label="Select Days"
                        value={dialogType === 'schedule' ? newScheduleEntry.days : newVolumeScheduleEntry.days}
                        MenuProps={{
                            PaperProps: {
                                style: {
                                    maxHeight: 300,
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                },
                            },
                            anchorOrigin: {
                                vertical: 'bottom',
                                horizontal: 'left',
                            },
                            transformOrigin: {
                                vertical: 'top',
                                horizontal: 'left',
                            },
                            disableScrollLock: true,
                        }}
                        sx={{
                            '& .MuiSelect-select': {
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            },
                        }}
                    />
                </FormControl>
            </Box>

            {/* Time Configuration Section */}
            <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Time Range
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
                    <TimeInput
                        size="small"
                        label="Start Time"
                        value={
                            dialogType === 'schedule'
                                ? newScheduleEntry.startTime || ''
                                : newVolumeScheduleEntry.startTime || ''
                        }
                        onChange={(value) => {
                            if (dialogType === 'schedule') {
                                setNewScheduleEntry({ ...newScheduleEntry, startTime: value });
                            } else {
                                setNewVolumeScheduleEntry({ ...newVolumeScheduleEntry, startTime: value });
                            }
                        }}
                        isFromTime={true}
                        sx={{ flex: 1 }}
                    />
                    <TimeInput
                        size="small"
                        label="End Time"
                        value={
                            dialogType === 'schedule'
                                ? newScheduleEntry.endTime || ''
                                : newVolumeScheduleEntry.endTime || ''
                        }
                        onChange={(value) => {
                            if (dialogType === 'schedule') {
                                setNewScheduleEntry({ ...newScheduleEntry, endTime: value });
                            } else {
                                setNewVolumeScheduleEntry({ ...newVolumeScheduleEntry, endTime: value });
                            }
                        }}
                        isFromTime={false}
                        sx={{ flex: 1 }}
                    />
                </Box>
            </Box>

            {/* Additional Configuration Section */}
            {dialogType === 'schedule' ? (
                <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Playlist Selection
                    </Typography>
                    <FormControl fullWidth size="small">
                        <Select
                            options={playlists.map((playlist) => ({
                                id: playlist.title,
                                name: playlist.title,
                            }))}
                            itemText="name"
                            itemValue="id"
                            onChange={(e) =>
                                setNewScheduleEntry({
                                    ...newScheduleEntry,
                                    playlist: (e.target as HTMLSelectElement).value as string,
                                })
                            }
                            label="Select Playlist"
                            value={newScheduleEntry.playlist || ''}
                        />
                    </FormControl>
                </Box>
            ) : (
                <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Volume Level
                    </Typography>
                    <Box sx={{ px: 2 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Set volume level: {newVolumeScheduleEntry.volumeLevel || 100}%
                        </Typography>
                        <Slider
                            value={newVolumeScheduleEntry.volumeLevel || 100}
                            onChangeCommitted={(_, value) =>
                                setNewVolumeScheduleEntry({ ...newVolumeScheduleEntry, volumeLevel: value as number })
                            }
                            min={0}
                            max={100}
                            marks={[
                                { value: 0, label: '0' },
                                { value: 25, label: '25' },
                                { value: 50, label: '50' },
                                { value: 75, label: '75' },
                                { value: 100, label: '100' },
                            ]}
                            step={1}
                            size="small"
                            sx={{
                                '& .MuiSlider-thumb': {
                                    width: 20,
                                    height: 20,
                                },
                                '& .MuiSlider-track': {
                                    height: 6,
                                },
                                '& .MuiSlider-rail': {
                                    height: 6,
                                },
                            }}
                        />
                    </Box>
                </Box>
            )}

            {/* Action Buttons */}
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 2,
                    mt: 2,
                    pt: 2,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                }}
            >
                <Button variant="outlined" onClick={handleCloseUnifiedDialog} sx={{ minWidth: 100 }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={dialogType === 'schedule' ? addViewerControlScheduleEntry : addVolumeScheduleEntry}
                    disabled={
                        dialogType === 'schedule'
                            ? !newScheduleEntry.days ||
                              !newScheduleEntry.startTime ||
                              !newScheduleEntry.endTime ||
                              !newScheduleEntry.playlist ||
                              !isValidTimeFormat(newScheduleEntry.startTime) ||
                              !isValidExtendedTimeFormat(newScheduleEntry.endTime)
                            : !newVolumeScheduleEntry.days ||
                              !newVolumeScheduleEntry.startTime ||
                              !newVolumeScheduleEntry.endTime ||
                              newVolumeScheduleEntry.volumeLevel === undefined ||
                              !isValidTimeFormat(newVolumeScheduleEntry.startTime) ||
                              !isValidExtendedTimeFormat(newVolumeScheduleEntry.endTime)
                    }
                    sx={{ minWidth: 140 }}
                >
                    {dialogType === 'schedule' ? 'Add Schedule Entry' : 'Add Volume Override'}
                </Button>
            </Box>
        </Box>
    );

    // Unified Delete Confirmation Dialog Content
    const DeleteDialogContent = () => {
        const getItemType = () => {
            if (itemToDelete?.type === 'schedule') {
                return 'schedule entry';
            } else if (itemToDelete?.type === 'volume') {
                return 'volume override';
            }
            return 'item';
        };

        return (
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    minWidth: '400px',
                }}
            >
                <Box>
                    <Typography variant="body1" color="text.secondary">
                        Are you sure you want to delete this {getItemType()}
                    </Typography>
                </Box>
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 2,
                        mt: 2,
                        pt: 2,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <Button variant="outlined" onClick={handleCloseDeleteDialog} sx={{ minWidth: 100 }}>
                        Cancel
                    </Button>
                    <Button variant="contained" color="error" onClick={confirmDelete} sx={{ minWidth: 100 }}>
                        Delete
                    </Button>
                </Box>
            </Box>
        );
    };

    const getDaysDisplayName = (days: ViewerControlScheduleEntry['days']) => {
        const dayNames = {
            all: 'All',
            'weekend-fri-sat': 'Weekend (Fri+Sat)',
            'weekend-sat-sun': 'Weekend (Sat+Sun)',
            'weekday-mon-fri': 'Weekday (Mon–Fri)',
            'weekday-sun-thu': 'Weekday (Sun–Thu)',
            monday: 'Monday',
            tuesday: 'Tuesday',
            wednesday: 'Wednesday',
            thursday: 'Thursday',
            friday: 'Friday',
            saturday: 'Saturday',
            sunday: 'Sunday',
        };
        return dayNames[days];
    };

    // Utility function to format time in 24-hour format
    const formatTime24Hour = (timeString: string): string => {
        if (!timeString) return '';

        // If time is already in HH:MM format, return as is
        if (/^\d{2}:\d{2}$/.test(timeString)) {
            return timeString;
        }

        // If time is in H:MM format, pad with leading zero
        if (/^\d{1}:\d{2}$/.test(timeString)) {
            return `0${timeString}`;
        }

        return timeString;
    };

    // Utility function to validate time format
    const isValidTimeFormat = (timeString: string): boolean => {
        if (!timeString) return false;
        // Accept both HH:MM and H:MM formats, but ensure valid 24-hour time
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeRegex.test(timeString);
    };

    // Utility function to validate extended time format (for end times that can exceed 24:00)
    const isValidExtendedTimeFormat = (timeString: string): boolean => {
        if (!timeString) return false;
        // Accept extended time format (0-168:59) for end times
        const timeRegex = /^([0-9]|[1-9][0-9]|1[0-6][0-9]|16[0-8]):[0-5][0-9]$/;
        return timeRegex.test(timeString);
    };

    // Helper functions for volume schedule management
    const addVolumeScheduleEntry = () => {
        if (
            newVolumeScheduleEntry.days &&
            newVolumeScheduleEntry.startTime &&
            newVolumeScheduleEntry.endTime &&
            newVolumeScheduleEntry.volumeLevel !== undefined &&
            isValidTimeFormat(newVolumeScheduleEntry.startTime) &&
            isValidExtendedTimeFormat(newVolumeScheduleEntry.endTime)
        ) {
            const entry: VolumeScheduleEntry = {
                id: generateId(),
                days: newVolumeScheduleEntry.days,
                startTime: formatTime24Hour(newVolumeScheduleEntry.startTime),
                endTime: formatTime24Hour(newVolumeScheduleEntry.endTime),
                volumeLevel: newVolumeScheduleEntry.volumeLevel,
            };
            dispatch(playerStatusActions.addVolumeScheduleEntry(entry));
            setNewVolumeScheduleEntry({
                days: 'all',
                startTime: '00:00',
                endTime: '23:59',
                volumeLevel: 100,
            });
            setUnifiedDialogOpen(false);
        }
    };

    const removeVolumeScheduleEntry = (id: string) => {
        setItemToDelete({ id, type: 'volume' });
        setDeleteDialogOpen(true);
    };

    const confirmDelete = () => {
        if (itemToDelete) {
            if (itemToDelete.type === 'schedule') {
                dispatch(playerStatusActions.removeViewerControlScheduleEntry(itemToDelete.id));
            } else if (itemToDelete.type === 'volume') {
                dispatch(playerStatusActions.removeVolumeScheduleEntry(itemToDelete.id));
            }
        }
        setDeleteDialogOpen(false);
        setItemToDelete(null);
    };

    const handleCloseDeleteDialog = (event?: any, reason?: string) => {
        setDeleteDialogOpen(false);
        setItemToDelete(null);
    };

    // Handle directory selection for Electron app
    const handleSelectDirectory = async () => {
        if (isElectron() && window.electronAPI?.requestChooseShowFolder) {
            try {
                // Use the dedicated directory selection method
                const newSF = await window.electronAPI.requestChooseShowFolder();

                if (newSF) {
                    // Redux store will get updated by choice made
                    // Local state will be updated via the useEffect that watches storedShowDirectory

                    ToastMsgs.showSuccessMessage(`Directory selected: ${newSF}`, {
                        theme: 'colored',
                        position: 'bottom-right',
                        autoClose: 2000,
                    });
                }
            } catch (error) {
                console.error('Error selecting directory:', error);
                ToastMsgs.showErrorMessage('Failed to select directory', {
                    theme: 'colored',
                    position: 'bottom-right',
                    autoClose: 2000,
                });
            }
        }
    };

    // Main settings card content
    const renderMainContent = () => {
        return (
            <>
                <Box
                    sx={{
                        padding: 2,
                        '& .MuiDivider-root': { my: 3 },
                        '& .MuiFormControl-root': { mb: 2 },
                    }}
                    role="presentation"
                >
                    {/* Theme Selector */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 3 }}>
                        <FormControl fullWidth size="small" sx={{ flex: 1 }}>
                            <Select
                                options={ezrgbThemeOptions}
                                itemText="id"
                                itemValue="name"
                                onChange={(e) => handleThemeSwitch(e as SelectChangeEvent<unknown>)}
                                label="Theme"
                                value={themeName}
                            />
                        </FormControl>
                        <IconButton
                            onClick={() => setColorPaletteDialogOpen(true)}
                            size="medium"
                            sx={{
                                mt: '8px',
                                color: 'primary.main',
                                '&:hover': {
                                    backgroundColor: 'action.hover',
                                },
                            }}
                            title="View Color Palette"
                        >
                            <PaletteIcon />
                        </IconButton>
                    </Box>

                    {/* Audio Sync Adjust Group */}
                    <Card
                        sx={{
                            mb: 3,
                            p: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            backgroundColor: 'background.paper',
                        }}
                    >
                        <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                            Audio Sync Adjust
                        </Typography>
                        <Box sx={{ px: 2 }}>
                            <Slider
                                value={settings.audioSyncAdjust}
                                onChange={(_, value) =>
                                    dispatch(playerStatusActions.setAudioSyncAdjust(value as number))
                                }
                                min={-100}
                                max={100}
                                step={1}
                                marks={[
                                    { value: -100, label: '-100' },
                                    { value: -50, label: '-50' },
                                    { value: 0, label: '0' },
                                    { value: 50, label: '50' },
                                    { value: 100, label: '100' },
                                ]}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(value) => `${value}ms`}
                                sx={{
                                    '& .MuiSlider-thumb': {
                                        width: 20,
                                        height: 20,
                                    },
                                    '& .MuiSlider-track': {
                                        height: 6,
                                    },
                                    '& .MuiSlider-rail': {
                                        height: 6,
                                    },
                                }}
                            />
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            Adjust audio synchronization. Negative values sync earlier, positive values sync later.
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                            Current value: {settings.audioSyncAdjust}ms
                        </Typography>
                    </Card>

                    {/* Background Sequence Group */}
                    <Card
                        sx={{
                            mb: 3,
                            p: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            backgroundColor: 'background.paper',
                        }}
                    >
                        <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                            Background Sequence
                        </Typography>
                        <FormControl fullWidth size="small">
                            <Select
                                options={[
                                    { id: 'overlay', name: 'Overlay' },
                                    { id: 'underlay', name: 'Underlay' },
                                ]}
                                itemText="name"
                                itemValue="id"
                                onChange={(e) =>
                                    dispatch(
                                        playerStatusActions.setBackgroundSequence(
                                            (e.target as HTMLSelectElement).value as 'overlay' | 'underlay',
                                        ),
                                    )
                                }
                                label="Background Sequence"
                                value={settings.backgroundSequence}
                            />
                        </FormControl>
                    </Card>

                    {/* Viewer Control Group */}
                    <Card
                        sx={{
                            mb: 3,
                            p: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            backgroundColor: 'background.paper',
                        }}
                    >
                        <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                            Viewer Control
                        </Typography>

                        {/* Viewer Control Type */}
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <Select
                                options={[
                                    { id: 'disabled', name: 'Disabled' },
                                    { id: 'remote-falcon', name: 'Remote Falcon' },
                                ]}
                                itemText="name"
                                itemValue="id"
                                onChange={(e) => {
                                    const type = (e.target as HTMLSelectElement).value as 'disabled' | 'remote-falcon';
                                    dispatch(playerStatusActions.setViewerControlType(type));
                                    dispatch(playerStatusActions.setViewerControlEnabled(type !== 'disabled'));
                                }}
                                label="Viewer Control Type"
                                value={settings.viewerControl.type}
                            />
                        </FormControl>

                        {/* Remote Falcon Token */}
                        {settings.viewerControl.type === 'remote-falcon' && (
                            <TextField
                                fullWidth
                                size="small"
                                label="Remote Falcon Token"
                                value={settings.viewerControl.remoteFalconToken}
                                onChange={(e) => dispatch(playerStatusActions.setRemoteFalconToken(e.target.value))}
                                placeholder="Enter your Remote Falcon token"
                                sx={{ mb: 3 }}
                            />
                        )}

                        {/* Schedule Management */}
                        {settings.viewerControl.type === 'remote-falcon' && (
                            <Box>
                                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                                    Schedule Configuration
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                    Configure when viewers can control the playlist. Last entry takes priority for
                                    overlapping times.
                                </Typography>

                                {/* Schedule Entries List */}
                                {settings.viewerControl.schedule.length > 0 && (
                                    <Box sx={{ mb: 2 }}>
                                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                            Current Schedule ({settings.viewerControl.schedule.length} entries)
                                        </Typography>
                                        <List dense>
                                            {settings.viewerControl.schedule.map((entry, index) => (
                                                <React.Fragment key={entry.id}>
                                                    <ListItem>
                                                        <ListItemText
                                                            primary={
                                                                <Box
                                                                    sx={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: 1,
                                                                        flexWrap: 'wrap',
                                                                    }}
                                                                >
                                                                    <Chip
                                                                        label={getDaysDisplayName(entry.days)}
                                                                        size="small"
                                                                    />
                                                                    <Typography variant="body2">
                                                                        {formatTime24Hour(entry.startTime)} -{' '}
                                                                        {formatTime24Hour(entry.endTime)}
                                                                    </Typography>
                                                                    <Typography variant="body2" fontWeight="medium">
                                                                        {entry.playlist}
                                                                    </Typography>
                                                                </Box>
                                                            }
                                                            secondary={`Priority: ${settings.viewerControl.schedule.length - index}`}
                                                        />
                                                        <ListItemSecondaryAction>
                                                            <IconButton
                                                                edge="end"
                                                                onClick={() =>
                                                                    removeViewerControlScheduleEntry(entry.id)
                                                                }
                                                                size="small"
                                                                color="error"
                                                            >
                                                                <Delete />
                                                            </IconButton>
                                                        </ListItemSecondaryAction>
                                                    </ListItem>
                                                    {index < settings.viewerControl.schedule.length - 1 && <Divider />}
                                                </React.Fragment>
                                            ))}
                                        </List>
                                    </Box>
                                )}

                                {/* Add Schedule Entry Button */}
                                <Button
                                    variant="contained"
                                    startIcon={<Add />}
                                    onClick={handleOpenScheduleDialog}
                                    sx={{ mb: 2 }}
                                >
                                    Add Schedule Entry
                                </Button>
                            </Box>
                        )}
                    </Card>

                    {/* Volume Control Group */}
                    <Card
                        sx={{
                            mb: 3,
                            p: 3,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            backgroundColor: 'background.paper',
                        }}
                    >
                        <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                            Volume Control
                        </Typography>

                        {/* Default Volume */}
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle2" sx={{ mb: 2 }}>
                                Default Volume
                            </Typography>
                            <Box sx={{ px: 2 }}>
                                <Slider
                                    value={settings.volumeControl.defaultVolume}
                                    onChange={(_, value) =>
                                        dispatch(playerStatusActions.setDefaultVolume(value as number))
                                    }
                                    min={0}
                                    max={100}
                                    step={1}
                                    marks={[
                                        { value: 0, label: '0' },
                                        { value: 25, label: '25' },
                                        { value: 50, label: '50' },
                                        { value: 75, label: '75' },
                                        { value: 100, label: '100' },
                                    ]}
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={(value) => `${value}%`}
                                    sx={{
                                        '& .MuiSlider-thumb': {
                                            width: 20,
                                            height: 20,
                                        },
                                        '& .MuiSlider-track': {
                                            height: 6,
                                        },
                                        '& .MuiSlider-rail': {
                                            height: 6,
                                        },
                                    }}
                                />
                            </Box>
                            <Typography variant="body2" sx={{ mt: 1, fontWeight: 'medium' }}>
                                Default Volume: {settings.volumeControl.defaultVolume}%
                            </Typography>
                        </Box>

                        {/* Volume Schedule Management */}
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 2 }}>
                                Volume Schedule Overrides
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                Configure volume overrides for specific times. Last entry takes priority for overlapping
                                times.
                            </Typography>

                            {/* Volume Schedule Entries List */}
                            {settings.volumeControl.schedule.length > 0 && (
                                <Box sx={{ mb: 2 }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                        Current Volume Overrides ({settings.volumeControl.schedule.length} entries)
                                    </Typography>
                                    <List dense>
                                        {settings.volumeControl.schedule.map((entry, index) => (
                                            <React.Fragment key={entry.id}>
                                                <ListItem>
                                                    <ListItemText
                                                        primary={
                                                            <Box
                                                                sx={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 1,
                                                                    flexWrap: 'wrap',
                                                                }}
                                                            >
                                                                <Chip
                                                                    label={getDaysDisplayName(entry.days)}
                                                                    size="small"
                                                                />
                                                                <Typography variant="body2">
                                                                    {formatTime24Hour(entry.startTime)} -{' '}
                                                                    {formatTime24Hour(entry.endTime)}
                                                                </Typography>
                                                                <Chip
                                                                    label={`${entry.volumeLevel}%`}
                                                                    size="small"
                                                                    color="primary"
                                                                    variant="outlined"
                                                                />
                                                            </Box>
                                                        }
                                                        secondary={`Priority: ${settings.volumeControl.schedule.length - index}`}
                                                    />
                                                    <ListItemSecondaryAction>
                                                        <IconButton
                                                            edge="end"
                                                            onClick={() => removeVolumeScheduleEntry(entry.id)}
                                                            size="small"
                                                            color="error"
                                                        >
                                                            <Delete />
                                                        </IconButton>
                                                    </ListItemSecondaryAction>
                                                </ListItem>
                                                {index < settings.volumeControl.schedule.length - 1 && <Divider />}
                                            </React.Fragment>
                                        ))}
                                    </List>
                                </Box>
                            )}

                            {/* Add Volume Override Button */}
                            <Button
                                variant="contained"
                                startIcon={<Add />}
                                onClick={handleOpenVolumeDialog}
                                sx={{ mb: 2 }}
                            >
                                Add Volume Override
                            </Button>
                        </Box>
                    </Card>

                    {/* Show Directory Group */}
                    {isElectron() && (
                        <Card
                            sx={{
                                mb: 3,
                                p: 3,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 2,
                                backgroundColor: 'background.paper',
                            }}
                        >
                            <Typography variant="h6" sx={{ mb: 2, color: 'primary.main' }}>
                                Show Directory
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Button
                                    variant="contained"
                                    onClick={handleSelectDirectory}
                                    sx={{ whiteSpace: 'nowrap' }}
                                >
                                    Show Folder
                                </Button>
                                <TextField
                                    fullWidth
                                    variant="outlined"
                                    size="small"
                                    placeholder="No directory selected"
                                    value={selectedDirectory}
                                    disabled
                                    sx={{
                                        '& .MuiInputBase-input': { color: 'text.primary' },
                                    }}
                                />
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                Select a directory containing your show files
                            </Typography>
                        </Card>
                    )}

                    {/* About & License Buttons */}
                    <Box sx={{ mt: 1, pt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                        <Button
                            variant="outlined"
                            startIcon={<Info />}
                            onClick={() => setAboutDialogOpen(true)}
                            size="small"
                            sx={{
                                textTransform: 'none',
                                minWidth: 'auto',
                                px: 3,
                            }}
                        >
                            About EZPlayer
                        </Button>
                        <Button
                            variant="outlined"
                            startIcon={<Info />}
                            onClick={() => setLicenseDialogOpen(true)}
                            size="small"
                            sx={{
                                textTransform: 'none',
                                minWidth: 'auto',
                                px: 3,
                            }}
                        >
                            License
                        </Button>
                    </Box>
                </Box>
            </>
        );
    };

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden', // Prevent outer scrollbar
            }}
        >
            <Box sx={{ flexShrink: 0, padding: 2 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>

            <Box
                sx={{
                    padding: 2,
                    overflowY: 'auto', // Only this container should scroll
                    flexGrow: 1, // Take remaining space
                }}
            >
                {/* Main Settings Card */}
                <Card
                    sx={{
                        maxWidth: '600px',
                        p: 5,
                        mb: 4,
                    }}
                >
                    {renderMainContent()}
                </Card>
            </Box>

            {/* Unified Dialog for both Schedule Entry and Volume Override */}
            <Dialog open={unifiedDialogOpen} onClose={handleCloseUnifiedDialog}>
                <DialogTitle>
                    <Typography variant="h5">
                        {dialogType === 'schedule' ? 'Add Schedule Entry' : 'Add Volume Override'}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <UnifiedDialogContent />
                </DialogContent>
            </Dialog>

            {/* Unified Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onClose={handleCloseDeleteDialog}>
                <DialogTitle>
                    <Typography variant="h5">
                        Delete{' '}
                        {itemToDelete?.type === 'schedule'
                            ? 'Schedule Entry'
                            : itemToDelete?.type === 'volume'
                              ? 'Volume Override'
                              : 'Item'}
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <DeleteDialogContent />
                </DialogContent>
            </Dialog>

            {/* About Dialog */}
            <AboutDialog
                open={aboutDialogOpen}
                onClose={() => setAboutDialogOpen(false)}
                playerVersion={versionInfo.playerVersion}
                cloudVersion={versionInfo.cloudVersion}
            />

            {/* License Dialog */}
            <LicenseDialog
                open={licenseDialogOpen}
                onClose={() => setLicenseDialogOpen(false)}
                licenses={licenseEntries}
            />

            {/* Color Palette Dialog */}
            <ColorPaletteDialog open={colorPaletteDialogOpen} onClose={() => setColorPaletteDialogOpen(false)} />
        </Box>
    );
};
