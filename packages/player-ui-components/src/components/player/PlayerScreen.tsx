import { PageHeader } from '@ezplayer/shared-ui-components';
import { Alert, Box, Card, CardContent, Chip, CircularProgress, Grid, Typography } from '@mui/material';
import { endOfDay, startOfDay } from 'date-fns';
import React, { useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store/Store';
import { SchedulePreviewSettings } from '../../types/SchedulePreviewTypes';
import { generateSchedulePreview } from '../../util/schedulePreviewUtils';
import GraphForSchedule from '../schedule-preview/GraphForSchedule';
import { NowPlayingCard } from './NowPlayingCard';
import { QueueCard } from '../status/QueueCard';
import { getControllerStats } from '../status/ControllerHelpers';
import { AppDispatch } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/PlayerStatusStore';

interface PlayerScreenProps {
    title: string;
    statusArea: React.ReactNode[];
}

const StatusCards = ({}: {}) => {
    const playerStatus = useSelector((state: RootState) => state.playerStatus);

    return (
        <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
            {/* Now Playing Card and Controller Status */}
            <Grid container spacing={2}>
                <Grid item xs={12} md={12} lg={6} xl={4}>
                    {playerStatus.playerStatus?.player ? (
                        <NowPlayingCard player={playerStatus.playerStatus.player} compact={true} />
                    ) : playerStatus.playerStatus?.show ? (
                        <Box sx={{ p: 2, border: '1px solid #ccc', borderRadius: 2, bgcolor: 'background.paper' }}>
                            <Typography variant="body2" color="text.secondary">
                                Show: {playerStatus.playerStatus.show.show_name}
                            </Typography>
                            <Typography variant="caption" display="block">
                                Player data not available
                            </Typography>
                        </Box>
                    ) : null}
                </Grid>

                {/* Controller Status Summary */}
                {playerStatus.playerStatus?.controller &&
                    (() => {
                        const controller = playerStatus.playerStatus.controller;
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

const TimelineView = ({}: {}) => {
    // Get data from Redux store
    const sequences = useSelector((state: RootState) => state.sequences.sequenceData || []);
    const playlists = useSelector((state: RootState) => state.playlists.playlists || []);
    const schedules = useSelector((state: RootState) => state.schedule.scheduledPlaylists || []);
    const isLoading = useSelector(
        (state: RootState) => state.sequences.loading || state.playlists.loading || state.schedule.loading,
    );

    // Get today's time boundaries
    const startTime = startOfDay(new Date()).getTime();
    const endTime = endOfDay(new Date()).getTime();

    // Filter and process schedules for today
    const todaysSchedules = useMemo(() => {
        return schedules.filter((sch: { date: number; scheduleType?: string }) => {
            const schDate = new Date(sch.date);
            return schDate >= new Date(startTime) && schDate <= new Date(endTime);
        });
    }, [schedules, startTime, endTime]);

    // Separate schedules into background and main
    const { backgroundSchedules, mainSchedules } = useMemo(() => {
        const background = todaysSchedules.filter(
            (sch: { scheduleType?: string }) => sch.scheduleType === 'background',
        );
        const main = todaysSchedules.filter((sch: { scheduleType?: string }) => sch.scheduleType !== 'background');
        return { backgroundSchedules: background, mainSchedules: main };
    }, [todaysSchedules]);

    const previewWindow: SchedulePreviewSettings = useMemo(
        () => ({
            startDate: new Date(startTime),
            endDate: new Date(endTime),
            startTime: '00:00',
            endTime: '23:59',
            maxEvents: 1000,
            scheduleTypeFilter: 'all',
        }),
        [startTime, endTime],
    );

    const { data: previewData, error } = useMemo(() => {
        if (!sequences.length || !playlists.length || !todaysSchedules.length) {
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
        todaysSchedules.length, // or a stable identifier for "today's"
        previewWindow,
    ]);

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
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                        <CircularProgress />
                    </Box>
                ) : !sequences.length || !playlists.length || !todaysSchedules.length ? (
                    <Alert severity="info">No schedule data available for today.</Alert>
                ) : previewData ? (
                    <GraphForSchedule data={previewData} selectedStartTime={startTime} selectedEndTime={endTime} />
                ) : (
                    <Alert severity="info">No schedule events for today.</Alert>
                )}
            </Box>
        </Box>
    );
};

export const PlayerScreen = ({ title, statusArea }: PlayerScreenProps) => {
    const dispatch = useDispatch<AppDispatch>();
    const pstat = useSelector((s: RootState) => s.playerStatus);

    if (!pstat.playerStatus || pstat.loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
        );
    }

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
            <StatusCards />

            {/* Playback Queue Card */}
            {pstat?.playerStatus?.player?.queue && (
                <Box sx={{ padding: 2, flexShrink: 0 }}>
                    <QueueCard
                        sx={{
                            padding: 2,
                        }}
                        queue={pstat.playerStatus.player.queue}
                        onRemoveItem={async (i, _index) => {
                            await dispatch(
                                callImmediateCommand({
                                    command: 'deleterequest',
                                    requestId: i.request_id ?? '',
                                }),
                            );
                        }}
                    ></QueueCard>
                </Box>
            )}

            {/* Timeline View */}
            <TimelineView />

            {/* Controls - Sticks to the bottom 
            <Box sx={{ 
                padding: 2, 
            }}>
                <FullPlayerControlStack />
            </Box>
            */}
        </Box>
    );
};
