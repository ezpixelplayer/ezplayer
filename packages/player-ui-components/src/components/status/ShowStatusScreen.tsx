import { PageHeader } from '@ezplayer/shared-ui-components';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Grid,
    Typography,
    useTheme,
} from '@mui/material';
import { Box } from '../box/Box';
import { format } from 'date-fns';
import React, { useState, useEffect } from 'react';
import type { SxProps, Theme } from '@mui/material';

import { useDispatch, useSelector } from 'react-redux';

// Types
import { AppDispatch, RootState } from '../../store/Store';
import { StatsDialog } from './StatsDialog';
import type { ControllerStatus } from '@ezplayer/ezplayer-core';
import {
    type ControllerStatusSeverity,
    getControllerSeverity,
    getControllersSeverity,
    getControllerStats,
    severityToChipColor,
    severityToMainColor,
} from './ControllerHelpers';
import { QueueCard } from './QueueCard';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';
import type { EZPElectronAPI } from '@ezplayer/ezplayer-core';

// Extend Window interface to include electronAPI
declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

const getControllerStatusLabel = (controllers?: ControllerStatus[]) => {
    if (!controllers) return 'No data';
    const stat = getControllerStats(controllers);

    if (stat.total === stat.online) return 'All controllers online';
    if (stat.online === 0) return 'No controllers online';
    return `${stat.offline} controller(s) offline`;
};

