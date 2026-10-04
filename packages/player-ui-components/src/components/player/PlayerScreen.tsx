import { PageHeader } from '@ezplayer/shared-ui-components';
import { Alert, Card, CardContent, Chip, CircularProgress, Grid, Typography } from '@mui/material';
import { Box } from '../box/Box';
import { addDays, addHours, endOfDay, startOfDay, startOfHour } from 'date-fns';
import React, { useMemo, useRef } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store/Store';
import { SchedulePreviewSettings } from '../../types/SchedulePreviewTypes';
import { generateSchedulePreview } from '../../util/schedulePreviewUtils';
import { DEFAULT_SCHEDULE_PREVIEW_SETTINGS } from '../../constants/schedulePreviewConstants';
import GraphForSchedule from '../schedule-preview/GraphForSchedule';
import { NowPlayingCard } from './NowPlayingCard';
import { getControllerStats } from '../status/ControllerHelpers';

interface PlayerScreenProps {
    title: string;
    statusArea: React.ReactNode[];
    /** Allow live master-volume control + the volume-settings gear on the Now Playing card. */
    allowVolumeControl?: boolean;
    /** Allow End/Abort playback controls. False in kiosk so a public display can't stop the show. */
    allowStopControls?: boolean;
}

const StatusCards = ({
    allowVolumeControl,
    allowStopControls,
}: {
    allowVolumeControl?: boolean;
    allowStopControls?: boolean;
}) => {
    const runtime = useSelector((state: RootState) => state.runtime);

    return (
        <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
            {/* Now Playing Card and Controller Status */}
            <Grid container spacing={2}>
                <Grid item xs={12} md={12} lg={6} xl={4}>
                    {runtime.combined?.player ? (
                        <NowPlayingCard
                            player={runtime.combined.player}
                            compact={true}
                            allowVolumeControl={allowVolumeControl}
                            allowStopControls={allowStopControls}
                        />
                    ) : runtime.combined?.show ? (
                        <Card sx={{ height: '100%' }}>
                            <CardContent>
                                <Typography variant="body2" color="text.secondary">
                                    Show: {runtime.combined.show.show_name}
                                </Typography>
                                <Typography variant="caption" display="block">
                                    Player data not available
                                </Typography>
                            </CardContent>
                        </Card>
                    ) : null}
                </Grid>

                {/* Controller Status Summary */}
                {runtime.combined?.controller &&
                    (() => {
                        const controller = runtime.combined.controller;
                        const stats = getControllerStats(controller.controllers);

                        return (
                            <Grid item xs={12} md={12} lg={6} xl={4}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography variant="h6" color="primary" gutterBottom>
                                            Controller Status
                                        </Typography>

                                        {/* System Info */}
                                        <Box sx={{ mb: 2 }}>
                                            <Typography variant="body2" color="text.secondary" gutterBottom>
                                                Models: {controller.n_models ?? '—'} | Channels:{' '}
                                                {controller.n_channels ?? '—'}
                                            </Typography>
                                        </Box>

                                        {/* Controller Count Summary */}
                                        <Box sx={{ mb: 2 }}>
                                            <Typography variant="body1" sx={{ fontWeight: 'bold', mb: 1 }}>
                                                Controllers: {stats.total}
                                                {(controller.controllers?.length ?? 0) === stats.total
                                                    ? ''
                                                    : ` (${controller.controllers?.length} including skipped)`}
                                            </Typography>

                                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                                                <Chip
                                                    label={`${stats.online} Online; ${stats.offline} Offline`}
                                                    color={
                                                        stats.online === stats.total
                                                            ? 'success'
                                                            : stats.offline > 0
                                                              ? 'error'
                                                              : 'warning'
                                                    }
                                                    size="small"
                                                />
                                            </Box>
                                        </Box>

                                        {/* Error Summary */}
                                        {stats.errorCount > 0 && (
                                            <Box
                                                sx={{
                                                    p: 1,
                                                    bgcolor: 'error.light',
                                                    borderRadius: 1,
                                                    border: '1px solid',
                                                    borderColor: 'error.main',
                                                }}
                                            >
                                                <Typography
                                                    variant="body2"
                                                    color="error.main"
                                                    sx={{ fontWeight: 'bold' }}
                                                >
                                                    ⚠ {stats.errorCount} Error{stats.errorCount !== 1 ? 's' : ''} in{' '}
                                                    {stats.withErrors} Controller{stats.withErrors !== 1 ? 's' : ''}
                                                </Typography>
                                            </Box>
                                        )}

                                        {/* All Good Status */}
                                        {stats.total > 0 && stats.online === stats.total && stats.errorCount === 0 && (
                                            <Box
                                                sx={{
                                                    p: 1,
                                                    bgcolor: 'success.light',
                                                    borderRadius: 1,
                                                    border: '1px solid',
                                                    borderColor: 'success.main',
                                                }}
                                            >
                                                <Typography
                                                    variant="body2"
                                                    color="success.main"
                                                    sx={{ fontWeight: 'bold' }}
                                                >
                                                    ✅ All Controllers Online & Healthy
                                                </Typography>
                                            </Box>
                                        )}

                                        {/* No Controllers */}
                                        {stats.total === 0 && (
                                            <Box
                                                sx={{
                                                    p: 1,
                                                    bgcolor: 'grey.100',
                                                    borderRadius: 1,
                                                    border: '1px solid',
                                                    borderColor: 'grey.300',
                                                }}
                                            >
                                                <Typography variant="body2" color="text.secondary">
                                                    No Controllers Assigned
                                                </Typography>
                                            </Box>
                                        )}
                                    </CardContent>
                                </Card>
                            </Grid>
                        );
                    })()}
            </Grid>
        </Box>
    );
};

