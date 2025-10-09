import type { PlaybackLogDetail, PlaybackStateSnapshot } from '@ezplayer/ezplayer-core';

export type PlaybackLogEventType =
    | 'Schedule Started'
    | 'Schedule Ended'
    | 'Schedule Stopped'
    | 'Schedule Suspended'
    | 'Schedule Resumed'
    | 'Schedule Deferred'
    | 'Schedule Prevented'
    | 'Playlist Started'
    | 'Playlist Ended'
    | 'Sequence Started'
    | 'Sequence Ended'
    | 'Sequence Paused'
    | 'Sequence Resumed';

export interface SchedulePreviewData {
    currentState: PlaybackStateSnapshot[];
    logs: PlaybackLogDetail[];
    startTime: number;
    endTime: number;
    errors?: string[]; // Array of error messages that occurred during preview generation
}

// New interface for combined parallel schedule data
export interface ParallelSchedulePreviewData {
    background: SchedulePreviewData;
    main: SchedulePreviewData;
    startTime: number;
    endTime: number;
    errors?: string[];
    warnings?: string[];
}

// Lane information for the timeline display
export interface TimelineLane {
    id: string;
    title: string;
    type: 'background' | 'main';
    color: string;
    data: PlaybackLogDetail[];
}

export interface SchedulePreviewSettings {
    startDate: Date;
    endDate: Date;
    startTime: string;
    endTime: string;
    maxEvents: number;
    scheduleTypeFilter: 'all' | 'main' | 'background';
}

export interface TimelineGroup {
    scheduleId: string;
    scheduleTitle: string;
    events: PlaybackLogDetail[];
    depth: number;
    isExpanded: boolean;
}

export interface PlaylistGroup {
    playlistId: string;
    playlistTitle: string;
    events: PlaybackLogDetail[];
    isExpanded: boolean;
}

export interface SequenceEvent {
    sequenceId: string;
    sequenceTitle: string;
    startTime: number;
    endTime: number;
    timeIntoSeq?: number;
    entryIntoPlaylist?: [number, number];
}
