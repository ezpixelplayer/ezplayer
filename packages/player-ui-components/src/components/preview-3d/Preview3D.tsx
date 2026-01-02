import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    Box,
    ToggleButton,
    ToggleButtonGroup,
    Button,
    IconButton,
    Tooltip,
    useTheme,
    Paper,
    Divider,
    Typography,
    TextField,
    Popover,
} from '@mui/material';
import View3DIcon from '@mui/icons-material/ViewInAr';
import View2DIcon from '@mui/icons-material/ViewQuilt';
import ListIcon from '@mui/icons-material/List';
import CloseIcon from '@mui/icons-material/Close';
import ColorLensIcon from '@mui/icons-material/ColorLens';
import { Viewer3D } from './Viewer3D';
import { Viewer2D } from './Viewer2D';
import { ItemList } from './ItemList';
import { loadModelFromJson, createDefaultModel } from '../../services/model3dLoader';
import type { Model3DData, PointColorData, SelectionState } from '../../types/model3d';

export type ViewMode = '3d' | '2d';
export type ViewPlane = 'xy' | 'xz' | 'yz';

export interface Preview3DProps {
    modelUrl?: string;
    modelData?: Model3DData;
    colorData?: PointColorData[];
    onColorDataUpdate?: (colorData: PointColorData[]) => void;
    className?: string;
    showList?: boolean;
    showControls?: boolean;
    defaultViewMode?: ViewMode;
    defaultViewPlane?: ViewPlane;
    pointSize?: number;
    enableAutoColorAnimation?: boolean;
    enableColorPicker?: boolean;
}