/** Section chrome only (no full-area background); status is conveyed by left accent + border. */
function severityToSectionSurfaceSx(severity: ControllerStatusSeverity): SxProps<Theme> {
    return {
        border: '1px solid',
        borderColor: 'divider',
        borderLeftWidth: 4,
        borderLeftStyle: 'solid',
        borderLeftColor: severityToMainColor(severity),
        bgcolor: 'transparent',
        '&:before': { display: 'none' },
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
    /** Per-controller accordion: omitted index defaults to expanded (matches prior “always open” behavior). */
    const [controllerSectionExpanded, setControllerSectionExpanded] = useState<Record<number, boolean>>({});
    const [serverStatus, setServerStatus] = useState<{
        port: number;
        portSource: string;
        status: 'listening' | 'stopped' | 'error';
        kioskPort?: number;
        kioskPortSource?: string;
    } | null>(null);

    const dispatch = useDispatch<AppDispatch>();
    const runtime = useSelector((s: RootState) => s.runtime);

    useEffect(() => {
        const fetchServerStatus = async () => {
            if (window.electronAPI?.getServerStatus) {
                try {
                    const status = await window.electronAPI.getServerStatus();
                    setServerStatus(status);
                } catch (error) {
                    console.error('Failed to fetch server status:', error);
                }
            }
        };

        fetchServerStatus();
        const interval = setInterval(fetchServerStatus, 5000); // Update every 5 seconds
        return () => clearInterval(interval);
    }, []);

    if (!runtime.combined || runtime.loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
        );
    }

    const player = runtime.combined.player;
    const content = runtime.combined.content;
    const controller = runtime.combined.controller;
    const show = runtime.combined.show;
    const showName = show?.show_name || 'Unknown Show';
    const vcLabel = show?.viewer_control_enabled
        ? show.viewer_control_mode === 'ezplayer'
            ? 'Enabled (EZPlayer)'
            : show.viewer_control_mode === 'remote-falcon'
              ? 'Enabled (Remote Falcon)'
              : 'Enabled'
        : 'Disabled';

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
                                {
                                    <Typography variant="body1">
                                        Status: {player.status === 'Playing' ? '▶ Playing' : '⏸ Not Playing'}
                                    </Typography>
                                }
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
                                            Upcoming Songs ({player.upcoming.filter((s) => s.sequence_id).length}):
                                        </Typography>
                                        {player.upcoming
                                            .filter((s) => s.sequence_id)
                                            .map((seq, index) => (
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
                                            Upcoming Shows ({player.upcoming.filter((s) => s.schedule_id).length}):
                                        </Typography>
                                        {player.upcoming
                                            .filter((s) => s.schedule_id)
                                            .map((show, index) => (
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
                                    <QueueCard
                                        queue={player.queue}
                                        onRemoveItem={async (i, index) => {
                                            console.log(`Remove ${index}`);
                                            await dispatch(
                                                callImmediateCommand({
                                                    command: 'deleterequest',
                                                    requestId: i.request_id ?? '',
                                                }),
                                            );
                                        }}
                                    ></QueueCard>
                                )}
                                {player.suspendedItems && player.suspendedItems.length > 0 && (
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
                                {player.preemptedItems && player.preemptedItems.length > 0 && (
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
                                <Typography variant="body1">Viewer Control: {vcLabel}</Typography>
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
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 1.5,
                                            mt: 1,
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                flexWrap: 'wrap',
                                                gap: 1,
                                                mb: 0.5,
                                            }}
                                        >
                                            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                                                Controller Details
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 1 }}>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() =>
                                                        setControllerSectionExpanded(
                                                            Object.fromEntries(
                                                                (controller.controllers ?? []).map((_, idx) => [
                                                                    idx,
                                                                    true,
                                                                ]),
                                                            ),
                                                        )
                                                    }
                                                >
                                                    Expand All
                                                </Button>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() =>
                                                        setControllerSectionExpanded(
                                                            Object.fromEntries(
                                                                (controller.controllers ?? []).map((_, idx) => [
                                                                    idx,
                                                                    false,
                                                                ]),
                                                            ),
                                                        )
                                                    }
                                                >
                                                    Collapse All
                                                </Button>
                                            </Box>
                                        </Box>
                                        {controller.controllers.map((ctrl, index) => {
                                            const ctrlSeverity = getControllerSeverity(ctrl);
                                            const sectionExpanded = controllerSectionExpanded[index] !== false;
                                            return (
                                                <Accordion
                                                    key={index}
                                                    expanded={sectionExpanded}
                                                    onChange={(_, isExpanded) =>
                                                        setControllerSectionExpanded((prev) => ({
                                                            ...prev,
                                                            [index]: isExpanded,
                                                        }))
                                                    }
                                                    disableGutters
                                                    elevation={0}
                                                    sx={{
                                                        borderRadius: 1,
                                                        overflow: 'hidden',
                                                        ...severityToSectionSurfaceSx(ctrlSeverity),
                                                    }}
                                                >
                                                    <AccordionSummary
                                                        expandIcon={<ExpandMoreIcon aria-hidden />}
                                                        aria-controls={`controller-status-panel-${index}`}
                                                        id={`controller-status-header-${index}`}
                                                        sx={{
                                                            px: 2,
                                                            minHeight: 52,
                                                            bgcolor: 'background.paper',
                                                            color: 'text.primary',
                                                            borderBottom: '1px solid',
                                                            borderColor: 'divider',
                                                            '&.Mui-expanded': { minHeight: 52 },
                                                            '& .MuiAccordionSummary-expandIconWrapper': {
                                                                color: 'text.primary',
                                                            },
                                                        }}
                                                    >
                                                        <Box
                                                            sx={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                flexWrap: 'wrap',
                                                                gap: 1,
                                                                py: 0.5,
                                                                width: '100%',
                                                                pr: 1,
                                                            }}
                                                        >
                                                            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                                                                {ctrl.name || `Controller ${index + 1}`}
                                                            </Typography>
                                                            <Chip
                                                                label={ctrl.status || 'unknown'}
                                                                color={severityToChipColor(ctrlSeverity)}
                                                                variant={
                                                                    ctrlSeverity === 'disabled' ? 'outlined' : 'filled'
                                                                }
                                                                size="small"
                                                            />
                                                        </Box>
                                                    </AccordionSummary>
                                                    <AccordionDetails
                                                        id={`controller-status-panel-${index}`}
                                                        sx={{ px: 2, pt: 2, pb: 2 }}
                                                    >
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
                                                                    <Typography variant="body2">
                                                                        Type: {ctrl.type}
                                                                    </Typography>
                                                                </Grid>
                                                            )}
                                                            {ctrl.model && (
                                                                <Grid item xs={6}>
                                                                    <Typography variant="body2">
                                                                        Model: {ctrl.model}
                                                                    </Typography>
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
                                                                    <Typography variant="body2">
                                                                        State: {ctrl.state}
                                                                    </Typography>
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
                                                            {ctrl.startCh !== undefined &&
                                                                ctrl.nCh !== undefined &&
                                                                ctrl.nCh > 0 && (
                                                                    <Grid item xs={12}>
                                                                        <Typography variant="body2">
                                                                            Channels: {ctrl.startCh.toLocaleString()}–
                                                                            {(
                                                                                ctrl.startCh +
                                                                                ctrl.nCh -
                                                                                1
                                                                            ).toLocaleString()}{' '}
                                                                            ({ctrl.nCh.toLocaleString()})
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
                                                                    sx={{ fontWeight: 'bold' }}
                                                                    color="text.primary"
                                                                >
                                                                    Notices:
                                                                </Typography>
                                                                {ctrl.notices.map((notice, noticeIndex) => (
                                                                    <Typography
                                                                        key={noticeIndex}
                                                                        variant="body2"
                                                                        display="block"
                                                                        color="text.secondary"
                                                                        sx={{ pl: 0.5 }}
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
                                                                    p: 1.5,
                                                                    borderRadius: 1,
                                                                    border: '1px solid',
                                                                    borderColor: 'divider',
                                                                    borderLeftWidth: 4,
                                                                    borderLeftStyle: 'solid',
                                                                    borderLeftColor: severityToMainColor(ctrlSeverity),
                                                                }}
                                                            >
                                                                <Typography
                                                                    variant="body2"
                                                                    sx={{
                                                                        fontWeight: 'bold',
                                                                    }}
                                                                    color="text.primary"
                                                                >
                                                                    Errors:
                                                                </Typography>
                                                                {ctrl.errors.map((error, errorIndex) => (
                                                                    <Typography
                                                                        key={errorIndex}
                                                                        variant="body2"
                                                                        display="block"
                                                                        color="text.primary"
                                                                        sx={{ fontWeight: 'medium', pl: 0.5 }}
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
                                                                    variant="body2"
                                                                    display="block"
                                                                    color="text.secondary"
                                                                    sx={{ mt: 0.5 }}
                                                                >
                                                                    {ctrl.protoDetails}
                                                                </Typography>
                                                            </Box>
                                                        )}
                                                    </AccordionDetails>
                                                </Accordion>
                                            );
                                        })}
                                    </Box>
                                )}
                            </CardContent>
                        </Card>
                    </Grid>
                )}

                {/* HTTP Listener Status */}
                {serverStatus && (
                    <Grid item xs={12}>
                        <Card>
                            <CardContent>
                                <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                                    HTTP Listener Status
                                </Typography>
                                <Typography variant="body1">Port: {serverStatus.port}</Typography>
                                <Typography variant="body1">Chosen by: {serverStatus.portSource}</Typography>
                                {serverStatus.kioskPort !== undefined && (
                                    <>
                                        <Typography variant="body1">Kiosk Port: {serverStatus.kioskPort}</Typography>
                                        <Typography variant="body1">
                                            Kiosk chosen by: {serverStatus.kioskPortSource}
                                        </Typography>
                                    </>
                                )}
                                <Box sx={{ mt: 1 }}>
                                    <Chip
                                        label={
                                            serverStatus.status === 'listening'
                                                ? 'Listening'
                                                : serverStatus.status === 'error'
                                                  ? 'Error'
                                                  : 'Stopped'
                                        }
                                        color={
                                            serverStatus.status === 'listening'
                                                ? 'success'
                                                : serverStatus.status === 'error'
                                                  ? 'error'
                                                  : 'default'
                                        }
                                        size="small"
                                    />
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
            </Grid>

            {/* Stats Dialog */}
            <StatsDialog
                open={statsDialogOpen}
                onClose={() => setStatsDialogOpen(false)}
                stats={runtime.playbackStats}
            />
        </Box>
    );
};
