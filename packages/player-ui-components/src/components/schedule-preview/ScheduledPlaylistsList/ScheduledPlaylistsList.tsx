import { PlaylistRecord, priorityToNumber, ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonIcon from '@mui/icons-material/Person';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Card,
    CardContent,
    Checkbox,
    Chip,
    FormControlLabel,
    List,
    Stack,
    Theme,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { format } from 'date-fns';
import React, { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../../store/Store';

export interface LogEvent {
    eventType: string;
    eventTime: number;
    scheduleId?: string;
    playlistId?: string;
    stackDepth: number;
    sequenceId?: string;
    entryIntoPlaylist: [number, number];
    timeIntoSeqMS: number;
}

export interface ScheduleData {
    currentState: any[];
    logs: LogEvent[];
    startTime: number;
    endTime: number;
    errors: any[];
}

interface ScheduledPlaylistsListProps {
    data?: ScheduleData;
    className?: string;
    targetScheduleId?: string; // Add prop to target specific schedule
}

// Add ref interface for scrolling to specific schedules
export interface ScheduledPlaylistsListRef {
    scrollToSchedule: (scheduleId: string) => void;
}

interface SequenceInstance {
    startTime: number;
    endTime: number;
    loopIndex: number;
    sequenceId: string; // Add sequenceId to track which sequence this instance belongs to
    sequenceName: string; // Add sequence name for display
    artist: string; // Add artist for display
    playlistType: 'intro' | 'main' | 'outro'; // Add playlist type to know where it came from
}

// Add new interface for chronological sequence instances
interface ChronologicalSequenceInstance {
    sequenceId: string;
    sequenceName: string;
    artist: string;
    startTime: number;
    endTime: number;
    loopNumber: number; // Global loop number for this sequence across the entire schedule
    playlistType: 'intro' | 'main' | 'outro';
    order: number; // Original order in playlist
}

interface ProcessedSchedule {
    scheduleId: string;
    playlistId: string;
    startTime: number;
    endTime: number;
    totalDuration: number; // Changed from sequences to totalDuration
    sequences: {
        id: string;
        startTime: number;
        endTime: number;
        order: number;
        artist?: string;
        duration?: number;
        instances: SequenceInstance[]; // Add this line
    }[];
    // Add intro/outro playlist support
    introPlaylist?: ProcessedPlaylist;
    outroPlaylist?: ProcessedPlaylist;
    // Add chronological instances
    chronologicalInstances: ChronologicalSequenceInstance[];
}

interface ProcessedPlaylist {
    playlistId: string;
    playlistType: 'intro' | 'main' | 'outro';
    startTime: number;
    endTime: number;
    sequences: {
        id: string;
        startTime: number;
        endTime: number;
        order: number;
        artist?: string;
        duration?: number;
        instances: SequenceInstance[];
    }[];
}

// Add helper function for formatting duration
const formatDuration = (durationMs: number) => {
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num: number) => num.toString().padStart(2, '0');

    if (hours > 0) {
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
};

const ScheduledPlaylistsList = forwardRef<ScheduledPlaylistsListRef, ScheduledPlaylistsListProps>(
    ({ data, className = '', targetScheduleId: _targetScheduleId }, ref) => {
        const [expandedDate, setExpandedDate] = useState<string | false>(false);
        const [expandedSchedule, setExpandedSchedule] = useState<string | false>(false);
        const [expandedPlaylist, setExpandedPlaylist] = useState<string | false>(false);
        const [showLoops, setShowLoops] = useState(true);

        // Get theme for dynamic styling
        const theme = useTheme();

        // Refs for each schedule accordion
        const scheduleRefs = useRef<Map<string, HTMLElement>>(new Map());

        // Get schedules, playlists, and sequences from Redux store
        const schedulesList = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);
        const playlists = useSelector((state: RootState) => state.playlists.playlists || []);
        const sequences = useSelector((state: RootState) => state.sequences.sequenceData || []);

        const handleDateAccordionChange = (date: string) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
            setExpandedDate(isExpanded ? date : false);
        };

        const handleScheduleAccordionChange =
            (scheduleId: string) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
                setExpandedSchedule(isExpanded ? scheduleId : false);
            };

        const handlePlaylistAccordionChange =
            (playlistKey: string) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
                setExpandedPlaylist(isExpanded ? playlistKey : false);
            };

        // Helper function to get sequence name
        const getSequenceName = (sequenceId: string) => {
            const sequence = sequences.find((s) => s.id === sequenceId);
            return (
                sequence?.work?.title || `Sequence ${sequenceId.split('|')[1]?.slice(0, 8) || sequenceId.slice(0, 8)}`
            );
        };

        // Helper function to get schedule name
        const getScheduleName = (scheduleId: string) => {
            const schedule = schedulesList.find((s) => s.id === scheduleId);
            return schedule?.title || `Schedule ${scheduleId.slice(0, 8)}`;
        };

        // Helper function to get playlist name
        const getPlaylistName = (playlistId: string) => {
            const playlist = playlists.find((p) => p.id === playlistId);
            return playlist?.title || `Playlist ${playlistId.slice(0, 8)}`;
        };

        // Helper function to format time while preserving extended time formats (25:00, 26:30, etc.)
        const formatExtendedTime = (timeString: string) => {
            const [hours, minutes] = timeString.split(':').map(Number);
            const totalHours = hours;
            const normalizedHours = totalHours % 24;
            const daysOffset = Math.floor(totalHours / 24);

            if (daysOffset > 0) {
                // Extended time format - show as 25:00, 26:30, etc.
                return timeString;
            } else {
                // Normal time format - show as 23:30, 00:15, etc.
                return `${normalizedHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
        };

        const processedSchedules = useMemo(() => {
            if (!data?.logs?.length) return [];

            const schedules: { [key: string]: ProcessedSchedule } = {};

            // First pass: Create schedule entries
            data.logs.forEach((event) => {
                if (event.scheduleId && !schedules[event.scheduleId]) {
                    // Find the schedule in Redux store
                    const reduxSchedule = schedulesList.find((s: ScheduledPlaylist) => s.id === event.scheduleId);
                    if (reduxSchedule) {
                        const scheduleDate = new Date(reduxSchedule.date);
                        const [fromHours, fromMinutes] = reduxSchedule.fromTime.split(':').map(Number);
                        const [toHours, toMinutes] = reduxSchedule.toTime.split(':').map(Number);

                        const startTime = new Date(scheduleDate);
                        startTime.setHours(fromHours, fromMinutes, 0, 0);

                        const endTime = new Date(scheduleDate);
                        endTime.setHours(toHours, toMinutes, 0, 0);

                        // Calculate duration in milliseconds from the time values in Redux
                        const fromTimeInMinutes = fromHours * 60 + fromMinutes;
                        const toTimeInMinutes = toHours * 60 + toMinutes;

                        // If end time is before start time, add 24 hours (1440 minutes)
                        const adjustedToTimeInMinutes =
                            toTimeInMinutes < fromTimeInMinutes
                                ? toTimeInMinutes + 1440 // 24 hours * 60 minutes
                                : toTimeInMinutes;

                        // Calculate total duration in milliseconds
                        const durationInMinutes = adjustedToTimeInMinutes - fromTimeInMinutes;
                        const durationInMs = durationInMinutes * 60 * 1000; // Convert to milliseconds

                        schedules[event.scheduleId] = {
                            scheduleId: event.scheduleId,
                            playlistId: reduxSchedule.playlistId,
                            startTime: startTime.getTime(),
                            endTime: endTime.getTime(),
                            totalDuration: durationInMs,
                            sequences: [],
                            introPlaylist: undefined,
                            outroPlaylist: undefined,
                            chronologicalInstances: [], // Initialize chronological instances
                        };
                    }
                }
            });

            // Helper function to process playlist sequences
            const processPlaylistSequences = (
                playlistId: string,
                scheduleStartTime: number,
                scheduleEndTime: number,
                playlistStartTime?: number,
                playlistEndTime?: number,
            ) => {
                const playlist = playlists.find((p) => p.id === playlistId) as PlaylistRecord;
                if (!playlist?.items) return [];

                return playlist.items.map((item) => {
                    const sequence = sequences.find((s) => s.id === item.id);
                    const duration = sequence?.work?.length || 0;

                    return {
                        id: item.id,
                        startTime: playlistStartTime || scheduleStartTime,
                        endTime: playlistEndTime || scheduleEndTime,
                        order: item.sequence,
                        artist: sequence?.work?.artist || 'Unknown Artist',
                        duration: duration,
                        instances: [],
                    };
                });
            };

            // Second pass: Process main playlists and identify intro/outro playlists
            Object.values(schedules).forEach((schedule) => {
                const reduxSchedule = schedulesList.find((s) => s.id === schedule.scheduleId);
                if (!reduxSchedule) return;

                // Process main playlist
                schedule.sequences = processPlaylistSequences(
                    schedule.playlistId,
                    schedule.startTime,
                    schedule.endTime,
                );

                // Track playlist start/end times from logs for intro/outro identification
                const playlistTimes = new Map<string, { startTime?: number; endTime?: number }>();

                data.logs.forEach((event) => {
                    if (event.scheduleId === schedule.scheduleId && event.playlistId) {
                        if (!playlistTimes.has(event.playlistId)) {
                            playlistTimes.set(event.playlistId, {});
                        }
                        const times = playlistTimes.get(event.playlistId)!;

                        if (event.eventType === 'Playlist Started') {
                            times.startTime = event.eventTime;
                        } else if (event.eventType === 'Playlist Ended') {
                            times.endTime = event.eventTime;
                        }
                    }
                });

                // Process intro playlist if exists
                if (reduxSchedule.prePlaylistId && playlistTimes.has(reduxSchedule.prePlaylistId)) {
                    const introTimes = playlistTimes.get(reduxSchedule.prePlaylistId)!;
                    schedule.introPlaylist = {
                        playlistId: reduxSchedule.prePlaylistId,
                        playlistType: 'intro',
                        startTime: introTimes.startTime || schedule.startTime,
                        endTime: introTimes.endTime || schedule.startTime,
                        sequences: processPlaylistSequences(
                            reduxSchedule.prePlaylistId,
                            schedule.startTime,
                            schedule.endTime,
                            introTimes.startTime,
                            introTimes.endTime,
                        ),
                    };
                }

                // Process outro playlist if exists
                if (reduxSchedule.postPlaylistId && playlistTimes.has(reduxSchedule.postPlaylistId)) {
                    const outroTimes = playlistTimes.get(reduxSchedule.postPlaylistId)!;
                    schedule.outroPlaylist = {
                        playlistId: reduxSchedule.postPlaylistId,
                        playlistType: 'outro',
                        startTime: outroTimes.startTime || schedule.endTime,
                        endTime: outroTimes.endTime || schedule.endTime,
                        sequences: processPlaylistSequences(
                            reduxSchedule.postPlaylistId,
                            schedule.startTime,
                            schedule.endTime,
                            outroTimes.startTime,
                            outroTimes.endTime,
                        ),
                    };
                }

                // Process sequence instances for all playlists (main, intro, outro)
                const allPlaylists = [
                    { playlist: { sequences: schedule.sequences }, type: 'main' },
                    ...(schedule.introPlaylist ? [{ playlist: schedule.introPlaylist, type: 'intro' }] : []),
                    ...(schedule.outroPlaylist ? [{ playlist: schedule.outroPlaylist, type: 'outro' }] : []),
                ];

                allPlaylists.forEach(({ playlist, type }) => {
                    let currentLoopIndex = 0;
                    let lastSequenceId = '';

                    data.logs.forEach((event) => {
                        if (event.scheduleId === schedule.scheduleId && event.sequenceId) {
                            const sequence = playlist.sequences.find((s) => s.id === event.sequenceId);
                            if (sequence) {
                                if (event.eventType === 'Sequence Started') {
                                    // Check if this is a new loop
                                    if (lastSequenceId === event.sequenceId) {
                                        currentLoopIndex++;
                                    } else if (sequence.order === 1) {
                                        currentLoopIndex = 0;
                                    }
                                    lastSequenceId = event.sequenceId;

                                    // Start a new instance
                                    sequence.instances.push({
                                        startTime: event.eventTime,
                                        endTime: event.eventTime + (sequence.duration || 0) * 1000,
                                        loopIndex: currentLoopIndex,
                                        sequenceId: event.sequenceId,
                                        sequenceName: sequence.id,
                                        artist: sequence.artist || 'Unknown Artist',
                                        playlistType: type as 'intro' | 'main' | 'outro',
                                    });
                                }
                            }
                        }
                    });
                });

                // Create chronological instances by processing sequence start/end events
                schedule.chronologicalInstances = [];

                // Collect all sequence events for this schedule
                const sequenceEvents: Array<{
                    type: 'start' | 'end';
                    eventTime: number;
                    sequenceId: string;
                    playlistId?: string;
                }> = [];

                data.logs.forEach((event) => {
                    if (event.scheduleId === schedule.scheduleId && event.sequenceId) {
                        if (event.eventType === 'Sequence Started') {
                            sequenceEvents.push({
                                type: 'start',
                                eventTime: event.eventTime,
                                sequenceId: event.sequenceId,
                                playlistId: event.playlistId,
                            });
                        } else if (event.eventType === 'Sequence Ended') {
                            sequenceEvents.push({
                                type: 'end',
                                eventTime: event.eventTime,
                                sequenceId: event.sequenceId,
                                playlistId: event.playlistId,
                            });
                        }
                    }
                });

                // Sort events by time
                sequenceEvents.sort((a, b) => a.eventTime - b.eventTime);

                // Pair up start/end events and create chronological instances
                const pendingStarts = new Map<string, (typeof sequenceEvents)[0]>();
                const tempInstances: Array<{
                    sequenceId: string;
                    startTime: number;
                    endTime: number;
                    playlistType: 'intro' | 'main' | 'outro';
                    order: number;
                    name: string;
                    artist: string;
                }> = [];

                // First, collect all instances
                sequenceEvents.forEach((event) => {
                    if (event.type === 'start') {
                        pendingStarts.set(event.sequenceId, event);
                    } else if (event.type === 'end') {
                        const startEvent = pendingStarts.get(event.sequenceId);
                        if (startEvent) {
                            // Find sequence details and determine playlist type using playlistId from event
                            let sequenceDetails: {
                                name: string;
                                artist: string;
                                order: number;
                                playlistType: 'intro' | 'main' | 'outro';
                            } | null = null;

                            // Determine playlist type based on the playlistId from the event
                            const reduxSchedule = schedulesList.find((s) => s.id === schedule.scheduleId);
                            let playlistType: 'intro' | 'main' | 'outro' = 'main';

                            if (reduxSchedule && event.playlistId) {
                                if (event.playlistId === reduxSchedule.prePlaylistId) {
                                    playlistType = 'intro';
                                } else if (event.playlistId === reduxSchedule.postPlaylistId) {
                                    playlistType = 'outro';
                                } else if (event.playlistId === reduxSchedule.playlistId) {
                                    playlistType = 'main';
                                }
                            }

                            // Find sequence in the appropriate playlist based on determined type
                            if (playlistType === 'intro' && schedule.introPlaylist) {
                                const introSequence = schedule.introPlaylist.sequences.find(
                                    (s) => s.id === event.sequenceId,
                                );
                                if (introSequence) {
                                    sequenceDetails = {
                                        name: getSequenceName(event.sequenceId),
                                        artist: introSequence.artist || 'Unknown Artist',
                                        order: introSequence.order,
                                        playlistType: 'intro',
                                    };
                                }
                            } else if (playlistType === 'outro' && schedule.outroPlaylist) {
                                const outroSequence = schedule.outroPlaylist.sequences.find(
                                    (s) => s.id === event.sequenceId,
                                );
                                if (outroSequence) {
                                    sequenceDetails = {
                                        name: getSequenceName(event.sequenceId),
                                        artist: outroSequence.artist || 'Unknown Artist',
                                        order: outroSequence.order,
                                        playlistType: 'outro',
                                    };
                                }
                            } else {
                                // Default to main playlist
                                const mainSequence = schedule.sequences.find((s) => s.id === event.sequenceId);
                                if (mainSequence) {
                                    sequenceDetails = {
                                        name: getSequenceName(event.sequenceId),
                                        artist: mainSequence.artist || 'Unknown Artist',
                                        order: mainSequence.order,
                                        playlistType: 'main',
                                    };
                                }
                            }

                            if (sequenceDetails) {
                                tempInstances.push({
                                    sequenceId: event.sequenceId,
                                    startTime: startEvent.eventTime,
                                    endTime: event.eventTime,
                                    playlistType: sequenceDetails.playlistType,
                                    order: sequenceDetails.order,
                                    name: sequenceDetails.name,
                                    artist: sequenceDetails.artist,
                                });
                            }

                            pendingStarts.delete(event.sequenceId);
                        }
                    }
                });

                // Sort by start time
                tempInstances.sort((a, b) => a.startTime - b.startTime);

                // Now assign loop numbers based on playlist iteration
                const playlistLoopNumbers = new Map<'intro' | 'main' | 'outro', number>();
                const playlistSequenceTrackers = new Map<'intro' | 'main' | 'outro', Set<string>>();

                tempInstances.forEach((instance) => {
                    const playlistType = instance.playlistType;

                    // Initialize trackers for this playlist type if not exists
                    if (!playlistLoopNumbers.has(playlistType)) {
                        playlistLoopNumbers.set(playlistType, 1);
                        playlistSequenceTrackers.set(playlistType, new Set());
                    }

                    const currentLoopNumber = playlistLoopNumbers.get(playlistType)!;
                    const seenSequences = playlistSequenceTrackers.get(playlistType)!;

                    // Check if this sequence indicates we're starting a new loop
                    // For main playlist: if we see sequence order 1 and we've already seen other sequences
                    // For intro/outro: similar logic but they might have different order patterns
                    if (instance.order === 1 && seenSequences.size > 0) {
                        // We're starting a new loop
                        playlistLoopNumbers.set(playlistType, currentLoopNumber + 1);
                        seenSequences.clear();
                    }

                    seenSequences.add(instance.sequenceId);

                    schedule.chronologicalInstances.push({
                        sequenceId: instance.sequenceId,
                        sequenceName: instance.name,
                        artist: instance.artist,
                        startTime: instance.startTime,
                        endTime: instance.endTime,
                        loopNumber: playlistLoopNumbers.get(playlistType)!,
                        playlistType: instance.playlistType,
                        order: instance.order,
                    });
                });

                // Sort chronological instances by start time
                schedule.chronologicalInstances.sort((a, b) => a.startTime - b.startTime);
            });

            return Object.values(schedules);
        }, [data, playlists, sequences, schedulesList, getSequenceName]);

        // Group processed schedules by date
        const schedulesByDate = useMemo(() => {
            if (!processedSchedules.length) return new Map<string, ProcessedSchedule[]>();

            const groupedSchedules = new Map<string, ProcessedSchedule[]>();

            processedSchedules.forEach((schedule: ProcessedSchedule) => {
                const date = format(schedule.startTime, 'yyyy-MM-dd');
                if (!groupedSchedules.has(date)) {
                    groupedSchedules.set(date, []);
                }
                groupedSchedules.get(date)?.push(schedule);
            });

            // Sort dates and schedules within each date by type first, then by priority, then by start time
            const sortedGroupedSchedules = new Map(
                [...groupedSchedules.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([date, schedules]) => [
                        date,
                        schedules.sort((a, b) => {
                            // First, get the schedule objects from Redux store to access type and priority
                            const scheduleA = schedulesList.find((s) => s.id === a.scheduleId);
                            const scheduleB = schedulesList.find((s) => s.id === b.scheduleId);

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
                            const priorityValueA = priorityToNumber[priorityA] || priorityToNumber.normal;
                            const priorityValueB = priorityToNumber[priorityB] || priorityToNumber.normal;

                            // Sort by priority (higher number = lower priority, so we want low priority first)
                            if (priorityValueA !== priorityValueB) {
                                return priorityValueB - priorityValueA; // Reverse the comparison
                            }

                            // If priorities are equal, sort by start time
                            return a.startTime - b.startTime;
                        }),
                    ]),
            );

            return sortedGroupedSchedules;
        }, [processedSchedules, schedulesList]);

        // Function to scroll to specific schedule
        const scrollToSchedule = (scheduleId: string) => {
            const scheduleElement = scheduleRefs.current.get(scheduleId);
            if (scheduleElement) {
                // Expand the date accordion first if needed
                const scheduleData = processedSchedules.find((schedule) => schedule.scheduleId === scheduleId);
                if (scheduleData) {
                    const scheduleDate = format(new Date(scheduleData.startTime), 'yyyy-MM-dd');
                    setExpandedDate(scheduleDate);
                    // Small delay to allow accordion to expand before scrolling
                    setTimeout(() => {
                        setExpandedSchedule(scheduleId);
                        setTimeout(() => {
                            scheduleElement.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                            });
                        }, 100);
                    }, 100);
                }
            }
        };

        // Expose ref methods
        useImperativeHandle(
            ref,
            () => ({
                scrollToSchedule,
            }),
            [processedSchedules, scrollToSchedule],
        );

        // Helper function to get playlist type icon and color
        const getPlaylistTypeConfig = (playlistType: 'intro' | 'main' | 'outro') => {
            switch (playlistType) {
                case 'intro':
                    return {
                        label: 'Intro',
                        color: 'success' as const,
                        icon: '▶️',
                        description: 'Plays before main playlist',
                    };
                case 'outro':
                    return {
                        label: 'Outro',
                        color: 'warning' as const,
                        icon: '⏹️',
                        description: 'Plays after main playlist',
                    };
                default:
                    return {
                        label: 'Main',
                        color: 'primary' as const,
                        icon: '🎵',
                        description: 'Main scheduled playlist',
                    };
            }
        };

        // Helper function to get schedule priority configuration
        const getSchedulePriorityConfig = (scheduleId: string) => {
            const schedule = schedulesList.find((s) => s.id === scheduleId);
            const priority = schedule?.priority || 'normal';
            const scheduleType = schedule?.scheduleType || 'main';

            let priorityLabel = '';
            let priorityClass = '';
            let typeLabel = '';
            let typeClass = '';

            if (scheduleType === 'background') {
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
                // Priority labels for main schedules
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

            return {
                priorityLabel,
                priorityClass,
                typeLabel,
                typeClass,
                scheduleType,
                priority,
            };
        };

        // Helper function to render chronological sequences
        const renderChronologicalView = (schedule: ProcessedSchedule) => {
            if (schedule.chronologicalInstances.length === 0) {
                return (
                    <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                            fontStyle: 'italic',
                            textAlign: 'center',
                            py: 4,
                        }}
                    >
                        No loop instances found for this schedule.
                    </Typography>
                );
            }

            // Detect suspensions by checking for explicit suspension events only
            const suspensionIndicators: Array<{
                index: number;
                type: 'suspension';
                startTime: number;
                endTime: number;
                duration: number;
                reason: string;
            }> = [];

            // Check for explicit Schedule Suspended events
            const scheduleEvents =
                data?.logs?.filter(
                    (event) =>
                        event.scheduleId === schedule.scheduleId &&
                        (event.eventType === 'Schedule Suspended' || event.eventType === 'Schedule Resumed'),
                ) || [];

            const pendingSuspensions = new Map<string, number>();
            scheduleEvents.forEach((event) => {
                if (event.eventType === 'Schedule Suspended') {
                    pendingSuspensions.set(event.scheduleId!, event.eventTime);
                } else if (event.eventType === 'Schedule Resumed') {
                    const suspendTime = pendingSuspensions.get(event.scheduleId!);
                    if (suspendTime !== undefined) {
                        // Find the appropriate index to insert the suspension
                        let insertIndex = schedule.chronologicalInstances.findIndex(
                            (instance) => instance.startTime > suspendTime,
                        );
                        if (insertIndex === -1) insertIndex = schedule.chronologicalInstances.length;

                        suspensionIndicators.push({
                            index: insertIndex,
                            type: 'suspension',
                            startTime: suspendTime,
                            endTime: event.eventTime,
                            duration: event.eventTime - suspendTime,
                            reason: 'Schedule Suspended',
                        });
                        pendingSuspensions.delete(event.scheduleId!);
                    }
                }
            });

            // Sort suspension indicators by index
            suspensionIndicators.sort((a, b) => a.index - b.index);

            // Render suspension indicator row
            const renderSuspensionRow = (suspension: (typeof suspensionIndicators)[0]) => (
                <Box
                    key={`suspension-${suspension.startTime}`}
                    sx={{
                        py: 1.5,
                        px: 2,
                        backgroundColor: (theme: Theme) => alpha(theme.palette.error.main, 0.08),
                        borderLeft: '4px solid',
                        borderLeftColor: (theme: Theme) => theme.palette.error.main,
                        ml: 0.5,
                        border: '1px dashed',
                        borderColor: (theme: Theme) => alpha(theme.palette.error.main, 0.5),
                        borderRadius: 1,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                            <Chip
                                label="Suspended"
                                size="small"
                                color="error"
                                variant="filled"
                                sx={{ height: 24, minWidth: 80, flexShrink: 0 }}
                            />

                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                <Typography
                                    variant="body1"
                                    sx={{
                                        fontWeight: 600,
                                        color: (theme: Theme) => theme.palette.error.dark,
                                        lineHeight: 1.2,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.5,
                                    }}
                                >
                                    ⏸️ {suspension.reason}
                                    <Typography
                                        component="span"
                                        variant="caption"
                                        sx={{
                                            color: (theme: Theme) => theme.palette.text.secondary,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 0.5,
                                            ml: 1,
                                        }}
                                    >
                                        No music playing
                                    </Typography>
                                </Typography>
                            </Box>
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography
                                variant="body2"
                                sx={{
                                    fontWeight: 500,
                                    color: (theme: Theme) => theme.palette.error.main,
                                    fontFamily: 'monospace',
                                }}
                            >
                                {format(suspension.startTime, 'HH:mm:ss')}
                            </Typography>
                            <Typography
                                variant="caption"
                                sx={{ color: (theme: Theme) => theme.palette.text.secondary }}
                            >
                                →
                            </Typography>
                            <Typography
                                variant="body2"
                                sx={{
                                    fontWeight: 500,
                                    color: (theme: Theme) => theme.palette.error.main,
                                    fontFamily: 'monospace',
                                }}
                            >
                                {format(suspension.endTime, 'HH:mm:ss')}
                            </Typography>
                            <Chip
                                label={formatDuration(suspension.duration)}
                                size="small"
                                color="error"
                                variant="outlined"
                                sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    fontFamily: 'monospace',
                                }}
                            />
                        </Box>
                    </Box>
                </Box>
            );

            // Build the final list of items with suspensions inserted
            const itemsWithSuspensions: React.ReactNode[] = [];
            let suspensionIndex = 0;

            schedule.chronologicalInstances.forEach((instance: ChronologicalSequenceInstance, index: number) => {
                // Check if we need to insert suspension(s) before this item
                while (
                    suspensionIndex < suspensionIndicators.length &&
                    suspensionIndicators[suspensionIndex].index === index
                ) {
                    itemsWithSuspensions.push(renderSuspensionRow(suspensionIndicators[suspensionIndex]));
                    suspensionIndex++;
                }

                // Add the regular sequence item
                const typeConfig = getPlaylistTypeConfig(instance.playlistType);
                itemsWithSuspensions.push(
                    <Box
                        key={`${instance.sequenceId}-${instance.startTime}-${instance.loopNumber}`}
                        sx={{
                            py: 1.5,
                            px: 2,
                            backgroundColor:
                                index % 2 === 0
                                    ? (theme: Theme) => alpha(theme.palette.action.hover, 0.3)
                                    : 'transparent',
                            borderBottom: index < schedule.chronologicalInstances.length - 1 ? '1px solid' : 'none',
                            borderColor: 'divider',
                            '&:hover': {
                                backgroundColor: (theme: Theme) => alpha(theme.palette.action.selected, 0.4),
                            },
                            transition: (theme: Theme) => theme.transitions.create(['background-color']),
                            borderLeft: '4px solid',
                            borderLeftColor: `${typeConfig.color}.main`,
                            ml: 0.5,
                        }}
                    >
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                width: '100%',
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
                                <Chip
                                    label={typeConfig.label}
                                    size="small"
                                    color={typeConfig.color}
                                    variant="outlined"
                                    sx={{ height: 24, minWidth: 60, flexShrink: 0 }}
                                />

                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                    <Typography
                                        variant="body1"
                                        sx={{
                                            fontWeight: 600,
                                            color: 'text.primary',
                                            lineHeight: 1.2,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 0.5,
                                        }}
                                    >
                                        Loop {instance.loopNumber} - {instance.sequenceName}
                                        <Typography
                                            component="span"
                                            variant="caption"
                                            sx={{
                                                color: 'text.secondary',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 0.5,
                                                ml: 1,
                                            }}
                                        >
                                            <PersonIcon sx={{ fontSize: 12 }} />
                                            {instance.artist}
                                        </Typography>
                                    </Typography>
                                </Box>
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontWeight: 500,
                                        color: 'text.primary',
                                        fontFamily: 'monospace',
                                    }}
                                >
                                    {format(instance.startTime, 'HH:mm:ss')}
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    →
                                </Typography>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontWeight: 500,
                                        color: 'text.primary',
                                        fontFamily: 'monospace',
                                    }}
                                >
                                    {format(instance.endTime, 'HH:mm:ss')}
                                </Typography>
                                <Chip
                                    label={formatDuration(instance.endTime - instance.startTime)}
                                    size="small"
                                    color="default"
                                    variant="outlined"
                                    sx={{
                                        height: 20,
                                        fontSize: '0.7rem',
                                        fontFamily: 'monospace',
                                    }}
                                />
                            </Box>
                        </Box>
                    </Box>,
                );
            });

            // Add any remaining suspensions at the end
            while (suspensionIndex < suspensionIndicators.length) {
                itemsWithSuspensions.push(renderSuspensionRow(suspensionIndicators[suspensionIndex]));
                suspensionIndex++;
            }

            return (
                <List
                    dense
                    sx={{
                        p: 0,
                    }}
                >
                    {itemsWithSuspensions}
                </List>
            );
        };

        // Helper function to render playlist section
        const renderPlaylistSection = (
            playlistData: ProcessedPlaylist | { sequences: ProcessedSchedule['sequences']; playlistType?: string },
            schedule: ProcessedSchedule,
        ) => {
            const playlistType = 'playlistType' in playlistData ? playlistData.playlistType : 'main';
            const sequences = playlistData.sequences;
            const typeConfig = getPlaylistTypeConfig(playlistType as 'intro' | 'main' | 'outro');
            const playlistId = 'playlistId' in playlistData ? playlistData.playlistId : schedule.playlistId;

            // Create unique key for this playlist within the schedule
            const playlistKey = `${schedule.scheduleId}-${playlistType}`;
            const isExpanded = expandedPlaylist === playlistKey;

            return (
                <Accordion
                    key={playlistKey}
                    expanded={isExpanded}
                    onChange={handlePlaylistAccordionChange(playlistKey)}
                    sx={{
                        mb: 1,
                        border: '1px solid',
                        borderColor: `${typeConfig.color}.main`,
                        borderRadius: 2,
                        backgroundColor: `${typeConfig.color}.50`,
                        overflow: 'hidden',
                        '&:before': { display: 'none' },
                        '&.Mui-expanded': {
                            margin: (theme: Theme) => theme.spacing(1, 0),
                        },
                    }}
                >
                    <AccordionSummary
                        expandIcon={<ExpandMoreIcon />}
                        sx={{
                            py: 1,
                            px: 2,
                            backgroundColor: `${typeConfig.color}.100`,
                            borderBottom: isExpanded ? '1px solid' : 'none',
                            borderColor: `${typeConfig.color}.main`,
                            minHeight: 48,
                            '&:hover': {
                                backgroundColor: `${typeConfig.color}.200`,
                            },
                            transition: (theme: Theme) => theme.transitions.create(['background-color']),
                        }}
                    >
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                width: '100%',
                                pr: 1,
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography
                                    variant="body1"
                                    sx={{
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                    }}
                                >
                                    <span>{typeConfig.icon}</span>
                                    {typeConfig.label} Playlist: {getPlaylistName(playlistId)}
                                </Typography>
                                <Tooltip title={typeConfig.description} arrow>
                                    <Chip
                                        label={typeConfig.label}
                                        size="small"
                                        color={typeConfig.color}
                                        variant="filled"
                                    />
                                </Tooltip>
                            </Box>
                        </Box>
                    </AccordionSummary>

                    <AccordionDetails
                        sx={{
                            p: 0,
                        }}
                    >
                        {sequences.length === 0 ? (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                    fontStyle: 'italic',
                                    p: 2,
                                    textAlign: 'center',
                                }}
                            >
                                No songs found for this {typeConfig.label.toLowerCase()} playlist.
                            </Typography>
                        ) : (
                            <List
                                dense
                                sx={{
                                    p: 0,
                                }}
                            >
                                {sequences.map((sequence: ProcessedSchedule['sequences'][0], index: number) => (
                                    <Box
                                        key={sequence.id}
                                        sx={{
                                            py: 1.5,
                                            px: 2,
                                            backgroundColor:
                                                index % 2 === 0
                                                    ? (theme: Theme) => alpha(theme.palette.action.hover, 0.3)
                                                    : 'transparent',
                                            borderBottom: index < sequences.length - 1 ? '1px solid' : 'none',
                                            borderColor: 'divider',
                                            '&:hover': {
                                                backgroundColor: (theme: Theme) =>
                                                    alpha(theme.palette.action.selected, 0.4),
                                            },
                                            transition: (theme: Theme) =>
                                                theme.transitions.create(['background-color']),
                                        }}
                                    >
                                        <Stack spacing={0.5} sx={{ width: '100%' }}>
                                            <Box
                                                sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                                            >
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        fontWeight: 500,
                                                        color: 'text.primary',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 0.5,
                                                    }}
                                                >
                                                    {getSequenceName(sequence.id)}
                                                    <Typography
                                                        component="span"
                                                        variant="caption"
                                                        sx={{
                                                            fontStyle: 'italic',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 0.5,
                                                            color: 'text.secondary',
                                                            ml: 1,
                                                        }}
                                                    >
                                                        <PersonIcon sx={{ fontSize: 12 }} />
                                                        {sequence.artist}
                                                    </Typography>
                                                </Typography>
                                                <Chip
                                                    label={`#${sequence.order}`}
                                                    size="small"
                                                    color="primary"
                                                    variant="outlined"
                                                    sx={{ height: 20 }}
                                                />
                                            </Box>
                                        </Stack>
                                    </Box>
                                ))}
                            </List>
                        )}
                    </AccordionDetails>
                </Accordion>
            );
        };

        if (!data?.logs?.length) {
            return (
                <Card className={className} sx={{ mb: 2 }}>
                    <CardContent>
                        <Typography variant="body2" color="text.secondary">
                            No scheduled songs found in the selected date range.
                        </Typography>
                    </CardContent>
                </Card>
            );
        }

        return (
            <>
                <Card
                    className={className}
                    sx={{ mb: 2, backgroundColor: 'background.paper', boxShadow: (theme: Theme) => theme.shadows[2] }}
                >
                    <CardContent>
                        <Box
                            sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                mb: 3,
                                flexWrap: 'wrap',
                                gap: 2,
                            }}
                        >
                            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                                Scheduled Playlists in Range
                            </Typography>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={showLoops}
                                        onChange={(e) => setShowLoops(e.target.checked)}
                                        color="primary"
                                    />
                                }
                                label={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        Show Loop Details
                                    </Box>
                                }
                                sx={{
                                    '& .MuiFormControlLabel-label': {
                                        fontSize: '0.875rem',
                                        fontWeight: 500,
                                        color: 'text.primary',
                                    },
                                }}
                            />
                        </Box>

                        <List>
                            {Array.from(schedulesByDate.entries()).map(([date, schedules]) => (
                                <Accordion
                                    key={date}
                                    expanded={expandedDate === date}
                                    onChange={handleDateAccordionChange(date)}
                                    sx={{
                                        mb: 1,
                                        boxShadow: (theme: Theme) => theme.shadows[1],
                                        borderRadius: 1,
                                        '&:before': { display: 'none' },
                                        '&.Mui-expanded': {
                                            margin: (theme: Theme) => theme.spacing(2, 0),
                                            backgroundColor: 'background.default',
                                        },
                                    }}
                                >
                                    <AccordionSummary
                                        expandIcon={<ExpandMoreIcon />}
                                        sx={{
                                            backgroundColor: 'background.default',
                                            borderRadius: (theme: Theme) =>
                                                `${theme.shape.borderRadius}px ${theme.shape.borderRadius}px 0 0`,
                                            transition: (theme: Theme) =>
                                                theme.transitions.create(['background-color']),
                                            '&:hover': {
                                                backgroundColor: 'action.hover',
                                            },
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <CalendarTodayIcon sx={{ color: 'primary.main' }} />
                                            <Typography variant="h6" sx={{ fontWeight: 500 }}>
                                                {format(new Date(date), 'dd-MMM-yyyy HH:mm:ss')}
                                            </Typography>
                                            <Chip
                                                label={`${schedules.length} schedule${schedules.length !== 1 ? 's' : ''}`}
                                                size="small"
                                                color="secondary"
                                            />
                                        </Box>
                                    </AccordionSummary>
                                    <AccordionDetails sx={{ p: 1 }}>
                                        <Stack spacing={1}>
                                            {schedules.map((schedule: ProcessedSchedule) => {
                                                const { priorityLabel, priorityClass, typeLabel, typeClass } =
                                                    getSchedulePriorityConfig(schedule.scheduleId);
                                                return (
                                                    <Accordion
                                                        key={schedule.scheduleId}
                                                        expanded={expandedSchedule === schedule.scheduleId}
                                                        onChange={handleScheduleAccordionChange(schedule.scheduleId)}
                                                        ref={(el) => {
                                                            if (el) {
                                                                scheduleRefs.current.set(schedule.scheduleId, el);
                                                            } else {
                                                                scheduleRefs.current.delete(schedule.scheduleId);
                                                            }
                                                        }}
                                                        sx={{
                                                            boxShadow: (theme: Theme) => theme.shadows[1],
                                                            borderRadius: 1,
                                                            '&:before': { display: 'none' },
                                                            '&.Mui-expanded': {
                                                                margin: '0 !important',
                                                                backgroundColor: 'background.paper',
                                                            },
                                                        }}
                                                    >
                                                        <AccordionSummary
                                                            expandIcon={<ExpandMoreIcon />}
                                                            sx={{
                                                                backgroundColor: 'background.paper',
                                                                borderRadius: 1,
                                                                py: 1,
                                                                px: 2,
                                                                minHeight: 40,
                                                                '&.Mui-expanded': {
                                                                    minHeight: 40,
                                                                    py: 1,
                                                                },
                                                                '& .MuiAccordionSummary-content': {
                                                                    my: 0,
                                                                },
                                                                '& .MuiAccordionSummary-content.Mui-expanded': {
                                                                    my: 0,
                                                                },
                                                                '&:hover': {
                                                                    backgroundColor: 'action.hover',
                                                                },
                                                            }}
                                                        >
                                                            <Box
                                                                sx={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'space-between',
                                                                    width: '100%',
                                                                }}
                                                            >
                                                                <Box>
                                                                    <Box
                                                                        sx={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: 1,
                                                                        }}
                                                                    >
                                                                        <Typography
                                                                            variant="subtitle1"
                                                                            sx={{
                                                                                fontWeight: 600,
                                                                                color: 'text.primary',
                                                                            }}
                                                                        >
                                                                            {getScheduleName(schedule.scheduleId)} -
                                                                        </Typography>
                                                                        <Typography
                                                                            variant="body2"
                                                                            sx={{
                                                                                fontWeight: 500,
                                                                                color: 'text.primary',
                                                                                fontFamily: 'monospace',
                                                                            }}
                                                                        >
                                                                            {(() => {
                                                                                const reduxSchedule =
                                                                                    schedulesList.find(
                                                                                        (s) =>
                                                                                            s.id ===
                                                                                            schedule.scheduleId,
                                                                                    );
                                                                                const timeString = reduxSchedule
                                                                                    ? formatExtendedTime(
                                                                                          reduxSchedule.fromTime,
                                                                                      )
                                                                                    : format(
                                                                                          new Date(schedule.startTime),
                                                                                          'HH:mm',
                                                                                      );
                                                                                const isExtended =
                                                                                    reduxSchedule &&
                                                                                    parseInt(
                                                                                        reduxSchedule.fromTime.split(
                                                                                            ':',
                                                                                        )[0],
                                                                                    ) >= 24;
                                                                                return (
                                                                                    <Tooltip
                                                                                        title={
                                                                                            isExtended
                                                                                                ? `Extended time: ${reduxSchedule.fromTime} (${parseInt(reduxSchedule.fromTime.split(':')[0]) - 24}:${reduxSchedule.fromTime.split(':')[1]} next day)`
                                                                                                : `Start time: ${timeString}`
                                                                                        }
                                                                                        arrow
                                                                                    >
                                                                                        <span>{timeString}</span>
                                                                                    </Tooltip>
                                                                                );
                                                                            })()}
                                                                        </Typography>
                                                                        <Typography
                                                                            variant="caption"
                                                                            sx={{ color: 'text.secondary' }}
                                                                        >
                                                                            →
                                                                        </Typography>
                                                                        <Typography
                                                                            variant="body2"
                                                                            sx={{
                                                                                fontWeight: 500,
                                                                                color: 'text.primary',
                                                                                fontFamily: 'monospace',
                                                                            }}
                                                                        >
                                                                            {(() => {
                                                                                const reduxSchedule =
                                                                                    schedulesList.find(
                                                                                        (s) =>
                                                                                            s.id ===
                                                                                            schedule.scheduleId,
                                                                                    );
                                                                                const timeString = reduxSchedule
                                                                                    ? formatExtendedTime(
                                                                                          reduxSchedule.toTime,
                                                                                      )
                                                                                    : format(
                                                                                          new Date(schedule.endTime),
                                                                                          'HH:mm',
                                                                                      );
                                                                                const isExtended =
                                                                                    reduxSchedule &&
                                                                                    parseInt(
                                                                                        reduxSchedule.toTime.split(
                                                                                            ':',
                                                                                        )[0],
                                                                                    ) >= 24;
                                                                                return (
                                                                                    <Tooltip
                                                                                        title={
                                                                                            isExtended
                                                                                                ? `Extended time: ${reduxSchedule.toTime} (${parseInt(reduxSchedule.toTime.split(':')[0]) - 24}:${reduxSchedule.toTime.split(':')[1]} next day)`
                                                                                                : `End time: ${timeString}`
                                                                                        }
                                                                                        arrow
                                                                                    >
                                                                                        <span>{timeString}</span>
                                                                                    </Tooltip>
                                                                                );
                                                                            })()}
                                                                        </Typography>
                                                                        <Chip
                                                                            label={formatDuration(
                                                                                schedule.totalDuration,
                                                                            )}
                                                                            size="small"
                                                                            color="primary"
                                                                            variant="outlined"
                                                                            sx={{
                                                                                height: 20,
                                                                                fontSize: '0.7rem',
                                                                                fontFamily: 'monospace',
                                                                            }}
                                                                        />
                                                                    </Box>
                                                                    <Box
                                                                        sx={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: 1,
                                                                            mt: 0.5,
                                                                        }}
                                                                    >
                                                                        <Chip
                                                                            label={typeLabel}
                                                                            size="small"
                                                                            variant="outlined"
                                                                            sx={{
                                                                                height: 20,
                                                                                fontSize: '0.7rem',
                                                                                fontFamily: 'monospace',
                                                                                backgroundColor:
                                                                                    typeClass === 'type-main'
                                                                                        ? theme.palette.primary.light
                                                                                        : theme.palette.info.light,
                                                                                color:
                                                                                    typeClass === 'type-main'
                                                                                        ? theme.palette.primary.dark
                                                                                        : theme.palette.info.dark,
                                                                                borderColor:
                                                                                    typeClass === 'type-main'
                                                                                        ? theme.palette.primary.main
                                                                                        : theme.palette.info.main,
                                                                                fontWeight: 600,
                                                                                letterSpacing: 0.3,
                                                                                boxShadow:
                                                                                    '0 1px 3px rgba(0, 0, 0, 0.2)',
                                                                            }}
                                                                        />
                                                                        <Chip
                                                                            label={priorityLabel}
                                                                            size="small"
                                                                            variant="outlined"
                                                                            sx={{
                                                                                height: 20,
                                                                                fontSize: '0.7rem',
                                                                                fontFamily: 'monospace',
                                                                                backgroundColor:
                                                                                    priorityClass === 'priority-high'
                                                                                        ? theme.palette.error.main
                                                                                        : priorityClass ===
                                                                                            'priority-normal'
                                                                                          ? theme.palette.primary.main
                                                                                          : theme.palette.info.main,
                                                                                color:
                                                                                    priorityClass === 'priority-high'
                                                                                        ? theme.palette.error
                                                                                              .contrastText
                                                                                        : priorityClass ===
                                                                                            'priority-normal'
                                                                                          ? theme.palette.primary
                                                                                                .contrastText
                                                                                          : theme.palette.info
                                                                                                .contrastText,
                                                                                borderColor:
                                                                                    priorityClass === 'priority-high'
                                                                                        ? theme.palette.error.dark
                                                                                        : priorityClass ===
                                                                                            'priority-normal'
                                                                                          ? theme.palette.primary.dark
                                                                                          : theme.palette.info.dark,
                                                                                fontWeight: 600,
                                                                                letterSpacing: 0.3,
                                                                                boxShadow:
                                                                                    '0 1px 3px rgba(0, 0, 0, 0.2)',
                                                                            }}
                                                                        />
                                                                    </Box>
                                                                </Box>
                                                            </Box>
                                                        </AccordionSummary>
                                                        <AccordionDetails
                                                            sx={{
                                                                backgroundColor: 'background.default',
                                                                borderRadius: (theme: Theme) =>
                                                                    `0 0 ${theme.shape.borderRadius}px ${theme.shape.borderRadius}px`,
                                                                p: 0.5,
                                                            }}
                                                        >
                                                            <Box
                                                                sx={{
                                                                    width: '100%',
                                                                    borderTop: (theme: Theme) =>
                                                                        `1px solid ${theme.palette.divider}`,
                                                                    pt: 1,
                                                                }}
                                                            >
                                                                {showLoops ? (
                                                                    <Box
                                                                        sx={{
                                                                            backgroundColor: 'background.default',
                                                                            borderRadius: 1,
                                                                            overflow: 'hidden',
                                                                        }}
                                                                    >
                                                                        {renderChronologicalView(schedule)}
                                                                    </Box>
                                                                ) : (
                                                                    <Box
                                                                        sx={{
                                                                            backgroundColor: 'background.default',
                                                                            borderRadius: 1,
                                                                            overflow: 'hidden',
                                                                        }}
                                                                    >
                                                                        {/* Render intro playlist if exists */}
                                                                        {schedule.introPlaylist &&
                                                                            renderPlaylistSection(
                                                                                schedule.introPlaylist,
                                                                                schedule,
                                                                            )}

                                                                        {/* Render main playlist */}
                                                                        {renderPlaylistSection(
                                                                            {
                                                                                sequences: schedule.sequences,
                                                                                playlistType: 'main',
                                                                            },
                                                                            schedule,
                                                                        )}

                                                                        {/* Render outro playlist if exists */}
                                                                        {schedule.outroPlaylist &&
                                                                            renderPlaylistSection(
                                                                                schedule.outroPlaylist,
                                                                                schedule,
                                                                            )}

                                                                        {!schedule.introPlaylist &&
                                                                            schedule.sequences.length === 0 &&
                                                                            !schedule.outroPlaylist && (
                                                                                <Typography
                                                                                    variant="body2"
                                                                                    color="text.secondary"
                                                                                    sx={{
                                                                                        fontStyle: 'italic',
                                                                                        textAlign: 'center',
                                                                                        py: 4,
                                                                                    }}
                                                                                >
                                                                                    No songs found for this schedule.
                                                                                </Typography>
                                                                            )}
                                                                    </Box>
                                                                )}
                                                            </Box>
                                                        </AccordionDetails>
                                                    </Accordion>
                                                );
                                            })}
                                        </Stack>
                                    </AccordionDetails>
                                </Accordion>
                            ))}
                        </List>
                    </CardContent>
                </Card>
            </>
        );
    },
);

ScheduledPlaylistsList.displayName = 'ScheduledPlaylistsList';

export default ScheduledPlaylistsList;
