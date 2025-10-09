// TimelineBySchedule.tsx - Replaced scatter chart with timeline component
import React from 'react';
import { type ParallelSchedulePreviewData } from '../../types/SchedulePreviewTypes';
import TimelineBySchedule from './TimelineBySchedule';

interface ScatterChartByScheduleProps {
    data: ParallelSchedulePreviewData;
    className?: string;
    onItemClick?: (scheduleId?: string, playlistId?: string) => void;
    selectedStartTime?: number; // Add selected start time from settings
    selectedEndTime?: number; // Add selected end time from settings
}

const GraphForSchedule: React.FC<ScatterChartByScheduleProps> = ({
    data,
    className,
    onItemClick,
    selectedStartTime,
    selectedEndTime,
}) => {
    // Combine logs from both background and main schedules for the timeline
    const combinedLogs = [...data.background.logs, ...data.main.logs];

    // Sort by event time to ensure proper chronological order
    combinedLogs.sort((a, b) => a.eventTime - b.eventTime);

    return (
        <TimelineBySchedule
            data={combinedLogs}
            className={className}
            onItemClick={onItemClick}
            simulationStartTime={data.startTime}
            simulationEndTime={data.endTime}
            minScrollTime={selectedStartTime}
            maxScrollTime={selectedEndTime}
        />
    );
};

export default GraphForSchedule;
