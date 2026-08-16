import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
    Box as MuiBox,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Typography,
    Chip,
    IconButton,
    TextField,
    InputAdornment,
    useTheme,
    Paper,
    Divider,
    alpha,
} from '@mui/material';
import { Box } from '../box/Box';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import { useSelector } from 'react-redux';
import type { KnownController } from '@ezplayer/ezplayer-core';
import type { RootState } from '../../store/Store';
import { Model3DData, ModelMetadata } from '../../types/model3d';

export interface ModelListProps {
    selectedModelNames?: Set<string> | null;
    onModelSelect: (model: ModelMetadata | null) => void;
    searchable?: boolean;
    modelData?: Model3DData | null;
    /** When set, the header shows a close X wired to this. */
    onClose?: () => void;
}

/** Where a model plugs in, joined from known controllers' modelIntents by name. */
interface ModelControllerInfo {
    controllerName: string;
    /** 1-based physical port. */
    port: number;
    /** xLights smart-remote index (0/undefined = none, 1 = A, 2 = B, ...). */
    smartRemote?: number;
    protocol?: string;
    /** Matches for this model name; the first wins for display, extras show as "+N". */
    matchCount: number;
}

/** 1 → "A", 2 → "B", ... (falls back to the raw number past Z). */
function smartRemoteLetter(sr: number): string {
    return sr >= 1 && sr <= 26 ? String.fromCharCode(64 + sr) : String(sr);
}

/** "Port 5" / "Port 5 SR B". */
function formatPort(info: ModelControllerInfo): string {
    const sr = info.smartRemote && info.smartRemote > 0 ? ` SR ${smartRemoteLetter(info.smartRemote)}` : '';
    return `Port ${info.port}${sr}`;
}

/** Build the model-name → controller/port lookup once per `known` change. */
function buildControllerInfoMap(known: KnownController[] | undefined): Map<string, ModelControllerInfo> {
    const map = new Map<string, ModelControllerInfo>();
    for (const kc of known ?? []) {
        for (const mi of kc.modelIntents ?? []) {
            const existing = map.get(mi.name);
            if (existing) {
                existing.matchCount += 1;
            } else {
                map.set(mi.name, {
                    controllerName: kc.name,
                    port: mi.controllerPort,
                    smartRemote: mi.smartRemote,
                    protocol: mi.protocol || kc.protocol,
                    matchCount: 1,
                });
            }
        }
    }
    return map;
}

export const ModelList = React.memo(function ModelList({
    selectedModelNames = null,
    onModelSelect,
    searchable = true,
    modelData = null,
    onClose,
}: ModelListProps) {
    const theme = useTheme();
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredModelName, setHoveredModelName] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const selectedItemRef = useRef<HTMLLIElement>(null);

    const allModels = useMemo(() => {
        return modelData?.metadata?.models ?? [];
    }, [modelData]);

    const knownControllers = useSelector((state: RootState) => state.controllerOps.known);
    const controllerInfoByModel = useMemo(() => buildControllerInfoMap(knownControllers), [knownControllers]);

    // Search matches the model name or its controller's name.
    const filteredModels = useMemo(() => {
        if (!searchQuery.trim()) {
            return allModels;
        }

        const query = searchQuery.toLowerCase();
        return allModels.filter((model) => {
            if (model.name.toLowerCase().includes(query)) {
                return true;
            }
            const info = controllerInfoByModel.get(model.name);
            return info ? info.controllerName.toLowerCase().includes(query) : false;
        });
    }, [allModels, searchQuery, controllerInfoByModel]);

    const getModelPointCount = (model: ModelMetadata): number => {
        return model?.pointCount ?? 0;
    };

    const handleModelClick = (model: ModelMetadata) => {
        // Clicking the selected model deselects it.
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

            // Center the selected item in the container.
            const itemOffsetTop = item.offsetTop;
            const containerHeight = container.clientHeight;
            const itemHeight = item.clientHeight;
            const targetScrollTop = itemOffsetTop - containerHeight / 2 + itemHeight / 2;

            container.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior: 'smooth',
            });
        }
    }, [selectedModelNames, filteredModels]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Header */}
            <Box
                sx={{
                    p: 1.5,
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[50],
                    flexShrink: 0,
                    zIndex: 1,
                }}
            >
                {/* Single slim row: stats (formerly a separate footer) + close X. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: searchable ? 1 : 0 }}>
                    <ViewInArIcon
                        sx={{
                            fontSize: 20,
                            color: theme.palette.primary.main,
                        }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, flexGrow: 1 }}>
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
                    {onClose && (
                        <IconButton size="small" aria-label="close" onClick={onClose} sx={{ my: -0.5 }}>
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    )}
                </Box>

                {searchable && (
                    <TextField
                        fullWidth
                        size="small"
                        placeholder="Search models or controllers..."
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

            {/* Scrollable model list */}
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
                            const controllerInfo = controllerInfoByModel.get(model.name);

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
                                                            {model.firstNodeChannel !== undefined && (
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
                                                                        Ch: {model.firstNodeChannel.toLocaleString()}
                                                                    </Typography>
                                                                </>
                                                            )}
                                                        </Box>
                                                        {controllerInfo ? (
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
                                                                    sx={{
                                                                        fontWeight: 600,
                                                                        color: theme.palette.info.main,
                                                                    }}
                                                                >
                                                                    {controllerInfo.controllerName}
                                                                </Typography>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    •
                                                                </Typography>
                                                                <Typography
                                                                    variant="caption"
                                                                    color="text.secondary"
                                                                    sx={{ fontWeight: 500 }}
                                                                >
                                                                    {formatPort(controllerInfo)}
                                                                </Typography>
                                                                {controllerInfo.protocol && (
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
                                                                            {controllerInfo.protocol}
                                                                        </Typography>
                                                                    </>
                                                                )}
                                                                {controllerInfo.matchCount > 1 && (
                                                                    <Chip
                                                                        label={`+${controllerInfo.matchCount - 1} more`}
                                                                        size="small"
                                                                        sx={{
                                                                            height: 16,
                                                                            fontSize: '0.6rem',
                                                                            backgroundColor:
                                                                                theme.palette.mode === 'dark'
                                                                                    ? theme.palette.grey[700]
                                                                                    : theme.palette.grey[200],
                                                                            color: theme.palette.text.secondary,
                                                                        }}
                                                                    />
                                                                )}
                                                            </Box>
                                                        ) : (
                                                            controllerInfoByModel.size > 0 && (
                                                                <Typography variant="caption" color="text.disabled">
                                                                    — no controller
                                                                </Typography>
                                                            )
                                                        )}
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

        </Box>
    );
});
