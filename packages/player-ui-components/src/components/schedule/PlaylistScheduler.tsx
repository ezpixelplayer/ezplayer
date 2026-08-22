import { PlaylistRecord, ScheduledPlaylist, getPlaylistDurationMS, priorityToNumber } from '@ezplayer/ezplayer-core';
import { ToastMsgs, convertDateToMilliseconds, timestampToDate } from '@ezplayer/shared-ui-components';
import { ScheduleChip, type CalendarViewMode } from './ScheduleChip/ScheduleChip';
import {
    CalendarViewDay,
    CalendarViewMonth,
    CalendarViewWeek,
    ChevronLeft,
    ChevronRight,
    ExpandLess,
    ExpandMore,
} from '@mui/icons-material';
import DeleteIcon from '@mui/icons-material/Delete';
import PreviewIcon from '@mui/icons-material/Preview';
import { Box } from '../box/Box';
import {
    Button,
    Checkbox,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    FormHelperText,
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
    Tooltip,
    Typography,
    styled,
} from '@mui/material';
import {
    DndContext,
    DragOverlay,
    pointerWithin,
    type DragEndEvent,
    type DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { addDays, addMonths, addWeeks, format, subDays, subMonths, subWeeks } from 'date-fns';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { postScheduledPlaylists } from '../../store/slices/ScheduleStore';
import { formatDateStandard } from '../../util/dateUtils';
import {
    generateDailyOccurrences,
    generateSelectedDaysOccurrences,
    type RecurrenceOption,
} from '../../util/scheduleRecurrence';
import {
    buildDragOperationPayload,
    dateKeyToDate,
    findScheduleConflicts,
    getDragDialogType,
    isScheduleDragAllowed,
    type ScheduleDragDialogType,
    type ScheduleDragOperation,
} from '../../util/scheduleDragDrop';
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
    onScheduleTypeChange?: (value: 'main' | 'background') => void;
    onOpenPreview?: () => void;
}

type EditMode = 'single' | 'all' | null;
type PriorityOption = 'normal' | 'high' | 'low';
type EndPolicyOption = 'seqboundearly' | 'seqboundlate' | 'seqboundnearest' | 'hardcut';

const END_POLICY_LABELS: Record<EndPolicyOption, string> = {
    seqboundearly: 'Finish  before end time, between songs',
    seqboundlate: 'Finish after end time, between songs',
    seqboundnearest: 'Finish near end time, between songs',
    hardcut: 'Finish exactly at end time, even if a song gets cut off',
};

