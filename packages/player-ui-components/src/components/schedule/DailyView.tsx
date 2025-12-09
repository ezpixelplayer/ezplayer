import React, { useEffect, useRef } from 'react';
import { format, isSameDay } from 'date-fns';
import { Box, Typography, styled } from '@mui/material';
import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { timestampToDate } from '@ezplayer/shared-ui-components';
import { formatDateStandard } from '../../util/dateUtils';

interface DailyViewProps {
    currentDate: Date;
    onDateSelect: (date: Date, time: string) => void;
    scheduledPlaylists: ScheduledPlaylist[];
    renderScheduledPlaylist: (
        playlist: ScheduledPlaylist,
        index: number,
        array: ScheduledPlaylist[],
    ) => React.ReactNode;
}

const TimeSlot = styled(Box)(({ theme }) => ({
    height: 80,
    borderBottom: `1px solid ${theme.palette.divider}`,
    cursor: 'pointer',
    display: 'flex',
    position: 'relative',
    '&:hover': {
        backgroundColor: theme.palette.action.hover,
    },
}));

const DailyView: React.FC<DailyViewProps> = ({
    currentDate,
    onDateSelect,
    scheduledPlaylists,
    renderScheduledPlaylist,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Find the earliest event time
        let earliestHour = 12; // Default to noon
        let hasEvents = false;

        scheduledPlaylists.forEach((playlist) => {
            try {
                const scheduleDate = timestampToDate(playlist.date);
                if (isSameDay(scheduleDate, currentDate)) {
                    const [hour] = playlist.fromTime.split(':').map(Number);
                    if (!hasEvents || hour < earliestHour) {
                        earliestHour = hour;
                        hasEvents = true;
                    }
                }
            } catch (error) {
                console.error('Error processing schedule:', playlist, error);
            }
        });

        // Calculate scroll position (each hour slot is 80px high)
        const scrollPosition = earliestHour * 80;
        containerRef.current.scrollTo({
            top: scrollPosition,
            behavior: 'smooth',
        });
    }, [scheduledPlaylists, currentDate]);

    const processScheduledPlaylists = (playlists: ScheduledPlaylist[]) => {
        // Group overlapping playlists
        const groups: ScheduledPlaylist[][] = [];

        playlists.forEach((playlist) => {
            const [startHour, startMin] = playlist.fromTime.split(':').map(Number);
            const [endHour, endMin] = playlist.toTime.split(':').map(Number);
            const startTime = startHour * 60 + startMin;
            const endTime = endHour * 60 + endMin;

            let foundGroup = false;
            for (const group of groups) {
                const overlaps = group.some((existingPlaylist) => {
                    const [existingStartHour, existingStartMin] = existingPlaylist.fromTime.split(':').map(Number);
                    const [existingEndHour, existingEndMin] = existingPlaylist.toTime.split(':').map(Number);
                    const existingStartTime = existingStartHour * 60 + existingStartMin;
                    const existingEndTime = existingEndHour * 60 + existingEndMin;

                    return !(startTime >= existingEndTime || endTime <= existingStartTime);
                });

                if (overlaps) {
                    group.push(playlist);
                    foundGroup = true;
                    break;
                }
            }

            if (!foundGroup) {
                groups.push([playlist]);
            }
        });

        return groups.flatMap((group) =>
            group.map((playlist, indexInGroup) => ({
                ...playlist,
                width: `${100 / group.length}%`,
                left: `${(indexInGroup * 100) / group.length}%`,
            })),
        );
    };

    const getTimeLabel = (hour: number) => {
        return `${hour.toString().padStart(2, '0')}:00`;
    };

    return (
        <Box ref={containerRef} sx={{ height: '100%', overflow: 'auto' }}>
            <Box
                sx={{
                    p: 2,
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.default',
                    position: 'sticky',
                    top: 0,
                    zIndex: 3,
                }}
            >
                <Typography variant="h6">{formatDateStandard(currentDate)}</Typography>
            </Box>
            <Box sx={{ display: 'flex' }}>
                {/* Time column */}
                <Box
                    sx={{
                        width: 80,
                        borderRight: 1,
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        position: 'sticky',
                        left: 0,
                        zIndex: 2,
                    }}
                >
                    {Array.from({ length: 24 }, (_, i) => (
                        <TimeSlot
                            key={`time-${i}`}
                            sx={{
                                px: 1,
                                justifyContent: 'flex-end',
                                borderRight: 1,
                                borderColor: 'divider',
                            }}
                        >
                            <Typography variant="caption" color="text.secondary">
                                {getTimeLabel(i)}
                            </Typography>
                        </TimeSlot>
                    ))}
                </Box>
                {/* Content area */}
                <Box sx={{ flex: 1 }}>
                    {Array.from({ length: 24 }, (_, i) => (
                        <TimeSlot
                            key={`content-${i}`}
                            onClick={() => {
                                const timeString = `${i.toString().padStart(2, '0')}:00`;
                                onDateSelect(currentDate, timeString);
                            }}
                        >
                            <Box
                                sx={{
                                    position: 'relative',
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 1,
                                    p: 0.5,
                                }}
                            >
                                {processScheduledPlaylists(
                                    scheduledPlaylists
                                        .filter((schedule) => {
                                            try {
                                                // Convert timestamp to Date object
                                                const scheduleDate = timestampToDate(schedule.date);

                                                if (!isSameDay(scheduleDate, currentDate)) return false;

                                                const [scheduleHour] = schedule.fromTime.split(':').map(Number);
                                                const [toHour] = schedule.toTime.split(':').map(Number);

                                                return scheduleHour === i || (scheduleHour < i && toHour > i);
                                            } catch (error) {
                                                console.error('Error processing schedule:', schedule, error);
                                                return false;
                                            }
                                        })
                                        .sort((a, b) => {
                                            const [hourA, minutesA] = a.fromTime.split(':').map(Number);
                                            const [hourB, minutesB] = b.fromTime.split(':').map(Number);
                                            return hourA * 60 + minutesA - (hourB * 60 + minutesB);
                                        }),
                                ).map((playlist, index) => {
                                    const [fromHour, fromMinutes] = playlist.fromTime.split(':').map(Number);
                                    const [toHour, toMinutes] = playlist.toTime.split(':').map(Number);

                                    // Calculate top position
                                    let topPosition = 0;
                                    if (fromHour === i) {
                                        topPosition = (fromMinutes / 60) * 100;
                                    }

                                    // Calculate height based on duration within this hour
                                    let heightPercentage;
                                    if (fromHour === toHour) {
                                        heightPercentage = ((toMinutes - fromMinutes) / 60) * 100;
                                    } else if (fromHour === i) {
                                        heightPercentage = ((60 - fromMinutes) / 60) * 100;
                                    } else if (toHour === i) {
                                        heightPercentage = (toMinutes / 60) * 100;
                                    } else {
                                        heightPercentage = 100;
                                    }

                                    return (
                                        <Box
                                            key={index}
                                            sx={{
                                                position: 'absolute',
                                                top: `${topPosition}%`,
                                                left: `calc(${playlist.left} + 4px)`,
                                                width: `calc(${playlist.width} - 8px)`,
                                                height: `${heightPercentage}%`,
                                                minHeight: '40px',
                                                zIndex: 1,
                                                display: 'flex',
                                                alignItems: 'center',
                                                padding: '0 2px',
                                                '& > *': {
                                                    width: '100%',
                                                    minHeight: '20px',
                                                    display: 'flex',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                },
                                            }}
                                        >
                                            {renderScheduledPlaylist(playlist, index, scheduledPlaylists)}
                                        </Box>
                                    );
                                })}
                            </Box>
                        </TimeSlot>
                    ))}
                </Box>
            </Box>
        </Box>
    );
};

export default DailyView;
