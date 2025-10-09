import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@ezplayer/shared-ui-components';
import { ListItem, ListItemText, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ArrowForward } from '@mui/icons-material';
import { Box, Chip } from '@mui/material';

interface SortableItemProps {
    id: string;
    songName: React.ReactNode;
    children?: React.ReactNode;
    onRemoveSong?: (id: string) => void;
    showRemove?: boolean;
    containerId?: string;
    isInPlaylist?: boolean;
    onAddSong?: (id: string) => void;
    showAdd?: boolean;
    tags?: string[];
    duration?: string;
}

export function SortableItem({
    id,
    songName,
    onRemoveSong,
    showRemove,
    containerId,
    isInPlaylist = false,
    onAddSong,
    showAdd,
    tags,
    duration,
}: SortableItemProps) {
    const theme = useTheme();

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id,
        data: {
            containerId,
            songId: id,
        },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        cursor: 'grab',
        border: '1px solid #ddd',
        padding: '5px',
        margin: '0',
        backgroundColor: containerId === 'available' && isInPlaylist ? theme.palette.primary.light : null,
        '&:hover': {
            backgroundColor:
                containerId === 'available' && isInPlaylist ? theme.palette.action.hover : theme.palette.action.hover,
        },
        //borderLeft: containerId === 'available' && isInPlaylist ? '4px solid #1976d2' : '1px solid #ddd',
        userSelect: 'none' as const,
        WebkitUserSelect: 'none' as const,
        MozUserSelect: 'none' as const,
        msUserSelect: 'none' as const,
    };

    return (
        <ListItem
            ref={setNodeRef}
            sx={{
                ...style,
                display: 'flex',
                justifyContent: 'space-between',
                padding: 0,
            }}
        >
            {showRemove && onRemoveSong && (
                <div style={{ marginLeft: '5px' }}>
                    <Button
                        style={{
                            padding: 0,
                            minWidth: 'auto',
                        }}
                        size="small"
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemoveSong(id);
                        }}
                        icon={<CloseIcon />}
                    />
                </div>
            )}
            <div
                {...attributes}
                {...listeners}
                style={{
                    flex: 1,
                    padding: '5px',
                }}
            >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <ListItemText
                        sx={{
                            color: containerId === 'available' && isInPlaylist ? 'inherit' : 'inherit',
                            '.MuiTypography-root': {
                                userSelect: 'none',
                                WebkitUserSelect: 'none',
                                MozUserSelect: 'none',
                                msUserSelect: 'none',
                                pointerEvents: 'none',
                            },
                        }}
                    >
                        {songName}
                    </ListItemText>
                    {duration && (
                        <Box
                            component="span"
                            sx={{
                                ml: 1,
                                fontSize: '0.8rem',
                                color: 'text.secondary',
                                userSelect: 'none',
                                WebkitUserSelect: 'none',
                                MozUserSelect: 'none',
                                msUserSelect: 'none',
                            }}
                        >
                            {duration}
                        </Box>
                    )}
                </Box>
                {tags && tags.length > 0 && (
                    <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {tags.map((tag) => (
                            <Chip
                                key={tag}
                                label={tag}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 20 }}
                            />
                        ))}
                    </Box>
                )}
            </div>
            <div>
                {showAdd && onAddSong && (
                    <Button
                        style={{
                            padding: 0,
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddSong(id);
                        }}
                        icon={<ArrowForward />}
                    />
                )}
            </div>
        </ListItem>
    );
}