export const Preview3D: React.FC<Preview3DProps> = ({
    modelUrl,
    modelData: initialModelData,
    colorData: externalColorData,
    onColorDataUpdate,
    className,
    showList = true,
    showControls = true,
    defaultViewMode = '3d',
    defaultViewPlane = 'xy',
    pointSize = 0.1,
    enableAutoColorAnimation = false,
    enableColorPicker = false,
}) => {
    const theme = useTheme();
    const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
    const [viewPlane, setViewPlane] = useState<ViewPlane>(defaultViewPlane);
    const [showItemList, setShowItemList] = useState(showList);
    const [modelData, setModelData] = useState<Model3DData | null>(initialModelData || null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectionState, setSelectionState] = useState<SelectionState>({
        selectedIds: new Set<string>(),
        hoveredId: null,
    });
    const [colorData, setColorData] = useState<PointColorData[]>(externalColorData || []);
    const [colorPickerAnchor, setColorPickerAnchor] = useState<HTMLElement | null>(null);
    const [selectedColor, setSelectedColor] = useState<string>('#ffffff');

    // Load model from URL if provided
    useEffect(() => {
        if (modelUrl && !initialModelData) {
            setLoading(true);
            setError(null);
            loadModelFromJson(modelUrl)
                .then((data) => {
                    setModelData(data);
                    setLoading(false);
                })
                .catch((err) => {
                    setError(err instanceof Error ? err.message : 'Failed to load model');
                    setLoading(false);
                    // Use default model on error
                    setModelData(createDefaultModel());
                });
        } else if (!initialModelData && !modelUrl) {
            // Use default model if no data provided
            setModelData(createDefaultModel());
        }
    }, [modelUrl, initialModelData]);

    // Sync external color data
    useEffect(() => {
        if (externalColorData) {
            setColorData(externalColorData);
        }
    }, [externalColorData]);

    // Handle item selection
    const handleItemClick = useCallback(
        (itemId: string) => {
            setSelectionState((prev) => {
                const newSelectedIds = new Set(prev.selectedIds);
                if (newSelectedIds.has(itemId)) {
                    newSelectedIds.delete(itemId);
                } else {
                    newSelectedIds.add(itemId);
                }
                return { ...prev, selectedIds: newSelectedIds };
            });
        },
        []
    );

    // Handle item hover
    const handleItemHover = useCallback((itemId: string | null) => {
        setSelectionState((prev) => ({ ...prev, hoveredId: itemId }));
    }, []);

    // Handle color change for selected points
    const handleColorChange = useCallback(
        (color: string) => {
            setSelectedColor(color);
            if (selectionState.selectedIds.size > 0 && modelData) {
                const newColorData: PointColorData[] = [...colorData];
                const updatedPoints = modelData.points.map((point) => {
                    if (selectionState.selectedIds.has(point.id)) {
                        const existingIndex = newColorData.findIndex((cd) => cd.pointId === point.id);
                        if (existingIndex >= 0) {
                            newColorData[existingIndex] = { ...newColorData[existingIndex], color, timestamp: Date.now() };
                        } else {
                            newColorData.push({ pointId: point.id, color, timestamp: Date.now() });
                        }
                        return { ...point, color };
                    }
                    return point;
                });
                setModelData({ ...modelData, points: updatedPoints });
                setColorData(newColorData);
                if (onColorDataUpdate) {
                    onColorDataUpdate(newColorData);
                }
            }
        },
        [selectionState.selectedIds, colorData, modelData, onColorDataUpdate]
    );

    // Open color picker
    const handleOpenColorPicker = useCallback((event: React.MouseEvent<HTMLElement>) => {
        if (selectionState.selectedIds.size > 0) {
            setColorPickerAnchor(event.currentTarget);
            // Get current color of first selected point
            const firstSelectedId = Array.from(selectionState.selectedIds)[0];
            const pointColor = colorData.find((cd) => cd.pointId === firstSelectedId);
            const modelPoint = modelData?.points.find((p) => p.id === firstSelectedId);
            setSelectedColor(pointColor?.color || modelPoint?.color || '#ffffff');
        }
    }, [selectionState.selectedIds, colorData, modelData]);

    // Close color picker
    const handleCloseColorPicker = useCallback(() => {
        setColorPickerAnchor(null);
    }, []);

    // Handle view mode change
    const handleViewModeChange = useCallback((_event: React.MouseEvent<HTMLElement>, newMode: ViewMode | null) => {
        if (newMode !== null) {
            setViewMode(newMode);
        }
    }, []);

    // Handle view plane change (for 2D view)
    const handleViewPlaneChange = useCallback((_event: React.MouseEvent<HTMLElement>, newPlane: ViewPlane | null) => {
        if (newPlane !== null) {
            setViewPlane(newPlane);
        }
    }, []);

    // Animate colors (simulate incoming data) - only if enabled
    useEffect(() => {
        if (!enableAutoColorAnimation || !modelData || modelData.points.length === 0) return;

        const interval = setInterval(() => {
            // Generate random color updates for demonstration
            // In production, this would come from actual data sources
            const newColorData: PointColorData[] = modelData.points.map((point) => {
                const hue = Math.random() * 360;
                return {
                    pointId: point.id,
                    color: `hsl(${hue}, 100%, 50%)`,
                    timestamp: Date.now(),
                };
            });

            setColorData(newColorData);
            if (onColorDataUpdate) {
                onColorDataUpdate(newColorData);
            }
        }, 1000); // Update every second

        return () => clearInterval(interval);
    }, [enableAutoColorAnimation, modelData, onColorDataUpdate]);

    // Check WebGL support
    const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
    const [webglError, setWebglError] = useState<string | null>(null);

    useEffect(() => {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('webgl2') || canvas.getContext('experimental-webgl');
            if (gl) {
                setWebglSupported(true);
            } else {
                setWebglSupported(false);
                setWebglError('WebGL is not supported in this environment');
            }
        } catch (err) {
            setWebglSupported(false);
            setWebglError(err instanceof Error ? err.message : 'Failed to check WebGL support');
        }
    }, []);

    if (loading) {
        return (
            <Box
                className={className}
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    minHeight: 600,
                }}
            >
                Loading model...
            </Box>
        );
    }

    if (webglSupported === false) {
        return (
            <Box
                className={className}
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    minHeight: 600,
                    flexDirection: 'column',
                    gap: 2,
                    p: 3,
                }}
            >
                <Box sx={{ color: 'error.main', textAlign: 'center' }}>
                    <Typography variant="h6" gutterBottom>
                        WebGL Not Supported
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {webglError || 'WebGL is required to display 3D content but is not available in this environment.'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        In Electron, ensure WebGL is enabled in webPreferences.
                    </Typography>
                </Box>
            </Box>
        );
    }

    if (error && !modelData) {
        return (
            <Box
                className={className}
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    minHeight: 600,
                    flexDirection: 'column',
                    gap: 2,
                }}
            >
                <Box sx={{ color: 'error.main' }}>Error: {error}</Box>
                <Button variant="outlined" onClick={() => window.location.reload()}>
                    Reload
                </Button>
            </Box>
        );
    }

    if (!modelData) {
        return (
            <Box
                className={className}
                sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    minHeight: 600,
                }}
            >
                No model data available
            </Box>
        );
    }

    return (
        <Box
            className={className}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                minHeight: 600,
            }}
        >
            {showControls && (
                <Paper
                    elevation={2}
                    sx={{
                        p: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.background.paper,
                        zIndex: 10,
                    }}
                >
                    {/* View Mode Controls */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                            View:
                        </Typography>
                        <ToggleButtonGroup value={viewMode} exclusive onChange={handleViewModeChange} size="small">
                            <ToggleButton value="3d" aria-label="3D view">
                                <Tooltip title="3D View">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <View3DIcon fontSize="small" />
                                        <Typography variant="caption" sx={{ ml: 0.5 }}>
                                            3D
                                        </Typography>
                                    </Box>
                                </Tooltip>
                            </ToggleButton>
                            <ToggleButton value="2d" aria-label="2D view">
                                <Tooltip title="2D View">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <View2DIcon fontSize="small" />
                                        <Typography variant="caption" sx={{ ml: 0.5 }}>
                                            2D
                                        </Typography>
                                    </Box>
                                </Tooltip>
                            </ToggleButton>
                        </ToggleButtonGroup>
                    </Box>

                    {/* 2D Plane Selection */}
                    {viewMode === '2d' && (
                        <>
                            <Divider orientation="vertical" flexItem sx={{ height: 24 }} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                                    Plane:
                                </Typography>
                                <ToggleButtonGroup value={viewPlane} exclusive onChange={handleViewPlaneChange} size="small">
                                    <ToggleButton value="xy" aria-label="XY plane">
                                        XY
                                    </ToggleButton>
                                    <ToggleButton value="xz" aria-label="XZ plane">
                                        XZ
                                    </ToggleButton>
                                    <ToggleButton value="yz" aria-label="YZ plane">
                                        YZ
                                    </ToggleButton>
                                </ToggleButtonGroup>
                            </Box>
                        </>
                    )}

                    <Divider orientation="vertical" flexItem sx={{ height: 24 }} />

                    {/* Selection Info & Color Picker */}
                    {selectionState.selectedIds.size > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" color="primary" sx={{ fontWeight: 500 }}>
                                {selectionState.selectedIds.size} selected
                            </Typography>
                            {enableColorPicker && (
                                <>
                                    <Tooltip title="Change color of selected points">
                                        <IconButton
                                            size="small"
                                            onClick={handleOpenColorPicker}
                                            color="primary"
                                            sx={{
                                                backgroundColor: theme.palette.primary.main + '15',
                                                '&:hover': {
                                                    backgroundColor: theme.palette.primary.main + '25',
                                                },
                                            }}
                                        >
                                            <ColorLensIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Popover
                                        open={Boolean(colorPickerAnchor)}
                                        anchorEl={colorPickerAnchor}
                                        onClose={handleCloseColorPicker}
                                        anchorOrigin={{
                                            vertical: 'bottom',
                                            horizontal: 'left',
                                        }}
                                        transformOrigin={{
                                            vertical: 'top',
                                            horizontal: 'left',
                                        }}
                                    >
                                        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 300 }}>
                                            <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 600 }}>
                                                Change Point Color
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {selectionState.selectedIds.size} point{selectionState.selectedIds.size !== 1 ? 's' : ''} selected
                                            </Typography>
                                            <TextField
                                                type="color"
                                                label="Color Picker"
                                                value={selectedColor}
                                                onChange={(e) => handleColorChange(e.target.value)}
                                                fullWidth
                                                InputLabelProps={{
                                                    shrink: true,
                                                }}
                                                sx={{
                                                    '& input[type="color"]': {
                                                        height: 60,
                                                        cursor: 'pointer',
                                                        borderRadius: 1,
                                                    },
                                                }}
                                            />
                                            <TextField
                                                label="Hex Color Code"
                                                value={selectedColor}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
                                                        handleColorChange(value);
                                                    } else {
                                                        setSelectedColor(value);
                                                    }
                                                }}
                                                fullWidth
                                                size="small"
                                                placeholder="#ffffff"
                                                helperText="Enter hex color code (e.g., #ff0000 for red)"
                                            />
                                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                <Button variant="outlined" onClick={handleCloseColorPicker} sx={{ flex: 1 }}>
                                                    Cancel
                                                </Button>
                                                <Button
                                                    variant="contained"
                                                    onClick={() => {
                                                        handleColorChange(selectedColor);
                                                        handleCloseColorPicker();
                                                    }}
                                                    sx={{ flex: 1 }}
                                                >
                                                    Apply
                                                </Button>
                                            </Box>
                                        </Box>
                                    </Popover>
                                </>
                            )}
                        </Box>
                    )}

                    <Box sx={{ flex: 1 }} />

                    {/* Right Side Controls */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {modelData.name && (
                            <Typography variant="body2" color="text.secondary" sx={{ mr: 1, fontStyle: 'italic' }}>
                                {modelData.name}
                            </Typography>
                        )}
                        {showList && (
                            <Tooltip title={showItemList ? 'Hide item list' : 'Show item list'}>
                                <IconButton
                                    size="small"
                                    onClick={() => setShowItemList(!showItemList)}
                                    color={showItemList ? 'primary' : 'default'}
                                >
                                    <ListIcon />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
                </Paper>
            )}

            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 600 }}>
                <Box sx={{ flex: 1, position: 'relative', minWidth: 0, minHeight: 600 }}>
                    {viewMode === '3d' ? (
                        <Viewer3D
                            points={modelData.points}
                            shapes={modelData.shapes}
                            selectedIds={selectionState.selectedIds}
                            hoveredId={selectionState.hoveredId}
                            colorData={colorData}
                            onPointClick={handleItemClick}
                            onPointHover={handleItemHover}
                            pointSize={pointSize}
                        />
                    ) : (
                        <Viewer2D
                            points={modelData.points}
                            shapes={modelData.shapes}
                            selectedIds={selectionState.selectedIds}
                            hoveredId={selectionState.hoveredId}
                            colorData={colorData}
                            onPointClick={handleItemClick}
                            onPointHover={handleItemHover}
                            viewPlane={viewPlane}
                            pointSize={pointSize}
                        />
                    )}
                </Box>

                {showItemList && (
                    <Paper
                        elevation={3}
                        sx={{
                            width: 320,
                            minWidth: 280,
                            maxWidth: '35%',
                            display: 'flex',
                            flexDirection: 'column',
                            borderLeft: `1px solid ${theme.palette.divider}`,
                            backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.background.paper,
                        }}
                    >
                        <Box
                            sx={{
                                p: 1.5,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                borderBottom: `1px solid ${theme.palette.divider}`,
                                backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[50],
                            }}
                        >
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                Items ({modelData.points.length + (modelData.shapes?.length || 0)})
                            </Typography>
                            <IconButton size="small" onClick={() => setShowItemList(false)}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Box>
                        <ItemList
                            points={modelData.points}
                            shapes={modelData.shapes}
                            selectedIds={selectionState.selectedIds}
                            hoveredId={selectionState.hoveredId}
                            onItemClick={handleItemClick}
                            onItemHover={handleItemHover}
                            showShapes={!!modelData.shapes}
                        />
                    </Paper>
                )}
            </Box>
        </Box>
    );
};

