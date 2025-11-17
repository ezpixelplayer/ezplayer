import { PageHeader } from '@ezplayer/shared-ui-components';
import { Box, Button, Card, CardContent, Chip, CircularProgress, Grid, Typography, useTheme } from '@mui/material';
import { format } from 'date-fns';
import React, { useState } from 'react';
import type { SxProps, Theme } from '@mui/material';

import { useDispatch, useSelector } from 'react-redux';

// Types
import { AppDispatch, RootState } from '../../store/Store';
import { StatsDialog } from './StatsDialog';
import type { ControllerStatus } from '@ezplayer/ezplayer-core';
import { type ControllerStatusSeverity, getControllerSeverity, getControllersSeverity, getControllerStats, severityToChipColor, severityToLightColor, severityToMainColor } from './ControllerHelpers';


const getControllerStatusLabel = (controllers?: ControllerStatus[]) => {
    if (!controllers) return 'No data';
    const stat = getControllerStats(controllers);

    if (stat.total === stat.online) return 'All controllers online';
    if (stat.online === 0) return 'No controllers online';
    return `${stat.offline} controller(s) offline`;
};

function severityToBoxSx(severity: ControllerStatusSeverity): SxProps<Theme> {
    switch (severity) {
        case 'error':
            return {
                border: '1px solid',
                borderColor: 'error.main',
                backgroundColor: 'error.light',
                opacity: 0.9,
            };
        case 'warning':
            return {
                border: '1px solid',
                borderColor: 'warning.main',
                backgroundColor: 'warning.light',
                opacity: 0.9,
            };
        case 'pending':
            return {
                border: '1px solid',
                borderColor: 'info.main',
                backgroundColor: 'info.light',
                opacity: 0.9,
            };
        case 'success':
            return {
                border: '1px solid',
                borderColor: 'success.main',
                backgroundColor: 'success.light',
                opacity: 0.8,
            };
        case 'disabled':
            return {
                border: '1px solid',
                borderColor: 'grey.400',
                backgroundColor: 'grey.100',
                opacity: 0.6,
            };
        case 'neutral':
        default:
            return {
                border: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'background.paper',
                opacity: 1,
            };
    };
}

const formatTime = (timestamp?: number | string) => {
    if (!timestamp) return '—';
    const ts = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
    const date = new Date(ts);

    return format(date, 'dd-MMM-yyyy HH:mm:ss');
};

export interface ShowStatusScreenProps {
    title: string;
    statusArea: React.ReactNode[];
}

