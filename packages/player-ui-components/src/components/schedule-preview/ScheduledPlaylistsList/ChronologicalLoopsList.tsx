import PersonIcon from '@mui/icons-material/Person';
import { Chip, List, Theme, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { format } from 'date-fns';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '../../box/Box';

export interface ChronologicalSequenceInstance {
    sequenceId: string;
    sequenceName: string;
    artist: string;
    startTime: number;
    endTime: number;
    loopNumber: number;
    playlistType: 'intro' | 'main' | 'outro';
    order: number;
}

export interface ChronologicalLoopsSchedule {
    scheduleId: string;
    chronologicalInstances: ChronologicalSequenceInstance[];
}

export interface LogEventLike {
    eventType: string;
    eventTime: number;
    scheduleId?: string;
}

interface SuspensionIndicator {
    index: number;
    startTime: number;
    endTime: number;
    duration: number;
    reason: string;
}

type LoopRow =
    | { kind: 'sequence'; key: string; instance: ChronologicalSequenceInstance; zebraIndex: number }
    | { kind: 'suspension'; key: string; suspension: SuspensionIndicator };

const ROW_HEIGHT = 64;
const VIEWPORT_HEIGHT = 420;
const OVERSCAN = 6;
/** Above this count, virtualize + fixed viewport so accordion expand stays cheap. */
const VIRTUALIZE_THRESHOLD = 40;

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

const getPlaylistTypeConfig = (playlistType: 'intro' | 'main' | 'outro') => {
    switch (playlistType) {
        case 'intro':
            return { label: 'Intro', color: 'success' as const };
        case 'outro':
            return { label: 'Outro', color: 'warning' as const };
        default:
            return { label: 'Main', color: 'primary' as const };
    }
};

function buildSuspensionIndicators(
    scheduleId: string,
    instances: ChronologicalSequenceInstance[],
    logs: LogEventLike[] | undefined,
): SuspensionIndicator[] {
    const suspensionIndicators: SuspensionIndicator[] = [];
    const scheduleEvents =
        logs?.filter(
            (event) =>
                event.scheduleId === scheduleId &&
                (event.eventType === 'Schedule Suspended' || event.eventType === 'Schedule Resumed'),
        ) || [];

    const pendingSuspensions = new Map<string, number>();
    scheduleEvents.forEach((event) => {
        if (event.eventType === 'Schedule Suspended') {
            pendingSuspensions.set(event.scheduleId!, event.eventTime);
        } else if (event.eventType === 'Schedule Resumed') {
            const suspendTime = pendingSuspensions.get(event.scheduleId!);
            if (suspendTime !== undefined) {
                let insertIndex = instances.findIndex((instance) => instance.startTime > suspendTime);
                if (insertIndex === -1) insertIndex = instances.length;

                suspensionIndicators.push({
                    index: insertIndex,
                    startTime: suspendTime,
                    endTime: event.eventTime,
                    duration: event.eventTime - suspendTime,
                    reason: 'Schedule Suspended',
                });
                pendingSuspensions.delete(event.scheduleId!);
            }
        }
    });

    suspensionIndicators.sort((a, b) => a.index - b.index);
    return suspensionIndicators;
}

function buildLoopRows(
    scheduleId: string,
    instances: ChronologicalSequenceInstance[],
    logs: LogEventLike[] | undefined,
): LoopRow[] {
    const suspensions = buildSuspensionIndicators(scheduleId, instances, logs);
    const rows: LoopRow[] = [];
    let suspensionIndex = 0;

    instances.forEach((instance, index) => {
        while (suspensionIndex < suspensions.length && suspensions[suspensionIndex].index === index) {
            const suspension = suspensions[suspensionIndex];
            rows.push({
                kind: 'suspension',
                key: `suspension-${suspension.startTime}`,
                suspension,
            });
            suspensionIndex++;
        }

        rows.push({
            kind: 'sequence',
            key: `${instance.sequenceId}-${instance.startTime}-${instance.loopNumber}`,
            instance,
            zebraIndex: index,
        });
    });

    while (suspensionIndex < suspensions.length) {
        const suspension = suspensions[suspensionIndex];
        rows.push({
            kind: 'suspension',
            key: `suspension-${suspension.startTime}`,
            suspension,
        });
        suspensionIndex++;
    }

    return rows;
}

const SuspensionRow = React.memo(function SuspensionRow({ suspension }: { suspension: SuspensionIndicator }) {
    return (
        <Box
            sx={{
                py: 1.5,
                px: 2,
                height: ROW_HEIGHT,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
                    <Chip
                        label="Suspended"
                        size="small"
                        color="error"
                        variant="filled"
                        sx={{ height: 24, minWidth: 80, flexShrink: 0 }}
                    />
                    <Typography
                        variant="body1"
                        sx={{
                            fontWeight: 600,
                            color: (theme: Theme) => theme.palette.error.dark,
                            lineHeight: 1.2,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        ⏸️ {suspension.reason}
                        <Typography
                            component="span"
                            variant="caption"
                            sx={{
                                color: (theme: Theme) => theme.palette.text.secondary,
                                ml: 1,
                                flexShrink: 0,
                            }}
                        >
                            No music playing
                        </Typography>
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
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
                    <Typography variant="caption" sx={{ color: (theme: Theme) => theme.palette.text.secondary }}>
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
                        sx={{ height: 20, fontSize: '0.7rem', fontFamily: 'monospace' }}
                    />
                </Box>
            </Box>
        </Box>
    );
});

const SequenceRow = React.memo(function SequenceRow({
    instance,
    zebraIndex,
    isLast,
}: {
    instance: ChronologicalSequenceInstance;
    zebraIndex: number;
    isLast: boolean;
}) {
    const typeConfig = getPlaylistTypeConfig(instance.playlistType);
    return (
        <Box
            sx={{
                py: 1.5,
                px: 2,
                height: ROW_HEIGHT,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                backgroundColor:
                    zebraIndex % 2 === 0 ? (theme: Theme) => alpha(theme.palette.action.hover, 0.3) : 'transparent',
                borderBottom: isLast ? 'none' : '1px solid',
                borderColor: 'divider',
                '&:hover': {
                    backgroundColor: (theme: Theme) => alpha(theme.palette.action.selected, 0.4),
                },
                borderLeft: '4px solid',
                borderLeftColor: `${typeConfig.color}.main`,
                ml: 0.5,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
                    <Chip
                        label={typeConfig.label}
                        size="small"
                        color={typeConfig.color}
                        variant="outlined"
                        sx={{ height: 24, minWidth: 60, flexShrink: 0 }}
                    />
                    <Typography
                        variant="body1"
                        sx={{
                            fontWeight: 600,
                            color: 'text.primary',
                            lineHeight: 1.2,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
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
                                flexShrink: 0,
                            }}
                        >
                            <PersonIcon sx={{ fontSize: 12 }} />
                            {instance.artist}
                        </Typography>
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                    <Typography
                        variant="body2"
                        sx={{ fontWeight: 500, color: 'text.primary', fontFamily: 'monospace' }}
                    >
                        {format(instance.startTime, 'HH:mm:ss')}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        →
                    </Typography>
                    <Typography
                        variant="body2"
                        sx={{ fontWeight: 500, color: 'text.primary', fontFamily: 'monospace' }}
                    >
                        {format(instance.endTime, 'HH:mm:ss')}
                    </Typography>
                    <Chip
                        label={formatDuration(instance.endTime - instance.startTime)}
                        size="small"
                        color="default"
                        variant="outlined"
                        sx={{ height: 20, fontSize: '0.7rem', fontFamily: 'monospace' }}
                    />
                </Box>
            </Box>
        </Box>
    );
});

export interface ChronologicalLoopsListProps {
    schedule: ChronologicalLoopsSchedule;
    logs?: LogEventLike[];
    className?: string;
}

/**
 * Renders simulation loop rows. Large lists use a fixed-height virtual viewport so
 * accordion expand/collapse does not mount or animate thousands of DOM nodes.
 */
export const ChronologicalLoopsList = React.memo(function ChronologicalLoopsList({
    schedule,
    logs,
    className = '',
}: ChronologicalLoopsListProps) {
    const rows = useMemo(
        () => buildLoopRows(schedule.scheduleId, schedule.chronologicalInstances, logs),
        [schedule.scheduleId, schedule.chronologicalInstances, logs],
    );

    const [scrollTop, setScrollTop] = useState(0);
    const rafRef = useRef<number | null>(null);

    // Drop a queued scroll update if the list unmounts first (accordion collapse with unmountOnExit).
    useEffect(
        () => () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        },
        [],
    );

    const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const nextScrollTop = event.currentTarget.scrollTop;
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = requestAnimationFrame(() => {
            setScrollTop(nextScrollTop);
            rafRef.current = null;
        });
    }, []);

    if (schedule.chronologicalInstances.length === 0) {
        return (
            <Typography
                variant="body2"
                color="text.secondary"
                className={className}
                sx={{ fontStyle: 'italic', textAlign: 'center', py: 4 }}
            >
                No loop instances found for this schedule.
            </Typography>
        );
    }

    const renderRow = (row: LoopRow, isLast: boolean) => {
        if (row.kind === 'suspension') {
            return <SuspensionRow key={row.key} suspension={row.suspension} />;
        }
        return <SequenceRow key={row.key} instance={row.instance} zebraIndex={row.zebraIndex} isLast={isLast} />;
    };

    if (rows.length <= VIRTUALIZE_THRESHOLD) {
        return (
            <List dense className={className} sx={{ p: 0 }}>
                {rows.map((row, index) => renderRow(row, index === rows.length - 1))}
            </List>
        );
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(rows.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
    const visibleRows = rows.slice(startIndex, endIndex);
    const offsetY = startIndex * ROW_HEIGHT;
    const totalHeight = rows.length * ROW_HEIGHT;

    return (
        <Box
            className={className}
            onScroll={handleScroll}
            sx={{
                height: VIEWPORT_HEIGHT,
                overflow: 'auto',
                position: 'relative',
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
            }}
        >
            <Box sx={{ height: totalHeight, position: 'relative' }}>
                <Box sx={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
                    {visibleRows.map((row, i) => renderRow(row, startIndex + i === rows.length - 1))}
                </Box>
            </Box>
        </Box>
    );
});

ChronologicalLoopsList.displayName = 'ChronologicalLoopsList';

export const shouldSkipAccordionTransition = (instanceCount: number) => instanceCount > VIRTUALIZE_THRESHOLD;
