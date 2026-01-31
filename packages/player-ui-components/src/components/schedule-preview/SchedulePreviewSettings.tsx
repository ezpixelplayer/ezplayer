import React, { useState, useCallback } from 'react';
import { Card, CardContent, TextField, Button, Grid, Typography, Collapse, IconButton, MenuItem } from '@mui/material';
import { Box } from '../box/Box';
import { ExpandMore, ExpandLess, PlayArrow } from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { SchedulePreviewSettings as SettingsType } from '../../types/SchedulePreviewTypes';

interface SchedulePreviewSettingsProps {
    settings: SettingsType;
    onSettingsChange: (settings: SettingsType) => void;
    onGeneratePreview: (settings: SettingsType) => void;
    isGenerating: boolean;
    hasData: boolean;
    className?: string;
}

const SchedulePreviewSettings: React.FC<SchedulePreviewSettingsProps> = ({
    settings,
    onSettingsChange,
    onGeneratePreview,
    isGenerating,
    hasData,
    className = '',
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [localSettings, setLocalSettings] = useState<SettingsType>(settings);

    const handleInputChange = useCallback(
        (field: keyof SettingsType, value: any) => {
            const newSettings = { ...localSettings, [field]: value };
            setLocalSettings(newSettings);
            onSettingsChange(newSettings);
        },
        [localSettings, onSettingsChange],
    );

    // Helper function to get date without time for comparison
    const getDateOnly = (date: Date) => {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    };

    const handleGenerateClick = useCallback(() => {
        onGeneratePreview(localSettings);
    }, [localSettings, onGeneratePreview]);

    const handleDateChange = (field: 'startDate' | 'endDate', value: Date | null) => {
        if (value) {
            // First, check if end date would be before start date (same date is allowed)
            if (field === 'endDate' && localSettings.startDate) {
                const startDateOnly = getDateOnly(localSettings.startDate);
                const endDateOnly = getDateOnly(value);
                if (endDateOnly < startDateOnly) {
                    return; // Don't update if end date is before start date
                }
            }

            // If setting start date and it's after current end date, reset end date to start date
            if (field === 'startDate' && localSettings.endDate) {
                const startDateOnly = getDateOnly(value);
                const endDateOnly = getDateOnly(localSettings.endDate);
                if (startDateOnly > endDateOnly) {
                    const newSettings = { ...localSettings, startDate: value, endDate: value };
                    setLocalSettings(newSettings);
                    onSettingsChange(newSettings);
                    return;
                }
            }

            // If setting start date and there's no end date, set end date to start date
            if (field === 'startDate' && !localSettings.endDate) {
                const newSettings = { ...localSettings, startDate: value, endDate: value };
                setLocalSettings(newSettings);
                onSettingsChange(newSettings);
                return;
            }

            // Create new settings with the updated field
            const newSettings = { ...localSettings, [field]: value };
            setLocalSettings(newSettings);
            onSettingsChange(newSettings);
        }
    };

    // Generate time options for dropdown (24-hour format with 15-minute intervals)
    const generateTimeOptions = () => {
        const options = [];
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 15) {
                // 15-minute intervals
                const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                options.push({ value: timeString, label: timeString });
            }
        }
        return options;
    };

    const timeOptions = generateTimeOptions();

    return (
        <Card className={`schedule-preview-settings ${className}`}>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="h6" component="h2">
                        Schedule Preview Settings
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<PlayArrow />}
                            onClick={handleGenerateClick}
                            disabled={isGenerating || !hasData}
                            size="small"
                        >
                            {isGenerating ? 'Generating...' : 'Generate Preview'}
                        </Button>
                        <IconButton onClick={() => setIsExpanded(!isExpanded)} size="small">
                            {isExpanded ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                    </Box>
                </Box>

                {/* Basic Settings - Always Visible */}
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} sm={6} md={2.4}>
                        <LocalizationProvider dateAdapter={AdapterDateFns}>
                            <DatePicker
                                label="Start Date"
                                value={localSettings.startDate}
                                onChange={(newDate) => handleDateChange('startDate', newDate)}
                                inputFormat="dd-MMM-yyyy"
                                renderInput={(props) => <TextField {...props} size="small" fullWidth />}
                            />
                        </LocalizationProvider>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2.4}>
                        <TextField
                            label="Start Time"
                            type="text"
                            size="small"
                            fullWidth
                            value={localSettings.startTime}
                            onChange={(e) => {
                                const value = e.target.value;
                                // Allow extended time format (e.g., 25:00, 26:30)
                                if (/^(\d{1,2}):([0-5][0-9])$/.test(value) || value === '') {
                                    const [hours, minutes] = value.split(':').map(Number);
                                    // Allow hours up to 168 (7 days) for extended scheduling
                                    if (hours >= 0 && hours <= 168 && minutes >= 0 && minutes <= 59) {
                                        handleInputChange('startTime', value);
                                    }
                                }
                            }}
                            placeholder="HH:MM (25:00+)"
                            InputLabelProps={{ shrink: true }}
                            select
                            SelectProps={{
                                native: false,
                                MenuProps: {
                                    PaperProps: {
                                        style: {
                                            maxHeight: 300,
                                        },
                                    },
                                },
                            }}
                        >
                            {timeOptions.map((option) => (
                                <MenuItem
                                    key={option.value}
                                    value={option.value}
                                    sx={{
                                        fontSize: '0.875rem',
                                        padding: '8px 16px',
                                    }}
                                >
                                    {option.label}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2.4}>
                        <LocalizationProvider dateAdapter={AdapterDateFns}>
                            <DatePicker
                                label="End Date"
                                value={localSettings.endDate}
                                onChange={(newDate) => handleDateChange('endDate', newDate)}
                                minDate={localSettings.startDate}
                                inputFormat="dd-MMM-yyyy"
                                shouldDisableDate={(date) => {
                                    if (!localSettings.startDate || !date) return false;
                                    // Disable dates that are before start date (same date is allowed)
                                    const startDateOnly = getDateOnly(localSettings.startDate);
                                    const dateOnly = getDateOnly(date);
                                    return dateOnly < startDateOnly;
                                }}
                                renderInput={(props) => <TextField {...props} size="small" fullWidth />}
                            />
                        </LocalizationProvider>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2.4}>
                        <TextField
                            label="End Time"
                            type="text"
                            size="small"
                            fullWidth
                            value={localSettings.endTime}
                            onChange={(e) => {
                                const value = e.target.value;
                                // Allow extended time format (e.g., 25:00, 26:30)
                                if (/^(\d{1,2}):([0-5][0-9])$/.test(value) || value === '') {
                                    const [hours, minutes] = value.split(':').map(Number);
                                    // Allow hours up to 168 (7 days) for extended scheduling
                                    if (hours >= 0 && hours <= 168 && minutes >= 0 && minutes <= 59) {
                                        handleInputChange('endTime', value);
                                    }
                                }
                            }}
                            placeholder="HH:MM (25:00+)"
                            InputLabelProps={{ shrink: true }}
                            select
                            SelectProps={{
                                native: false,
                                MenuProps: {
                                    PaperProps: {
                                        style: {
                                            maxHeight: 300,
                                        },
                                    },
                                },
                            }}
                        >
                            {timeOptions.map((option) => (
                                <MenuItem
                                    key={option.value}
                                    value={option.value}
                                    sx={{
                                        fontSize: '0.875rem',
                                        padding: '8px 16px',
                                    }}
                                >
                                    {option.label}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2.4}>
                        <TextField
                            label="Schedule Type Filter"
                            size="small"
                            fullWidth
                            value={localSettings.scheduleTypeFilter}
                            onChange={(e) => handleInputChange('scheduleTypeFilter', e.target.value)}
                            select
                            InputLabelProps={{ shrink: true }}
                        >
                            <MenuItem value="all">All Schedules</MenuItem>
                            <MenuItem value="main">Main Schedules Only</MenuItem>
                            <MenuItem value="background">Background Schedules Only</MenuItem>
                        </TextField>
                    </Grid>
                </Grid>

                {/* Advanced Settings - Collapsible */}
                <Collapse in={isExpanded}>
                    <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle2" gutterBottom>
                            Advanced Options
                        </Typography>
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    label="Max Events"
                                    type="number"
                                    size="small"
                                    fullWidth
                                    value={localSettings.maxEvents}
                                    onChange={(e) => handleInputChange('maxEvents', parseInt(e.target.value, 10))}
                                    helperText="Maximum number of events to display"
                                    inputProps={{ min: 1, max: 10000 }}
                                />
                            </Grid>
                        </Grid>
                    </Box>
                </Collapse>

                {!hasData && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="body2" color="warning.main">
                            ⚠️ No schedule data available. Please ensure you have configured sequences, playlists, and
                            schedules.
                        </Typography>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};

export default SchedulePreviewSettings;
