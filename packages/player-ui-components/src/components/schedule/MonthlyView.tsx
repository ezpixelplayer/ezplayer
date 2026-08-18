import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    format,
} from 'date-fns';
import { Typography, styled } from '@mui/material';
import { Box } from '../box/Box';
import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';

interface MonthlyViewProps {
    currentDate: Date;
    onDateSelect: (date: Date, time: string) => void;
    scheduledPlaylists: ScheduledPlaylist[];
    renderScheduledPlaylist: (
        playlist: ScheduledPlaylist,
        index: number,
        array: ScheduledPlaylist[],
    ) => React.ReactNode;
    dayErrorKeys?: Record<string, boolean>;
}

const DayCell = styled(Box)(({ theme }) => ({
    border: `1px solid ${theme.palette.divider}`,
    minHeight: 120,
    padding: theme.spacing(1),
    position: 'relative',
    cursor: 'pointer',
    '&:hover': {
        backgroundColor: theme.palette.action.hover,
    },
}));

type CalendarDayObj = {
    date: Date;
    isEmpty: boolean;
    gridRow: number;
    gridColumn: number;
};

interface DayCellDroppableProps {
    dayObj: CalendarDayObj;
    index: number;
    currentDate: Date;
    scheduledPlaylists: ScheduledPlaylist[];
    renderScheduledPlaylist: (
        playlist: ScheduledPlaylist,
        index: number,
        array: ScheduledPlaylist[],
    ) => React.ReactNode;
    onDateSelect: (date: Date, time: string) => void;
    dayErrorKeys?: Record<string, boolean>;
}

const DayCellDroppable: React.FC<DayCellDroppableProps> = ({
    dayObj,
    index,
    scheduledPlaylists,
    renderScheduledPlaylist,
    onDateSelect,
    dayErrorKeys,
}) => {
    const dateKey = format(dayObj.date, 'yyyy-MM-dd');
    const hasError = Boolean(dayErrorKeys?.[dateKey]);

    const { setNodeRef } = useDroppable({
        id: dateKey,
        disabled: dayObj.isEmpty,
    });

    const getCurrentTime = () => {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    };

    return (
        <DayCell
            ref={setNodeRef}
            key={`${dayObj.date.toString()}-${index}`}
            onClick={() => !dayObj.isEmpty && onDateSelect(dayObj.date, getCurrentTime())}
            sx={{
                bgcolor: dayObj.isEmpty ? 'action.disabledBackground' : hasError ? 'error.light' : 'background.paper',
                cursor: dayObj.isEmpty ? 'default' : 'pointer',
                gridRow: dayObj.gridRow,
                gridColumn: dayObj.gridColumn,
                borderColor: hasError ? 'error.main' : undefined,
                position: 'relative',
            }}
        >
            {hasError && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 4,
                        right: 6,
                        zIndex: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{
                            bgcolor: 'error.main',
                            color: 'error.contrastText',
                            borderRadius: 0.5,
                            px: 0.5,
                            fontWeight: 'bold',
                            fontSize: 10,
                        }}
                    >
                        ERR
                    </Typography>
                </Box>
            )}

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                }}
            >
                <Typography
                    variant="body2"
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        backgroundColor:
                            !dayObj.isEmpty && isSameDay(dayObj.date, new Date())
                                ? 'primary.main'
                                : 'transparent',
                        color:
                            !dayObj.isEmpty && isSameDay(dayObj.date, new Date())
                                ? 'primary.contrastText'
                                : dayObj.isEmpty
                                  ? 'text.disabled'
                                  : 'text.primary',
                    }}
                >
                    {format(dayObj.date, 'd')}
                </Typography>
            </Box>
            <Box sx={{ mt: 1 }}>
                {scheduledPlaylists
                    .filter((schedule) => isSameDay(new Date(schedule.date), dayObj.date))
                    .map((playlist, playlistIndex, array) =>
                        renderScheduledPlaylist(playlist, playlistIndex, array),
                    )}
            </Box>
        </DayCell>
    );
};

const MonthlyView: React.FC<MonthlyViewProps> = ({
    currentDate,
    onDateSelect,
    scheduledPlaylists,
    renderScheduledPlaylist,
    dayErrorKeys,
}) => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 0 }); // Sunday as start of week
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });

    const allDays = eachDayOfInterval({ start: startDate, end: endDate });

    // Create days with proper grid positioning
    const days = allDays.map((day, index) => {
        const dayOfWeek = day.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const weekNumber = Math.floor(index / 7);
        const gridRow = weekNumber + 1; // +1 because CSS Grid is 1-indexed
        const gridColumn = dayOfWeek + 1; // +1 because CSS Grid is 1-indexed

        return {
            date: day,
            isEmpty: !isSameMonth(day, currentDate),
            gridRow,
            gridColumn,
        };
    });

    return (
        <Box>
            {/* Weekday headers */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    borderBottom: 1,
                    borderColor: 'divider',
                }}
            >
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <Box
                        key={day}
                        sx={{
                            padding: 1,
                            textAlign: 'center',
                            fontWeight: 'bold',
                        }}
                    >
                        <Typography variant="subtitle2">{day}</Typography>
                    </Box>
                ))}
            </Box>

            {/* Calendar grid */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gridTemplateRows: `repeat(${Math.ceil(days.length / 7)}, minmax(120px, auto))`,
                    borderLeft: 1,
                    borderColor: 'divider',
                }}
            >
                {days.map((dayObj, index) => (
                    <DayCellDroppable
                        key={`${dayObj.date.toString()}-${index}`}
                        dayObj={dayObj}
                        index={index}
                        currentDate={currentDate}
                        scheduledPlaylists={scheduledPlaylists}
                        renderScheduledPlaylist={renderScheduledPlaylist}
                        onDateSelect={onDateSelect}
                        dayErrorKeys={dayErrorKeys}
                    />
                ))}
            </Box>
        </Box>
    );
};

export default MonthlyView;
