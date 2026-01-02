import React, { useMemo } from 'react';
import {
    Box,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Typography,
    Chip,
    TextField,
    InputAdornment,
    useTheme,
    Paper,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import type { Point3D, Shape3D } from '../../types/model3d';

export interface ItemListProps {
    points: Point3D[];
    shapes?: Shape3D[];
    selectedIds: Set<string>;
    hoveredId: string | null;
    onItemClick: (itemId: string) => void;
    onItemHover: (itemId: string | null) => void;
    className?: string;
    showShapes?: boolean;
    searchable?: boolean;
}

interface ListItemData {
    id: string;
    type: 'point' | 'shape';
    label: string;
    position: string;
    color?: string;
}

export const ItemList: React.FC<ItemListProps> = ({
    points,
    shapes,
    selectedIds,
    hoveredId,
    onItemClick,
    onItemHover,
    className,
    showShapes = true,
    searchable = true,
}) => {
    const theme = useTheme();
    const [searchQuery, setSearchQuery] = React.useState('');

    const items = useMemo(() => {
        const itemList: ListItemData[] = [];

        // Add points
        points.forEach((point) => {
            itemList.push({
                id: point.id,
                type: 'point',
                label: point.label || point.id,
                position: `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`,
                color: point.color,
            });
        });

        // Add shapes if enabled
        if (showShapes && shapes) {
            shapes.forEach((shape) => {
                itemList.push({
                    id: shape.id,
                    type: 'shape',
                    label: shape.label || shape.id,
                    position: `(${shape.position.x.toFixed(2)}, ${shape.position.y.toFixed(2)}, ${shape.position.z.toFixed(2)})`,
                    color: shape.color,
                });
            });
        }

        // Filter by search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            return itemList.filter((item) => item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query));
        }

        return itemList;
    }, [points, shapes, showShapes, searchQuery]);

    const handleItemClick = (itemId: string) => {
        onItemClick(itemId);
    };

    const handleItemMouseEnter = (itemId: string) => {
        onItemHover(itemId);
    };

    const handleItemMouseLeave = () => {
        onItemHover(null);
    };

    return (
        <Box className={className} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {searchable && (
                <Box
                    sx={{
                        p: 1.5,
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[50],
                    }}
                >
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Search items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize="small" />
                                </InputAdornment>
                            ),
                        }}
                        sx={{
                            '& .MuiOutlinedInput-root': {
                                backgroundColor: theme.palette.background.paper,
                            },
                        }}
                    />
                </Box>
            )}

            <Box sx={{ flex: 1, overflow: 'auto' }}>
                <List dense>
                    {items.length === 0 ? (
                        <ListItem>
                            <ListItemText primary={<Typography variant="body2" color="text.secondary">No items found</Typography>} />
                        </ListItem>
                    ) : (
                        items.map((item) => {
                            const isSelected = selectedIds.has(item.id);
                            const isHovered = hoveredId === item.id;

                            return (
                                <ListItem
                                    key={item.id}
                                    disablePadding
                                    onMouseEnter={() => handleItemMouseEnter(item.id)}
                                    onMouseLeave={handleItemMouseLeave}
                                    sx={{
                                        backgroundColor: isSelected
                                            ? theme.palette.primary.main + '15'
                                            : isHovered
                                                ? theme.palette.action.hover
                                                : 'transparent',
                                        borderLeft: isSelected
                                            ? `4px solid ${theme.palette.primary.main}`
                                            : isHovered
                                                ? `4px solid ${theme.palette.divider}`
                                                : '4px solid transparent',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    <ListItemButton
                                        onClick={() => handleItemClick(item.id)}
                                        sx={{
                                            py: 1.5,
                                            '&:hover': {
                                                backgroundColor: 'transparent',
                                            },
                                        }}
                                    >
                                        <ListItemText
                                            primary={
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Typography
                                                        variant="body2"
                                                        fontWeight={isSelected ? 600 : 400}
                                                        color={isSelected ? 'primary.main' : 'text.primary'}
                                                    >
                                                        {item.label}
                                                    </Typography>
                                                    <Chip
                                                        label={item.type}
                                                        size="small"
                                                        sx={{
                                                            height: 20,
                                                            fontSize: '0.7rem',
                                                            fontWeight: 500,
                                                            backgroundColor:
                                                                item.type === 'point'
                                                                    ? theme.palette.primary.main + '20'
                                                                    : theme.palette.secondary.main + '20',
                                                            color:
                                                                item.type === 'point'
                                                                    ? theme.palette.primary.main
                                                                    : theme.palette.secondary.main,
                                                        }}
                                                    />
                                                </Box>
                                            }
                                            secondary={
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {item.position}
                                                    </Typography>
                                                    {item.color && (
                                                        <Box
                                                            sx={{
                                                                width: 16,
                                                                height: 16,
                                                                borderRadius: '50%',
                                                                backgroundColor: item.color,
                                                                border: `2px solid ${theme.palette.divider}`,
                                                                boxShadow: `0 0 0 1px ${item.color}40`,
                                                            }}
                                                        />
                                                    )}
                                                </Box>
                                            }
                                        />
                                    </ListItemButton>
                                </ListItem>
                            );
                        })
                    )}
                </List>
            </Box>

            <Paper
                sx={{
                    p: 1.5,
                    borderTop: `1px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[50],
                }}
            >
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                    {items.length} item{items.length !== 1 ? 's' : ''}
                    {selectedIds.size > 0 && (
                        <>
                            {' • '}
                            <Box component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>
                                {selectedIds.size} selected
                            </Box>
                        </>
                    )}
                </Typography>
            </Paper>
        </Box>
    );
};

