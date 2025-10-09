import { SchedulePreviewSettings } from '../types/SchedulePreviewTypes';

export const DEFAULT_SCHEDULE_PREVIEW_SETTINGS: SchedulePreviewSettings = {
    startDate: new Date(),
    endDate: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours from now (reasonable default)
    startTime: '00:00',
    endTime: '23:45',
    maxEvents: 50000, // Increased default limit for longer time ranges
    scheduleTypeFilter: 'all',
};

export const DEFAULT_TIMELINE_SETTINGS = {
    showTimestamps: true,
    show24HourTime: true,
    showStackDepth: true,
    autoRefresh: false,
    refreshInterval: 30000, // 30 seconds
    maxEventsPerSchedule: 100,
} as const;

export const SCHEDULE_EVENT_COLORS = {
    'Schedule Started': '#4caf50',
    'Schedule Ended': '#f44336',
    'Schedule Stopped': '#ff9800',
    'Schedule Suspended': '#9c27b0',
    'Schedule Resumed': '#2196f3',
    'Schedule Deferred': '#ffeb3b',
    'Schedule Prevented': '#795548',
    'Playlist Started': '#00bcd4',
    'Playlist Ended': '#607d8b',
    'Sequence Started': '#8bc34a',
    'Sequence Ended': '#ffc107',
    'Sequence Paused': '#e91e63',
    'Sequence Resumed': '#03a9f4',
} as const;

// Colors for different stack depths in the timeline
export const DEPTH_COLORS = [
    '#1976d2', // Primary blue
    '#2e7d32', // Success green
    '#d32f2f', // Error red
    '#ed6c02', // Warning orange
    '#9c27b0', // Purple
    '#0288d1', // Light blue
    '#388e3c', // Light green
    '#f44336', // Light red
];
