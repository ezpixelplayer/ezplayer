import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Timeline } from 'vis-timeline/standalone';
import { DataSet } from 'vis-data';
import { format } from 'date-fns';
import { useSelector } from 'react-redux';
import { RootState } from '../../store/Store';
import { type PlaybackLogDetail } from '@ezplayer/ezplayer-core';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Chip,
    Stack,
    Tooltip,
    IconButton,
    CircularProgress,
    useTheme,
    Theme,
} from '@mui/material';
import { ZoomIn, ZoomOut, FitScreen, Refresh } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { priorityToNumber } from '@ezplayer/ezplayer-core';

interface TimelineByScheduleProps {
    data: PlaybackLogDetail[];
    className?: string;
    onItemClick?: (scheduleId?: string, playlistId?: string) => void;
    simulationStartTime?: number;
    simulationEndTime?: number;
    // New props for horizontal scroll control
    minScrollTime?: Date | number;
    maxScrollTime?: Date | number;
}

interface TimelineItem {
    id: string;
    content: string;
    start: Date;
    end?: Date;
    group: string;
    subgroup?: string;
    className: string;
    title: string;
    eventType: string;
    scheduleId?: string;
    playlistId?: string;
    sequenceId?: string;
    stackDepth: number;
    scheduleColor?: string;
    type?: string;
    style?: string;
    // New properties for schedule vs actual comparison
    scheduledStart?: Date;
    scheduledEnd?: Date;
    actualStart?: Date;
    actualEnd?: Date;
    isDelayed?: boolean;
    isMissed?: boolean;
    delayMinutes?: number;
}

interface TimelineGroup {
    id: string;
    content: string;
    className: string;
    priorityLabel?: string;
    priorityClass?: string;
    typeLabel?: string;
    typeClass?: string;
}

// Define priority-based color mapping that works across all themes
const getPriorityColors = (theme: Theme) => ({
    high: theme.palette.error.main, // Red for high priority
    normal: theme.palette.primary.main, // Primary color for normal priority
    low: theme.palette.info.main, // Blue for low priority
});

const getEventTypeConfig = (_theme: Theme) => ({
    'Schedule Started': {
        icon: '▶️',
        className: 'schedule-started',
        description: 'Schedule execution began',
    },
    'Schedule Ended': {
        icon: '⏹️',
        className: 'schedule-ended',
        description: 'Schedule execution completed',
    },
    'Schedule Stopped': {
        icon: '⏹️',
        className: 'schedule-stopped',
        description: 'Schedule was stopped',
    },
    'Schedule Suspended': {
        icon: '⏸️',
        className: 'schedule-suspended',
        description: 'Schedule was suspended',
    },
    'Schedule Resumed': {
        icon: '▶️',
        className: 'schedule-resumed',
        description: 'Schedule was resumed',
    },
    'Schedule Deferred': {
        icon: '⏭️',
        className: 'schedule-deferred',
        description: 'Schedule was deferred',
    },
    'Schedule Prevented': {
        icon: '⏹️',
        className: 'schedule-prevented',
        description: 'Schedule was prevented',
    },
});

