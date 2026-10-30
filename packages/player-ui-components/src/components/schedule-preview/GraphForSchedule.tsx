// TimelineBySchedule.tsx - Replaced scatter chart with timeline component
import React, { useMemo } from 'react';
import { type ParallelSchedulePreviewData } from '../../types/SchedulePreviewTypes';
import TimelineBySchedule from './TimelineBySchedule';

interface ScatterChartByScheduleProps {
    data: ParallelSchedulePreviewData;
    className?: string;
    onItemClick?: (scheduleId?: string, playlistId?: string) => void;
    selectedStartTime?: number; // Add selected start time from settings
    selectedEndTime?: number; // Add selected end time from settings
    /** Window to open on, when narrower than the selected range. Defaults to the simulated range. */
    viewStartTime?: number;
    viewEndTime?: number;
    /** When false, hides grey scheduled-time comparison strips. Default true. */
    showScheduledMarkers?: boolean;
}

const GraphForSchedule: React.FC<ScatterChartByScheduleProps> = ({
    data,
    className,
    onItemClick,
    selectedStartTime,
    selectedEndTime,
    viewStartTime,
    viewEndTime,
    showScheduledMarkers = true,
}) => {
    // Combine logs from both background and main schedules for the timeline.
    // Memoized so a parent re-render does not hand the timeline a new array
    // (which would make it rebuild from scratch).
    const combinedLogs = useMemo(() => {
        const logs = [...data.background.logs, ...data.main.logs];
        logs.sort((a, b) => a.eventTime - b.eventTime);
        return logs;
    }, [data.background.logs, data.main.logs]);

    return (
        <TimelineBySchedule
            data={combinedLogs}
            className={className}
            onItemClick={onItemClick}
            simulationStartTime={data.startTime}
            simulationEndTime={data.endTime}
            viewStartTime={viewStartTime}
            viewEndTime={viewEndTime}
            minScrollTime={selectedStartTime}
            maxScrollTime={selectedEndTime}
            showScheduledMarkers={showScheduledMarkers}
        />
    );
};

export default GraphForSchedule;