const TimelineView = () => {
    // Get data from Redux store
    const sequences = useSelector((state: RootState) => state.sequences.sequenceData || []);
    const playlists = useSelector((state: RootState) => state.playlists.playlists || []);
    const schedules = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);
    const isLoading = useSelector(
        (state: RootState) => state.sequences.loading || state.playlists.loading || state.schedule.loading,
    );

    // Today and tomorrow are simulated and scrollable. The timeline opens on today plus the
    // next 24 hours, rounded up to the hour so re-renders don't keep resetting the view.
    const now = new Date();
    const startTime = startOfDay(now).getTime();
    const endTime = endOfDay(addDays(now, 1)).getTime();
    const viewEndTime = Math.min(startOfHour(addHours(now, 25)).getTime(), endTime);

    // Filter and process schedules for today and tomorrow
    const upcomingSchedules = useMemo(() => {
        return schedules.filter((sch: { date: number; scheduleType?: string }) => {
            const schDate = new Date(sch.date);
            return schDate >= new Date(startTime) && schDate <= new Date(endTime);
        });
    }, [schedules, startTime, endTime]);

    // Separate schedules into background and main
    const { backgroundSchedules, mainSchedules } = useMemo(() => {
        const background = upcomingSchedules.filter(
            (sch: { scheduleType?: string }) => sch.scheduleType === 'background',
        );
        const main = upcomingSchedules.filter((sch: { scheduleType?: string }) => sch.scheduleType !== 'background');
        return { backgroundSchedules: background, mainSchedules: main };
    }, [upcomingSchedules]);

    const previewWindow: SchedulePreviewSettings = useMemo(
        () => ({
            startDate: new Date(startTime),
            endDate: new Date(endTime),
            startTime: '00:00',
            endTime: '23:59',
            maxEvents: DEFAULT_SCHEDULE_PREVIEW_SETTINGS.maxEvents,
            scheduleTypeFilter: 'all',
        }),
        [startTime, endTime],
    );

    // Stale-while-revalidate so a loading flip doesn't unmount the graph.
    type PreviewBundle =
        NonNullable<ReturnType<typeof generateSchedulePreview>> extends infer S
            ? { background: S; main: S; startTime: number; endTime: number; errors: never[]; warnings: never[] }
            : never;
    const lastGoodPreviewRef = useRef<PreviewBundle | null>(null);

    const { data: previewData, error } = useMemo(() => {
        if (!sequences.length || !playlists.length || !upcomingSchedules.length) {
            return { data: null, error: null as string | null };
        }

        try {
            const background = generateSchedulePreview(sequences, playlists, backgroundSchedules, previewWindow);

            const main = generateSchedulePreview(sequences, playlists, mainSchedules, previewWindow);

            const combined = {
                background,
                main,
                startTime: Math.min(background.startTime, main.endTime),
                endTime: Math.max(background.endTime, main.endTime),
                errors: [],
                warnings: [],
            };

            return { data: combined, error: null };
        } catch (e) {
            console.error('Error processing schedules:', e);
            return { data: null, error: 'Failed to process schedule data' };
        }
    }, [
        sequences, // make sure these refs are stable; see notes below
        playlists,
        backgroundSchedules,
        mainSchedules,
        upcomingSchedules.length, // or a stable identifier for the window's schedules
        previewWindow,
    ]);

    if (previewData) lastGoodPreviewRef.current = previewData;
    const renderableData = previewData ?? (isLoading ? lastGoodPreviewRef.current : null);
    const noScheduleData = !sequences.length || !playlists.length || !upcomingSchedules.length;

    return (
        <Box
            sx={{
                flex: 1,
                overflow: 'hidden',
                px: 2,
                pb: 2,
            }}
        >
            {error && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => {}}>
                    {error}
                </Alert>
            )}

            <Box sx={{ height: '100%', overflow: 'hidden' }}>
                {renderableData ? (
                    <GraphForSchedule
                        data={renderableData}
                        selectedStartTime={startTime}
                        selectedEndTime={endTime}
                        viewStartTime={startTime}
                        viewEndTime={viewEndTime}
                        showScheduledMarkers={false}
                    />
                ) : isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                        <CircularProgress />
                    </Box>
                ) : noScheduleData ? (
                    <Alert severity="info">No schedule data available for today or tomorrow.</Alert>
                ) : (
                    <Alert severity="info">No schedule events for today or tomorrow.</Alert>
                )}
            </Box>
        </Box>
    );
};

export const PlayerScreen = ({ title, statusArea, allowVolumeControl, allowStopControls }: PlayerScreenProps) => {
    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <Box sx={{ padding: 2, flexShrink: 0 }}>
                <PageHeader heading={title} children={statusArea} />
            </Box>

            {/* Now Playing Card and Controller Status */}
            <StatusCards allowVolumeControl={allowVolumeControl} allowStopControls={allowStopControls} />

            {/* Timeline View */}
            <TimelineView />
        </Box>
    );
};