const END_POLICY_DESCRIPTIONS: Record<EndPolicyOption, string> = {
    seqboundearly:
        'Choose this if the schedule must finish by the selected end time. For example, if you promised your neighbor the show would be over by 10:00 PM, use this option.',
    seqboundlate:
        'Choose this if the schedule should still be running at the selected end time. For example, if you promised your audience the show would still be playing at 10:00 PM, use this option.',
    seqboundnearest:
        'Choose this if you want the schedule to end at the item boundary closest to the selected end time. For example, if your show should wrap up at approximately 10:00 PM, use this option.',
    hardcut:
        'Choose this if the schedule must stop exactly at the selected end time, even if a sequence is still playing. For example, if you need the show to end precisely at 10:00 PM, use this option.',
};

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
    onScheduleTypeChange,
    onOpenPreview,
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
    const [isLoopAutoEnabled, setIsLoopAutoEnabled] = useState(false);
    const [isAdvancedOptionsExpanded, setIsAdvancedOptionsExpanded] = useState(false);
    const sequenceData = useSelector((state: RootState) => state.sequences.sequenceData);
    const [scheduledPlaylists, setScheduledPlaylists] = useState<ScheduledPlaylist[]>(initialSchedules);
    const [selectedSchedule, setSelectedSchedule] = useState<ScheduledPlaylist | null>(null);
    const isDnDDraggingRef = useRef(false);

    const [dayErrorKeys, setDayErrorKeys] = useState<Record<string, boolean>>({});

    const [dragDropDialogState, setDragDropDialogState] = useState<{
        open: boolean;
        dialogType: ScheduleDragDialogType;
        sourceSchedule: ScheduledPlaylist | null;
        destinationDate: Date | null;
        destinationDateKey: string | null;
    }>({
        open: false,
        dialogType: 'single',
        sourceSchedule: null,
        destinationDate: null,
        destinationDateKey: null,
    });

    const [conflictConfirmDialogState, setConflictConfirmDialogState] = useState<{
        open: boolean;
        operation: ScheduleDragOperation | null;
        sourceSchedule: ScheduledPlaylist | null;
        destinationDate: Date | null;
        destinationDateKey: string | null;
        candidateSchedules: ScheduledPlaylist[];
        conflictErrors: string[];
    }>({
        open: false,
        operation: null,
        sourceSchedule: null,
        destinationDate: null,
        destinationDateKey: null,
        candidateSchedules: [],
        conflictErrors: [],
    });
    const [activeDragSchedule, setActiveDragSchedule] = useState<ScheduledPlaylist | null>(null);

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
        if (isDnDDraggingRef.current) return;
        setSelectedDate(date);
        setIsLoopAutoEnabled(false);
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
            setIsLoopAutoEnabled(false);
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
        setIsLoopAutoEnabled(false);
        setIsAdvancedOptionsExpanded(false);
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

            // When mode is 'single' and editing a recurring schedule, we update in place (no deletion)
            const isSingleOccurrenceUpdateOfRecurring =
                mode === 'single' &&
                selectedSchedule &&
                ['daily', 'selectedDays'].includes(selectedSchedule.recurrence ?? '');

            if (selectedSchedule && !isSimpleSingleOccurrenceUpdate && !isSingleOccurrenceUpdateOfRecurring) {
                if (mode === 'all') {
                    // Remove all schedules in the series
                    const baseId = selectedSchedule.baseScheduleId || selectedSchedule.id;
                    const allInSeries = scheduledPlaylists.filter(
                        (s) => s.baseScheduleId === baseId || s.id === baseId,
                    );
                    allInSeries.forEach((s) => idsToRemoveLocally.add(s.id));
                    schedulesToSubmit.push(...allInSeries.map((s) => ({ ...s, deleted: true })));
                } else {
                    // mode is null (not 'single' or 'all')
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
                duration: totalDuration, // TODO CRAZ: This is not accurate w/ loop or priority, should we delete it from here?
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
                    ? selectedSchedule
                        ? formData.startDate
                        : selectedDate
                    : formData.startDate || selectedDate;
            if (!startDateForGeneration) return;

            // When mode is 'single', we should only update the single occurrence being edited,
            // not regenerate the entire series, even if it's a recurring schedule
            if (mode === 'single' && selectedSchedule) {
                // Update the existing schedule in place for the selected date
                // Keep the original ID and baseScheduleId to maintain the relationship
                schedulesToUpdateLocally = [
                    {
                        ...selectedSchedule, // Preserve original schedule properties
                        ...baseSchedule, // Override with new form data
                        id: selectedSchedule.id, // Keep the same ID
                        date: convertDateToMilliseconds(selectedDate!), // Update to selected date
                        baseScheduleId: selectedSchedule.baseScheduleId || '', // Preserve baseScheduleId
                        // Keep the original recurrence type to maintain series relationship
                        recurrence: selectedSchedule.recurrence || 'once',
                        scheduleType: baseSchedule.scheduleType || 'main',
                    },
                ];
            } else if (formData.recurrence === 'daily' && formData.endDate) {
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

                // For single occurrence updates of recurring schedules, replace the existing one
                if (isSingleOccurrenceUpdateOfRecurring && selectedSchedule) {
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

    // Handle time field double-click to select all text.
    // The handler sits on the TextField root div, so reach for the actual input.
    const handleTimeDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
        if (event.target instanceof HTMLInputElement) {
            event.target.select();
        }
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
                const loopUpdates = getLoopAutoToggleUpdates(formattedValue, toTime, formData, isLoopAutoEnabled);

                setFormData((prev) => ({
                    ...prev,
                    [name]: formattedValue,
                    toTime,
                    ...(loopUpdates.loop !== undefined ? { loop: loopUpdates.loop } : {}),
                    ...(loopUpdates.shuffle !== undefined ? { shuffle: loopUpdates.shuffle } : {}),
                }));
                setIsLoopAutoEnabled(loopUpdates.nextAutoEnabled);
            } else {
                setFormData((prev) => ({
                    ...prev,
                    [name]: formattedValue,
                }));
            }
        } else {
            if (name === 'toTime') {
                const loopUpdates = getLoopAutoToggleUpdates(
                    formData.fromTime,
                    formattedValue,
                    formData,
                    isLoopAutoEnabled,
                );

                setFormData((prev) => ({
                    ...prev,
                    [name]: formattedValue,
                    ...(loopUpdates.loop !== undefined ? { loop: loopUpdates.loop } : {}),
                    ...(loopUpdates.shuffle !== undefined ? { shuffle: loopUpdates.shuffle } : {}),
                }));

                setIsLoopAutoEnabled(loopUpdates.nextAutoEnabled);
            } else {
                setFormData((prev) => ({
                    ...prev,
                    [name]: formattedValue,
                }));
            }
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
                    if (name === 'toTime') {
                        const loopUpdates = getLoopAutoToggleUpdates(
                            formData.fromTime,
                            formatted,
                            formData,
                            isLoopAutoEnabled,
                        );

                        setFormData((prev) => ({
                            ...prev,
                            [name]: formatted,
                            ...(loopUpdates.loop !== undefined ? { loop: loopUpdates.loop } : {}),
                            ...(loopUpdates.shuffle !== undefined ? { shuffle: loopUpdates.shuffle } : {}),
                        }));

                        setIsLoopAutoEnabled(loopUpdates.nextAutoEnabled);
                    } else {
                        setFormData((prev) => ({
                            ...prev,
                            [name]: formatted,
                        }));
                    }
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
        // Explicit user interaction: don't keep the auto-enable warning.
        setIsLoopAutoEnabled(false);
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
        // Explicit user interaction: don't keep the auto-enable warning.
        setIsLoopAutoEnabled(false);
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

    const getScheduleDurationMinutes = (mpid: string, prepid?: string, postpid?: string): number | null => {
        const totalDuration1 = calculatePlaylistDuration(mpid).totalDuration;
        const totalDuration2 = prepid ? calculatePlaylistDuration(prepid).totalDuration : 0;
        const totalDuration3 = postpid ? calculatePlaylistDuration(postpid).totalDuration : 0;
        const totalSeconds = totalDuration1 + totalDuration2 + totalDuration3;

        if (totalSeconds <= 0) return null;
        // Match existing `calcToTime` behavior: duration in minutes rounded up.
        return Math.max(1, Math.ceil(totalSeconds / 60));
    };

    const isToTimeLongerThanScheduleDuration = (fromTime: string, toTime: string, fd: typeof formData): boolean => {
        if (!fd.playlistId) return false;
        if (!fromTime || !toTime) return false;
        if (!isTimeValid(fromTime) || !isExtendedTimeValid(toTime)) return false;

        const totalDurationMinutes = getScheduleDurationMinutes(fd.playlistId, fd.prePlaylistId, fd.postPlaylistId);
        if (totalDurationMinutes === null) return false;

        const [fromHours, fromMinutes] = fromTime.split(':').map(Number);
        const [toHours, toMinutes] = toTime.split(':').map(Number);

        const startTotalMinutes = fromHours * 60 + fromMinutes;
        const endTotalMinutes = toHours * 60 + toMinutes;

        return endTotalMinutes - startTotalMinutes > totalDurationMinutes;
    };

    const shouldAutoEnableLoopForToTime = (fromTime: string, toTime: string, fd: typeof formData): boolean => {
        // Only auto-enable Loop when the user hasn't already enabled Loop.
        if (fd.loop) return false;
        return isToTimeLongerThanScheduleDuration(fromTime, toTime, fd);
    };

    const getLoopAutoToggleUpdates = (
        fromTime: string,
        toTime: string,
        fd: typeof formData,
        autoEnabled: boolean,
    ): { loop?: boolean; shuffle?: boolean; nextAutoEnabled: boolean } => {
        if (shouldAutoEnableLoopForToTime(fromTime, toTime, fd)) {
            return { loop: true, shuffle: false, nextAutoEnabled: true };
        }

        if (autoEnabled && fd.loop && !isToTimeLongerThanScheduleDuration(fromTime, toTime, fd)) {
            return { loop: false, nextAutoEnabled: false };
        }

        return { nextAutoEnabled: autoEnabled && isToTimeLongerThanScheduleDuration(fromTime, toTime, fd) };
    };

    const formatDuration = (seconds: number): string => {
        const totalSeconds = Math.round(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
        }
        return `${minutes}m ${remainingSeconds}s`;
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
        const sourceDateKey = format(timestampToDate(scheduleItem.date), 'yyyy-MM-dd');
        const canDrag = view !== 'daily' && isScheduleDragAllowed(scheduleItem, scheduledPlaylists);

        return (
            <ScheduleChip
                key={scheduleItem.id}
                scheduleItem={scheduleItem}
                view={view as CalendarViewMode}
                scheduleType={scheduleType}
                resolvedPlaylistTitle={selectedPlaylist?.title}
                sourceDateKey={sourceDateKey}
                onScheduleClick={handleScheduleClick}
                draggable={canDrag}
            />
        );
    };

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
    );

    const getDragOperationSuccessMessage = (operation: ScheduleDragOperation, destinationDate: Date) => {
        switch (operation) {
            case 'copy':
                return `Schedule copied to ${formatDateStandard(destinationDate)}`;
            case 'move':
                return `Schedule moved to ${formatDateStandard(destinationDate)}`;
            case 'fill':
                return `Schedule repeated through ${formatDateStandard(destinationDate)}`;
            case 'changeStartDate':
                return `Repeating schedule start date changed to ${formatDateStandard(destinationDate)}`;
            case 'changeEndDate':
                return `Repeating schedule end date changed to ${formatDateStandard(destinationDate)}`;
            default:
                return 'Schedule updated';
        }
    };

    const getDragOperationErrorMessage = (operation: ScheduleDragOperation) => {
        switch (operation) {
            case 'copy':
                return 'Copy failed. Please try again.';
            case 'move':
                return 'Move failed. Please try again.';
            case 'fill':
                return 'Repeat failed. Please try again.';
            case 'changeStartDate':
                return 'Start date change failed. Please try again.';
            case 'changeEndDate':
                return 'End date change failed. Please try again.';
            default:
                return 'Schedule update failed. Please try again.';
        }
    };

    const applyDragScheduleOperation = async (operation: ScheduleDragOperation, proceedAfterConflict: boolean) => {
        const sourceSchedule = dragDropDialogState.sourceSchedule ?? conflictConfirmDialogState.sourceSchedule;
        const destinationDate = dragDropDialogState.destinationDate ?? conflictConfirmDialogState.destinationDate;
        const destinationDateKey = dragDropDialogState.destinationDateKey ?? conflictConfirmDialogState.destinationDateKey;

        if (!sourceSchedule || !destinationDate || !destinationDateKey) return;

        const payload = buildDragOperationPayload(operation, sourceSchedule, destinationDate, scheduledPlaylists);
        if (!payload) {
            ToastMsgs.showErrorMessage('This schedule change is not valid for the selected date.', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 4000,
            });
            return;
        }

        const candidateSchedules =
            'singleSchedule' in payload
                ? [payload.singleSchedule]
                : [...payload.schedulesToCreate, ...payload.schedulesToUpdate];
        const excludeIds = new Set<string>(
            'singleSchedule' in payload
                ? operation === 'move'
                    ? [sourceSchedule.id]
                    : []
                : [
                    ...payload.schedulesToDelete.map((schedule) => schedule.id),
                    ...payload.schedulesToUpdate.map((schedule) => schedule.id),
                ],
        );

        const conflictErrors = findScheduleConflicts(candidateSchedules, scheduledPlaylists, excludeIds);
        const hasConflict = conflictErrors.length > 0;

        if (hasConflict && !proceedAfterConflict) {
            setDayErrorKeys((prev) => ({ ...prev, [destinationDateKey]: true }));
            setDragDropDialogState((prev) => ({ ...prev, open: false }));
            setConflictConfirmDialogState({
                open: true,
                operation,
                sourceSchedule,
                destinationDate,
                destinationDateKey,
                candidateSchedules,
                conflictErrors,
            });
            return;
        }

        const schedulesToSubmit =
            'singleSchedule' in payload
                ? [payload.singleSchedule]
                : [...payload.schedulesToDelete, ...payload.schedulesToCreate, ...payload.schedulesToUpdate];

        try {
            await dispatch(postScheduledPlaylists(schedulesToSubmit)).unwrap();
            setDayErrorKeys((prev) => {
                const next = { ...prev };
                delete next[destinationDateKey];
                return next;
            });
            setConflictConfirmDialogState((prev) => ({ ...prev, open: false }));
            setDragDropDialogState((prev) => ({ ...prev, open: false }));

            ToastMsgs.showSuccessMessage(getDragOperationSuccessMessage(operation, destinationDate), {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } catch (error) {
            console.error(`Drag-drop ${operation} failed:`, error);
            ToastMsgs.showErrorMessage(getDragOperationErrorMessage(operation), {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 4000,
            });
        }
    };

    const handleDragStart = (_event: DragStartEvent) => {
        isDnDDraggingRef.current = true;
        setSelectedSchedule(null);
        setEditConfirmDialogState({ open: false });
        setDeleteDialogState({ open: false });
        setDragDropDialogState({
            open: false,
            dialogType: 'single',
            sourceSchedule: null,
            destinationDate: null,
            destinationDateKey: null,
        });
        setConflictConfirmDialogState((prev) => ({ ...prev, open: false }));

        const activeData = _event.active.data?.current as any;
        const schedule = activeData?.scheduleItem as ScheduledPlaylist | undefined;
        setActiveDragSchedule(schedule ?? null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        isDnDDraggingRef.current = false;
        setActiveDragSchedule(null);

        const overId = event.over?.id;
        if (!overId || typeof overId !== 'string') return;

        const activeData = event.active.data?.current as any;
        const sourceSchedule = activeData?.scheduleItem as ScheduledPlaylist | undefined;
        const sourceDateKey = activeData?.sourceDateKey as string | undefined;

        if (!sourceSchedule || !sourceDateKey) return;
        if (sourceDateKey === overId) return;

        const destinationDate = dateKeyToDate(overId);
        setDragDropDialogState({
            open: true,
            dialogType: getDragDialogType(sourceSchedule, scheduledPlaylists),
            sourceSchedule,
            destinationDate,
            destinationDateKey: overId,
        });
    };

    const handleCancelDragDrop = () => {
        setActiveDragSchedule(null);
        setDragDropDialogState({
            open: false,
            dialogType: 'single',
            sourceSchedule: null,
            destinationDate: null,
            destinationDateKey: null,
        });
    };

    const clearConflictHighlight = () => {
        const key = conflictConfirmDialogState.destinationDateKey;
        if (!key) return;
        setDayErrorKeys((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
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
        <Paper
            elevation={2}
            sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginX: 2, overflow: 'auto' }}
        >
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
                        flexWrap: 'wrap',
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

                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            flexWrap: 'wrap',
                            flex: { xs: '1 0 100%', sm: '0 0 auto' },
                            justifyContent: { xs: 'center', sm: 'flex-end' },
                        }}
                    >
                        {onOpenPreview && (
                            <Tooltip title="Open schedule preview">
                                <IconButton size="small" onClick={onOpenPreview} aria-label="open schedule preview">
                                    <PreviewIcon />
                                </IconButton>
                            </Tooltip>
                        )}

                        {onScheduleTypeChange && (
                            <Tooltip
                                title={
                                    <Typography
                                        component="span"
                                        sx={{ fontSize: 11, lineHeight: 1.3, display: 'block', maxWidth: 180 }}
                                    >
                                        Choose FG to see the foreground schedule or BG to see the background schedule.
                                        Background runs while foreground schedules are running.
                                    </Typography>
                                }
                            >
                                <ToggleButtonGroup
                                    value={scheduleType}
                                    exclusive
                                    size="small"
                                    color="primary"
                                    onChange={(_e, value: 'main' | 'background' | null) => {
                                        if (value !== null) onScheduleTypeChange(value);
                                    }}
                                    aria-label="schedule layer"
                                >
                                    <ToggleButton value="main" aria-label="foreground">
                                        FG
                                    </ToggleButton>
                                    <ToggleButton value="background" aria-label="background">
                                        BG
                                    </ToggleButton>
                                </ToggleButtonGroup>
                            </Tooltip>
                        )}

                        <StyledToggleButtonGroup
                            value={view}
                            exclusive
                            onChange={handleViewChange}
                            aria-label="view selector"
                            size="small"
                        >
                            <StyledToggleButton value="monthly" aria-label="monthly view">
                                <CalendarViewMonth />
                            </StyledToggleButton>
                            <StyledToggleButton value="weekly" aria-label="weekly view">
                                <CalendarViewWeek />
                            </StyledToggleButton>
                            <StyledToggleButton value="daily" aria-label="daily view">
                                <CalendarViewDay />
                            </StyledToggleButton>
                        </StyledToggleButtonGroup>
                    </Box>
                </Box>
            )}

            <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={() => {
                    isDnDDraggingRef.current = false;
                    handleCancelDragDrop();
                    setConflictConfirmDialogState((prev) => ({ ...prev, open: false }));
                }}
            >
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
                            dayErrorKeys={dayErrorKeys}
                        />
                    )}
                    {view === 'weekly' && (
                        <WeeklyView
                            currentDate={currentDate}
                            onDateSelect={handleDateSelect}
                            scheduledPlaylists={sortedScheduledPlaylists}
                            renderScheduledPlaylist={renderScheduledPlaylist}
                            dayErrorKeys={dayErrorKeys}
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

                <DragOverlay dropAnimation={null}>
                    {activeDragSchedule && (
                        <ScheduleChip
                            draggable={false}
                            isDragOverlay
                            scheduleItem={activeDragSchedule}
                            view={view as CalendarViewMode}
                            scheduleType={scheduleType}
                            resolvedPlaylistTitle={
                                availablePlaylists.find((p) => p.id === activeDragSchedule.playlistId)?.title
                            }
                            sourceDateKey={format(timestampToDate(activeDragSchedule.date), 'yyyy-MM-dd')}
                            onScheduleClick={() => {
                                /* overlay: ignore click */
                            }}
                        />
                    )}
                </DragOverlay>
            </DndContext>

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
                                renderValue={(value) => END_POLICY_LABELS[value as EndPolicyOption]}
                            >
                                <MenuItem value="seqboundearly">{END_POLICY_LABELS.seqboundearly}</MenuItem>
                                <MenuItem value="seqboundlate">{END_POLICY_LABELS.seqboundlate}</MenuItem>
                                <MenuItem value="seqboundnearest">{END_POLICY_LABELS.seqboundnearest}</MenuItem>
                                <MenuItem value="hardcut">{END_POLICY_LABELS.hardcut}</MenuItem>
                            </Select>
                            <FormHelperText>{END_POLICY_DESCRIPTIONS[formData.endPolicy]}</FormHelperText>
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
                        {isLoopAutoEnabled &&
                            formData.loop &&
                            isToTimeLongerThanScheduleDuration(formData.fromTime, formData.toTime, formData) && (
                                <Typography variant="body2" sx={{ mt: 1, color: 'warning.main' }}>
                                    The Loop option has been enabled automatically because the schedule duration does
                                    not match the selected end time.
                                </Typography>
                            )}
                        {/* Advisory only: the schedule is still allowed to be submitted. */}
                        {!formData.loop &&
                            !formData.shuffle &&
                            isToTimeLongerThanScheduleDuration(formData.fromTime, formData.toTime, formData) && (
                                <Typography variant="body2" sx={{ mt: 1, color: 'warning.main' }}>
                                    NOTE: Playlist is too short to fill the scheduled time. Choose loop or shuffle to
                                    fill the whole schedule.
                                </Typography>
                            )}

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

                        <Box
                            sx={{
                                mt: 1,
                                border: 1,
                                borderColor: 'divider',
                                borderRadius: 1,
                                overflow: 'hidden',
                            }}
                        >
                            <Box
                                role="button"
                                tabIndex={0}
                                aria-expanded={isAdvancedOptionsExpanded}
                                aria-label="Advanced Options"
                                onClick={() => setIsAdvancedOptionsExpanded((prev) => !prev)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setIsAdvancedOptionsExpanded((prev) => !prev);
                                    }
                                }}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                    px: 1.5,
                                    py: 1,
                                    // Divider only while expanded, so the card reads as one unit.
                                    borderBottom: isAdvancedOptionsExpanded ? 1 : 0,
                                    borderColor: 'divider',
                                    bgcolor: 'background.paper',
                                    color: 'text.primary',
                                    '&:hover': {
                                        bgcolor: 'action.hover',
                                    },
                                    '&:focus-visible': {
                                        outline: '2px solid',
                                        outlineColor: 'primary.main',
                                        outlineOffset: -2,
                                    },
                                }}
                            >
                                <Typography variant="body1" sx={{ fontWeight: 500, color: 'text.primary' }}>
                                    Advanced Options
                                </Typography>
                                {isAdvancedOptionsExpanded ? (
                                    <ExpandLess color="action" />
                                ) : (
                                    <ExpandMore color="action" />
                                )}
                            </Box>
                            <Collapse in={isAdvancedOptionsExpanded}>
                                <Box
                                    sx={{
                                        pt: 1.5,
                                        px: 1.5,
                                        pb: 1.5,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 1.5,
                                    }}
                                >
                                    <FormControl fullWidth>
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

                                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
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
                                </Box>
                            </Collapse>
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
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ mb: 1, display: 'block' }}
                                    >
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
                    <Button onClick={handleClose}>Cancel</Button>
                    {selectedSchedule && (
                        <Button onClick={handleDelete} color="error" startIcon={<DeleteIcon />}>
                            Delete
                        </Button>
                    )}
                    <Button onClick={handleSubmit} variant="contained" disabled={!isFormValid()}>
                        {selectedSchedule ? 'Update' : 'Schedule'}
                    </Button>
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
                        <Button onClick={() => setEditConfirmDialogState({ open: false })}>Cancel</Button>
                        <Button onClick={() => submitScheduleUpdate('single')} variant="outlined">
                            This Event
                        </Button>
                        <Button onClick={() => submitScheduleUpdate('all')} variant="contained" color="primary">
                            All Events
                        </Button>
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
                                <Button onClick={() => setDeleteDialogState({ open: false })}>Cancel</Button>

                                <Button onClick={() => handleConfirmDelete('single')} variant="outlined" color="error">
                                    This Event
                                </Button>

                                <Button onClick={() => handleConfirmDelete('all')} variant="contained" color="error">
                                    All Events
                                </Button>
                            </Box>
                        </>
                    ) : (
                        <>
                            <Typography>Are you sure you want to delete this schedule?</Typography>
                            <DialogActions>
                                <Button onClick={() => setDeleteDialogState({ open: false })}>Cancel</Button>
                                <Button onClick={() => handleConfirmDelete('single')} color="error" variant="contained">
                                    Delete
                                </Button>
                            </DialogActions>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Drag-drop confirmation dialog */}
            <Dialog
                open={dragDropDialogState.open}
                onClose={handleCancelDragDrop}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Schedule</DialogTitle>
                <DialogContent>
                    {dragDropDialogState.dialogType === 'single' && (
                        <Typography gutterBottom>
                            Choose an action for this schedule on{' '}
                            <b>
                                {dragDropDialogState.destinationDate
                                    ? formatDateStandard(dragDropDialogState.destinationDate)
                                    : ''}
                            </b>
                            .
                        </Typography>
                    )}
                    {dragDropDialogState.dialogType === 'recurring-first' && (
                        <Typography gutterBottom>
                            Change the repeating schedule start date to{' '}
                            <b>
                                {dragDropDialogState.destinationDate
                                    ? formatDateStandard(dragDropDialogState.destinationDate)
                                    : ''}
                            </b>
                            ?
                        </Typography>
                    )}
                    {dragDropDialogState.dialogType === 'recurring-last' && (
                        <Typography gutterBottom>
                            Change the repeating schedule end date to{' '}
                            <b>
                                {dragDropDialogState.destinationDate
                                    ? formatDateStandard(dragDropDialogState.destinationDate)
                                    : ''}
                            </b>
                            ?
                        </Typography>
                    )}
                    {dragDropDialogState.sourceSchedule && (
                        <Typography variant="body2" color="text.secondary">
                            {dragDropDialogState.sourceSchedule.title} ({dragDropDialogState.sourceSchedule.fromTime} -{' '}
                            {dragDropDialogState.sourceSchedule.toTime})
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions sx={{ flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end' }}>
                    <Button onClick={handleCancelDragDrop}>Cancel</Button>
                    {dragDropDialogState.dialogType === 'single' && (
                        <>
                            <Button onClick={() => applyDragScheduleOperation('copy', false)} variant="outlined">
                                Copy
                            </Button>
                            <Button onClick={() => applyDragScheduleOperation('move', false)} variant="outlined">
                                Move
                            </Button>
                            <Button
                                onClick={() => applyDragScheduleOperation('fill', false)}
                                variant="contained"
                                color="primary"
                            >
                                Repeat
                            </Button>
                        </>
                    )}
                    {dragDropDialogState.dialogType === 'recurring-first' && (
                        <Button
                            onClick={() => applyDragScheduleOperation('changeStartDate', false)}
                            variant="contained"
                            color="primary"
                        >
                            Change Start Date
                        </Button>
                    )}
                    {dragDropDialogState.dialogType === 'recurring-last' && (
                        <Button
                            onClick={() => applyDragScheduleOperation('changeEndDate', false)}
                            variant="contained"
                            color="primary"
                        >
                            Change End Date
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            {/* Conflict confirmation dialog */}
            <Dialog
                open={conflictConfirmDialogState.open}
                onClose={() => {
                    setConflictConfirmDialogState((prev) => ({ ...prev, open: false }));
                    clearConflictHighlight();
                    handleCancelDragDrop();
                }}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Schedule Conflict</DialogTitle>
                <DialogContent>
                    <Typography gutterBottom>
                        This destination day has unresolved schedule conflicts. You must explicitly confirm the operation.
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {conflictConfirmDialogState.operation === 'copy'
                            ? 'Copy'
                            : conflictConfirmDialogState.operation === 'move'
                                ? 'Move'
                                : conflictConfirmDialogState.operation === 'fill'
                                    ? 'Fill'
                                    : conflictConfirmDialogState.operation === 'changeStartDate'
                                        ? 'Change start date'
                                        : conflictConfirmDialogState.operation === 'changeEndDate'
                                            ? 'Change end date'
                                            : 'Update'}{' '}
                        to{' '}
                        {conflictConfirmDialogState.destinationDate
                            ? formatDateStandard(conflictConfirmDialogState.destinationDate)
                            : ''}
                        .
                    </Typography>
                    {conflictConfirmDialogState.conflictErrors.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                            {conflictConfirmDialogState.conflictErrors.slice(0, 3).map((err, i) => (
                                <Typography key={i} variant="caption" color="error.main" sx={{ display: 'block' }}>
                                    ERR: {err}
                                </Typography>
                            ))}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => {
                            setConflictConfirmDialogState((prev) => ({ ...prev, open: false }));
                            clearConflictHighlight();
                            handleCancelDragDrop();
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={() => applyDragScheduleOperation(conflictConfirmDialogState.operation!, true)}
                        variant="contained"
                        color="primary"
                        disabled={!conflictConfirmDialogState.operation}
                    >
                        {conflictConfirmDialogState.operation === 'copy'
                            ? 'Copy Anyway'
                            : conflictConfirmDialogState.operation === 'move'
                                ? 'Move Anyway'
                                : conflictConfirmDialogState.operation === 'fill'
                                    ? 'Fill Anyway'
                                    : conflictConfirmDialogState.operation === 'changeStartDate'
                                        ? 'Change Start Date Anyway'
                                        : conflictConfirmDialogState.operation === 'changeEndDate'
                                            ? 'Change End Date Anyway'
                                            : 'Confirm Anyway'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default PlaylistScheduler;
