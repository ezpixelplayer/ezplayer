import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Box } from '../../box/Box';
import { ScheduledPlaylist } from '@ezplayer/ezplayer-core';
import { Typography } from '@mui/material';

export type CalendarViewMode = 'monthly' | 'weekly' | 'daily';
export type ScheduleChipScheduleType = 'main' | 'background';

export interface ScheduleChipProps {
    className?: string;
    scheduleItem: ScheduledPlaylist;
    view: CalendarViewMode;
    scheduleType: ScheduleChipScheduleType;
    resolvedPlaylistTitle?: string;
    sourceDateKey?: string;
    onScheduleClick?: (scheduleItem: ScheduledPlaylist) => void;
    draggable?: boolean;
    isDragOverlay?: boolean;
}

export const ScheduleChip: React.FC<ScheduleChipProps> = ({
    className = '',
    scheduleItem,
    view,
    scheduleType,
    resolvedPlaylistTitle,
    sourceDateKey,
    onScheduleClick,
    draggable = true,
    isDragOverlay = false,
}) => {
    const isBackground = scheduleType === 'background';

    const draggableState = useDraggable({
        id: scheduleItem.id,
        disabled: !draggable,
        data: {
            scheduleId: scheduleItem.id,
            sourceDateKey,
            scheduleItem,
        },
    });

    const attributes = draggable ? draggableState.attributes : {};
    const listeners = draggable ? draggableState.listeners : undefined;
    const setNodeRef = draggable ? draggableState.setNodeRef : undefined;
    const transform = draggable ? draggableState.transform : null;
    const isDragging = draggable ? draggableState.isDragging : false;

    const dragStyle: React.CSSProperties = {
        // When dragging we rely on DragOverlay for motion; keep the in-place element stable.
        transform: isDragging && !isDragOverlay ? undefined : CSS.Transform.toString(transform),
        opacity: isDragOverlay ? 1 : isDragging ? 0.15 : 1,
        cursor: draggable ? 'grab' : 'default',
        boxShadow: isDragOverlay ? '0 8px 24px rgba(0,0,0,0.22)' : undefined,
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isDragging || !onScheduleClick) return;
        onScheduleClick(scheduleItem);
    };

    const backgroundColor = isBackground ? 'secondary.main' : 'primary.main';
    const textColor = isBackground ? 'secondary.contrastText' : 'primary.contrastText';
    const hoverColor = isBackground ? 'secondary.dark' : 'primary.dark';

    if (view === 'monthly') {
        return (
            <Box
                ref={setNodeRef}
                className={className}
                onClick={handleClick}
                {...attributes}
                {...listeners}
                sx={{
                    position: 'relative',
                    width: isDragOverlay ? '160px' : '100%',
                    backgroundColor,
                    borderRadius: 1,
                    p: 0.5,
                    marginTop: 0.5,
                    cursor: draggable ? 'grab' : 'pointer',
                    '&:hover': {
                        backgroundColor: hoverColor,
                    },
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    MozUserSelect: 'none',
                    msUserSelect: 'none',
                    touchAction: 'none',
                    ...dragStyle,
                }}
            >
                <Typography variant="body2" sx={{ display: 'block', margin: '0 2px', color: textColor }}>
                    {scheduleItem.title}
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ display: 'block', margin: '0 2px', color: textColor, opacity: 0.8 }}
                >
                    {scheduleItem.fromTime} - {scheduleItem.toTime}
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            ref={setNodeRef}
            className={className}
            onClick={handleClick}
            {...attributes}
            {...listeners}
            sx={{
                backgroundColor,
                borderRadius: '4px',
                '&:hover': {
                    backgroundColor: hoverColor,
                },
                padding: '2px 4px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                cursor: draggable ? 'grab' : 'pointer',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                touchAction: 'none',
                ...dragStyle,
            }}
        >
            <Typography
                variant="body2"
                sx={{
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    margin: 0,
                    color: textColor,
                    display: 'block',
                }}
            >
                {scheduleItem.title || resolvedPlaylistTitle}
            </Typography>
            <Typography
                variant="caption"
                sx={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    margin: 0,
                    color: textColor,
                    opacity: 0.8,
                    display: 'block',
                }}
            >
                {scheduleItem.fromTime} - {scheduleItem.toTime}
            </Typography>
        </Box>
    );
};