export const ShowStatusScreen = ({ title, statusArea }: ShowStatusScreenProps) => {
    const theme = useTheme();
    const [statsDialogOpen, setStatsDialogOpen] = useState(false);

    const dispatch = useDispatch<AppDispatch>();
    const pstat = useSelector((s: RootState) => s.playerStatus);

    if (!pstat.playerStatus || pstat.loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
        );
    }

    const player = pstat.playerStatus.player;
    const content = pstat.playerStatus.content;
    const controller = pstat.playerStatus.controller;
    const showName = pstat.playerStatus.show?.show_name || 'Unknown Show';

    return (
        <Box>
            <Box sx={{ padding: 2, flexShrink: 0 }}>
                <PageHeader heading={`${title} - ${showName}`} children={statusArea} />
            </Box>
            <Grid container spacing={2} padding={2}>
                {/* Player Status */}
                {player && (
                    <Grid item xs={12}>
                        <Card>
                            <CardContent>
                                <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                                    Player Status
                                </Typography>
                                <Typography variant="body1">Type: {player.ptype}</Typography>
                                <Typography variant="body1">
                                    Last Checkin: {formatTime(player.reported_time)}
                                </Typography>
                                {(
                                    <Typography variant="body1">
                                        Status: {player.status === 'Playing' ? '▶ Playing' : '⏸ Not Playing'}
                                    </Typography>
                                )}
                                {player.now_playing && (
                                    <>
                                        <Typography variant="body2">Now Playing: {player.now_playing.title}</Typography>
                                        <Typography variant="body2">
                                            Until: {formatTime(player.now_playing.until)}
                                        </Typography>
                                    </>
                                )}
                                {player.upcoming && (
                                    <>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                            Upcoming Songs ({player.upcoming.length}):
                                        </Typography>
                                        {player.upcoming.filter((s)=>s.sequence_id).map((seq, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    mb: 1,
                                                    pl: 1,
                                                    borderLeft: '2px solid',
                                                    borderColor: 'primary.main',
                                                }}
                                            >
                                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                                    {seq.title}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    Starts: {formatTime(seq.at ?? 0)}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </>
                                )}
                                {player.upcoming && (
                                    <>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                            Upcoming Shows ({player.upcoming.length}):
                                        </Typography>
                                        {player.upcoming.filter((s)=>s.schedule_id).map((show, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    mb: 1,
                                                    pl: 1,
                                                    borderLeft: '2px solid',
                                                    borderColor: 'primary.main',
                                                }}
                                            >
                                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                                    {show.title}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    Starts: {formatTime(show.at ?? 0)}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </>
                                )}
                                {player.queue && (
                                    <>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                            Queue ({player.queue.length}):
                                        </Typography>
                                        {player.queue.map((qi, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    mb: 1,
                                                    pl: 1,
                                                    borderLeft: '2px solid',
                                                    borderColor: 'primary.main',
                                                }}
                                            >
                                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                                    {qi.title}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </>
                                )}
                                {player.suspendedItems?.length && (
                                    <>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                            Suspended ({player.suspendedItems.length}):
                                        </Typography>
                                        {player.suspendedItems.map((item, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    mb: 1,
                                                    pl: 1,
                                                    borderLeft: '2px solid',
                                                    borderColor: 'primary.main',
                                                }}
                                            >
                                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                                    {item.title}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </>
                                )}
                                {player.preemptedItems?.length && (
                                    <>
                                        <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>
                                            Preempted ({player.preemptedItems.length}):
                                        </Typography>
                                        {player.preemptedItems.map((sched, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    mb: 1,
                                                    pl: 1,
                                                    borderLeft: '2px solid',
                                                    borderColor: 'primary.main',
                                                }}
                                            >
                                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                                    {sched.title}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    Scheduled start: {formatTime(sched.at ?? 0)}
                                                </Typography>
                                            </Box>
                                        ))}
                                    </>
                                )}
                                {player.ptype === 'EZP' && (
                                    <Box sx={{ mt: 2 }}>
                                        <Button
                                            variant="outlined"
                                            color="primary"
                                            onClick={() => {
                                                setStatsDialogOpen(true);
                                            }}
                                            size="small"
                                        >
                                            Stats
                                        </Button>
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                )}

                {/* Content Status */}
                {content && (
                    <Grid item xs={12}>
                        <Card>
                            <CardContent>
                                <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                                    Content & Schedule
                                </Typography>
                                <Typography variant="body1">
                                    Sequence Sync: {formatTime(content.sequence_sync_time)}
                                </Typography>
                                <Typography variant="body1">Sequences: {content.n_sequences ?? '—'}</Typography>
                                <Typography variant="body1">
                                    Need Download: {content.n_needing_download ?? '—'}
                                </Typography>
                                <Typography variant="body1">
                                    Schedule Sync: {formatTime(content.schedule_sync_time)}
                                </Typography>
                                <Typography variant="body1">Schedules: {content.n_schedules ?? '—'}</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                )}

                {/* Controller Status */}
                {controller && (
                    <Grid item xs={12}>
                        <Card>
                            <CardContent>
                                <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                                    Controller Status
                                </Typography>

                                {/* Summary Information */}
                                <Box sx={{ mb: 2 }}>
                                    <Typography variant="body1">Models: {controller.n_models ?? '—'}</Typography>
                                    <Typography variant="body1">Channels: {controller.n_channels ?? '—'}</Typography>
                                    <Typography variant="body1">
                                        Controllers Seen: {controller.controllers?.length ?? 0}
                                    </Typography>
                                    <Chip
                                        label={getControllerStatusLabel(controller.controllers)}
                                        color={severityToChipColor(getControllersSeverity(controller.controllers))}
                                        sx={{ mt: 1 }}
                                    />
                                </Box>

                                {/* Individual Controller Details */}
                                {controller.controllers && controller.controllers.length > 0 && (
                                    <Box>
                                        <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                                            Controller Details
                                        </Typography>
                                        {controller.controllers.map((ctrl, index) => (
                                            <Box
                                                key={index}
                                                sx={{
                                                    mb: 2,
                                                    p: 2,
                                                    border: '1px solid',
                                                    borderRadius: 1,
                                                    ...severityToBoxSx(getControllerSeverity(ctrl))
                                                }}
                                            >
                                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                                                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mr: 1 }}>
                                                        {ctrl.name || `Controller ${index + 1}`}
                                                    </Typography>
                                                    <Chip
                                                        label={ctrl.status || 'unknown'}
                                                        color={severityToChipColor(getControllerSeverity(ctrl))}
                                                        variant={getControllerSeverity(ctrl) === 'disabled' ? 'outlined' : 'filled'}
                                                        size="small"
                                                    />
                                                </Box>

                                                <Grid container spacing={1}>
                                                    {ctrl.description && (
                                                        <Grid item xs={12}>
                                                            <Typography variant="body2" color="text.secondary">
                                                                Description: {ctrl.description}
                                                            </Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.type && (
                                                        <Grid item xs={6}>
                                                            <Typography variant="body2">Type: {ctrl.type}</Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.model && (
                                                        <Grid item xs={6}>
                                                            <Typography variant="body2">Model: {ctrl.model}</Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.address && (
                                                        <Grid item xs={6}>
                                                            <Typography variant="body2">
                                                                Address: {ctrl.address}
                                                            </Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.proto && (
                                                        <Grid item xs={6}>
                                                            <Typography variant="body2">
                                                                Protocol: {ctrl.proto}
                                                            </Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.state && (
                                                        <Grid item xs={6}>
                                                            <Typography variant="body2">State: {ctrl.state}</Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.connectivity && (
                                                        <Grid item xs={6}>
                                                            <Typography variant="body2">
                                                                Connectivity: {ctrl.connectivity}
                                                            </Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.pingSummary && (
                                                        <Grid item xs={6}>
                                                            <Typography variant="body2">
                                                                Ping: {ctrl.pingSummary}
                                                            </Typography>
                                                        </Grid>
                                                    )}
                                                    {ctrl.reported_time && (
                                                        <Grid item xs={12}>
                                                            <Typography variant="body2" color="text.secondary">
                                                                Last Reported: {formatTime(ctrl.reported_time)}
                                                            </Typography>
                                                        </Grid>
                                                    )}
                                                </Grid>

                                                {/* Notices */}
                                                {ctrl.notices && ctrl.notices.length > 0 && (
                                                    <Box sx={{ mt: 1 }}>
                                                        <Typography
                                                            variant="body2"
                                                            sx={{ fontWeight: 'bold', color: 'info.main' }}
                                                        >
                                                            Notices:
                                                        </Typography>
                                                        {ctrl.notices.map((notice, noticeIndex) => (
                                                            <Typography
                                                                key={noticeIndex}
                                                                variant="caption"
                                                                display="block"
                                                                color="info.main"
                                                            >
                                                                • {notice}
                                                            </Typography>
                                                        ))}
                                                    </Box>
                                                )}

                                                {/* Errors */}
                                                {ctrl.errors && ctrl.errors.length > 0 && (
                                                    <Box
                                                        sx={{
                                                            mt: 1,
                                                            p: 1,
                                                            bgcolor: severityToLightColor(getControllerSeverity(ctrl)),
                                                            borderRadius: 1,
                                                            border: '1px solid',
                                                            borderColor: severityToMainColor(getControllerSeverity(ctrl)),
                                                        }}
                                                    >
                                                        <Typography
                                                            variant="body2"
                                                            sx={{ fontWeight: 'bold', color: severityToMainColor(getControllerSeverity(ctrl)) }}
                                                        >
                                                            Errors:
                                                        </Typography>
                                                        {ctrl.errors.map((error, errorIndex) => (
                                                            <Typography
                                                                key={errorIndex}
                                                                variant="body2"
                                                                display="block"
                                                                color={severityToMainColor(getControllerSeverity(ctrl))}
                                                                sx={{ fontWeight: 'medium' }}
                                                            >
                                                                • {error}
                                                            </Typography>
                                                        ))}
                                                    </Box>
                                                )}

                                                {/* Protocol Details */}
                                                {ctrl.protoDetails && (
                                                    <Box sx={{ mt: 1 }}>
                                                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                                            Protocol Details:
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            display="block"
                                                            color="text.secondary"
                                                        >
                                                            {ctrl.protoDetails}
                                                        </Typography>
                                                    </Box>
                                                )}
                                            </Box>
                                        ))}
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                )}
            </Grid>

            {/* Stats Dialog */}
            <StatsDialog open={statsDialogOpen} onClose={() => setStatsDialogOpen(false)} stats={pstat.playbackStats} />
        </Box>
    );
};
