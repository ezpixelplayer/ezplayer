import React, { useEffect, useRef } from 'react';
import { startOfWeek, addDays, format, isSameDay } from 'date-fns';
import { Box, Typography, styled } from '@mui/material';
import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';

interface WeeklyViewProps {
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
    height: 60,
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    position: 'relative',
    cursor: 'pointer',
    '&:hover': {
        backgroundColor: theme.palette.action.hover,
    },
}));

const WeeklyView: React.FC<WeeklyViewProps> = ({
    currentDate,
    onDateSelect,
    scheduledPlaylists,
    renderScheduledPlaylist,
}: WeeklyViewProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday as start of week
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    useEffect(() => {
        if (!containerRef.current) return;

        // Find the earliest event time
        let earliestHour = 12; // Default to noon
        let hasEvents = false;

        scheduledPlaylists.forEach((playlist: ScheduledPlaylist) => {
            try {
                const scheduleDate = new Date(playlist.date);
                if (days.some((day) => isSameDay(scheduleDate, day))) {
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

        // Calculate scroll position (each hour slot is 60px high)
        const scrollPosition = earliestHour * 60;
        containerRef.current.scrollTo({
            top: scrollPosition,
            behavior: 'smooth',
        });
    }, [scheduledPlaylists, days]);

    const getTimeLabel = (hour: number) => {
        return `${hour.toString().padStart(2, '0')}:00`;
    };

    const processScheduledPlaylists = (playlists: ScheduledPlaylist[]) => {
        // Group overlapping playlists
        const groups: ScheduledPlaylist[][] = [];

        playlists.forEach((playlist) => {
            const [startHour, startMin] = playlist.fromTime.split(':').map(Number);
            const [endHour, endMin] = playlist.toTime.split(':').map(Number);
            const startTime = startHour * 60 + startMin;
            const endTime = endHour * 60 + endMin;

            // Find a group where this playlist overlaps
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

        // Flatten and add position information
        return groups.flatMap((group) =>
            group.map((playlist, indexInGroup) => ({
                ...playlist,
                width: `${100 / group.length}%`,
                left: `${(indexInGroup * 100) / group.length}%`,
            })),
        );
    };

    return (
        <Box ref={containerRef} sx={{ height: '100%', overflow: 'auto' }}>
            {/* Header row with weekdays */}
            <Box
                sx={{
                    display: 'flex',
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: 'background.paper',
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                }}
            >
                {/* Empty cell for time column */}
                <Box
                    sx={{
                        width: 80,
                        borderRight: 1,
                        borderColor: 'divider',
                    }}
                />

                {/* Day headers */}
                {days.map((day) => (
                    <Box
                        key={`header-${day}`}
                        sx={{
                            flex: 1,
                            minWidth: 120,
                            p: 1,
                            textAlign: 'center',
                            borderRight: 1,
                            borderColor: 'divider',
                        }}
                    >
                        <Typography variant="subtitle2">{format(day, 'EEE')}</Typography>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                margin: '0 auto',
                                backgroundColor: isSameDay(day, new Date()) ? 'primary.main' : 'transparent',
                            }}
                        >
                            <Typography
                                variant="caption"
                                sx={{
                                    color: isSameDay(day, new Date()) ? 'primary.contrastText' : 'text.secondary',
                                }}
                            >
                                {format(day, 'd')}
                            </Typography>
                        </Box>
                    </Box>
                ))}
            </Box>

            {/* Time grid */}
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
                        zIndex: 1,
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
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                                {getTimeLabel(i)}
                            </Typography>
                        </TimeSlot>
                    ))}
                </Box>

                {/* Days columns */}
                {days.map((day) => (
                    <Box
                        key={day.toString()}
                        sx={{
                            flex: 1,
                            minWidth: 120,
                            borderRight: 1,
                            borderColor: 'divider',
                            position: 'relative',
                        }}
                    >
                        {/* Time slots */}
                        <Box sx={{ position: 'relative' }}>
                            {Array.from({ length: 24 }, (_, i) => (
                                <TimeSlot
                                    key={`${day}-${i}`}
                                    onClick={() => {
                                        const timeString = `${i.toString().padStart(2, '0')}:00`;
                                        onDateSelect(day, timeString);
                                    }}
                                />
                            ))}

                            {/* Scheduled playlists */}
                            {processScheduledPlaylists(
                                scheduledPlaylists
                                    .filter((schedule: ScheduledPlaylist) => isSameDay(new Date(schedule.date), day))
                                    .sort((a: ScheduledPlaylist, b: ScheduledPlaylist) => {
                                        const [hourA, minutesA] = a.fromTime.split(':').map(Number);
                                        const [hourB, minutesB] = b.fromTime.split(':').map(Number);
                                        return hourA * 60 + minutesA - (hourB * 60 + minutesB);
                                    }),
                            ).map((playlist, index) => {
                                const [fromHour, fromMinutes] = playlist.fromTime.split(':').map(Number);
                                const [toHour, toMinutes] = playlist.toTime.split(':').map(Number);
                                const startTimeInMinutes = fromHour * 60 + fromMinutes;
                                const endTimeInMinutes = toHour * 60 + toMinutes;
                                const durationInMinutes = endTimeInMinutes - startTimeInMinutes;

                                // Define a minimum height for events to ensure text visibility
                                const MIN_EVENT_HEIGHT_PX = 50; // Adjust as needed

                                return (
                                    <Box
                                        key={index}
                                        sx={{
                                            position: 'absolute',
                                            top: `${startTimeInMinutes}px`,
                                            height: `${Math.max(durationInMinutes, MIN_EVENT_HEIGHT_PX)}px`,
                                            left: playlist.left,
                                            width: playlist.width,
                                            zIndex: 1,
                                            cursor: 'pointer',
                                            '& > *': {
                                                height: '100%',
                                            },
                                        }}
                                    >
                                        {renderScheduledPlaylist(playlist, index, scheduledPlaylists)}
                                    </Box>
                                );
                            })}
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
};

export default WeeklyView;
