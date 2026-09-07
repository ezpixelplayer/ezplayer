import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Timeline } from 'vis-timeline/standalone';
import { DataSet } from 'vis-data';
import { format } from 'date-fns';
import { useSelector } from 'react-redux';
import { RootState } from '../../store/Store';
import { priorityToNumber, type PlaybackLogDetail, type ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { formatDateStandard } from '../../util/dateUtils';
import { Card, CardContent, Typography, Chip, Stack, Tooltip, IconButton, useTheme, Theme } from '@mui/material';
import { Box } from '../box/Box';
import { ZoomIn, ZoomOut, FitScreen, Refresh } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';

interface TimelineByScheduleProps {
    data: PlaybackLogDetail[];
    className?: string;
    onItemClick?: (scheduleId?: string, playlistId?: string) => void;
    simulationStartTime?: number;
    simulationEndTime?: number;
    // Horizontal scroll limits
    minScrollTime?: Date | number;
    maxScrollTime?: Date | number;
}

interface TimelineItem {
    id: string;
    content: string;
    start: Date;
    end: Date;
    group: string;
    className: string;
    title: string;
    type: 'range';
    /** Inline CSS applied by vis to the item box (priority color for main schedules) */
    style?: string;
    eventType: string;
    scheduleId: string;
    playlistId?: string;
    sequenceId?: string;
    stackDepth: number;
    // Schedule vs actual comparison
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
    /** Schedule title (rendered via groupTemplate, so it is never interpreted as HTML) */
    content: string;
    className: string;
    typeLabel: string;
    typeClass: string;
    priorityLabel: string;
    priorityClass: string;
}

type Priority = 'high' | 'normal' | 'low';

interface TimelinePalette {
    high: string;
    normal: string;
    low: string;
    background: string;
}

const SCHEDULE_EVENT_TYPES = new Set<string>([
    'Schedule Started',
    'Schedule Ended',
    'Schedule Stopped',
    'Schedule Suspended',
    'Schedule Resumed',
    'Schedule Deferred',
    'Schedule Prevented',
]);

const PRIORITY_LABEL: Record<Priority, string> = {
    high: 'High Priority',
    normal: 'Normal Priority',
    low: 'Low Priority',
};

const toPriority = (p: string | undefined): Priority => (p === 'high' || p === 'low' ? p : 'normal');

/** Parse "HH:mm[:ss]" relative to a base date, allowing extended hours (25:00 = 01:00 next day). */
function parseExtendedTime(baseDate: Date, timeString: string): Date {
    const [hours, minutes, seconds = 0] = timeString.split(':').map(Number);
    const result = new Date(baseDate);
    result.setDate(result.getDate() + Math.floor(hours / 24));
    result.setHours(hours % 24, minutes, seconds, 0);
    return result;
}

/** Tooltip lines comparing a scheduled start with what actually happened. */
function timingLines(scheduledStart: Date | undefined, actualStart: Date): string {
    if (!scheduledStart) return '';
    const delayMinutes = Math.round((actualStart.getTime() - scheduledStart.getTime()) / 60000);
    let text = `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')}`;
    text += `\nActual: ${format(actualStart, 'HH:mm:ss')}`;
    if (delayMinutes > 0) text += `\nDelay: ${delayMinutes} minutes`;
    else if (delayMinutes < 0) text += `\nEarly: ${Math.abs(delayMinutes)} minutes`;
    else text += `\nOn Time`;
    return text;
}

/**
 * Turn the simulation log into vis-timeline items (one row per schedule).
 * Pure so it can be memoized on its inputs.
 */
function buildTimelineData(
    data: PlaybackLogDetail[],
    schedules: ScheduledPlaylist[],
    palette: TimelinePalette,
    simulationEndTime?: number,
): { items: TimelineItem[]; groups: TimelineGroup[] } {
    const items: TimelineItem[] = [];
    const groups: TimelineGroup[] = [];

    const scheduleEvents = data.filter((event) => event.scheduleId && SCHEDULE_EVENT_TYPES.has(event.eventType));
    if (!scheduleEvents.length) return { items, groups };

    const scheduleById = new Map(schedules.map((s) => [s.id, s]));
    const nameOf = (id: string) => scheduleById.get(id)?.title || `Schedule ${id.slice(0, 8)}`;
    const priorityOf = (id: string) => toPriority(scheduleById.get(id)?.priority);
    const isBackground = (id: string) => scheduleById.get(id)?.scheduleType === 'background';
    const colorOf = (id: string) => (isBackground(id) ? palette.background : palette[priorityOf(id)]);
    const scheduledTimesOf = (id: string) => {
        const schedule = scheduleById.get(id);
        if (!schedule) return { scheduledStart: undefined, scheduledEnd: undefined };
        const baseDate = new Date(schedule.date);
        return {
            scheduledStart: parseExtendedTime(baseDate, schedule.fromTime),
            scheduledEnd: parseExtendedTime(baseDate, schedule.toTime),
        };
    };

    // Group events by schedule to track each schedule's lifecycle
    const scheduleEventMap = new Map<string, PlaybackLogDetail[]>();
    scheduleEvents.forEach((event) => {
        const list = scheduleEventMap.get(event.scheduleId!) ?? [];
        list.push(event);
        scheduleEventMap.set(event.scheduleId!, list);
    });

    scheduleEventMap.forEach((events, scheduleId) => {
        events.sort((a, b) => a.eventTime - b.eventTime);

        const scheduleName = nameOf(scheduleId);
        const background = isBackground(scheduleId);
        const color = colorOf(scheduleId);
        const { scheduledStart, scheduledEnd } = scheduledTimesOf(scheduleId);
        // Background schedules are colored by CSS; main schedules carry their priority color inline.
        const barStyle = background ? undefined : `background-color: ${color}; border-color: ${color};`;

        let currentSegmentStart: Date | null = null;
        let lastSuspendTime: Date | null = null;
        let segmentCounter = 0;

        const pushSegment = (
            start: Date,
            end: Date,
            status: 'Completed' | 'Suspended' | 'Running',
            event?: PlaybackLogDetail,
        ) => {
            const suspended = status === 'Suspended';
            const cutOff = status === 'Running' && !!simulationEndTime && end.getTime() === simulationEndTime;
            let title = `${scheduleName}`;
            title += `\n${format(start, 'HH:mm:ss')} - ${status === 'Running' && !cutOff ? '(ongoing)' : format(end, 'HH:mm:ss')}`;
            title += `\nDate: ${formatDateStandard(start)}`;
            title += suspended ? `\nStatus: Suspended (interrupted by higher priority)` : `\nStatus: ${status}`;
            if (cutOff) title += `\nCut off by simulation end time`;
            title += timingLines(scheduledStart, start);

            let className = background ? 'schedule-background' : 'schedule-started';
            // Background schedules keep solid borders even when suspended
            if (suspended && !background) className += ' schedule-suspended';

            const delayMinutes = scheduledStart ? Math.round((start.getTime() - scheduledStart.getTime()) / 60000) : 0;
            items.push({
                id: `${scheduleId}-segment-${segmentCounter++}`,
                content: scheduleName,
                start,
                end,
                group: scheduleId,
                className,
                title,
                type: 'range',
                style: barStyle,
                eventType: suspended ? 'Schedule Suspended' : 'Schedule Started',
                scheduleId,
                playlistId: event?.playlistId ?? '',
                sequenceId: event?.sequenceId ?? '',
                stackDepth: event?.stackDepth ?? 0,
                scheduledStart,
                scheduledEnd,
                actualStart: start,
                actualEnd: end,
                isDelayed: scheduledStart ? start > scheduledStart : false,
                delayMinutes,
            });
        };

        events.forEach((event) => {
            const eventTime = new Date(event.eventTime);

            if (event.eventType === 'Schedule Started') {
                currentSegmentStart = eventTime;
            } else if (event.eventType === 'Schedule Resumed') {
                if (lastSuspendTime) {
                    // Show the gap while a higher-priority schedule ran
                    let title = `${scheduleName} - Interruption Period`;
                    title += `\n${format(lastSuspendTime, 'HH:mm:ss')} - ${format(eventTime, 'HH:mm:ss')}`;
                    title += `\nDate: ${formatDateStandard(eventTime)}`;
                    title += `\nStatus: Interrupted by higher priority schedule`;
                    items.push({
                        id: `${scheduleId}-interruption-${segmentCounter++}`,
                        content: 'Interruption',
                        start: lastSuspendTime,
                        end: eventTime,
                        group: scheduleId,
                        className: 'schedule-interruption',
                        title,
                        type: 'range',
                        eventType: 'Schedule Interruption',
                        scheduleId,
                        playlistId: event.playlistId,
                        sequenceId: event.sequenceId,
                        stackDepth: event.stackDepth,
                    });
                }
                currentSegmentStart = eventTime;
                lastSuspendTime = null;
            } else if (
                (event.eventType === 'Schedule Ended' ||
                    event.eventType === 'Schedule Stopped' ||
                    event.eventType === 'Schedule Suspended') &&
                currentSegmentStart
            ) {
                const suspended = event.eventType === 'Schedule Suspended';
                pushSegment(currentSegmentStart, eventTime, suspended ? 'Suspended' : 'Completed', event);
                if (suspended) {
                    lastSuspendTime = eventTime;
                } else {
                    currentSegmentStart = null;
                    lastSuspendTime = null;
                }
            }
        });

        // Started but never ended within the log: runs to the simulation end (or 1h fallback)
        if (currentSegmentStart) {
            const startTime: Date = currentSegmentStart;
            const end = simulationEndTime ? new Date(simulationEndTime) : new Date(startTime.getTime() + 3600000);
            pushSegment(startTime, end, 'Running');
        }

        // Scheduled-time marker for comparison against what actually ran
        if (scheduledStart && scheduledEnd) {
            const ran = items.some((item) => item.scheduleId === scheduleId && item.actualStart && item.actualEnd);
            let title = `${scheduleName} - ${ran ? 'Scheduled Time' : 'Scheduled Only'}`;
            title += `\nScheduled: ${format(scheduledStart, 'HH:mm:ss')} - ${format(scheduledEnd, 'HH:mm:ss')}`;
            title += `\nDate: ${formatDateStandard(scheduledStart)}`;
            if (!ran) title += `\nStatus: Never Executed`;
            items.push({
                id: `${scheduleId}-${ran ? 'scheduled-marker' : 'scheduled-only'}`,
                content: `${scheduleName} (Scheduled)`,
                start: scheduledStart,
                end: scheduledEnd,
                group: scheduleId,
                className: ran ? 'schedule-scheduled-marker' : 'schedule-scheduled-only',
                title,
                type: 'range',
                eventType: 'Schedule Scheduled',
                scheduleId,
                playlistId: '',
                sequenceId: '',
                stackDepth: 0,
                scheduledStart,
                scheduledEnd,
                isDelayed: false,
                isMissed: !ran,
                delayMinutes: 0,
            });
        }
    });

    // One row per schedule that produced something to draw. (A schedule that only
    // appears in Deferred/Prevented events with no known scheduled time has no bar,
    // and an empty row would just be confusing.)
    const rowIds = Array.from(new Set(items.map((item) => item.scheduleId)));

    // Background schedules first, then by priority (high first), then by name
    rowIds.sort((a, b) => {
        const bgA = isBackground(a);
        const bgB = isBackground(b);
        if (bgA !== bgB) return bgA ? -1 : 1;
        const pA = priorityToNumber[priorityOf(a)] ?? priorityToNumber.normal;
        const pB = priorityToNumber[priorityOf(b)] ?? priorityToNumber.normal;
        if (pA !== pB) return pB - pA;
        return nameOf(a).localeCompare(nameOf(b));
    });

    rowIds.forEach((scheduleId) => {
        const background = isBackground(scheduleId);
        const priority = priorityOf(scheduleId);
        groups.push({
            id: scheduleId,
            content: nameOf(scheduleId),
            className: background ? 'schedule-background-group' : `schedule-main-${priority}-priority`,
            typeLabel: background ? 'Background' : 'Main',
            typeClass: background ? 'type-bg' : 'type-main',
            priorityLabel: PRIORITY_LABEL[priority],
            priorityClass: `priority-${priority}`,
        });
    });

    return { items, groups };
}

/** Group label: name + type badge + priority badge, built as DOM so titles are never parsed as HTML. */
function groupTemplate(group?: TimelineGroup): HTMLElement | string {
    const root = document.createElement('div');
    root.className = 'schedule-group-label';
    if (!group) return root;

    const name = document.createElement('span');
    name.className = 'schedule-name';
    name.textContent = group.content;
    root.appendChild(name);

    const typeBadge = document.createElement('span');
    typeBadge.className = `type-badge ${group.typeClass}`;
    typeBadge.textContent = group.typeLabel;
    root.appendChild(typeBadge);

    const priorityBadge = document.createElement('span');
    priorityBadge.className = `priority-badge ${group.priorityClass}`;
    priorityBadge.textContent = group.priorityLabel;
    root.appendChild(priorityBadge);

    return root;
}

function itemTemplate(item?: TimelineItem): HTMLElement | string {
    const el = document.createElement('span');
    el.className = 'schedule-item-label';
    el.textContent = item?.content ?? '';
    return el;
}

const dayWindow = (): { start: Date; end: Date } => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const TimelineBySchedule: React.FC<TimelineByScheduleProps> = ({
    data,
    className = '',
    onItemClick,
    simulationStartTime,
    simulationEndTime,
    minScrollTime,
    maxScrollTime,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<Timeline | null>(null);
    const datasetsRef = useRef<{ items: DataSet<TimelineItem>; groups: DataSet<TimelineGroup> } | null>(null);
    if (!datasetsRef.current) {
        datasetsRef.current = { items: new DataSet<TimelineItem>(), groups: new DataSet<TimelineGroup>() };
    }
    // Latest click handler without making it a reason to rebuild the timeline
    const onItemClickRef = useRef(onItemClick);
    onItemClickRef.current = onItemClick;

    const [zoomLevel, setZoomLevel] = useState(1);
    const [error, setError] = useState<string | null>(null);

    const theme = useTheme();
    const schedules = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);

    const palette = useMemo<TimelinePalette>(
        () => ({
            high: theme.palette.error.main,
            normal: theme.palette.primary.main,
            low: theme.palette.info.main,
            background: theme.palette.info.main,
        }),
        [theme],
    );

    const timelineData = useMemo(
        () => buildTimelineData(data, schedules, palette, simulationEndTime),
        [data, schedules, palette, simulationEndTime],
    );

    const hasData = data.length > 0;

    // The window the user asked to look at
    const displayRange = useMemo(() => {
        if (simulationStartTime && simulationEndTime) {
            return { start: new Date(simulationStartTime), end: new Date(simulationEndTime) };
        }
        return dayWindow();
    }, [simulationStartTime, simulationEndTime]);

    // How far the user may scroll
    const scrollBoundaries = useMemo(() => {
        if (minScrollTime && maxScrollTime) {
            return { minTime: new Date(minScrollTime), maxTime: new Date(maxScrollTime) };
        }
        if (simulationStartTime && simulationEndTime) {
            return { minTime: new Date(simulationStartTime), maxTime: new Date(simulationEndTime) };
        }
        if (data.length > 0) {
            const times = data.map((event) => event.eventTime);
            return {
                minTime: new Date(Math.min(...times) - 3600000),
                maxTime: new Date(Math.max(...times) + 3600000),
            };
        }
        const { start, end } = dayWindow();
        return { minTime: start, maxTime: end };
    }, [minScrollTime, maxScrollTime, simulationStartTime, simulationEndTime, data]);

    // Create the timeline once the container exists; updates below are applied in place
    useEffect(() => {
        const container = containerRef.current;
        const datasets = datasetsRef.current;
        if (!container || !datasets) return;

        try {
            const timeline = new Timeline(container, datasets.items, datasets.groups, {
                stack: false,
                stackSubgroups: false,
                // Size each row from all of its bars, not just the ones in view, so rows
                // don't shrink when the user scrolls the bars off screen.
                groupHeightMode: 'fixed',
                orientation: 'top',
                maxHeight: 600,
                minHeight: 120,
                zoomable: false,
                moveable: true,
                selectable: true,
                multiselect: false,
                showMajorLabels: true,
                showMinorLabels: true,
                showCurrentTime: true,
                showTooltips: true,
                tooltip: { followMouse: true, overflowMethod: 'flip' as const },
                // Zero vertical margins. vis places the first row's items at margin.axis and
                // every other row's at half margin.item.vertical, then shifts tops by the
                // difference after a restack; with bars partly scrolled out of view that left
                // rows flipping by a couple of pixels. With both at zero there is nothing to
                // shift; the bars get their vertical offset from CSS instead.
                margin: { axis: 0, item: { horizontal: 1, vertical: 0 } },
                verticalScroll: true,
                horizontalScroll: true,
                editable: false,
                itemsAlwaysDraggable: false,
                template: itemTemplate,
                groupTemplate,
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
            });

            timeline.on('select', (properties: { items: (string | number)[] }) => {
                if (properties.items.length > 0) {
                    const selected = datasets.items.get(properties.items[0]) as TimelineItem | null;
                    if (selected) onItemClickRef.current?.(selected.scheduleId, selected.playlistId);
                    // Clear selection immediately to prevent visual selection state
                    timeline.setSelection([]);
                }
            });

            timelineRef.current = timeline;
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to initialize timeline');
        }

        return () => {
            timelineRef.current?.destroy();
            timelineRef.current = null;
        };
    }, [hasData]);

    // Push new rows/bars into the existing timeline
    useEffect(() => {
        const datasets = datasetsRef.current;
        if (!timelineRef.current || !datasets) return;
        datasets.groups.clear();
        datasets.groups.add(timelineData.groups);
        datasets.items.clear();
        datasets.items.add(timelineData.items);
    }, [timelineData, hasData]);

    // Apply the visible window and scroll limits
    useEffect(() => {
        const timeline = timelineRef.current;
        if (!timeline) return;
        timeline.setOptions({ min: scrollBoundaries.minTime, max: scrollBoundaries.maxTime });
        timeline.setWindow(displayRange.start, displayRange.end, { animation: false });
    }, [displayRange, scrollBoundaries, hasData]);

    const setFullRangeView = useCallback(
        (animate: boolean = false) => {
            timelineRef.current?.setWindow(displayRange.start, displayRange.end, { animation: animate });
        },
        [displayRange],
    );

    const handleZoomIn = useCallback(() => {
        if (timelineRef.current) {
            timelineRef.current.moveTo(new Date());
            timelineRef.current.zoomIn(0.5);
            setZoomLevel((prev) => Math.min(prev + 0.5, 3));
        }
    }, []);

    const handleZoomOut = useCallback(() => {
        if (timelineRef.current) {
            timelineRef.current.zoomOut(0.5);
            setZoomLevel((prev) => Math.max(prev - 0.5, 0.1));
        }
    }, []);

    const handleFitScreen = useCallback(() => {
        setFullRangeView(true);
        setZoomLevel(1);
    }, [setFullRangeView]);

    if (!hasData) {
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
                                <IconButton onClick={handleZoomIn} size="small" color="primary">
                                    <ZoomIn />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Zoom Out" arrow>
                                <IconButton onClick={handleZoomOut} size="small" color="primary">
                                    <ZoomOut />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Fit to Screen" arrow>
                                <IconButton onClick={handleFitScreen} size="small" color="primary">
                                    <FitScreen />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="Refresh Timeline" arrow>
                                <IconButton onClick={handleFitScreen} size="small" color="primary">
                                    <Refresh />
                                </IconButton>
                            </Tooltip>
                            <Chip
                                label={`Zoom: ${Math.round(zoomLevel * 100)}%`}
                                size="small"
                                color="secondary"
                                variant="outlined"
                                sx={{ height: '32px', alignSelf: 'center' }}
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

                    <Box
                        sx={{
                            position: 'relative',
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            overflow: 'hidden',
                        }}
                    >
                        <div
                            ref={containerRef}
                            style={{ width: '100%', textAlign: 'left' }}
                            role="region"
                            aria-label="Schedule Timeline"
                        />
                    </Box>
                </CardContent>
            </Card>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
          .vis-timeline {
            border: none !important;
            background-color: ${theme.palette.background.paper} !important;
            font-family: ${theme.typography.fontFamily} !important;
          }

          .vis-panel.vis-background,
          .vis-panel.vis-center {
            background-color: ${theme.palette.background.paper} !important;
          }

          .vis-panel.vis-left {
            background-color: ${theme.palette.background.default} !important;
            border-right: 1px solid ${theme.palette.divider} !important;
          }

          /* ---- Row labels ---- */
          .vis-labelset .vis-label {
            color: ${theme.palette.text.primary} !important;
            background-color: ${theme.palette.background.default} !important;
            border-bottom: 1px solid ${theme.palette.divider} !important;
            display: flex !important;
            align-items: center !important;
          }

          .vis-labelset .vis-label .vis-inner {
            width: 100%;
            padding: 4px 8px !important;
          }

          /* Fixed label height, taller than any bar, so vis sizes every row from the label
             and rows stay put as bars scroll in and out of view. */
          .schedule-group-label {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            height: 30px;
            box-sizing: border-box;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.3px;
          }

          .schedule-group-label .schedule-name {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .vis-label.schedule-background-group .schedule-name,
          .vis-label.schedule-main-low-priority .schedule-name {
            color: ${theme.palette.info.dark};
          }

          .vis-label.schedule-main-high-priority .schedule-name {
            color: ${theme.palette.error.dark};
          }

          .vis-label.schedule-main-normal-priority .schedule-name {
            color: ${theme.palette.primary.dark};
          }

          .type-badge,
          .priority-badge {
            flex-shrink: 0;
            display: inline-block;
            font-family: ${theme.typography.fontFamily};
            font-weight: 700;
            line-height: 1.2;
            white-space: nowrap;
            text-align: center;
            border-radius: 12px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
          }

          .type-badge {
            font-size: 9px;
            padding: 2px 6px;
            opacity: 0.85;
          }

          .priority-badge {
            font-size: 10px;
            padding: 3px 8px;
            opacity: 0.9;
          }

          .type-main {
            background-color: ${theme.palette.primary.light};
            color: ${theme.palette.primary.dark};
            border: 1px solid ${theme.palette.primary.main};
          }

          .type-bg {
            background-color: ${theme.palette.info.light};
            color: ${theme.palette.info.dark};
            border: 1px solid ${theme.palette.info.main};
          }

          .priority-high {
            background-color: ${theme.palette.error.main};
            color: ${theme.palette.error.contrastText};
            border: 1px solid ${theme.palette.error.dark};
          }

          .priority-normal {
            background-color: ${theme.palette.primary.main};
            color: ${theme.palette.primary.contrastText};
            border: 1px solid ${theme.palette.primary.dark};
          }

          .priority-low {
            background-color: ${theme.palette.info.main};
            color: ${theme.palette.info.contrastText};
            border: 1px solid ${theme.palette.info.dark};
          }

          /* ---- Bars ---- */
          .vis-item.vis-range {
            border-width: 2px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
          }

          .vis-item .vis-item-content {
            padding: 4px 8px;
            text-align: left;
          }

          .vis-item:hover {
            filter: brightness(1.1);
          }

          .vis-item.vis-selected {
            border-color: ${theme.palette.primary.main} !important;
            box-shadow: 0 0 0 2px ${alpha(theme.palette.primary.main, 0.3)};
          }

          /* Vertical placement is done here rather than by vis (see margin option above) */
          .vis-item.schedule-started,
          .vis-item.schedule-background,
          .vis-item.schedule-scheduled-only {
            top: 4px !important;
          }

          /* Main schedules: background/border color is set per item from its priority */
          .vis-item.schedule-started {
            color: ${theme.palette.common.white};
          }

          .vis-item.schedule-suspended {
            border-style: dashed !important;
            opacity: 0.8;
          }

          .vis-item.schedule-background {
            background-color: ${theme.palette.info.main} !important;
            border: 3px solid ${theme.palette.info.dark} !important;
            color: ${theme.palette.info.contrastText};
            font-style: italic;
            opacity: 0.95;
          }

          /* Thin bars: interruption gap and scheduled-time reference */
          .vis-item.schedule-interruption,
          .vis-item.schedule-scheduled-marker,
          .vis-item.schedule-scheduled-only {
            height: 8px !important;
            border-radius: 6px !important;
          }

          .vis-item.schedule-interruption .vis-item-content,
          .vis-item.schedule-scheduled-marker .vis-item-content,
          .vis-item.schedule-scheduled-only .vis-item-content {
            display: none;
          }

          .vis-item.schedule-interruption {
            background: repeating-linear-gradient(45deg, #9e9e9e, #9e9e9e 6px, #bdbdbd 6px, #bdbdbd 12px) !important;
            border: 1px solid #757575 !important;
            top: 8px !important;
            z-index: 1;
          }

          .vis-item.schedule-scheduled-marker,
          .vis-item.schedule-scheduled-only {
            background: repeating-linear-gradient(90deg, #f5f5f5, #f5f5f5 4px, #e0e0e0 4px, #e0e0e0 8px) !important;
            border: 2px dashed #9e9e9e !important;
            z-index: 0;
          }

          /* Sits behind the bar, visible only where the schedule did not actually run */
          .vis-item.schedule-scheduled-marker {
            top: 20px !important;
            opacity: 0.6;
          }

          .vis-item.schedule-scheduled-only {
            opacity: 0.8;
          }

          /* ---- Axis ---- */
          .vis-time-axis .vis-text {
            color: ${theme.palette.text.primary} !important;
            font-weight: 500 !important;
          }

          .vis-time-axis .vis-text.vis-major {
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

          /* Current time marker */
          .vis-current-time {
            background-color: ${theme.palette.primary.main} !important;
            width: 2px !important;
            z-index: 10 !important;
            pointer-events: none !important;
          }

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
        `,
                }}
            />
        </>
    );
};

export default TimelineBySchedule;
