import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Box, CircularProgress, Alert, Stack, Typography } from '@mui/material';
import { useSelector } from 'react-redux';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { RootState } from '../../store/Store';
import SchedulePreviewSettings from './SchedulePreviewSettings';
import { generateSchedulePreview } from '../../util/schedulePreviewUtils';
import { SchedulePreviewSettings as SettingsType, ParallelSchedulePreviewData } from '../../types/SchedulePreviewTypes';
import { DEFAULT_SCHEDULE_PREVIEW_SETTINGS } from '../../constants/schedulePreviewConstants';
import ScheduledPlaylistsList, {
    ScheduleData,
    ScheduledPlaylistsListRef,
} from './ScheduledPlaylistsList/ScheduledPlaylistsList';
import GraphForSchedule from './GraphForSchedule';
import { priorityToNumber } from '@ezplayer/ezplayer-core';

interface SchedulePreviewProps {
    title: string;
    className?: string;
    statusArea: React.ReactNode[];
}

export const SchedulePreview: React.FC<SchedulePreviewProps> = ({ title, statusArea, className = '' }) => {
    const [settings, setSettings] = useState<SettingsType>(DEFAULT_SCHEDULE_PREVIEW_SETTINGS);
    const [previewData, setPreviewData] = useState<ParallelSchedulePreviewData | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);

    // Ref for the accordion section to enable scrolling
    const accordionRef = useRef<HTMLDivElement>(null);
    // Ref for the ScheduledPlaylistsList component
    const scheduledPlaylistsRef = useRef<ScheduledPlaylistsListRef>(null);

    // Get data from Redux store
    const sequences = useSelector((state: RootState) => state.sequences.sequenceData || []);
    const playlists = useSelector((state: RootState) => state.playlists.playlists || []);
    const schedules = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);

    // Memoize data availability
    const hasData = useMemo(() => {
        return sequences.length > 0 && playlists.length > 0 && schedules.length > 0;
    }, [sequences.length, playlists.length, schedules.length]);

    // Helper to combine date and time into a timestamp
    const combineDateAndTime = (date: Date, time: string) => {
        const d = new Date(date);
        const [hours, minutes] = time.split(':').map(Number);
        d.setHours(hours ?? 0, minutes ?? 0, 0, 0);
        return d.getTime();
    };

    // Filter schedules by selected date and time range
    const filteredSchedules = useMemo(() => {
        const start = combineDateAndTime(settings.startDate, settings.startTime);
        const end = combineDateAndTime(settings.endDate, settings.endTime);
        return schedules.filter((sch) => {
            const schStart = combineDateAndTime(new Date(sch.date), sch.fromTime);
            const timeMatches = schStart >= start && schStart <= end;

            // Apply schedule type filter
            let typeMatches = true;
            if (settings.scheduleTypeFilter === 'main') {
                typeMatches = sch.scheduleType !== 'background';
            } else if (settings.scheduleTypeFilter === 'background') {
                typeMatches = sch.scheduleType === 'background';
            }
            // If filter is 'all', typeMatches remains true

            return timeMatches && typeMatches;
        });
    }, [
        schedules,
        settings.startDate,
        settings.startTime,
        settings.endDate,
        settings.endTime,
        settings.scheduleTypeFilter,
    ]);

    // Separate schedules into background and main for parallel simulation
    const { backgroundSchedules, mainSchedules } = useMemo(() => {
        const background = filteredSchedules.filter((sch) => sch.scheduleType === 'background');
        const main = filteredSchedules.filter((sch) => sch.scheduleType !== 'background');

        // Sort both arrays by priority first, then by start time
        const sortByPriorityAndTime = (schedules: typeof filteredSchedules) => {
            return schedules.sort((a, b) => {
                // Get priority values (default to 'normal' if not set)
                const priorityA = a.priority || 'normal';
                const priorityB = b.priority || 'normal';

                // Convert priority to number for comparison
                const priorityValueA = priorityToNumber[priorityA] || priorityToNumber.normal;
                const priorityValueB = priorityToNumber[priorityB] || priorityToNumber.normal;

                // Sort by priority first (higher number = lower priority, so we want low priority first)
                if (priorityValueA !== priorityValueB) {
                    return priorityValueB - priorityValueA; // Reverse the comparison
                }

                // If priorities are equal, sort by start time
                const startTimeA = combineDateAndTime(new Date(a.date), a.fromTime);
                const startTimeB = combineDateAndTime(new Date(b.date), b.fromTime);
                return startTimeA - startTimeB;
            });
        };

        // Background schedules are processed first, then main schedules
        return {
            backgroundSchedules: sortByPriorityAndTime(background),
            mainSchedules: sortByPriorityAndTime(main),
        };
    }, [filteredSchedules]);

    const handleGeneratePreview = useCallback(
        async (newSettings: SettingsType) => {
            if (!hasData) {
                setError(
                    'No schedule data available. Please ensure you have sequences, playlists, and schedules configured.',
                );
                return;
            }

            setIsGenerating(true);
            setError(null);
            setWarnings([]);
            setPreviewData(null); // Clear previous preview data immediately

            try {
                // Use setTimeout to allow UI to update before heavy computation
                setTimeout(() => {
                    try {
                        // Generate separate previews for background and main schedules
                        const backgroundData = generateSchedulePreview(
                            sequences,
                            playlists,
                            backgroundSchedules,
                            newSettings,
                        );

                        const mainData = generateSchedulePreview(sequences, playlists, mainSchedules, newSettings);

                        // Handle edge cases where there might be no schedules of a particular type
                        if (backgroundSchedules.length === 0 && mainSchedules.length === 0) {
                            setError(
                                'No schedules found in the selected time range. Please check your schedule configuration or try a different date range.',
                            );
                            setIsGenerating(false);
                            return;
                        }

                        // Combine the results into a parallel schedule preview
                        const combinedData: ParallelSchedulePreviewData = {
                            background: backgroundData,
                            main: mainData,
                            startTime: Math.min(backgroundData.startTime, mainData.startTime),
                            endTime: Math.max(backgroundData.endTime, mainData.endTime),
                            errors: [...(backgroundData.errors || []), ...(mainData.errors || [])],
                            warnings: [],
                        };

                        // Handle any errors or warnings from the preview generation
                        if (combinedData.errors && combinedData.errors.length > 0) {
                            setWarnings(combinedData.errors);
                        }

                        // Check if either preview was truncated
                        if (backgroundData.logs.length >= newSettings.maxEvents) {
                            combinedData.warnings?.push(
                                `Background schedule preview was truncated after ${newSettings.maxEvents} events.`,
                            );
                        }
                        if (mainData.logs.length >= newSettings.maxEvents) {
                            combinedData.warnings?.push(
                                `Main schedule preview was truncated after ${newSettings.maxEvents} events.`,
                            );
                        }

                        if (combinedData.warnings && combinedData.warnings.length > 0) {
                            setWarnings((prev) => [...prev, ...combinedData.warnings!]);
                        }

                        setPreviewData(combinedData);
                        setSettings(newSettings);
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : 'Failed to generate schedule preview';
                        console.error('Schedule preview generation error:', err);
                        setError(
                            `${errorMessage}. Try reducing the preview time window or simplifying the schedule configuration.`,
                        );
                    } finally {
                        setIsGenerating(false);
                    }
                }, 100);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to generate schedule preview';
                setError(errorMessage);
                setIsGenerating(false);
            }
        },
        [sequences, playlists, backgroundSchedules, mainSchedules, hasData],
    );

    const handleSettingsChange = useCallback(
        (newSettings: SettingsType) => {
            setSettings(newSettings);

            // Clear preview data when date changes to show fresh state
            const currentDateKey = `${settings.startDate?.toDateString()}-${settings.endDate?.toDateString()}`;
            const newDateKey = `${newSettings.startDate?.toDateString()}-${newSettings.endDate?.toDateString()}`;

            if (currentDateKey !== newDateKey) {
                setPreviewData(null);
                setError(null);
                setWarnings([]);
            }
        },
        [settings.startDate, settings.endDate],
    );

    // Handle timeline item click to scroll to specific schedule accordion
    const handleTimelineItemClick = useCallback((scheduleId?: string, _playlistId?: string) => {
        if (scheduleId && scheduledPlaylistsRef.current) {
            // Scroll directly to the specific schedule accordion
            scheduledPlaylistsRef.current.scrollToSchedule(scheduleId);
        } else if (accordionRef.current) {
            // Fallback to general accordion scroll if no scheduleId
            accordionRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
            });
        }
    }, []);

    // Create combined data for the ScheduledPlaylistsList
    const combinedPreviewData = useMemo(() => {
        if (!previewData) return null;

        // Merge logs from both background and main schedules
        const allLogs = [...previewData.background.logs, ...previewData.main.logs];

        // Sort by event time
        allLogs.sort((a, b) => a.eventTime - b.eventTime);

        // Ensure we have valid data
        if (allLogs.length === 0) {
            return null;
        }

        return {
            currentState: [...previewData.background.currentState, ...previewData.main.currentState],
            logs: allLogs,
            startTime: previewData.startTime,
            endTime: previewData.endTime,
            errors: previewData.errors,
        };
    }, [previewData]);

    return (
        <>
            <Box
                className={`schedule-preview ${className}`}
                sx={{
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <Box sx={{ padding: 2, flexShrink: 0 }}>
                    <PageHeader heading={title} children={statusArea} />
                </Box>

                {/* Settings Panel */}
                <Box sx={{ padding: 2, flexShrink: 0 }}>
                    <SchedulePreviewSettings
                        settings={settings}
                        onSettingsChange={handleSettingsChange}
                        onGeneratePreview={handleGeneratePreview}
                        isGenerating={isGenerating}
                        hasData={hasData}
                    />
                </Box>

                {/* Errors and Warnings */}
                <Stack spacing={1} sx={{ padding: 2, flexShrink: 0 }}>
                    {error && (
                        <Alert severity="error" onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    )}
                    {warnings.map((warning, index) => (
                        <Alert
                            key={index}
                            severity="warning"
                            onClose={() => setWarnings((prev) => prev.filter((_, i) => i !== index))}
                        >
                            {warning}
                        </Alert>
                    ))}
                </Stack>

                {/* Loading Indicator */}
                {isGenerating && (
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            padding: 4,
                            flexShrink: 0,
                        }}
                    >
                        <CircularProgress size={40} />
                        <Box sx={{ ml: 2 }}>Generating schedule preview...</Box>
                    </Box>
                )}

                {/* Timeline Display */}
                {previewData && !isGenerating && (
                    <Box
                        sx={{
                            flex: 1,
                            overflow: 'auto',
                            padding: 2,
                        }}
                    >
                        {/*
                    <Typography variant="h6">
                    Errors: {previewData.errors?.join('\n')+'\n'}
                    </Typography>
                    <Typography variant="h6">
                    Details: {`${previewData.logs.length}\n`}
                    </Typography>
                    <Box>
                    {
                        (previewData.logs.map(
                            (e, index)=> {
                                // Find the corresponding schedule, playlist, and sequence with null checks
                                const schedule = schedules.find((s) => s.id === e.scheduleId);
                                const playlist = e.playlistId ? playlists.find((p) => p.id === e.playlistId) : null;
                                const sequence = e.sequenceId ? sequences.find((s) => s.id === e.sequenceId) : null;
                                
                                return (
                                    <Typography key={index} variant="h6">
                                        {`${e.eventType}: ${e.stackDepth} @${new Date(e.eventTime).toISOString()} (${e.entryIntoPlaylist ? e.entryIntoPlaylist.map((entry) => entry.toString()).join(',') : '?'}.${e.timeIntoSeqMS ? e.timeIntoSeqMS.toString() : ''}) : ${schedule?.title || '<unknown>'}.${playlist?.title || 'N/A'}.${sequence?.work?.title || 'N/A'}`}
                                    </Typography>
                                );
                            }
                        ))
                    }
                    </Box>
                    */}
                        <GraphForSchedule
                            data={previewData}
                            onItemClick={handleTimelineItemClick}
                            selectedStartTime={combineDateAndTime(settings.startDate, settings.startTime)}
                            selectedEndTime={combineDateAndTime(settings.endDate, settings.endTime)}
                        />
                        {/* Show filtered scheduled playlists below the timeline */}
                        {combinedPreviewData && (
                            <Box ref={accordionRef} sx={{ mt: 3 }}>
                                <ScheduledPlaylistsList
                                    ref={scheduledPlaylistsRef}
                                    data={combinedPreviewData as ScheduleData}
                                />
                            </Box>
                        )}

                        {/* Show message if no combined data */}
                        {!combinedPreviewData && (
                            <Box sx={{ mt: 3, p: 2, textAlign: 'center' }}>
                                <Typography variant="body2" color="text.secondary">
                                    No schedule events found in the selected time range.
                                </Typography>
                            </Box>
                        )}
                    </Box>
                )}

                {/* No Data Message */}
                {!hasData && !isGenerating && (
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            padding: 4,
                            flex: 1,
                        }}
                    >
                        <Alert severity="info">
                            No schedule data available. Please configure sequences, playlists, and schedules first.
                        </Alert>
                    </Box>
                )}
            </Box>
        </>
    );
};
