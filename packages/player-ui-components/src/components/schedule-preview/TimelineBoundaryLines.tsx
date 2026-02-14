import React, { useMemo, useEffect, useRef } from 'react';
import { useTheme } from '@mui/material';
import { Box } from '../box/Box';
import { type PlaybackLogDetail } from '@ezplayer/ezplayer-core';

interface TimelineBoundaryLinesProps {
    data: PlaybackLogDetail[];
    className?: string;
}

interface ScheduleBoundary {
    scheduleId: string;
    scheduleName: string;
    startTime: Date;
    endTime: Date;
    isBackground: boolean;
    priority: string;
}

const TimelineBoundaryLines: React.FC<TimelineBoundaryLinesProps> = ({ data, className = '' }) => {
    const theme = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);

    // Process data to find schedule boundaries
    const scheduleBoundaries = useMemo(() => {
        if (!data.length) return [];

        const boundaries: ScheduleBoundary[] = [];
        const scheduleEventMap = new Map<string, any[]>();

        // Filter to only schedule events
        const scheduleEvents = data.filter((event) => event.eventType.includes('Schedule') && event.scheduleId);

        // Group events by schedule
        scheduleEvents.forEach((event) => {
            if (!scheduleEventMap.has(event.scheduleId!)) {
                scheduleEventMap.set(event.scheduleId!, []);
            }
            scheduleEventMap.get(event.scheduleId!)!.push(event);
        });

        // Process each schedule to find start and end times
        scheduleEventMap.forEach((events, scheduleId) => {
            events.sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

            let startTime: Date | null = null;
            let endTime: Date | null = null;
            let isBackground = false;
            let priority = 'normal';

            events.forEach((event) => {
                if (event.eventType === 'Schedule Started') {
                    startTime = new Date(event.eventTime);
                } else if (event.eventType === 'Schedule Ended' || event.eventType === 'Schedule Stopped') {
                    endTime = new Date(event.eventTime);
                }

                // Extract schedule metadata if available
                if (event.scheduleType) {
                    isBackground = event.scheduleType === 'background';
                }
                if (event.priority) {
                    priority = event.priority;
                }
            });

            // If we have both start and end times, create a boundary
            if (startTime && endTime) {
                boundaries.push({
                    scheduleId,
                    scheduleName: `Schedule ${scheduleId.slice(0, 8)}`,
                    startTime,
                    endTime,
                    isBackground,
                    priority,
                });
            }
        });

        return boundaries;
    }, [data]);

    // Effect to position boundary lines based on timeline coordinates
    useEffect(() => {
        if (!containerRef.current || !scheduleBoundaries.length) return;

        const container = containerRef.current;
        const timelineContainer = container.parentElement?.querySelector('[role="region"]');

        if (!timelineContainer) return;

        // Wait for timeline to be fully rendered
        const timer = setTimeout(() => {
            const timelineItems = timelineContainer.querySelectorAll('.vis-item');

            scheduleBoundaries.forEach((boundary) => {
                // Find the corresponding timeline item
                const timelineItem = Array.from(timelineItems).find((item) => {
                    const itemElement = item as HTMLElement;
                    return itemElement.textContent?.includes(boundary.scheduleId.slice(0, 8));
                });

                if (timelineItem) {
                    const itemRect = timelineItem.getBoundingClientRect();
                    const containerRect = container.getBoundingClientRect();

                    // Create boundary line element
                    const boundaryLine = document.createElement('div');
                    boundaryLine.className = 'timeline-boundary-line';
                    boundaryLine.style.cssText = `
            position: absolute;
            top: ${itemRect.top - containerRect.top + itemRect.height / 2}px;
            left: ${itemRect.left - containerRect.left}px;
            width: ${itemRect.width}px;
            height: 2px;
            background: ${
                boundary.isBackground
                    ? theme.palette.info.main
                    : boundary.priority === 'high'
                      ? theme.palette.error.main
                      : boundary.priority === 'low'
                        ? theme.palette.info.main
                        : theme.palette.primary.main
            };
            opacity: 0.6;
            pointer-events: none;
            z-index: 10;
          `;

                    // Add start and end markers
                    const startMarker = document.createElement('div');
                    startMarker.style.cssText = `
            position: absolute;
            left: 0;
            top: -6px;
            width: 2px;
            height: 14px;
            background: inherit;
          `;

                    const endMarker = document.createElement('div');
                    endMarker.style.cssText = `
            position: absolute;
            right: 0;
            top: -6px;
            width: 2px;
            height: 14px;
            background: inherit;
          `;

                    boundaryLine.appendChild(startMarker);
                    boundaryLine.appendChild(endMarker);
                    container.appendChild(boundaryLine);
                }
            });
        }, 1000); // Wait for timeline to render

        return () => {
            clearTimeout(timer);
            // Clean up boundary lines
            const existingLines = container.querySelectorAll('.timeline-boundary-line');
            existingLines.forEach((line) => line.remove());
        };
    }, [scheduleBoundaries, theme]);

    if (!scheduleBoundaries.length) return null;

    return (
        <Box
            ref={containerRef}
            className={className}
            sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                pointerEvents: 'none',
                zIndex: 1,
            }}
        />
    );
};

export default TimelineBoundaryLines;
