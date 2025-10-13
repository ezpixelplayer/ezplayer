import type { PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '@ezplayer/ezplayer-core';
import { PlayerRunState, type PlaybackLogDetail } from '@ezplayer/ezplayer-core';
import { format } from 'date-fns';
import {
    PlaylistGroup,
    SchedulePreviewData,
    SchedulePreviewSettings,
    SequenceEvent,
    TimelineGroup,
} from '../types/SchedulePreviewTypes';

const SAFETY_EVENT_LIMIT = 100000; // Maximum events > 60 days * 24 hours * 60 events/hour

/**
 * Generates schedule preview data using PlayerRunState simulation
 */
export function generateSchedulePreview(
    sequences: SequenceRecord[],
    playlists: PlaylistRecord[],
    schedules: ScheduledPlaylist[],
    settings: SchedulePreviewSettings,
): SchedulePreviewData {
    const errors: string[] = [];

    // Convert date/time settings to timestamps
    const startTime = combineDateAndTime(settings.startDate, settings.startTime);
    const endTime = combineDateAndTime(settings.endDate, settings.endTime);

    // Create PlayerRunState for simulation
    const playerState = new PlayerRunState(startTime);

    // Load all data with error checking
    playerState.setUpSequences(sequences, playlists, schedules, errors);

    if (errors.length > 0) {
        console.warn('Schedule preview generated with errors:', errors);
    }

    // Skip to report start time (discard initial logs)
    let logs: PlaybackLogDetail[] = [];
    const maxLogs = Math.min(settings.maxEvents, SAFETY_EVENT_LIMIT);
    try {
        logs = playerState.readOutScheduleUntil(endTime, maxLogs);
    } catch (error) {
        console.error('Error during schedule simulation:', error);
        errors.push(error instanceof Error ? error.message : 'Unknown simulation error');
    }

    // Get current state snapshot
    const currentState = playerState.getStatusSnapshot();

    // If we hit the safety limit, add a warning event
    if (logs.length >= maxLogs) {
        logs.push({
            eventType: 'Schedule Prevented',
            eventTime: endTime,
            stackDepth: 0,
            scheduleId: 'system',
            playlistId: undefined,
            sequenceId: undefined,
        });
        errors.push(
            'Schedule simulation stopped due to excessive events. Consider increasing the maxEvents setting or simplifying your schedule configuration.',
        );
    }

    return {
        currentState,
        logs,
        startTime,
        endTime,
        errors, // Add errors to the preview data
    };
}

/**
 * Combines a date and time string into a timestamp
 * Supports extended time format (e.g., 25:00, 26:30)
 */
export function combineDateAndTime(date: Date, timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);

    // Handle extended time format (e.g., 25:00, 26:30)
    const totalHours = hours;
    const normalizedHours = totalHours % 24;
    const daysOffset = Math.floor(totalHours / 24);

    const result = new Date(date);
    result.setDate(result.getDate() + daysOffset);
    result.setHours(normalizedHours || 0, minutes || 0, 0, 0);

    return result.getTime();
}

/**
 * Groups logs by schedule for hierarchical display
 */
export function groupLogsBySchedule(logs: PlaybackLogDetail[]): TimelineGroup[] {
    const scheduleMap = new Map<string, TimelineGroup>();

    logs.forEach((log) => {
        if (!log.scheduleId) return;

        if (!scheduleMap.has(log.scheduleId)) {
            scheduleMap.set(log.scheduleId, {
                scheduleId: log.scheduleId,
                scheduleTitle: log.scheduleId,
                events: [],
                depth: log.stackDepth,
                isExpanded: true,
            });
        }

        scheduleMap.get(log.scheduleId)!.events.push(log);
    });

    return Array.from(scheduleMap.values()).sort((a, b) => {
        const aTime = a.events[0]?.eventTime || 0;
        const bTime = b.events[0]?.eventTime || 0;
        return aTime - bTime;
    });
}

/**
 * Groups events within a schedule by playlist
 */
export function groupEventsByPlaylist(events: PlaybackLogDetail[]): PlaylistGroup[] {
    const playlistMap = new Map<string, PlaylistGroup>();

    events.forEach((event) => {
        if (!event.playlistId) return;

        if (!playlistMap.has(event.playlistId)) {
            playlistMap.set(event.playlistId, {
                playlistId: event.playlistId,
                playlistTitle: event.playlistId, // Could be enhanced with actual title lookup
                events: [],
                isExpanded: false,
            });
        }

        playlistMap.get(event.playlistId)!.events.push(event);
    });

    return Array.from(playlistMap.values()).sort((a, b) => {
        // Sort by first event time
        const aTime = a.events[0]?.eventTime || 0;
        const bTime = b.events[0]?.eventTime || 0;
        return aTime - bTime;
    });
}

/**
 * Extracts sequence events from logs
 */
export function extractSequenceEvents(events: PlaybackLogDetail[]): SequenceEvent[] {
    const sequenceMap = new Map<string, Partial<SequenceEvent>>();

    events.forEach((event) => {
        if (!event.sequenceId) return;

        const key = `${event.sequenceId}-${event.eventTime}`;

        if (!sequenceMap.has(key)) {
            sequenceMap.set(key, {
                sequenceId: event.sequenceId,
                sequenceTitle: event.sequenceId, // Could be enhanced with actual title lookup
            });
        }

        const seqEvent = sequenceMap.get(key)!;

        if (event.eventType === 'Sequence Started') {
            seqEvent.startTime = event.eventTime;
            seqEvent.timeIntoSeq = event.timeIntoSeqMS;
            seqEvent.entryIntoPlaylist = event.entryIntoPlaylist;
        } else if (event.eventType === 'Sequence Ended') {
            seqEvent.endTime = event.eventTime;
        }
    });

    return Array.from(sequenceMap.values())
        .filter((seq) => seq.startTime !== undefined && seq.endTime !== undefined)
        .map((seq) => seq as SequenceEvent)
        .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Formats timestamp for display
 */
export function formatEventTime(timestamp: number): string {
    const date = new Date(timestamp);
    return format(date, 'HH:mm:ss');
}

/**
 * Formats timestamp with date for display
 */
export function formatEventDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    return format(date, 'dd-MMM-yyyy HH:mm:ss');
}

/**
 * Calculates duration between two timestamps
 */
export function calculateDuration(startTime: number, endTime: number): string {
    const durationMs = endTime - startTime;
    const seconds = Math.floor((durationMs / 1000) % 60);
    const minutes = Math.floor((durationMs / (1000 * 60)) % 60);
    const hours = Math.floor(durationMs / (1000 * 60 * 60));

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
}
