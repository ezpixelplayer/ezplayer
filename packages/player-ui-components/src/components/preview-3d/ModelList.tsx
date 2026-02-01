import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
    Box as MuiBox,
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
    Divider,
    alpha,
} from '@mui/material';
import { Box } from '../box/Box';
import SearchIcon from '@mui/icons-material/Search';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import { ModelMetadata } from '../../types/model3d';

export interface ModelListProps {
    selectedModelNames?: Set<string> | null;
    onModelSelect: (model: ModelMetadata | null) => void;
    className?: string;
    searchable?: boolean;
    modelData?: {
        points: Array<{ metadata?: { modelName?: string } }>;
        metadata?: {
            models?: Array<{ name: string; pointCount: number }>;
        };
    } | null;
}

export const ModelList: React.FC<ModelListProps> = ({
    selectedModelNames = null,
    onModelSelect,
    className,
    searchable = true,
    modelData = null,
}) => {
    const theme = useTheme();
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredModelName, setHoveredModelName] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const selectedItemRef = useRef<HTMLLIElement>(null);

    // Extract models from modelData
    const allModels = useMemo(() => {
        if (modelData?.metadata?.models && modelData.metadata.models.length > 0) {
            // Use models from XML/modelData
            return modelData.metadata.models as ModelMetadata[];
        } else {
            // No models available
            return [] as ModelMetadata[];
        }
    }, [modelData]);

    // Filter models based on search query
    const filteredModels = useMemo(() => {
        if (!searchQuery.trim()) {
            return allModels;
        }

        const query = searchQuery.toLowerCase();
        return allModels.filter((model) => model.name.toLowerCase().includes(query));
    }, [allModels, searchQuery]);

    // Calculate point count for a model
    const getModelPointCount = (model: ModelMetadata): number => {
        // If we have modelData with metadata, use that
        if (modelData?.metadata?.models) {
            const modelInfo = modelData.metadata.models.find((m) => m.name === model.name);
            if (modelInfo) {
                return modelInfo.pointCount;
            }
        }

        // If we have modelData with points, count points for this model
        if (modelData?.points) {
            return modelData.points.filter((p) => p.metadata?.modelName === model.name).length;
        }

        return 0;
    };

    const handleModelClick = (model: ModelMetadata) => {
        // Toggle selection: if the clicked model is already selected, deselect it
        if (selectedModelNames?.has(model.name)) {
            onModelSelect(null);
        } else {
            onModelSelect(model);
        }
    };

    const handleModelMouseEnter = (modelName: string) => {
        setHoveredModelName(modelName);
    };

    const handleModelMouseLeave = () => {
        setHoveredModelName(null);
    };

    // Auto-scroll to selected model
    useEffect(() => {
        if (selectedModelNames?.size && selectedItemRef.current && scrollContainerRef.current) {
            const container = scrollContainerRef.current;
            const item = selectedItemRef.current;

            // Calculate scroll position to center the selected item
            const itemOffsetTop = item.offsetTop;
            const containerHeight = container.clientHeight;
            const itemHeight = item.clientHeight;

            // Calculate the desired scroll position to center the item
            const targetScrollTop = itemOffsetTop - containerHeight / 2 + itemHeight / 2;

            // Smooth scroll to the selected item
            container.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior: 'smooth',
            });
        }
    }, [selectedModelNames, filteredModels]);

    return (
        <Box
            className={className}
            sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
        >
            {/* Fixed Header Section */}
            <Box
                sx={{
                    p: 1.5,
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[50],
                    flexShrink: 0,
                    zIndex: 1,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: searchable ? 1.5 : 0 }}>
                    <ViewInArIcon
                        sx={{
                            fontSize: 20,
                            color: theme.palette.primary.main,
                        }}
                    />
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        3D Models
                    </Typography>
                    <Chip
                        label={allModels.length}
                        size="small"
                        sx={{
                            height: 20,
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            backgroundColor: theme.palette.primary.main + '20',
                            color: theme.palette.primary.main,
                        }}
                    />
                </Box>

                {/* Fixed Search Bar */}
                {searchable && (
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Search models..."
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
                )}
            </Box>

            {/* SCROLLABLE Model List - ONLY THIS SECTION SCROLLS */}
            <Paper
                ref={scrollContainerRef}
                elevation={0}
                sx={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    minHeight: 0,
                    m: 0,
                    borderRadius: 0,
                    backgroundColor: 'transparent',
                    // Custom scrollbar styling
                    '&::-webkit-scrollbar': {
                        width: 8,
                    },
                    '&::-webkit-scrollbar-track': {
                        backgroundColor:
                            theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200],
                    },
                    '&::-webkit-scrollbar-thumb': {
                        backgroundColor:
                            theme.palette.mode === 'dark' ? theme.palette.grey[600] : theme.palette.grey[400],
                        borderRadius: 4,
                        '&:hover': {
                            backgroundColor:
                                theme.palette.mode === 'dark' ? theme.palette.grey[500] : theme.palette.grey[500],
                        },
                    },
                }}
            >
                <List dense sx={{ p: 0 }}>
                    {filteredModels.length === 0 ? (
                        <ListItem>
                            <ListItemText
                                primary={
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ textAlign: 'center', py: 2 }}
                                    >
                                        No models found
                                    </Typography>
                                }
                            />
                        </ListItem>
                    ) : (
                        filteredModels.map((model, index) => {
                            const isSelected = selectedModelNames?.has(model.name);
                            const isHovered = hoveredModelName === model.name;
                            const pointCount = getModelPointCount(model);

                            return (
                                <React.Fragment key={`${model.name}-${index}`}>
                                    <ListItem
                                        ref={isSelected ? selectedItemRef : null}
                                        disablePadding
                                        onMouseEnter={() => handleModelMouseEnter(model.name)}
                                        onMouseLeave={handleModelMouseLeave}
                                        sx={{
                                            backgroundColor: isSelected
                                                ? theme.palette.primary.main + '15'
                                                : isHovered
                                                  ? alpha(theme.palette.primary.light, 0.2)
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
                                            onClick={() => handleModelClick(model)}
                                            sx={{
                                                py: 1.5,
                                                '&:hover': {
                                                    backgroundColor: 'transparent',
                                                },
                                            }}
                                        >
                                            <ListItemText
                                                primary={
                                                    <Typography
                                                        variant="body2"
                                                        fontWeight={isSelected ? 600 : 500}
                                                        color={isSelected ? 'primary.main' : 'text.primary'}
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 1,
                                                        }}
                                                    >
                                                        {model.name}
                                                        {isSelected && (
                                                            <Chip
                                                                label="Active"
                                                                size="small"
                                                                sx={{
                                                                    height: 18,
                                                                    fontSize: '0.65rem',
                                                                    fontWeight: 600,
                                                                    backgroundColor: theme.palette.success.main,
                                                                    color: theme.palette.success.contrastText,
                                                                }}
                                                            />
                                                        )}
                                                    </Typography>
                                                }
                                                secondary={
                                                    <Box
                                                        sx={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: 0.5,
                                                            mt: 0.5,
                                                        }}
                                                    >
                                                        <Box
                                                            sx={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: 1,
                                                                flexWrap: 'wrap',
                                                            }}
                                                        >
                                                            <Typography
                                                                variant="caption"
                                                                color="text.secondary"
                                                                sx={{ fontWeight: 500 }}
                                                            >
                                                                {pointCount.toLocaleString()} points
                                                            </Typography>
                                                            {model.pixelSize && (
                                                                <>
                                                                    <Typography
                                                                        variant="caption"
                                                                        color="text.secondary"
                                                                    >
                                                                        •
                                                                    </Typography>
                                                                    <Typography
                                                                        variant="caption"
                                                                        color="text.secondary"
                                                                    >
                                                                        Size: {model.pixelSize}
                                                                    </Typography>
                                                                </>
                                                            )}
                                                        </Box>
                                                        {model.pixelStyle && (
                                                            <Chip
                                                                label={model.pixelStyle}
                                                                size="small"
                                                                sx={{
                                                                    height: 18,
                                                                    fontSize: '0.65rem',
                                                                    alignSelf: 'flex-start',
                                                                    backgroundColor:
                                                                        theme.palette.mode === 'dark'
                                                                            ? theme.palette.grey[700]
                                                                            : theme.palette.grey[200],
                                                                    color: theme.palette.text.secondary,
                                                                }}
                                                            />
                                                        )}
                                                    </Box>
                                                }
                                            />
                                        </ListItemButton>
                                    </ListItem>
                                    {index < filteredModels.length - 1 && (
                                        <Divider
                                            sx={{
                                                ml: 2,
                                                opacity: 0.6,
                                            }}
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })
                    )}
                </List>
            </Paper>

            {/* Fixed Footer with Stats */}
            <Paper
                elevation={0}
                sx={{
                    p: 1.5,
                    borderTop: `2px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[50],
                    flexShrink: 0,
                    zIndex: 1,
                }}
            >
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                    {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''}
                    {searchQuery && filteredModels.length !== allModels.length && (
                        <>
                            {' of '}
                            {allModels.length}
                        </>
                    )}
                    {selectedModelNames && (
                        <>
                            {' • '}
                            <MuiBox component="span" sx={{ color: 'primary.main', fontWeight: 600 }}>
                                {selectedModelNames?.size} active
                            </MuiBox>
                        </>
                    )}
                </Typography>
            </Paper>
        </Box>
    );
};