const TimelineBySchedule: React.FC<TimelineByScheduleProps> = ({
    data,
    className = '',
    onItemClick,
    simulationStartTime,
    simulationEndTime,
    minScrollTime,
    maxScrollTime,
}) => {
    const timelineRef = useRef<HTMLDivElement>(null);
    const timelineInstanceRef = useRef<Timeline | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get theme for dynamic styling
    const theme = useTheme();

    // Memoize eventTypeConfig and priority colors to prevent unnecessary re-renders
    const eventTypeConfig = useMemo(() => getEventTypeConfig(theme), [theme]);
    const priorityColors = useMemo(() => getPriorityColors(theme), [theme]);

    // Get schedules from Redux store
    const schedules = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);

    // Helper function to get schedule name
    const getScheduleName = useCallback(
        (scheduleId: string) => {
            const schedule = schedules.find((s) => s.id === scheduleId);
            return schedule?.title || `Schedule ${scheduleId.slice(0, 8)}`;
        },
        [schedules],
    );

    // Helper function to get schedule priority
    const getSchedulePriority = useCallback(
        (scheduleId: string) => {
            const schedule = schedules.find((s) => s.id === scheduleId);
            return schedule?.priority || 'normal';
        },
        [schedules],
    );

    // Helper function to assign color based on schedule priority
    const getScheduleColor = useCallback(
        (scheduleId: string) => {
            const priority = getSchedulePriority(scheduleId);
            return priorityColors[priority];
        },
        [getSchedulePriority, priorityColors],
    );

    // Helper function to check if a schedule is background type
    const isBackgroundSchedule = useCallback(
        (scheduleId: string) => {
            const schedule = schedules.find((s) => s.id === scheduleId);
            return schedule?.scheduleType === 'background';
        },
        [schedules],
    );

    // Helper function to get final color for timeline item - use single color for background schedules
    const getTimelineItemColor = useCallback(
        (scheduleId: string) => {
            if (isBackgroundSchedule(scheduleId)) {
                // Use a single color for all background schedules
                return theme.palette.info.main; // Single blue color for all background schedules
            }
            // Use priority-based colors for regular schedules
            return getScheduleColor(scheduleId);
        },
        [getScheduleColor, isBackgroundSchedule, theme.palette.info.main],
    );

    // Helper function to get scheduled start and end times for a schedule
    const getScheduledTimes = useCallback(
        (scheduleId: string) => {
            const schedule = schedules.find((s) => s.id === scheduleId);
            if (!schedule) return { scheduledStart: undefined, scheduledEnd: undefined };

            const baseDate = new Date(schedule.date);

            // Parse time strings (handle extended time format like 25:00, 26:30)
            const parseExtendedTime = (timeString: string): Date => {
                const [hours, minutes, seconds = 0] = timeString.split(':').map(Number);
                const totalHours = hours;
                const normalizedHours = totalHours % 24;
                const daysOffset = Math.floor(totalHours / 24);

                const resultDate = new Date(baseDate);
                resultDate.setDate(resultDate.getDate() + daysOffset);
                resultDate.setHours(normalizedHours, minutes, seconds, 0);

                return resultDate;
            };

            const scheduledStart = parseExtendedTime(schedule.fromTime);
            const scheduledEnd = parseExtendedTime(schedule.toTime);

            return { scheduledStart, scheduledEnd };
        },
        [schedules],
    );

    // Process data for timeline
    const timelineData = useMemo(() => {
        if (!data.length) return { items: [], groups: [] };

        const items: TimelineItem[] = [];
        const groups: TimelineGroup[] = [];

        // Filter to only schedule events and get unique schedule IDs
        const scheduleEvents = data.filter(
            (event) =>
                event.eventType.includes('Schedule') &&
                event.scheduleId &&
                eventTypeConfig[event.eventType as keyof typeof eventTypeConfig],
        );

        if (!scheduleEvents.length) {
            return { items, groups };
        }

        // Create schedule-based groups instead of date groups
        const uniqueScheduleIds = Array.from(
            new Set(scheduleEvents.map((event) => event.scheduleId).filter(Boolean)),
        ) as string[];

        // Sort schedule IDs by type first, then by priority, then by name for consistency
        uniqueScheduleIds.sort((a, b) => {
            // Get schedule objects from Redux store to access type and priority
            const scheduleA = schedules.find((s) => s.id === a);
            const scheduleB = schedules.find((s) => s.id === b);

            // Get schedule types (default to 'main' if not set)
            const typeA = scheduleA?.scheduleType || 'main';
            const typeB = scheduleB?.scheduleType || 'main';

            // Sort by type first: background schedules come before main schedules
            if (typeA !== typeB) {
                // Background schedules (typeA === 'background') should come first
                if (typeA === 'background') return -1;
                if (typeB === 'background') return 1;
                return 0;
            }

            // If types are equal, sort by priority
            const priorityA = scheduleA?.priority || 'normal';
            const priorityB = scheduleB?.priority || 'normal';

            // Convert priority to number for comparison
            const priorityValueA = priorityToNumber[priorityA as keyof typeof priorityToNumber] || priorityToNumber.normal;
            const priorityValueB = priorityToNumber[priorityB as keyof typeof priorityToNumber] || priorityToNumber.normal;

            // Sort by priority (higher number = lower priority, so we want low priority first)
            if (priorityValueA !== priorityValueB) {
                return priorityValueB - priorityValueA; // Reverse the comparison
            }

            // If priorities are equal, sort by schedule name
            const nameA = getScheduleName(a);
            const nameB = getScheduleName(b);
            return nameA.localeCompare(nameB);
        });

        uniqueScheduleIds.forEach((scheduleId) => {
            const scheduleName = getScheduleName(scheduleId);
            const isBackground = isBackgroundSchedule(scheduleId);
            const priority = getSchedulePriority(scheduleId);

            // Create a unique class name that includes schedule type and priority
            let groupClassName = 'schedule-group';
            if (isBackground) {
                groupClassName += ' schedule-background-group';
            } else {
                groupClassName += ` schedule-main-${priority}-priority`;
            }

            // Create priority and type labels for the schedule name
            let priorityLabel = '';
            let priorityClass = '';
            let typeLabel = '';
            let typeClass = '';

            if (isBackground) {
                // For background schedules, show both type and priority
                typeLabel = 'Background';
                typeClass = 'type-bg';

                // Show the actual priority for background schedules
                switch (priority) {
                    case 'high':
                        priorityLabel = 'High Priority';
                        priorityClass = 'priority-high';
                        break;
                    case 'normal':
                        priorityLabel = 'Normal Priority';
                        priorityClass = 'priority-normal';
                        break;
                    case 'low':
                        priorityLabel = 'Low Priority';
                        priorityClass = 'priority-low';
                        break;
                    default:
                        priorityLabel = 'Normal Priority';
                        priorityClass = 'priority-normal';
                }
            } else {
                // Priority labels
                switch (priority) {
                    case 'high':
                        priorityLabel = 'High Priority';
                        priorityClass = 'priority-high';
                        break;
                    case 'normal':
                        priorityLabel = 'Normal Priority';
                        priorityClass = 'priority-normal';
                        break;
                    case 'low':
                        priorityLabel = 'Low Priority';
                        priorityClass = 'priority-low';
                        break;
                    default:
                        priorityLabel = 'Normal Priority';
                        priorityClass = 'priority-normal';
                }
                typeLabel = 'Main'; // Type indicator
                typeClass = 'type-main';
            }

            groups.push({
                id: scheduleId,
                // Include schedule ID in content for accurate matching, hidden with zero-width space
                content: `${scheduleName}\u200B${scheduleId}`,
                className: groupClassName,
                // Store priority and type info for later DOM manipulation
                priorityLabel: priorityLabel,
                priorityClass: priorityClass,
                typeLabel: typeLabel,
                typeClass: typeClass,
            });
        });

        // Group events by schedule to track their lifecycle
        const scheduleEventMap = new Map<string, any[]>();
        scheduleEvents.forEach((event) => {
            if (!scheduleEventMap.has(event.scheduleId!)) {
                scheduleEventMap.set(event.scheduleId!, []);
            }
            scheduleEventMap.get(event.scheduleId!)!.push(event);
        });

        // Process each schedule's events to create timeline segments
        scheduleEventMap.forEach((events, scheduleId) => {
            events.sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

            const scheduleName = getScheduleName(scheduleId);
            const scheduleColor = getTimelineItemColor(scheduleId);
            const { scheduledStart, scheduledEnd } = getScheduledTimes(scheduleId);
            const groupId = scheduleId; // Use schedule ID as group ID

            let currentSegmentStart: Date | null = null;
            let segmentCounter = 0;
            let lastSuspendTime: Date | null = null; // Track suspension time for interruption periods

            events.forEach((event, _index) => {
                const eventTime = new Date(event.eventTime);
                const groupId = scheduleId; // Use schedule ID as group ID

                if (event.eventType === 'Schedule Started') {
                    currentSegmentStart = eventTime;
                } else if (event.eventType === 'Schedule Resumed') {
                    // If we have a suspension time, create an interruption period
                    if (lastSuspendTime) {
                        const interruptionId = `${scheduleId}-interruption-${segmentCounter++}`;
                        const interruptionContent = `Interruption`;
                        let interruptionTitle = `${scheduleName} - Interruption Period`;
                        interruptionTitle += `\n${format(lastSuspendTime, 'HH:mm:ss')} - ${format(eventTime, 'HH:mm:ss')}`;
                        interruptionTitle += `\nDate: ${format(eventTime, 'MMM d, yyyy')}`;
                        interruptionTitle += `\nStatus: Interrupted by higher priority schedule`;

                        // Use grey color for interruptions, but if it's a background schedule, use a darker grey
                        const interruptionColor = isBackgroundSchedule(scheduleId) ? '#757575' : '#9e9e9e';

                        items.push({
                            id: interruptionId,
                            content: interruptionContent,
                            start: lastSuspendTime,
                            end: eventTime,
                            group: groupId,
                            subgroup: scheduleId, // Use schedule ID as subgroup
                            className: 'schedule-interruption',
                            title: interruptionTitle,
                            eventType: 'Schedule Interruption',
                            scheduleId: scheduleId,
                            playlistId: event.playlistId,
                            sequenceId: event.sequenceId,
                            stackDepth: event.stackDepth,
                            scheduleColor: interruptionColor,
                            type: 'range',
                        });
                    }
                    currentSegmentStart = eventTime;
                    lastSuspendTime = null; // Reset suspension time
                } else if (
                    (event.eventType === 'Schedule Ended' ||
                        event.eventType === 'Schedule Stopped' ||
                        event.eventType === 'Schedule Suspended') &&
                    currentSegmentStart
                ) {
                    // Create a timeline segment from start to this end event
                    const segmentEnd = eventTime;
                    const isSuspended = event.eventType === 'Schedule Suspended';

                    const itemId = `${scheduleId}-segment-${segmentCounter++}`;
                    const content = `${scheduleName}`;
                    let title = `${scheduleName}`;
                    title += `\n${format(currentSegmentStart, 'HH:mm:ss')} - ${format(segmentEnd, 'HH:mm:ss')}`;
                    title += `\nDate: ${format(eventTime, 'MMM d, yyyy')}`;

                    if (isSuspended) {
                        title += `\nStatus: Suspended (interrupted by higher priority)`;
                        lastSuspendTime = eventTime; // Store suspension time for potential interruption period
                    } else {
                        title += `\nStatus: Completed`;
                    }

                    // Add schedule vs actual comparison information
                    if (scheduledStart) {
                        const delayMinutes = Math.round(
                            (currentSegmentStart.getTime() - scheduledStart.getTime()) / (1000 * 60),
                        );
                        if (delayMinutes > 0) {
                            title += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')}`;
                            title += `\nActual: ${format(currentSegmentStart, 'HH:mm:ss')}`;
                            title += `\nDelay: ${delayMinutes} minutes`;
                        } else if (delayMinutes < 0) {
                            title += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')}`;
                            title += `\nActual: ${format(currentSegmentStart, 'HH:mm:ss')}`;
                            title += `\nEarly: ${Math.abs(delayMinutes)} minutes`;
                        } else {
                            title += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')}`;
                            title += `\nActual: ${format(currentSegmentStart, 'HH:mm:ss')}`;
                            title += `\nOn Time`;
                        }
                    }

                    // Determine the appropriate CSS class based on schedule type and state
                    let itemClassName: string;
                    if (isBackgroundSchedule(scheduleId)) {
                        // For background schedules, use background styling when running
                        itemClassName = 'schedule-background';
                        // Note: Background schedules don't get schedule-suspended class to avoid dashed borders
                    } else {
                        // For regular schedules, use started styling when running
                        itemClassName = 'schedule-started';
                        // If suspended, add the suspended class for main schedules only
                        if (isSuspended) {
                            itemClassName += ' schedule-suspended';
                        }
                    }

                    const timelineItem = {
                        id: itemId,
                        content: `${content}|${scheduleColor}`, // Hidden color marker for DOM manipulation
                        start: currentSegmentStart,
                        end: segmentEnd,
                        group: groupId,
                        subgroup: scheduleId,
                        className: itemClassName,
                        title,
                        eventType: isSuspended ? 'Schedule Suspended' : 'Schedule Started',
                        scheduleId: scheduleId,
                        playlistId: event.playlistId,
                        sequenceId: event.sequenceId,
                        stackDepth: event.stackDepth,
                        scheduleColor,
                        type: 'range',
                        // Add schedule vs actual comparison data
                        scheduledStart,
                        scheduledEnd,
                        actualStart: currentSegmentStart,
                        actualEnd: segmentEnd,
                        isDelayed: scheduledStart ? currentSegmentStart > scheduledStart : false,
                        delayMinutes: scheduledStart
                            ? Math.round((currentSegmentStart.getTime() - scheduledStart.getTime()) / (1000 * 60))
                            : 0,
                    };
                    items.push(timelineItem);

                    if (!isSuspended) {
                        currentSegmentStart = null;
                        lastSuspendTime = null; // Reset if schedule ended/stopped
                    }
                }
            });

            // Handle case where schedule started but no end event found
            if (currentSegmentStart) {
                const startTime: Date = currentSegmentStart; // Create a non-null reference

                // Use simulation end time if available, otherwise fall back to 1 hour after start
                const defaultEnd = simulationEndTime
                    ? new Date(simulationEndTime)
                    : new Date(startTime.getTime() + 3600000); // 1 hour default fallback
                const itemId = `${scheduleId}-segment-${segmentCounter++}`;
                const content = `${scheduleName}`;
                let title = `${scheduleName}`;
                title += `\n${format(startTime, 'HH:mm:ss')} - ${simulationEndTime && defaultEnd.getTime() === simulationEndTime ? format(defaultEnd, 'HH:mm:ss') : '(ongoing)'}`;
                title += `\nDate: ${format(startTime, 'MMM d, yyyy')}`;
                title += `\nStatus: Running`;

                // Add simulation boundary information if schedule extends beyond simulation
                if (simulationEndTime && defaultEnd.getTime() === simulationEndTime) {
                    title += `\nCut off by simulation end time`;
                }

                // Add schedule vs actual comparison information
                if (scheduledStart) {
                    const delayMinutes = Math.round((startTime.getTime() - scheduledStart.getTime()) / (1000 * 60));
                    if (delayMinutes > 0) {
                        title += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')}`;
                        title += `\nActual: ${format(startTime, 'HH:mm:ss')}`;
                        title += `\nDelay: ${delayMinutes} minutes`;
                    } else if (delayMinutes < 0) {
                        title += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')}`;
                        title += `\nActual: ${format(startTime, 'HH:mm:ss')}`;
                        title += `\nEarly: ${Math.abs(delayMinutes)} minutes`;
                    } else {
                        title += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')}`;
                        title += `\nActual: ${format(startTime, 'HH:mm:ss')}`;
                        title += `\nOn Time`;
                    }
                }

                items.push({
                    id: itemId,
                    content: `${content}|${scheduleColor}`, // Hidden color marker for DOM manipulation
                    start: startTime,
                    end: defaultEnd,
                    group: groupId,
                    subgroup: scheduleId,
                    className: isBackgroundSchedule(scheduleId) ? 'schedule-background' : 'schedule-started',
                    title,
                    eventType: 'Schedule Started',
                    scheduleId: scheduleId,
                    playlistId: '',
                    sequenceId: '',
                    stackDepth: 0,
                    scheduleColor,
                    type: 'range',
                    // Add schedule vs actual comparison data
                    scheduledStart,
                    scheduledEnd,
                    actualStart: startTime,
                    actualEnd: defaultEnd,
                    isDelayed: scheduledStart ? startTime > scheduledStart : false,
                    delayMinutes: scheduledStart
                        ? Math.round((startTime.getTime() - scheduledStart.getTime()) / (1000 * 60))
                        : 0,
                });
            }

            // Add scheduled time markers for comparison (if schedule never ran or ran late)
            if (scheduledStart && scheduledEnd) {
                // Check if we have any actual execution for this schedule
                const hasActualExecution = items.some(
                    (item) => item.scheduleId === scheduleId && item.actualStart && item.actualEnd,
                );

                if (!hasActualExecution) {
                    // Schedule never ran - add a thin line showing scheduled time
                    const scheduledItemId = `${scheduleId}-scheduled-only`;
                    const scheduledContent = `${scheduleName} (Scheduled)`;
                    let scheduledTitle = `${scheduleName} - Scheduled Only`;
                    scheduledTitle += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')} - ${format(scheduledEnd, 'HH:mm:ss')}`;
                    scheduledTitle += `\nDate: ${format(scheduledStart, 'MMM d, yyyy')}`;
                    scheduledTitle += `\nStatus: Never Executed`;

                    items.push({
                        id: scheduledItemId,
                        content: `${scheduledContent}|${scheduleColor}`,
                        start: scheduledStart,
                        end: scheduledEnd,
                        group: groupId,
                        subgroup: scheduleId,
                        className: 'schedule-scheduled-only',
                        title: scheduledTitle,
                        eventType: 'Schedule Scheduled',
                        scheduleId: scheduleId,
                        playlistId: '',
                        sequenceId: '',
                        stackDepth: 0,
                        scheduleColor,
                        type: 'range',
                        // Add schedule vs actual comparison data
                        scheduledStart,
                        scheduledEnd,
                        actualStart: undefined,
                        actualEnd: undefined,
                        isDelayed: false,
                        isMissed: true,
                        delayMinutes: 0,
                    });
                } else {
                    // Schedule ran but may have been delayed - add scheduled time marker
                    const scheduledMarkerId = `${scheduleId}-scheduled-marker`;
                    const scheduledMarkerContent = `${scheduleName} (Scheduled)`;
                    let scheduledMarkerTitle = `${scheduleName} - Scheduled Time`;
                    scheduledMarkerTitle += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')} - ${format(scheduledEnd, 'HH:mm:ss')}`;
                    scheduledMarkerTitle += `\nDate: ${format(scheduledStart, 'MMM d, yyyy')}`;

                    items.push({
                        id: scheduledMarkerId,
                        content: `${scheduledMarkerContent}|${scheduleColor}`,
                        start: scheduledStart,
                        end: scheduledEnd,
                        group: groupId,
                        subgroup: scheduleId,
                        className: 'schedule-scheduled-marker',
                        title: scheduledMarkerTitle,
                        eventType: 'Schedule Scheduled',
                        scheduleId: scheduleId,
                        playlistId: '',
                        sequenceId: '',
                        stackDepth: 0,
                        scheduleColor,
                        type: 'range',
                        // Add schedule vs actual comparison data
                        scheduledStart,
                        scheduledEnd,
                        actualStart: undefined,
                        actualEnd: undefined,
                        isDelayed: false,
                        delayMinutes: 0,
                    });
                }
            }
        });

        return { items, groups };
    }, [
        data,
        getScheduleName,
        getTimelineItemColor,
        eventTypeConfig,
        isBackgroundSchedule,
        schedules,
        getScheduledTimes,
        simulationStartTime,
        simulationEndTime,
        theme.palette.warning.main,
        theme.palette.error.main,
    ]);

    // Calculate dynamic timeline height based on number of schedule groups
    const timelineHeight = useMemo(() => {
        const minHeight = 200;
        const maxHeight = 600;
        const heightPerGroup = 60; // Reduced from 80 to make it more compact
        const baseHeight = 60; // Reduced from 100 to eliminate extra space below last schedule

        const calculatedHeight = baseHeight + timelineData.groups.length * heightPerGroup;
        return Math.min(maxHeight, Math.max(minHeight, calculatedHeight));
    }, [timelineData.groups.length]);

    // Calculate scroll boundaries based on user selection or data range
    const scrollBoundaries = useMemo(() => {
        let minTime: Date;
        let maxTime: Date;

        if (minScrollTime && maxScrollTime) {
            // Use user-provided scroll boundaries
            minTime = new Date(minScrollTime);
            maxTime = new Date(maxScrollTime);
        } else if (simulationStartTime && simulationEndTime) {
            // Fall back to simulation boundaries
            minTime = new Date(simulationStartTime);
            maxTime = new Date(simulationEndTime);
        } else if (data.length > 0) {
            // Fall back to data boundaries with some padding
            const allTimes = data.map((event) => new Date(event.eventTime));
            const dataMinTime = new Date(Math.min(...allTimes.map((t) => t.getTime())));
            const dataMaxTime = new Date(Math.max(...allTimes.map((t) => t.getTime())));

            // Add 1 hour padding on each side
            minTime = new Date(dataMinTime.getTime() - 3600000);
            maxTime = new Date(dataMaxTime.getTime() + 3600000);
        } else {
            // Default to current day if no data
            const now = new Date();
            minTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            maxTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        }

        return { minTime, maxTime };
    }, [minScrollTime, maxScrollTime, simulationStartTime, simulationEndTime, data]);

    // Initialize timeline
    useEffect(() => {
        if (!timelineRef.current || !timelineData.items.length) return;

        setIsLoading(true);
        setError(null);

        try {
            const container = timelineRef.current;
            const items = new DataSet(timelineData.items);
            const groups = new DataSet(timelineData.groups);

            // Calculate the display range based on user selection
            let displayStart: Date;
            let displayEnd: Date;

            if (simulationStartTime && simulationEndTime) {
                // Use user's selected date range
                displayStart = new Date(simulationStartTime);
                displayEnd = new Date(simulationEndTime);
            } else {
                // Fallback to today's full day range
                const now = new Date();
                displayStart = new Date(now);
                displayStart.setHours(0, 0, 0, 0);
                displayEnd = new Date(now);
                displayEnd.setHours(23, 59, 59, 999);
            }

            const options = {
                stack: false, // Disable stacking completely
                orientation: 'top',
                height: `${timelineHeight}px`,
                zoomable: false,
                moveable: true,
                selectable: true,
                multiselect: false,
                showMajorLabels: true,
                showMinorLabels: true,
                showCurrentTime: true,
                showTooltips: true,
                tooltip: {
                    followMouse: true,
                    overflowMethod: 'flip' as const,
                },
                margin: {
                    item: {
                        horizontal: 1,
                        vertical: 0,
                    },
                },
                stackSubgroups: false,
                verticalScroll: false,
                horizontalScroll: true, // Enable horizontal scrolling
                editable: false,
                // Set initial window to user's selected range
                start: displayStart,
                end: displayEnd,
                // Set scroll boundaries to prevent scrolling beyond user-defined limits
                min: scrollBoundaries.minTime,
                max: scrollBoundaries.maxTime,
                order: (a: any, b: any) => {
                    // Order by start time to ensure chronological placement
                    return new Date(a.start).getTime() - new Date(b.start).getTime();
                },

                itemsAlwaysDraggable: false,
                format: {
                    minorLabels: {
                        millisecond: 'HH:mm:ss.SSS',
                        second: 'HH:mm:ss',
                        minute: 'HH:mm',
                        hour: 'HH:mm',
                        weekday: 'ddd D',
                        week: 'w',
                        day: 'D',
                        month: 'MMM',
                        year: 'YYYY',
                    },
                    majorLabels: {
                        millisecond: 'HH:mm:ss.SSS',
                        second: 'HH:mm:ss',
                        minute: 'ddd D MMMM',
                        hour: 'ddd D MMMM',
                        weekday: 'MMMM YYYY',
                        week: 'MMMM YYYY',
                        day: 'MMMM YYYY',
                        month: 'YYYY',
                        year: '',
                    },
                },
            };

            const timeline = new Timeline(container, items, groups, options);
            timelineInstanceRef.current = timeline;

            // Event handlers
            timeline.on('select', (properties: any) => {
                if (properties.items.length > 0) {
                    const selectedItemData = items.get(properties.items[0]) as unknown as TimelineItem;

                    // Call the onItemClick callback
                    if (onItemClick) {
                        onItemClick(selectedItemData.scheduleId, selectedItemData.playlistId);
                    }

                    // Clear selection immediately to prevent visual selection state
                    timeline.setSelection([]);
                }
            });

            setIsLoading(false);

            // Apply priority and type labels to timeline groups
            const applyPriorityLabels = () => {
                const visLabels = container.querySelectorAll('.vis-label');

                visLabels.forEach((labelElement: any) => {
                    const htmlLabel = labelElement as HTMLElement;

                    // Get the full label text including hidden schedule ID
                    const fullLabelText = htmlLabel.textContent || '';

                    // Extract schedule ID (after zero-width space)
                    const parts = fullLabelText.split('\u200B');
                    const scheduleId = parts.length > 1 ? parts[1] : null;
                    const scheduleName = parts[0];

                    // Always clean up the display first: remove the hidden schedule ID from view
                    const labelContent = htmlLabel.querySelector('.vis-label-content') || htmlLabel;

                    // Find and update all text nodes that contain the schedule ID
                    const updateTextNodes = (node: Node) => {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent) {
                            // If this text node contains the hidden ID, replace it with just the name
                            if (node.textContent.includes('\u200B')) {
                                node.textContent = scheduleName;
                            }
                        } else {
                            // Recursively check child nodes
                            node.childNodes.forEach(updateTextNodes);
                        }
                    };

                    updateTextNodes(labelContent);

                    // Check if we already added the labels
                    if (!htmlLabel.querySelector('.priority-badge') && !htmlLabel.querySelector('.type-badge')) {
                        // Find the group data by schedule ID (this ensures correct matching even with duplicate names)
                        const groupData = scheduleId ? timelineData.groups.find((g) => g.id === scheduleId) : null;

                        if (groupData && (groupData as any).priorityLabel && (groupData as any).priorityClass) {
                            // Create type badge element first (appears before priority badge)
                            if ((groupData as any).typeLabel && (groupData as any).typeClass) {
                                const typeBadge = document.createElement('span');
                                typeBadge.className = `type-badge ${(groupData as any).typeClass}`;
                                typeBadge.textContent = (groupData as any).typeLabel;

                                // Insert the type badge after the existing content
                                const existingContent = htmlLabel.querySelector('.vis-label-content') || htmlLabel;
                                existingContent.appendChild(typeBadge);
                            }

                            // Create priority badge element
                            const priorityBadge = document.createElement('span');
                            priorityBadge.className = `priority-badge ${(groupData as any).priorityClass}`;
                            priorityBadge.textContent = (groupData as any).priorityLabel;

                            // Insert the priority badge after the type badge
                            const existingContent = htmlLabel.querySelector('.vis-label-content') || htmlLabel;
                            existingContent.appendChild(priorityBadge);
                        }
                    }
                });
            };

            // Apply timeline colors using hidden color markers
            const applyTimelineColors = () => {
                const visItems = container.querySelectorAll('.vis-item');

                visItems.forEach((element: any) => {
                    const htmlElement = element as HTMLElement;
                    const itemContent = htmlElement.textContent || '';

                    // Extract color from hidden marker and clean up display text
                    const colorMatch = itemContent.match(/\|(#[a-fA-F0-9]{6})/);
                    if (colorMatch) {
                        const color = colorMatch[1];

                        // Clean up the display text by removing the color marker
                        const cleanContent = itemContent.replace(/\|#[a-fA-F0-9]{6}/, '');
                        if (htmlElement.querySelector('.vis-item-content')) {
                            const contentEl = htmlElement.querySelector('.vis-item-content') as HTMLElement;
                            contentEl.textContent = cleanContent;
                        }

                        // Check schedule type and state
                        const isBackgroundSchedule = htmlElement.classList.contains('schedule-background');
                        const isSuspended = htmlElement.classList.contains('schedule-suspended');
                        const isScheduledOnly = htmlElement.classList.contains('schedule-scheduled-only');
                        const isScheduledMarker = htmlElement.classList.contains('schedule-scheduled-marker');

                        if (isScheduledOnly || isScheduledMarker) {
                            // For scheduled-only items: let CSS handle the styling completely
                            // These are thin dashed lines showing scheduled times
                            return;
                        } else if (isBackgroundSchedule) {
                            // For background schedules: use info color styling
                            htmlElement.style.setProperty('border-color', theme.palette.info.dark, 'important');
                            htmlElement.style.setProperty('border-width', '3px', 'important');
                            htmlElement.style.setProperty('color', 'white', 'important');

                            // Background schedules always use solid borders (no dashed borders for suspended state)
                            htmlElement.style.setProperty('border-style', 'solid', 'important');
                        } else {
                            // For regular schedules: apply priority color as background
                            htmlElement.style.setProperty('background-color', color, 'important');
                            htmlElement.style.setProperty('border-color', color, 'important');
                            htmlElement.style.setProperty('border-width', '2px', 'important');
                            htmlElement.style.setProperty('color', 'white', 'important');

                            // If suspended, let CSS handle the dashed border and opacity
                            if (isSuspended) {
                                htmlElement.style.setProperty('border-style', 'dashed', 'important');
                            }
                        }

                        // Apply to child content elements
                        const contentElements = htmlElement.querySelectorAll('.vis-item-content');
                        contentElements.forEach((contentEl: any) => {
                            if (isScheduledOnly || isScheduledMarker) {
                                // For scheduled-only items: let CSS handle the styling completely
                                return;
                            } else if (isBackgroundSchedule) {
                                // For background schedules: apply info color styling
                                contentEl.style.setProperty('border-color', theme.palette.info.dark, 'important');
                                contentEl.style.setProperty('color', 'white', 'important');
                            } else {
                                // For regular schedules: apply full priority color styling
                                contentEl.style.setProperty('background-color', color, 'important');
                                contentEl.style.setProperty('border-color', color, 'important');
                                contentEl.style.setProperty('color', 'white', 'important');
                            }
                        });
                    }
                });
            };

            // Apply colors and labels immediately and also set up periodic reapplication
            setTimeout(() => {
                applyTimelineColors();
                applyPriorityLabels();
            }, 100);
            setTimeout(() => {
                applyTimelineColors();
                applyPriorityLabels();
            }, 500);
            setTimeout(() => {
                applyTimelineColors();
                applyPriorityLabels();
            }, 1000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to initialize timeline');
            setIsLoading(false);
        }

        return () => {
            if (timelineInstanceRef.current) {
                timelineInstanceRef.current.destroy();
                timelineInstanceRef.current = null;
            }
        };
    }, [timelineData, eventTypeConfig, timelineHeight, theme, onItemClick]);

    // Helper function to set full range view based on user selection
    const setFullRangeView = useCallback(
        (animate: boolean = false) => {
            if (timelineInstanceRef.current) {
                let displayStart: Date;
                let displayEnd: Date;

                if (simulationStartTime && simulationEndTime) {
                    // Use user's selected date range
                    displayStart = new Date(simulationStartTime);
                    displayEnd = new Date(simulationEndTime);
                } else {
                    // Fallback to today's full day range
                    const now = new Date();
                    displayStart = new Date(now);
                    displayStart.setHours(0, 0, 0, 0);
                    displayEnd = new Date(now);
                    displayEnd.setHours(23, 59, 59, 999);
                }

                timelineInstanceRef.current.setWindow(displayStart, displayEnd, { animation: animate });
            }
        },
        [simulationStartTime, simulationEndTime],
    );

    // Zoom controls
    const handleZoomIn = useCallback(() => {
        if (timelineInstanceRef.current) {
            timelineInstanceRef.current.moveTo(new Date());
            timelineInstanceRef.current.zoomIn(0.5);
            setZoomLevel((prev) => Math.min(prev + 0.5, 3));
        }
    }, []);

    const handleZoomOut = useCallback(() => {
        if (timelineInstanceRef.current) {
            timelineInstanceRef.current.zoomOut(0.5);
            setZoomLevel((prev) => Math.max(prev - 0.5, 0.1));
        }
    }, []);

    const handleFitScreen = useCallback(() => {
        setFullRangeView(true);
        setZoomLevel(1);
    }, [setFullRangeView]);

    const handleRefresh = useCallback(() => {
        setFullRangeView(true);
        setZoomLevel(1);
    }, [setFullRangeView]);

    if (!data.length) {
        return (
            <Card className={className} sx={{ mb: 1 }}>
                <CardContent sx={{ py: 2, '&:last-child': { pb: 0 } }}>
                    <Typography variant="body2" color="text.secondary">
                        No timeline data available for the selected date range.
                    </Typography>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <Card
                className={className}
                sx={{ mb: 0, backgroundColor: 'background.paper', boxShadow: (theme: Theme) => theme.shadows[2] }}
            >
                <CardContent sx={{ py: 2, '&:last-child': { pb: 1 } }}>
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            mb: 2,
                            flexWrap: 'wrap',
                            gap: 1.5,
                        }}
                    >
                        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                            Schedule Timeline
                        </Typography>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                            <Tooltip title="Zoom In" arrow>
                                <IconButton onClick={handleZoomIn} size="small" color="primary" disabled={isLoading}>
                                    <ZoomIn />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Zoom Out" arrow>
                                <IconButton onClick={handleZoomOut} size="small" color="primary" disabled={isLoading}>
                                    <ZoomOut />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Fit to Screen" arrow>
                                <IconButton onClick={handleFitScreen} size="small" color="primary" disabled={isLoading}>
                                    <FitScreen />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Refresh Timeline" arrow>
                                <IconButton onClick={handleRefresh} size="small" color="primary" disabled={isLoading}>
                                    <Refresh />
                                </IconButton>
                            </Tooltip>
                            <Chip
                                label={`Zoom: ${Math.round(zoomLevel * 100)}%`}
                                size="small"
                                color="secondary"
                                variant="outlined"
                                sx={{
                                    height: '32px',
                                    alignSelf: 'center',
                                }}
                            />
                        </Stack>
                    </Box>

                    {error && (
                        <Box
                            sx={{
                                mb: 1.5,
                                p: 1.5,
                                backgroundColor: 'error.light',
                                color: 'error.contrastText',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'error.main',
                            }}
                        >
                            <Typography variant="body2" color="error">
                                {error}
                            </Typography>
                        </Box>
                    )}

                    {isLoading && (
                        <Box
                            sx={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                height: `${timelineHeight}px`,
                            }}
                        >
                            <CircularProgress />
                        </Box>
                    )}

                    <Box
                        sx={{
                            position: 'relative',
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            overflow: 'hidden',
                            opacity: isLoading ? 0.5 : 1,
                            marginBottom: 0,
                            paddingBottom: 0,
                        }}
                    >
                        <div
                            ref={timelineRef}
                            style={{ width: '100%', height: `${timelineHeight}px`, textAlign: 'left' }}
                            role="region"
                            aria-label="Schedule Timeline"
                        />
                    </Box>
                </CardContent>
            </Card>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
          .timeline-item {
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .timeline-bar {
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 600;
            color: ${theme.palette.common.white};
            box-shadow: ${theme.shadows[2]};
            min-height: 32px;
            display: flex;
            align-items: center;
            width: 100%;
          }

          /* Force our timeline item colors to override any default vis.js styling */
          .vis-item.vis-range {
            background-color: inherit !important;
            border-color: inherit !important;
          }

          .vis-item {
            background-color: inherit !important;
            border-color: inherit !important;
          }

          .vis-item .vis-item-content {
            background-color: inherit !important;
            border-color: inherit !important;
          }

          /* Override any vis.js default background colors */
          .vis-item.vis-range .vis-item-content {
            background-color: inherit !important;
            border-color: inherit !important;
          }

          /* Specific overrides for timeline bars */
          .timeline-bar {
            background-color: inherit !important;
            border-color: inherit !important;
          }

          .timeline-bar:hover {
            transform: translateY(-1px);
            box-shadow: ${theme.shadows[4]};
            filter: brightness(1.1);
          }

          .timeline-bar:focus {
            outline: 2px solid ${theme.palette.primary.main};
            outline-offset: 2px;
          }

          .timeline-bar-content {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            gap: 8px;
          }

          .timeline-bar-text {
            font-weight: 600;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
          }

          .timeline-suspended-indicator {
            font-size: 16px;
            flex-shrink: 0;
            opacity: 0.9;
          }

          .timeline-interruption-indicator {
            font-size: 16px;
            flex-shrink: 0;
            opacity: 0.9;
          }

          .schedule-interruption {
            background: repeating-linear-gradient(45deg, #9e9e9e, #9e9e9e 6px, #bdbdbd 6px, #bdbdbd 12px) !important;
            border: 1px solid #757575 !important;
            border-radius: 6px !important;
            height: 8px !important;
            min-height: 8px !important;
            max-height: 8px !important;
          }

          /* Schedule vs Actual comparison styling */
          .schedule-scheduled-only {
            background: repeating-linear-gradient(90deg, #f5f5f5, #f5f5f5 4px, #e0e0e0 4px, #e0e0e0 8px) !important;
            border: 2px dashed #9e9e9e !important;
            border-radius: 6px !important;
            opacity: 0.7 !important;
            height: 8px !important;
            min-height: 8px !important;
            max-height: 8px !important;
          }

          .schedule-scheduled-only .vis-item-content {
            background: repeating-linear-gradient(90deg, #f5f5f5, #f5f5f5 4px, #e0e0e0 4px, #e0e0e0 8px) !important;
            border: 2px dashed #9e9e9e !important;
            border-radius: 6px !important;
            opacity: 0.7 !important;
            height: 8px !important;
            min-height: 8px !important;
            max-height: 8px !important;
          }

          .schedule-scheduled-marker {
            background: repeating-linear-gradient(90deg, #f5f5f5, #f5f5f5 4px, #e0e0e0 4px, #e0e0e0 8px) !important;
            border: 2px dashed #9e9e9e !important;
            border-radius: 6px !important;
            opacity: 0.5 !important;
            height: 6px !important;
            min-height: 6px !important;
            max-height: 6px !important;
            z-index: 1 !important;
          }

          .schedule-scheduled-marker .vis-item-content {
            background: repeating-linear-gradient(90deg, #f5f5f5, #f5f5f5 4px, #e0e0e0 4px, #e0e0e0 8px) !important;
            border: 2px dashed #9e9e9e !important;
            border-radius: 6px !important;
            opacity: 0.5 !important;
            height: 6px !important;
            min-height: 6px !important;
            max-height: 6px !important;
          }

          /* Text styling for scheduled markers */
          .schedule-scheduled-only .vis-item-content,
          .schedule-scheduled-marker .vis-item-content {
            color: #666 !important;
            font-size: 10px !important;
            font-style: italic !important;
            text-align: center !important;
            line-height: 6px !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* Delayed schedule styling */
          .schedule-delayed {
            border-left: 4px solid ${theme.palette.warning.main} !important;
            border-right: 4px solid ${theme.palette.warning.main} !important;
          }

          .schedule-delayed .vis-item-content {
            border-left: 4px solid ${theme.palette.warning.main} !important;
            border-right: 4px solid ${theme.palette.warning.main} !important;
          }

          .schedule-interruption .timeline-bar-text {
            color: ${theme.palette.getContrastText('#9e9e9e')} !important;
            font-style: italic;
            font-size: 11px !important;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .schedule-interruption .vis-item-content {
            height: 8px !important;
            min-height: 8px !important;
            max-height: 8px !important;
          }

          /* Background schedule styling - applies to all background schedules regardless of state */
          .schedule-background {
            background: ${theme.palette.info.main} !important;
            border: 3px solid ${theme.palette.info.dark} !important;
            border-radius: 6px !important;
            opacity: 0.95 !important;
            position: relative !important;
          }

          .schedule-background .timeline-bar-text {
            color: ${theme.palette.info.contrastText} !important;
            font-style: italic;
            font-weight: 600 !important;
            text-shadow: none !important;
          }

          /* Ensure background schedules maintain their styling in all states */
          .vis-item.schedule-background {
            background: ${theme.palette.info.main} !important;
            background-color: ${theme.palette.info.main} !important;
          }

          .vis-item.schedule-background .vis-item-content {
            background: ${theme.palette.info.main} !important;
            background-color: ${theme.palette.info.main} !important;
          }

          /* Suspended styling for main schedules only (background schedules don't get this class) */
          .schedule-suspended {
            border-style: dashed !important;
            opacity: 0.8 !important;
          }

          .schedule-suspended .vis-item-content {
            opacity: 0.8 !important;
          }

          /* Force all items to same level - no stacking */
          .vis-item {
            top: 5px !important;
            opacity: 1 !important;
          }


          /* Ensure main timeline items maintain full opacity */
          .vis-item.vis-range {
            opacity: 1 !important;
          }

          .vis-item.vis-range .vis-item-content {
            opacity: 1 !important;
          }

          /* Ensure main schedule items (not background, not suspended) maintain full opacity */
          .vis-item:not(.schedule-background):not(.schedule-suspended):not(.schedule-interruption):not(.schedule-scheduled-only):not(.schedule-scheduled-marker) {
            opacity: 1 !important;
          }

          .vis-item:not(.schedule-background):not(.schedule-suspended):not(.schedule-interruption):not(.schedule-scheduled-only):not(.schedule-scheduled-marker) .vis-item-content {
            opacity: 1 !important;
          }

          /* Force main timeline items to full opacity regardless of inheritance */
          .vis-item.vis-range:not(.schedule-background):not(.schedule-suspended):not(.schedule-interruption):not(.schedule-scheduled-only):not(.schedule-scheduled-marker) {
            opacity: 1 !important;
            background-color: inherit !important;
          }

          .vis-item.vis-range:not(.schedule-background):not(.schedule-suspended):not(.schedule-interruption):not(.schedule-scheduled-only):not(.schedule-scheduled-marker) .vis-item-content {
            opacity: 1 !important;
            background-color: inherit !important;
          }
          
          .vis-item.schedule-interruption {
            top: 5px !important;
            z-index: 1 !important;
            opacity: 0.9 !important;
          }

          /* Schedule vs actual comparison positioning - keep these at different levels for visual distinction */
          .vis-item.schedule-scheduled-only {
            top: 15px !important;
            z-index: 0 !important;
            opacity: 0.7 !important;
          }

          .vis-item.schedule-scheduled-marker {
            top: 20px !important;
            z-index: 0 !important;
            opacity: 0.5 !important;
          }

          /* Ensure items within same group stay on same line */
          .vis-group .vis-item {
            position: absolute !important;
            top: 5px !important;
          }

          /* Ensure no background transparency issues */
          .vis-panel.vis-background {
            opacity: 1 !important;
          }

          .vis-panel.vis-center {
            opacity: 1 !important;
          }

          .schedule-group {
            background-color: ${alpha(theme.palette.background.paper, 0.9)};
            color: ${theme.palette.text.primary};
            font-weight: 600;
            // padding: 8px 12px;
          }

          /* Background schedule group styling */
          .schedule-background-group {
            color: ${theme.palette.info.dark} !important;
            font-weight: 700 !important;
          }

          /* Main schedule group styling based on priority */
          .schedule-main-high-priority {
            color: ${theme.palette.error.dark} !important;
            font-weight: 700 !important;
          }

          .schedule-main-normal-priority {
            color: ${theme.palette.primary.dark} !important;
            font-weight: 700 !important;
          }

          .schedule-main-low-priority {
            color: ${theme.palette.info.dark} !important;
            font-weight: 700 !important;
          }

          .vis-item.vis-box {
            text-align: left !important;
            cursor: pointer !important;
          }

          .vis-item .vis-item-content {
            text-align: left !important;
          }

          .vis-item.vis-range {
            cursor: pointer !important;
          }

          .vis-timeline {
            border: 1px solid ${theme.palette.divider} !important;
            background-color: ${theme.palette.background.paper} !important;
            font-family: ${theme.typography.fontFamily} !important;
            padding-bottom: 0 !important;
            margin-bottom: 0 !important;
          }

          .vis-panel.vis-background {
            background-color: ${theme.palette.background.paper} !important;
          }

          .vis-panel.vis-left {
            background-color: ${theme.palette.background.default} !important;
            border-right: 1px solid ${theme.palette.divider} !important;
          }

          .vis-labelset .vis-label {
            color: ${theme.palette.text.primary} !important;
            background-color: ${theme.palette.background.default} !important;
            border-bottom: 1px solid ${theme.palette.divider} !important;
            font-weight: 600 !important;
            padding: 4px 8px !important;
            text-align: left !important;
            display: flex !important;
            align-items: center !important;
            justify-content: flex-start !important;
            position: relative !important;
            margin-bottom: 0 !important;
          }

          .vis-labelset .vis-label .schedule-group {
            margin: 0 !important;
            width: 100% !important;
            height: 100% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 8px 12px !important;
            padding-bottom: 0 !important;
            margin-bottom: 0 !important;
            border-radius: 4px !important;
            font-size: 14px !important;
            letter-spacing: 0.3px !important;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1) !important;
            transition: all 0.2s ease !important;
          }

          /* Hover effects for schedule labels */
          .vis-labelset .vis-label:hover .schedule-group {
            transform: translateX(2px) !important;
            box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15) !important;
          }

          /* Apply color coding to schedule group labels */
          .vis-labelset .vis-label .schedule-background-group {
            color: ${theme.palette.info.dark} !important;
            font-weight: 700 !important;
            background-color: ${alpha(theme.palette.info.light, 0.1)} !important;
            position: relative !important;
          }

          .vis-labelset .vis-label .schedule-main-high-priority {
            color: ${theme.palette.error.dark} !important;
            font-weight: 700 !important;
            background-color: ${alpha(theme.palette.error.light, 0.1)} !important;
            position: relative !important;
          }

          .vis-labelset .vis-label .schedule-main-normal-priority {
            color: ${theme.palette.primary.dark} !important;
            font-weight: 700 !important;
            background-color: ${alpha(theme.palette.primary.light, 0.1)} !important;
            position: relative !important;
          }

          .vis-labelset .vis-label .schedule-main-low-priority {
            color: ${theme.palette.info.dark} !important;
            font-weight: 700 !important;
            background-color: ${alpha(theme.palette.info.light, 0.1)} !important;
            position: relative !important;
          }

          /* Priority badge styling */
          .priority-badge {
            display: inline-block !important;
            font-size: 10px !important;
            font-weight: 700 !important;
            padding: 3px 8px !important;
            border-radius: 12px !important;
            margin-left: 8px !important;
            text-transform: none !important;
            letter-spacing: 0.3px !important;
            opacity: 0.9 !important;
            min-width: auto !important;
            text-align: center !important;
            line-height: 1.2 !important;
            vertical-align: middle !important;
            white-space: nowrap !important;
          }

          /* High priority badge styling */
          .priority-high {
            background-color: ${theme.palette.error.main} !important;
            color: ${theme.palette.error.contrastText} !important;
            border: 1px solid ${theme.palette.error.dark} !important;
          }

          /* Normal priority badge styling */
          .priority-normal {
            background-color: ${theme.palette.primary.main} !important;
            color: ${theme.palette.primary.contrastText} !important;
            border: 1px solid ${theme.palette.primary.dark} !important;
          }

          /* Low priority badge styling */
          .priority-low {
            background-color: ${theme.palette.info.main} !important;
            color: ${theme.palette.info.contrastText} !important;
            border: 1px solid ${theme.palette.info.dark} !important;
          }

          /* Background schedule badge styling */
          .priority-bg {
            background-color: ${theme.palette.info.main} !important;
            color: ${theme.palette.info.contrastText} !important;
            border: 1px solid ${theme.palette.info.dark} !important;
          }

          /* Type badge styling */
          .type-badge {
            display: inline-block !important;
            font-size: 9px !important;
            font-weight: 600 !important;
            padding: 2px 6px !important;
            border-radius: 8px !important;
            margin-right: 6px !important;
            text-transform: none !important;
            letter-spacing: 0.2px !important;
            opacity: 0.85 !important;
            min-width: auto !important;
            text-align: center !important;
            line-height: 1.2 !important;
            vertical-align: middle !important;
            white-space: nowrap !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15) !important;
          }

          /* Main schedule type badge */
          .type-main {
            background-color: ${theme.palette.primary.light} !important;
            color: ${theme.palette.primary.dark} !important;
            border: 1px solid ${theme.palette.primary.main} !important;
          }

          /* Background schedule type badge */
          .type-bg {
            background-color: ${theme.palette.info.light} !important;
            color: ${theme.palette.info.dark} !important;
            border: 1px solid ${theme.palette.info.main} !important;
          }

          /* Ensure badges are visible and properly styled */
          .priority-badge {
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
            font-family: ${theme.typography.fontFamily} !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
          }

          /* Make sure the schedule name and badges are properly spaced */
          .schedule-group {
            gap: 4px !important;
            flex-wrap: nowrap !important;
          }

          /* Ensure the schedule name takes up most of the space */
          .schedule-name {
            flex: 1 !important;
            min-width: 0 !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            white-space: nowrap !important;
            margin-right: 8px !important;
          }

          /* Ensure the type badge is properly positioned */
          .type-badge {
            flex-shrink: 0 !important;
            margin-right: 2px !important;
          }

          /* Ensure the priority badge is properly positioned */
          .priority-badge {
            flex-shrink: 0 !important;
            margin-left: 2px !important;
          }

          .vis-time-axis .vis-text {
            color: ${theme.palette.text.primary} !important;
            font-weight: 500 !important;
          }

          .vis-time-axis .vis-text.vis-major {
            color: ${theme.palette.text.primary} !important;
            font-weight: 600 !important;
          }

          .vis-time-axis .vis-text.vis-minor {
            color: ${theme.palette.text.secondary} !important;
          }

          .vis-time-axis .vis-grid.vis-minor {
            border-left: 1px solid ${alpha(theme.palette.divider, 0.3)} !important;
          }

          .vis-time-axis .vis-grid.vis-major {
            border-left: 1px solid ${theme.palette.divider} !important;
          }

          /* Current time marker styling */
          .vis-current-time {
            background-color: ${theme.palette.primary.main} !important;
            width: 2px !important;
            z-index: 10 !important;
            pointer-events: none !important;
          }

          /* Add a small circle at the top of the current time marker */
          .vis-current-time::before {
            content: '';
            position: absolute;
            top: 0;
            left: -4px;
            width: 10px;
            height: 10px;
            background-color: ${theme.palette.primary.main};
            border-radius: 50%;
            box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
          }

          /* Timeline content area */
          .vis-panel.vis-center {
            background-color: ${theme.palette.background.paper} !important;
            padding-bottom: 0 !important;
            margin-bottom: 0 !important;
          }



          /* Hover effects */
          .vis-item:hover {
            filter: brightness(1.1) !important;
          }



          /* Selection effects */
          .vis-item.vis-selected {
            border-color: ${theme.palette.primary.main} !important;
            box-shadow: 0 0 0 2px ${alpha(theme.palette.primary.main, 0.3)} !important;
          }

          /* Timeline navigation */
          .vis-navigation {
            background-color: ${theme.palette.background.default} !important;
            border-color: ${theme.palette.divider} !important;
          }

          /* Custom scrollbar */
          .vis-timeline::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }

          .vis-timeline::-webkit-scrollbar-track {
            background: ${theme.palette.background.default};
            border-radius: 4px;
          }

          .vis-timeline::-webkit-scrollbar-thumb {
            background: ${theme.palette.action.disabled};
            border-radius: 4px;
          }

          .vis-timeline::-webkit-scrollbar-thumb:hover {
            background: ${theme.palette.action.hover};
          }

        `,
                }}
            />
        </>
    );
};

export default TimelineBySchedule;
