import { PlaylistRecord, ScheduledPlaylist, getPlaylistDurationMS, priorityToNumber } from '@ezplayer/ezplayer-core';
import { Button, ToastMsgs, convertDateToMilliseconds, timestampToDate } from '@ezplayer/shared-ui-components';
import { CalendarViewDay, CalendarViewMonth, CalendarViewWeek, ChevronLeft, ChevronRight } from '@mui/icons-material';
import DeleteIcon from '@mui/icons-material/Delete';
import {
    Box,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    FormGroup,
    IconButton,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    SelectChangeEvent,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
    styled,
} from '@mui/material';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { addDays, addMonths, addWeeks, eachDayOfInterval, format, subDays, subMonths, subWeeks } from 'date-fns';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { postScheduledPlaylists } from '../../store/slices/ScheduleStore';
import { formatDateStandard } from '../../util/dateUtils';
import { AppDispatch, RootState } from '../../store/Store';
import DailyView from './DailyView';
import MonthlyView from './MonthlyView';
import WeeklyView from './WeeklyView';

interface PlaylistSchedulerProps {
    availablePlaylists: PlaylistRecord[];
    onScheduleSubmit: (scheduleData: ScheduledPlaylist[]) => void;
    initialSchedules: ScheduledPlaylist[];
    loading?: boolean;
    scheduleType?: 'main' | 'background';
}

type RecurrenceOption = 'once' | 'daily' | 'selectedDays';
type EditMode = 'single' | 'all' | null;
type PriorityOption = 'normal' | 'high' | 'low';
type EndPolicyOption = 'seqboundearly' | 'seqboundlate' | 'seqboundnearest' | 'hardcut';

const StyledToggleButtonGroup = styled(ToggleButtonGroup)(({ theme }) => ({
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
}));

const StyledToggleButton = styled(ToggleButton)(({ theme }) => ({
    '&.Mui-selected': {
        backgroundColor: theme.palette.primary.main,
        color: theme.palette.primary.contrastText,
        '&:hover': {
            backgroundColor: theme.palette.primary.dark,
        },
    },
}));

const PlaylistScheduler: React.FC<PlaylistSchedulerProps> = ({
    availablePlaylists,
    onScheduleSubmit,
    initialSchedules,
    loading,
    scheduleType = 'main',
}) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [view, setView] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [formData, setFormData] = useState({
        title: '',
        fromTime: '',
        toTime: '',
        playlistId: '',
        prePlaylistId: '',
        postPlaylistId: '',
        recurrence: 'once' as RecurrenceOption,
        selectedDays: [] as string[],
        selectAllDays: false,
        customEndType: 'never' as 'never' | 'on' | 'after',
        startDate: null as Date | null,
        endDate: null as Date | null,
        occurrences: '',
        shuffle: false,
        loop: false,
        priority: 'normal' as PriorityOption,
        endPolicy: 'seqboundearly' as EndPolicyOption,
        hardCutIn: false,
        preferHardCutIn: false,
        keepToScheduleWhenPreempted: false,
    });
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const [scheduledPlaylists, setScheduledPlaylists] = useState<ScheduledPlaylist[]>(initialSchedules);
    const [selectedSchedule, setSelectedSchedule] = useState<ScheduledPlaylist | null>(null);

    // Helper function to combine date and time into a timestamp
    const combineDateAndTime = (date: Date, time: string) => {
        const d = new Date(date);
        const [hours, minutes] = time.split(':').map(Number);
        d.setHours(hours ?? 0, minutes ?? 0, 0, 0);
        return d.getTime();
    };

    const [deleteDialogState, setDeleteDialogState] = useState<{
        open: boolean;
        mode?: EditMode;
    }>({ open: false });
    const [editConfirmDialogState, setEditConfirmDialogState] = useState<{
        open: boolean;
        pendingFormData?: typeof formData;
    }>({ open: false });

    const dispatch = useDispatch<AppDispatch>();

    useEffect(() => {
        setScheduledPlaylists(initialSchedules);
    }, [initialSchedules]);

    // Effect to validate and clear To Time when From Time changes
    useEffect(() => {
        if (formData.fromTime && formData.toTime) {
            if (
                isTimeValid(formData.fromTime) &&
                isExtendedTimeValid(formData.toTime) &&
                !isToTimeAfterFromTime(formData.fromTime, formData.toTime)
            ) {
                setFormData((prev) => ({
                    ...prev,
                    toTime: '',
                }));
            }
        }
    }, [formData.fromTime]);

    const handlePrevMonth = () => {
        if (view === 'monthly') {
            setCurrentDate(subMonths(currentDate, 1));
        } else if (view === 'weekly') {
            setCurrentDate(subWeeks(currentDate, 1));
        } else if (view === 'daily') {
            setCurrentDate(subDays(currentDate, 1));
        }
    };

    const handleNextMonth = () => {
        if (view === 'monthly') {
            setCurrentDate(addMonths(currentDate, 1));
        } else if (view === 'weekly') {
            setCurrentDate(addWeeks(currentDate, 1));
        } else if (view === 'daily') {
            setCurrentDate(addDays(currentDate, 1));
        }
    };

    const handleViewChange = (
        _event: React.MouseEvent<HTMLElement>,
        newView: 'monthly' | 'weekly' | 'daily' | null,
    ) => {
        if (newView !== null) {
            setView(newView);
        }
    };

    const handleDateSelect = (date: Date, time: string) => {
        setSelectedDate(date);
        // Apply 2-minute start buffer to the selected time
        const actualStartTime = calcActualStartTime(time);
        setFormData((prev) => ({
            ...prev,
            fromTime: actualStartTime,
            toTime: '',
            playlistId: '',
            startDate: date,
        }));
        setIsDialogOpen(true);
    };

    const handleScheduleClick = (schedule: ScheduledPlaylist) => {
        try {
            setSelectedSchedule(schedule);
            const scheduleDate = timestampToDate(schedule.date);
            setSelectedDate(scheduleDate);

            const seriesStartDate =
                schedule.recurrenceRule?.startDate && ['daily', 'selectedDays'].includes(schedule.recurrence ?? '')
                    ? timestampToDate(schedule.recurrenceRule.startDate)
                    : scheduleDate;

            setFormData((prev) => ({
                ...prev,
                playlistId: schedule.playlistId,
                prePlaylistId: schedule.prePlaylistId || '',
                postPlaylistId: schedule.postPlaylistId || '',
                title: schedule.title || '',
                fromTime: schedule.fromTime,
                toTime: schedule.toTime,
                recurrence: (schedule.recurrence as RecurrenceOption) || 'once',
                selectedDays: schedule.recurrenceRule?.byWeekDay || [],
                startDate: seriesStartDate,
                endDate: schedule.recurrenceRule?.endDate ? timestampToDate(schedule.recurrenceRule.endDate) : null,
                shuffle: schedule.shuffle ?? false,
                loop: schedule.loop ?? false,
                occurrences: prev.occurrences,
                priority: schedule.priority || 'normal',
                hardCutIn: schedule.hardCutIn ?? false,
                preferHardCutIn: schedule.preferHardCutIn ?? false,
                endPolicy: schedule.endPolicy ?? 'seqboundearly',
                keepToScheduleWhenPreempted: schedule.keepToScheduleWhenPreempted ?? false,
            }));

            setIsDialogOpen(true);
        } catch (error) {
            console.error('Error in handleScheduleClick:', error);
        }
    };

    const handleClose = () => {
        setIsDialogOpen(false);
        setSelectedSchedule(null);
        setFormData({
            title: '',
            fromTime: '',
            toTime: '',
            playlistId: '',
            prePlaylistId: '',
            postPlaylistId: '',
            recurrence: 'once',
            selectedDays: [],
            selectAllDays: false,
            customEndType: 'never',
            startDate: null,
            endDate: null,
            occurrences: '',
            shuffle: false,
            loop: false,
            priority: 'normal',
            hardCutIn: false,
            preferHardCutIn: false,
            endPolicy: 'seqboundearly',
            keepToScheduleWhenPreempted: false,
        });
    };

    // Update generateDailyOccurrences to ensure proper date handling
    const generateDailyOccurrences = (
        startDate: Date,
        endDate: Date | null,
        baseSchedule: Partial<ScheduledPlaylist>,
    ): ScheduledPlaylist[] => {
        if (!endDate) {
            return [
                {
                    ...baseSchedule,
                    date: convertDateToMilliseconds(startDate),
                    scheduleType: baseSchedule.scheduleType || 'main',
                } as ScheduledPlaylist,
            ];
        }

        // Generate all dates between start and end
        const dates = eachDayOfInterval({
            start: startDate,
            end: endDate,
        });

        // Create a schedule for each date
        return dates.map(
            (date) =>
                ({
                    ...baseSchedule,
                    id: `${baseSchedule.id}-${format(date, 'yyyy-MM-dd')}`,
                    date: convertDateToMilliseconds(date),
                    baseScheduleId: baseSchedule.id,
                    recurrence: 'daily' as RecurrenceOption,
                    scheduleType: baseSchedule.scheduleType || 'main',
                    recurrenceRule: {
                        frequency: 'daily',
                        startDate: convertDateToMilliseconds(startDate),
                        endDate: convertDateToMilliseconds(endDate),
                    },
                }) as ScheduledPlaylist,
        );
    };

    // Update generateSelectedDaysOccurrences to ensure proper date handling
    const generateSelectedDaysOccurrences = (
        startDate: Date,
        endDate: Date | null,
        selectedDays: string[],
        baseSchedule: Partial<ScheduledPlaylist>,
    ): ScheduledPlaylist[] => {
        if (!endDate || selectedDays.length === 0) {
            return [
                {
                    ...baseSchedule,
                    date: convertDateToMilliseconds(startDate),
                    scheduleType: baseSchedule.scheduleType || 'main',
                } as ScheduledPlaylist,
            ];
        }

        const dates = eachDayOfInterval({
            start: startDate,
            end: endDate,
        });

        const dayMap: { [key: string]: number } = {
            Sun: 0,
            Mon: 1,
            Tue: 2,
            Wed: 3,
            Thu: 4,
            Fri: 5,
            Sat: 6,
        };

        const selectedDates = dates.filter((date) =>
            selectedDays.includes(Object.keys(dayMap).find((key) => dayMap[key] === date.getDay()) || ''),
        );

        return selectedDates.map(
            (date) =>
                ({
                    ...baseSchedule,
                    id: `${baseSchedule.id}-${format(date, 'yyyy-MM-dd')}`,
                    date: convertDateToMilliseconds(date),
                    baseScheduleId: baseSchedule.id,
                    recurrence: 'selectedDays' as RecurrenceOption,
                    scheduleType: baseSchedule.scheduleType || 'main',
                    recurrenceRule: {
                        frequency: 'weekly',
                        byWeekDay: selectedDays,
                        startDate: convertDateToMilliseconds(startDate),
                        endDate: convertDateToMilliseconds(endDate),
                    },
                }) as ScheduledPlaylist,
        );
    };

    // Update handleSubmit to show confirmation dialog for recurring events
    const handleSubmit = () => {
        if (!selectedDate || !formData.playlistId) return;

        // Additional validation for time fields
        if (!formData.fromTime || !formData.toTime) {
            console.warn('From Time and To Time are required');
            return;
        }

        if (!isTimeValid(formData.fromTime) || !isExtendedTimeValid(formData.toTime)) {
            console.warn('Invalid time format');
            return;
        }

        if (!isToTimeAfterFromTime(formData.fromTime, formData.toTime)) {
            console.warn('To Time must be after From Time');
            return;
        }

        // If editing a recurring event, show confirmation dialog
        if (selectedSchedule && ['daily', 'selectedDays'].includes(selectedSchedule.recurrence ?? '')) {
            setEditConfirmDialogState({
                open: true,
                pendingFormData: { ...formData },
            });
            return;
        }

        // For non-recurring schedules or new schedules, proceed with update
        submitScheduleUpdate(null);
    };

    // New function to handle the actual schedule update
    const submitScheduleUpdate = (mode: EditMode) => {
        if (!selectedDate || !formData.playlistId) return;

        try {
            const selectedPlaylist = availablePlaylists.find((p) => p.id === formData.playlistId);
            let { totalDuration } = calculatePlaylistDuration(formData.playlistId);
            if (formData.prePlaylistId)
                totalDuration += calculatePlaylistDuration(formData.prePlaylistId).totalDuration;
            if (formData.postPlaylistId)
                totalDuration += calculatePlaylistDuration(formData.postPlaylistId).totalDuration;

            const schedulesToSubmit: ScheduledPlaylist[] = [];
            let schedulesToUpdateLocally: ScheduledPlaylist[] = [];
            const idsToRemoveLocally = new Set<string>();

            // If we're editing an existing schedule, we might need to remove old occurrences
            // Skip deletion logic for single occurrence schedules that remain single occurrence
            const isSimpleSingleOccurrenceUpdate =
                selectedSchedule &&
                selectedSchedule.recurrence === 'once' &&
                formData.recurrence === 'once' &&
                (mode === null || mode === 'single');

            if (selectedSchedule && !isSimpleSingleOccurrenceUpdate) {
                if (mode === 'all') {
                    // Remove all schedules in the series
                    const baseId = selectedSchedule.baseScheduleId || selectedSchedule.id;
                    const allInSeries = scheduledPlaylists.filter(
                        (s) => s.baseScheduleId === baseId || s.id === baseId,
                    );
                    allInSeries.forEach((s) => idsToRemoveLocally.add(s.id));
                    schedulesToSubmit.push(...allInSeries.map((s) => ({ ...s, deleted: true })));
                } else {
                    // mode is 'single' or null
                    // Remove just the single occurrence we're editing
                    idsToRemoveLocally.add(selectedSchedule.id);
                    schedulesToSubmit.push({ ...selectedSchedule, deleted: true });
                }
            }

            // Now, create the new schedule(s)

            // When replacing a series, create a completely new one.
            const baseScheduleId = uuidv4();

            const baseSchedule = {
                // For updates, maintain the original ID
                id: baseScheduleId,
                playlistId: formData.playlistId,
                prePlaylistId: formData.prePlaylistId,
                postPlaylistId: formData.postPlaylistId,
                title: formData.title || selectedPlaylist?.title || '',
                fromTime: formData.fromTime,
                toTime: formData.toTime,
                playlistTitle: selectedPlaylist?.title || '',
                duration: totalDuration, // TODO CRAZ: This is not accurate w/ loop or priority
                recurrence: formData.recurrence,
                shuffle: formData.shuffle,
                loop: formData.loop,
                priority: formData.priority,
                hardCutIn: formData.hardCutIn,
                preferHardCutIn: formData.preferHardCutIn,
                endPolicy: formData.endPolicy,
                keepToScheduleWhenPreempted: formData.keepToScheduleWhenPreempted,
                scheduleType: scheduleType, // Use the scheduleType prop
                updatedAt: convertDateToMilliseconds(new Date()),
                deleted: false,
            };

            // Date selection logic:
            // - For 'once' schedules: Use formData.startDate if editing existing schedule, otherwise use selectedDate
            // - For recurring schedules: Use formData.startDate if set, otherwise fall back to selectedDate
            // This allows editing the start date for both single and recurring schedules
            const startDateForGeneration =
                formData.recurrence === 'once'
                    ? (selectedSchedule ? formData.startDate : selectedDate)
                    : (formData.startDate || selectedDate);
            if (!startDateForGeneration) return;

            if (formData.recurrence === 'daily' && formData.endDate) {
                schedulesToUpdateLocally = generateDailyOccurrences(startDateForGeneration, formData.endDate, {
                    ...baseSchedule,
                    baseScheduleId,
                });
            } else if (formData.recurrence === 'selectedDays' && formData.endDate) {
                schedulesToUpdateLocally = generateSelectedDaysOccurrences(
                    startDateForGeneration,
                    formData.endDate,
                    formData.selectedDays,
                    {
                        ...baseSchedule,
                        baseScheduleId,
                    },
                );
            } else {
                // 'once' - Single occurrence schedule
                // When editing a recurring schedule and changing it to 'once', we want to create
                // the new schedule on the date the user selected (selectedDate), not the original start date
                const newId = selectedSchedule && mode !== 'all' ? selectedSchedule.id : uuidv4();
                let eventBaseId: string | undefined = undefined;
                if (selectedSchedule) {
                    if (mode === 'all') {
                        eventBaseId = baseScheduleId;
                    } else if (selectedSchedule.baseScheduleId) {
                        eventBaseId = selectedSchedule.baseScheduleId;
                    }
                }

                schedulesToUpdateLocally = [
                    {
                        ...(baseSchedule as ScheduledPlaylist),
                        id: newId,
                        date: convertDateToMilliseconds(startDateForGeneration),
                        baseScheduleId: eventBaseId || '',
                        recurrence: 'once',
                        scheduleType: baseSchedule.scheduleType || 'main',
                    },
                ];
            }

            schedulesToSubmit.push(...schedulesToUpdateLocally);
            onScheduleSubmit(schedulesToSubmit);

            setScheduledPlaylists((prev) => {
                const filteredSchedules = prev.filter((s) => !idsToRemoveLocally.has(s.id));

                // For simple single occurrence updates, we need to replace the existing schedule
                // instead of adding a duplicate
                if (isSimpleSingleOccurrenceUpdate && selectedSchedule) {
                    const existingScheduleIndex = filteredSchedules.findIndex((s) => s.id === selectedSchedule.id);
                    if (existingScheduleIndex !== -1) {
                        // Replace the existing schedule with the updated one
                        const updatedSchedules = [...filteredSchedules];
                        updatedSchedules[existingScheduleIndex] = schedulesToUpdateLocally[0];
                        return updatedSchedules;
                    }
                }

                return [...filteredSchedules, ...schedulesToUpdateLocally];
            });

            setEditConfirmDialogState({ open: false });
            handleClose();
        } catch (error) {
            console.error('Error in submitScheduleUpdate:', error);
            handleClose();
        }
    };

    // Helper function to check if time is valid
    // Helper function to check if time is valid (24-hour format only)
    const isTimeValid = (time: string): boolean => {
        // Only support standard 24-hour format (0-23 hours)
        const timeRegex = /^([0-9]|0[0-9]|1[0-9]|2[0-3]):([0-5][0-9])$/;
        if (!timeRegex.test(time)) return false;

        const [hours, minutes] = time.split(':').map(Number);

        // Restrict to standard 24-hour format
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return false;
        }

        return true;
    };

    // Helper function to check if extended time is valid (for To time only)
    const isExtendedTimeValid = (time: string): boolean => {
        // Support extended time format (e.g., 25:00, 26:30, 48:15)
        const extendedTimeRegex = /^(\d{1,2}):([0-5][0-9])$/;
        if (!extendedTimeRegex.test(time)) return false;

        const [hours, minutes] = time.split(':').map(Number);

        // Allow hours up to 168 (7 days * 24 hours) for extended scheduling
        if (hours < 0 || hours > 168 || minutes < 0 || minutes > 59) {
            return false;
        }

        return true;
    };

    // Helper function to check if To Time is after From Time
    const isToTimeAfterFromTime = (fromTime: string, toTime: string): boolean => {
        if (!isTimeValid(fromTime) || !isExtendedTimeValid(toTime)) return false;

        const [fromHours, fromMinutes] = fromTime.split(':').map(Number);
        const [toHours, toMinutes] = toTime.split(':').map(Number);

        const fromTotalMinutes = fromHours * 60 + fromMinutes;
        const toTotalMinutes = toHours * 60 + toMinutes;

        // To Time must be strictly greater than From Time (not equal)
        return toTotalMinutes > fromTotalMinutes;
    };

    // Helper function to suggest a valid To Time (including extended format)
    const suggestValidToTime = (fromTime: string): string => {
        if (!isTimeValid(fromTime)) return '';

        const [fromHours, fromMinutes] = fromTime.split(':').map(Number);
        let suggestedHours = fromHours;
        let suggestedMinutes = fromMinutes + 1; // Add 1 minute

        // Handle minute overflow
        if (suggestedMinutes >= 60) {
            suggestedMinutes = 0;
            suggestedHours = suggestedHours + 1; // Allow hours to exceed 23 for extended format
        }

        return `${suggestedHours.toString().padStart(2, '0')}:${suggestedMinutes.toString().padStart(2, '0')}`;
    };

    // Update form validation
    const isFormValid = () => {
        if (!formData.playlistId || !formData.fromTime || !formData.toTime) return false;
        if (!isTimeValid(formData.fromTime) || !isExtendedTimeValid(formData.toTime)) return false;
        if (!isToTimeAfterFromTime(formData.fromTime, formData.toTime)) return false;
        // Require start date for all schedule types when editing existing schedules
        if (selectedSchedule && !formData.startDate) return false;
        if (formData.recurrence === 'daily' && !formData.endDate) return false;
        if (formData.recurrence === 'selectedDays' && (!formData.endDate || formData.selectedDays.length === 0))
            return false;
        return true;
    };

    const calcToTime = (mpid?: string, prepid?: string, postpid?: string) => {
        if (!formData.fromTime) return '';

        // Validate that fromTime is in correct format (24-hour format only)
        if (!isTimeValid(formData.fromTime)) return '';

        const { totalDuration: totalDuration1 } = calculatePlaylistDuration(mpid ?? '');
        const { totalDuration: totalDuration2 } = calculatePlaylistDuration(prepid ?? '');
        const { totalDuration: totalDuration3 } = calculatePlaylistDuration(postpid ?? '');

        // totalDuration is in seconds, convert to minutes (use Math.ceil to round up any fractional minutes)
        const totalDurationMinutes = Math.max(1, Math.ceil((totalDuration1 + totalDuration2 + totalDuration3) / 60));

        // Calculate toTime based on playlist duration
        const [fromHours, fromMinutes] = formData.fromTime.split(':').map(Number);

        // Calculate the total minutes from start time
        const startTotalMinutes = fromHours * 60 + fromMinutes;

        // Add the duration in minutes
        const endTotalMinutes = startTotalMinutes + totalDurationMinutes;

        // Convert back to hours and minutes, handling 24-hour format
        const endHours = Math.floor(endTotalMinutes / 60);
        const endMinutes = endTotalMinutes % 60;

        // Format as HH:MM
        const toTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;

        return toTime;
    };

    // Helper function to calculate the actual start time with 2-minute buffer
    const calcActualStartTime = (selectedTime: string): string => {
        if (!selectedTime || !isTimeValid(selectedTime)) return selectedTime;

        const [hours, minutes] = selectedTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes;

        // Add 2 minutes for start buffer and handle overflow with modulo
        const adjustedTotalMinutes = (totalMinutes + 2) % 1440;

        const adjustedHours = Math.floor(adjustedTotalMinutes / 60);
        const adjustedMins = adjustedTotalMinutes % 60;
        return `${adjustedHours.toString().padStart(2, '0')}:${adjustedMins.toString().padStart(2, '0')}`;
    };

    const handlePlaylistChange = (event: SelectChangeEvent) => {
        const playlistId = event.target.value;
        const selectedPlaylist = availablePlaylists.find((p) => p.id === playlistId);

        // If title is empty, set it to the selected playlist title
        const updatedTitle = formData.title.trim() === '' ? selectedPlaylist?.title || '' : formData.title;

        setFormData((prev) => ({
            ...prev,
            playlistId,
            title: updatedTitle,
            // Only calculate toTime if loop is not enabled or if toTime is not already set
            toTime:
                prev.loop && prev.toTime
                    ? prev.toTime
                    : calcToTime(playlistId, prev.prePlaylistId, prev.postPlaylistId),
        }));
        return;
    };

    const handleIntroPlaylistChange = (event: SelectChangeEvent) => {
        const prePlaylistId = event.target.value;

        setFormData((prev) => ({
            ...prev,
            prePlaylistId,
            // Only calculate toTime if loop is not enabled or if toTime is not already set
            toTime:
                prev.loop && prev.toTime
                    ? prev.toTime
                    : calcToTime(prev.playlistId, prePlaylistId, prev.postPlaylistId),
        }));
        return;
    };

    const handleOutroPlaylistChange = (event: SelectChangeEvent) => {
        const postPlaylistId = event.target.value;

        setFormData((prev) => ({
            ...prev,
            postPlaylistId,
            // Only calculate toTime if loop is not enabled or if toTime is not already set
            toTime:
                prev.loop && prev.toTime
                    ? prev.toTime
                    : calcToTime(prev.playlistId, prev.prePlaylistId, postPlaylistId),
        }));
        return;
    };

    // Separate handler for title field to allow free text input
    const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setFormData((prev) => ({
            ...prev,
            title: value,
        }));
    };

    // Handle time field double-click to select all text
    const handleTimeDoubleClick = (event: React.MouseEvent<HTMLInputElement>) => {
        event.currentTarget.select();
    };

    // Handle time field paste operations
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

    // Handle time field focus to select all text for easy editing
    const handleTimeFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        // Select all text when focusing on time fields for easy editing
        event.target.select();
    };

    const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target;

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

        const formattedValue = formatTimeInput(value);

        // Auto-calculate toTime when fromTime changes and playlist is selected
        if (name === 'fromTime' && formData.playlistId) {
            const { totalDuration: totalDuration2 } = calculatePlaylistDuration(formData.playlistId);
            const { totalDuration: totalDuration1 } = calculatePlaylistDuration(formData.prePlaylistId ?? '');
            const { totalDuration: totalDuration3 } = calculatePlaylistDuration(formData.postPlaylistId ?? '');
            // Calculate duration in minutes (use Math.ceil to round up any fractional minutes)
            const totalDurationMinutes = Math.max(
                1,
                Math.ceil((totalDuration1 + totalDuration2 + totalDuration3) / 60),
            );

            // Only calculate toTime if we have a valid time format and loop is not enabled
            if (isTimeValid(formattedValue) && !(formData.loop && formData.toTime)) {
                const [hours, minutes] = formattedValue.split(':').map(Number);
                const startTotalMinutes = hours * 60 + minutes;
                const endTotalMinutes = startTotalMinutes + totalDurationMinutes;
                const endHours = Math.floor(endTotalMinutes / 60);
                const endMinutes = endTotalMinutes % 60;
                const toTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;

                setFormData((prev) => ({
                    ...prev,
                    [name]: formattedValue,
                    toTime,
                }));
            } else {
                setFormData((prev) => ({
                    ...prev,
                    [name]: formattedValue,
                }));
            }
        } else {
            setFormData((prev) => ({
                ...prev,
                [name]: formattedValue,
            }));
        }
    };

    // Handle time input blur to format the time properly
    const handleTimeBlur = (event: React.FocusEvent<HTMLInputElement>) => {
        const { name, value } = event.target;

        if (!value) return;

        // Simple formatting on blur - just add colon if missing and pad with zeros
        let cleaned = value.replace(/[^0-9:]/g, '');

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
            const isFromTime = name === 'fromTime';
            const maxHours = isFromTime ? 23 : 168;

            if (!isNaN(hours) && !isNaN(minutes) && hours >= 0 && hours <= maxHours && minutes >= 0 && minutes <= 59) {
                const formatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

                if (formatted !== value) {
                    setFormData((prev) => ({
                        ...prev,
                        [name]: formatted,
                    }));
                }
            }
        }
    };

    // Handle time input keyboard events for basic editing
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

    // Update handleRecurrenceChange
    const handleRecurrenceChange = (event: SelectChangeEvent<RecurrenceOption>) => {
        const recurrence = event.target.value as RecurrenceOption;
        setFormData((prev) => ({
            ...prev,
            recurrence,
            // Reset selectedDays when changing recurrence type
            selectedDays: [],
            // When switching to 'once', clear start and end dates to ensure selectedDate is used
            // This prevents the system from using the old start date when creating the new one-time schedule
            ...(recurrence === 'once' && {
                startDate: null,
                endDate: null,
            }),
        }));
    };

    // Update handleLoopChange to uncheck shuffle when loop is selected
    const handleLoopChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const isChecked = event.target.checked;

        setFormData((prev) => ({
            ...prev,
            loop: isChecked,
            // If enabling loop, disable shuffle
            shuffle: isChecked ? false : prev.shuffle,
        }));
    };

    // Update handleShuffleChange to uncheck loop when shuffle is selected
    const handleShuffleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const isChecked = event.target.checked;

        setFormData((prev) => ({
            ...prev,
            shuffle: isChecked,
            // If enabling shuffle, disable loop
            loop: isChecked ? false : prev.loop,
        }));
    };

    // Calculate total duration for a playlist
    const calculatePlaylistDuration = (playlistId: string): { totalDuration: number } => {
        const playlist = availablePlaylists.find((p) => p.id === playlistId);
        if (!playlist) return { totalDuration: 0 };
        return { totalDuration: getPlaylistDurationMS(sequenceData ?? [], playlist, []).totalMS / 1000 };
    };

    const formatDuration = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = (seconds % 60).toFixed(3);
        const [wholeSeconds, decimals] = remainingSeconds.split('.');

        // Only show decimals if they're not all zeros
        const formattedSeconds = decimals === '000' ? wholeSeconds : remainingSeconds;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${formattedSeconds}s`;
        }
        return `${minutes}m ${formattedSeconds}s`;
    };

    const deletePlaylist = async (selectedSchedule: ScheduledPlaylist, mode: EditMode) => {
        try {
            if (!selectedSchedule) return;

            if (mode === 'all' && selectedSchedule.baseScheduleId) {
                // Delete all occurrences with the same baseScheduleId
                const schedulesToDelete = scheduledPlaylists
                    .filter((s) => s.baseScheduleId === selectedSchedule.baseScheduleId)
                    .map((s) => ({ ...s, deleted: true }));

                await dispatch(postScheduledPlaylists(schedulesToDelete)).unwrap();
                setScheduledPlaylists((prev) =>
                    prev.filter((s) => s.baseScheduleId !== selectedSchedule.baseScheduleId),
                );
            } else {
                // Delete single occurrence
                await dispatch(postScheduledPlaylists([{ ...selectedSchedule, deleted: true }])).unwrap();
                setScheduledPlaylists((prev) => prev.filter((s) => s.id !== selectedSchedule.id));
            }

            handleClose();
            setDeleteDialogState({ open: false });
            ToastMsgs.showSuccessMessage(
                `${scheduleType === 'background' ? 'Background ' : ''}Schedule deleted successfully`,
                {
                    theme: 'colored',
                    position: 'bottom-right',
                    autoClose: 2000,
                },
            );
        } catch (error) {
            console.error('Error deleting schedule:', error);
        }
    };

    const handleConfirmDelete = (mode: EditMode) => {
        if (!selectedSchedule) return;
        deletePlaylist(selectedSchedule, mode);
    };

    const handleDelete = () => {
        if (selectedSchedule?.recurrence === 'once') {
            setDeleteDialogState({ open: true, mode: 'single' });
        } else {
            setDeleteDialogState({ open: true });
        }
    };

    const renderScheduledPlaylist = (scheduleItem: ScheduledPlaylist) => {
        const selectedPlaylist = availablePlaylists.find((p) => p.id === scheduleItem.playlistId);
        const isBackground = scheduleType === 'background';
        const backgroundColor = isBackground ? 'secondary.main' : 'primary.main';
        const textColor = isBackground ? 'secondary.contrastText' : 'primary.contrastText';
        const hoverColor = isBackground ? 'secondary.dark' : 'primary.dark';

        if (view === 'monthly') {
            return (
                <Box
                    key={scheduleItem.id}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleScheduleClick(scheduleItem);
                    }}
                    sx={{
                        position: 'relative',
                        width: '100%',
                        backgroundColor: backgroundColor,
                        borderRadius: 1,
                        p: 0.5,
                        marginTop: 0.5,
                        cursor: 'pointer',
                    }}
                >
                    <Typography variant="body2" sx={{ display: 'block', margin: '0 2px', color: textColor }}>
                        {scheduleItem.title}
                    </Typography>
                    <Typography
                        variant="caption"
                        sx={{ display: 'block', margin: '0 2px', color: textColor, opacity: 0.8 }}
                    >
                        {scheduleItem.fromTime} - {scheduleItem.toTime}
                    </Typography>
                </Box>
            );
        }

        // Daily and Weekly view rendering
        return (
            <Box
                key={scheduleItem.id}
                onClick={(e) => {
                    e.stopPropagation();
                    handleScheduleClick(scheduleItem);
                }}
                sx={{
                    backgroundColor: backgroundColor,
                    borderRadius: '4px',
                    '&:hover': {
                        backgroundColor: hoverColor,
                    },
                    padding: '2px 4px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                }}
            >
                <Typography
                    variant="body2"
                    sx={{
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        margin: 0,
                        color: textColor,
                        display: 'block',
                    }}
                >
                    {scheduleItem.title || selectedPlaylist?.title}
                </Typography>
                <Typography
                    variant="caption"
                    sx={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        margin: 0,
                        color: textColor,
                        opacity: 0.8,
                        display: 'block',
                    }}
                >
                    {scheduleItem.fromTime} - {scheduleItem.toTime}
                </Typography>
            </Box>
        );
    };

    // Create a memoized sorted version of scheduledPlaylists for display
    const sortedScheduledPlaylists = useMemo(() => {
        return [...scheduledPlaylists].sort((a, b) => {
            // First, sort by schedule type: background schedules come before main schedules
            const typeA = a.scheduleType || 'main';
            const typeB = b.scheduleType || 'main';

            if (typeA !== typeB) {
                // Background schedules (typeA === 'background') should come first
                if (typeA === 'background') return -1;
                if (typeB === 'background') return 1;
                return 0;
            }

            // If types are equal, sort by priority
            const priorityA = a.priority || 'normal';
            const priorityB = b.priority || 'normal';

            // Convert priority to number for comparison
            const priorityValueA = priorityToNumber[priorityA] || priorityToNumber.normal;
            const priorityValueB = priorityToNumber[priorityB] || priorityToNumber.normal;

            // Sort by priority (higher number = lower priority, so we want low priority first)
            if (priorityValueA !== priorityValueB) {
                return priorityValueB - priorityValueA; // Reverse the comparison
            }

            // If priorities are equal, sort by start time
            const startTimeA = combineDateAndTime(new Date(a.date), a.fromTime);
            const startTimeB = combineDateAndTime(new Date(b.date), b.fromTime);
            return startTimeA - startTimeB;
        });
    }, [scheduledPlaylists]);

    return (
        <Paper elevation={2} sx={{ height: '100%', display: 'flex', flexDirection: 'column', marginX: 2 }}>
            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                    <CircularProgress />
                </Box>
            ) : (
                <Box
                    sx={{
                        p: 2,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        borderBottom: 1,
                        borderColor: 'divider',
                        flexWrap: { xs: 'wrap', sm: 'nowrap' },
                        gap: 2,
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            flex: { xs: '1 0 100%', sm: '0 0 auto' },
                        }}
                    >
                        <IconButton onClick={handlePrevMonth} size="small">
                            <ChevronLeft />
                        </IconButton>
                        <Typography variant="h6" sx={{ minWidth: 200, textAlign: 'center' }}>
                            {format(currentDate, 'MMM yyyy')}
                        </Typography>
                        <IconButton onClick={handleNextMonth} size="small">
                            <ChevronRight />
                        </IconButton>
                    </Box>

                    <StyledToggleButtonGroup
                        value={view}
                        exclusive
                        onChange={handleViewChange}
                        aria-label="view selector"
                        size="small"
                        sx={{
                            flex: { xs: '1 0 100%', sm: '0 0 auto' },
                            justifyContent: { xs: 'center', sm: 'flex-end' },
                        }}
                    >
                        <StyledToggleButton value="monthly" aria-label="monthly view">
                            <CalendarViewMonth sx={{ mr: 1 }} />
                            Month
                        </StyledToggleButton>
                        <StyledToggleButton value="weekly" aria-label="weekly view">
                            <CalendarViewWeek sx={{ mr: 1 }} />
                            Week
                        </StyledToggleButton>
                        <StyledToggleButton value="daily" aria-label="daily view">
                            <CalendarViewDay sx={{ mr: 1 }} />
                            Day
                        </StyledToggleButton>
                    </StyledToggleButtonGroup>
                </Box>
            )}

            <Box
                sx={{
                    flex: 1,
                    overflow: 'auto',
                    p: 2,
                    m: 2,
                    bgcolor: 'background.default',
                }}
            >
                {view === 'monthly' && (
                    <MonthlyView
                        currentDate={currentDate}
                        onDateSelect={handleDateSelect}
                        scheduledPlaylists={sortedScheduledPlaylists}
                        renderScheduledPlaylist={renderScheduledPlaylist}
                    />
                )}
                {view === 'weekly' && (
                    <WeeklyView
                        currentDate={currentDate}
                        onDateSelect={handleDateSelect}
                        scheduledPlaylists={sortedScheduledPlaylists}
                        renderScheduledPlaylist={renderScheduledPlaylist}
                    />
                )}
                {view === 'daily' && (
                    <DailyView
                        currentDate={currentDate}
                        onDateSelect={handleDateSelect}
                        scheduledPlaylists={sortedScheduledPlaylists}
                        renderScheduledPlaylist={renderScheduledPlaylist}
                    />
                )}
            </Box>

            {/* Playlist Selection Dialog */}
            <Dialog open={isDialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <DialogTitle>
                        <Box sx={{ display: 'flex' }}>
                            <Typography sx={{ marginRight: 2 }}>
                                {selectedSchedule
                                    ? `Edit ${scheduleType === 'background' ? 'Background ' : ''}Schedule`
                                    : `Schedule ${scheduleType === 'background' ? 'Background ' : ''}Playlist`}
                            </Typography>
                            <Typography>
                                {selectedDate && (
                                    <Typography variant="subtitle1">
                                        Date: {formatDateStandard(selectedDate)}
                                    </Typography>
                                )}
                            </Typography>
                        </Box>
                    </DialogTitle>
                </Box>
                <DialogContent>
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            mt: 1,
                        }}
                    >
                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControl fullWidth>
                                <InputLabel id="playlist-select-label">Select Playlist</InputLabel>
                                <Select
                                    labelId="playlist-select-label"
                                    name="playlistId"
                                    value={formData.playlistId || ''}
                                    label="Select Playlist"
                                    onChange={handlePlaylistChange}
                                >
                                    {availablePlaylists.map((playlist) => (
                                        <MenuItem key={playlist.id} value={playlist.id}>
                                            <Box
                                                sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}
                                            >
                                                <span>{playlist.title}</span>
                                                <Typography variant="body2" color="text.secondary">
                                                    {formatDuration(
                                                        calculatePlaylistDuration(playlist?.id || '').totalDuration,
                                                    )}
                                                </Typography>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <TextField
                                name="title"
                                label="Title"
                                fullWidth
                                value={formData.title}
                                onChange={handleTitleChange}
                            />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                            <TextField
                                name="fromTime"
                                label="From"
                                type="text"
                                value={formData.fromTime}
                                onChange={handleTimeChange}
                                onBlur={handleTimeBlur}
                                onKeyDown={handleTimeKeyDown}
                                onFocus={handleTimeFocus}
                                onPaste={handleTimePaste}
                                onDoubleClick={handleTimeDoubleClick}
                                InputLabelProps={{
                                    shrink: true,
                                }}
                                inputProps={{
                                    placeholder: 'HH:MM (0-23)',
                                    inputMode: 'numeric',
                                    maxLength: 5,
                                }}
                                helperText="24-hour format (e.g., 14:30, 22:00). Start time must be within the same day."
                                error={!!formData.fromTime && !isTimeValid(formData.fromTime)}
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                name="toTime"
                                label="To"
                                type="text"
                                value={formData.toTime}
                                onChange={handleTimeChange}
                                onBlur={handleTimeBlur}
                                onKeyDown={handleTimeKeyDown}
                                onFocus={handleTimeFocus}
                                onPaste={handleTimePaste}
                                onDoubleClick={handleTimeDoubleClick}
                                InputLabelProps={{
                                    shrink: true,
                                }}
                                inputProps={{
                                    placeholder: 'HH:MM (25:00+)',
                                    inputMode: 'numeric',
                                    maxLength: 5,
                                }}
                                helperText={
                                    formData.fromTime &&
                                        formData.toTime &&
                                        !isToTimeAfterFromTime(formData.fromTime, formData.toTime)
                                        ? `To Time must be after From Time. Try ${suggestValidToTime(formData.fromTime)} or later.`
                                        : 'Extended time format (e.g., 14:30, 25:00, 26:30). Use 25:00 for 1:00 AM next day, 48:00 for midnight 2 days later.'
                                }
                                error={Boolean(
                                    formData.toTime &&
                                    (!isExtendedTimeValid(formData.toTime) ||
                                        (formData.fromTime &&
                                            !isToTimeAfterFromTime(formData.fromTime, formData.toTime))),
                                )}
                                sx={{ flex: 1 }}
                            />
                        </Box>

                        <FormControl fullWidth sx={{ mt: 1 }}>
                            <InputLabel id="priority-select-label">Priority</InputLabel>
                            <Select
                                labelId="priority-select-label"
                                value={formData.priority}
                                label="Priority"
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        priority: e.target.value as PriorityOption,
                                    }))
                                }
                            >
                                <MenuItem value="normal">Normal</MenuItem>
                                <MenuItem value="high">High</MenuItem>
                                <MenuItem value="low">Low</MenuItem>
                            </Select>
                        </FormControl>

                        <FormControl fullWidth sx={{ mt: 1 }}>
                            <InputLabel id="endpolicy-select-label">End Time Behavior</InputLabel>
                            <Select
                                labelId="endpolicy-select-label"
                                value={formData.endPolicy}
                                label="End Time Behavior"
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        endPolicy: e.target.value as EndPolicyOption,
                                    }))
                                }
                            >
                                // 'seqboundearly' | 'seqboundlate' | 'seqboundnearest' | 'hardcut'
                                <MenuItem value="seqboundearly">End Between Items, Before End Time</MenuItem>
                                <MenuItem value="seqboundlate">End Between Items, After End Time</MenuItem>
                                <MenuItem value="seqboundnearest">End Between Items, Closest To End Time</MenuItem>
                                <MenuItem value="hardcut">Hard Cutoff At End Time</MenuItem>
                            </Select>
                        </FormControl>

                        <FormGroup row sx={{ mt: 1, gap: 2 }}>
                            <FormControlLabel
                                control={<Checkbox checked={formData.shuffle} onChange={handleShuffleChange} />}
                                label="Shuffle"
                            />
                            <FormControlLabel
                                control={<Checkbox checked={formData.loop} onChange={handleLoopChange} />}
                                label="Loop"
                            />
                        </FormGroup>

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <FormControl fullWidth sx={{ mt: 1 }}>
                                <InputLabel id="pre-playlist-select-label">Intro Playlist</InputLabel>
                                <Select
                                    labelId="pre-playlist-select-label"
                                    name="prePlaylistId"
                                    value={formData.prePlaylistId || ''}
                                    label="Intro Playlist"
                                    onChange={handleIntroPlaylistChange}
                                >
                                    {[
                                        <MenuItem key="" value="">
                                            <Box
                                                sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}
                                            >
                                                <span>None</span>
                                                <Typography variant="body2" color="text.secondary"></Typography>
                                            </Box>
                                        </MenuItem>,
                                    ].concat(
                                        availablePlaylists.map((playlist) => (
                                            <MenuItem key={playlist.id} value={playlist.id}>
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        width: '100%',
                                                    }}
                                                >
                                                    <span>{playlist.title}</span>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {formatDuration(
                                                            calculatePlaylistDuration(playlist?.id || '').totalDuration,
                                                        )}
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                        )),
                                    )}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth sx={{ mt: 1 }}>
                                <InputLabel id="post-playlist-select-label">Outro Playlist</InputLabel>
                                <Select
                                    labelId="post-playlist-select-label"
                                    name="postPlaylistId"
                                    value={formData.postPlaylistId || ''}
                                    label="Outro Playlist"
                                    onChange={handleOutroPlaylistChange}
                                >
                                    {[
                                        <MenuItem key="" value="">
                                            <Box
                                                sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}
                                            >
                                                <span>None</span>
                                                <Typography variant="body2" color="text.secondary"></Typography>
                                            </Box>
                                        </MenuItem>,
                                    ].concat(
                                        availablePlaylists.map((playlist) => (
                                            <MenuItem key={playlist.id} value={playlist.id}>
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        width: '100%',
                                                    }}
                                                >
                                                    <span>{playlist.title}</span>
                                                    <Typography variant="body2" color="text.secondary">
                                                        {formatDuration(
                                                            calculatePlaylistDuration(playlist?.id || '').totalDuration,
                                                        )}
                                                    </Typography>
                                                </Box>
                                            </MenuItem>
                                        )),
                                    )}
                                </Select>
                            </FormControl>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={formData.hardCutIn}
                                        onChange={(e) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                hardCutIn: e.target.checked,
                                            }))
                                        }
                                    />
                                }
                                label="Interrupt Other Schedules Immediately"
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={formData.preferHardCutIn}
                                        onChange={(e) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                preferHardCutIn: e.target.checked,
                                            }))
                                        }
                                    />
                                }
                                label="Other Schedules Interrupt Immediately"
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={formData.keepToScheduleWhenPreempted}
                                        onChange={(e) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                keepToScheduleWhenPreempted: e.target.checked,
                                            }))
                                        }
                                    />
                                }
                                label="Keep To Schedule When Interrupted"
                            />
                        </Box>

                        <FormControl fullWidth sx={{ mt: 1 }}>
                            <InputLabel id="repeat-select-label">Repeat</InputLabel>
                            <Select
                                labelId="repeat-select-label"
                                value={formData.recurrence}
                                label="Repeat"
                                onChange={handleRecurrenceChange}
                            >
                                <MenuItem value="once">Occurs Once</MenuItem>
                                <MenuItem value="daily">Occurs Daily</MenuItem>
                                <MenuItem value="selectedDays">Occurs for Selected Days</MenuItem>
                            </Select>
                        </FormControl>

                        {/* Show start date field for daily recurrence types and when editing once schedules */}
                        {(formData.recurrence === 'daily' || (formData.recurrence === 'once' && selectedSchedule)) && (
                            <Box sx={{ mt: 1 }}>
                                {selectedSchedule && formData.recurrence === 'once' && (
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                        You can edit the start date for this schedule
                                    </Typography>
                                )}
                                <Box sx={{ display: 'flex', gap: 2 }}>
                                    <LocalizationProvider dateAdapter={AdapterDateFns}>
                                        <DatePicker
                                            label="Start Date"
                                            value={formData.startDate}
                                            onChange={(newDate) => {
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    startDate: newDate,
                                                }));
                                                // Update selectedDate to match the new start date for single occurrence schedules
                                                if (formData.recurrence === 'once' && newDate) {
                                                    setSelectedDate(newDate);
                                                }
                                            }}
                                            inputFormat="dd-MMM-yyyy"
                                            renderInput={(props) => <TextField {...props} />}
                                            disabled={!selectedSchedule && formData.recurrence === 'once'} // Disable for new single schedules
                                        />
                                        {/* Show end date only for daily schedules */}
                                        {formData.recurrence === 'daily' && (
                                            <DatePicker
                                                label="End Date"
                                                value={formData.endDate}
                                                onChange={(newDate) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        endDate: newDate,
                                                    }))
                                                }
                                                inputFormat="dd-MMM-yyyy"
                                                renderInput={(props) => <TextField {...props} />}
                                            />
                                        )}
                                    </LocalizationProvider>
                                </Box>
                            </Box>
                        )}

                        {/* Show day selection and date fields for selected days recurrence */}
                        {formData.recurrence === 'selectedDays' && (
                            <>
                                <Box sx={{ mt: 1 }}>
                                    <ToggleButtonGroup
                                        value={formData.selectedDays}
                                        onChange={(_, newDays) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                selectedDays: newDays,
                                            }))
                                        }
                                        aria-label="selected days"
                                    >
                                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                                            <ToggleButton key={day} value={day} aria-label={day}>
                                                {day}
                                            </ToggleButton>
                                        ))}
                                    </ToggleButtonGroup>
                                </Box>

                                <Box sx={{ mt: 1, display: 'flex', gap: 2 }}>
                                    <LocalizationProvider dateAdapter={AdapterDateFns}>
                                        <DatePicker
                                            label="Start Date"
                                            value={formData.startDate}
                                            onChange={(newDate) =>
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    startDate: newDate,
                                                }))
                                            }
                                            inputFormat="dd-MMM-yyyy"
                                            renderInput={(props) => <TextField {...props} />}
                                        />
                                        <DatePicker
                                            label="End Date"
                                            value={formData.endDate}
                                            onChange={(newDate) =>
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    endDate: newDate,
                                                }))
                                            }
                                            inputFormat="dd-MMM-yyyy"
                                            renderInput={(props) => <TextField {...props} />}
                                        />
                                    </LocalizationProvider>
                                </Box>
                            </>
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClose} btnText="Cancel" />
                    {selectedSchedule && (
                        <Button onClick={handleDelete} color="error" icon={<DeleteIcon />} btnText="Delete" />
                    )}
                    <Button
                        onClick={handleSubmit}
                        variant="contained"
                        disabled={!isFormValid()}
                        btnText={selectedSchedule ? 'Update' : 'Schedule'}
                    />
                </DialogActions>
            </Dialog>

            {/* New Edit Confirmation Dialog */}
            <Dialog
                open={editConfirmDialogState.open}
                onClose={() => setEditConfirmDialogState({ open: false })}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Update {scheduleType === 'background' ? 'Background ' : ''}Schedule</DialogTitle>
                <DialogContent>
                    <Typography gutterBottom>Would you like to update this event or all related events?</Typography>
                    <Box sx={{ mt: 2, display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                        <Button onClick={() => setEditConfirmDialogState({ open: false })} btnText="Cancel" />
                        <Button
                            onClick={() => submitScheduleUpdate('single')}
                            variant="outlined"
                            btnText="This Event"
                        />
                        <Button
                            onClick={() => submitScheduleUpdate('all')}
                            variant="contained"
                            color="primary"
                            btnText="All Events"
                        />
                    </Box>
                </DialogContent>
            </Dialog>

            <Dialog
                open={deleteDialogState.open}
                onClose={() => setDeleteDialogState({ open: false })}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Delete Schedule</DialogTitle>
                <DialogContent>
                    {selectedSchedule &&
                        ['daily', 'selectedDays'].includes(formData.recurrence) &&
                        !deleteDialogState.mode ? (
                        <>
                            <Typography gutterBottom>
                                Would you like to delete this event or all related events?
                            </Typography>
                            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                                <Button onClick={() => setDeleteDialogState({ open: false })} btnText="Cancel" />

                                <Button
                                    onClick={() => handleConfirmDelete('single')}
                                    variant="outlined"
                                    color="error"
                                    btnText="This Event"
                                />

                                <Button
                                    onClick={() => handleConfirmDelete('all')}
                                    variant="contained"
                                    color="error"
                                    btnText="All Events"
                                />
                            </Box>
                        </>
                    ) : (
                        <>
                            <Typography>Are you sure you want to delete this schedule?</Typography>
                            <DialogActions>
                                <Button onClick={() => setDeleteDialogState({ open: false })} btnText="Cancel" />
                                <Button
                                    onClick={() => handleConfirmDelete('single')}
                                    color="error"
                                    variant="contained"
                                    btnText="Delete"
                                />
                            </DialogActions>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </Paper>
    );
};

export default PlaylistScheduler;
