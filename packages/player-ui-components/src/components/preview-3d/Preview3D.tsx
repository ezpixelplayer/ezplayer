import React, { useState, useCallback, useEffect } from 'react';
import {
    ToggleButton,
    ToggleButtonGroup,
    Button,
    IconButton,
    Tooltip,
    useTheme,
    Paper,
    Divider,
    Typography,
} from '@mui/material';
import { useSelector } from 'react-redux';
import { Box } from '../box/Box';
import View3DIcon from '@mui/icons-material/ViewInAr';
import View2DIcon from '@mui/icons-material/ViewQuilt';
import ListIcon from '@mui/icons-material/List';
import CloseIcon from '@mui/icons-material/Close';
import { Viewer3D } from './Viewer3D';
import { Viewer2D } from './Viewer2D';
import { ModelList } from './ModelList';
import { convertXmlCoordinatesToModel3D } from '../../services/model3dLoader';
import type { Model3DData, ModelMetadata, SelectionState } from '../../types/model3d';
import { EZPElectronAPI, GetNodeResult, LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { useFrameBuffer } from '../../hooks/useFrameBuffer';
import type { RootState } from '../../store/Store';

export type ViewMode = '3d' | '2d';
export type ViewPlane = 'xy' | 'xz' | 'yz';

export interface Preview3DProps {
    modelData?: Model3DData;
    showList?: boolean;
    showControls?: boolean;
    defaultViewMode?: ViewMode;
    pointSize?: number; // TODO This will come from models individually
    frameServerUrl?: string; // URL for frame data server, e.g., "http://localhost:3000"
}

export const Preview3D: React.FC<Preview3DProps> = ({
    modelData: initialModelData,
    showList = true,
    showControls = true,
    defaultViewMode = '3d',
    pointSize = 3.0,
    frameServerUrl,
}) => {
    const theme = useTheme();
    const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
    const [showItemList, setShowItemList] = useState(showList);
    const [modelData, setModelData] = useState<Model3DData | null>(initialModelData || null);
    const [livePixels, setLivePixels] = useState<LatestFrameRingBuffer | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // This is the selection state of the 2D/3D view
    const [selectionState, setSelectionState] = useState<SelectionState>({
        selectedIds: new Set<string>(),
        hoveredId: null,
    });
    // This is the selection state of the model list
    const [selectedModelNames, setSelectedModelNames] = useState<Set<string>>(new Set<string>());

    // Get show directory from Redux store to detect changes
    const showDirectory = useSelector((state: RootState) => state.auth.showDirectory);

    // Auto-detect frame server URL if not provided
    const [effectiveFrameServerUrl, setEffectiveFrameServerUrl] = useState<string | undefined>(frameServerUrl);

    useEffect(() => {
        // If prop is provided, use it
        if (frameServerUrl) {
            setEffectiveFrameServerUrl(frameServerUrl);
            return;
        }

        // Auto-detect based on environment
        const detectUrl = async () => {
            const electronAPI = (window as any).electronAPI as EZPElectronAPI;

            // In Electron, query the server status for the port
            if (electronAPI?.getServerStatus) {
                try {
                    const status = await electronAPI.getServerStatus();
                    if (status?.port && status.status === 'listening') {
                        setEffectiveFrameServerUrl(`http://localhost:${status.port}`);
                        return;
                    }
                } catch (err) {
                    console.error('[Preview3D] Failed to get server status:', err);
                }
            }

            // In web app, use current origin (we're served from the same server)
            if (typeof window !== 'undefined' && window.location?.origin) {
                // Only use if it looks like a valid HTTP origin (not file://)
                if (window.location.origin.startsWith('http')) {
                    setEffectiveFrameServerUrl(window.location.origin);
                }
            }
        };

        detectUrl();
    }, [frameServerUrl]);

    // Frame buffer for live pixel data from server
    const { buffer: livePixelBuffer } = useFrameBuffer({
        baseUrl: effectiveFrameServerUrl,
        enabled: !!effectiveFrameServerUrl,
    });

    // Update livePixels when the frame buffer changes
    useEffect(() => {
        setLivePixels(livePixelBuffer);
    }, [livePixelBuffer]);

    // Load model from XML coordinates if available (Electron environment or HTTP API)
    useEffect(() => {
        // If initialModelData is provided, use it
        if (initialModelData) {
            setModelData(initialModelData);
            setLoading(false);
            return;
        }

        // Try to load from API
        const loadFromXml = async () => {
            setLoading(true);
            setError(null);

            try {
                // Check if we're in Electron environment and API is available
                const electronAPI = (window as any).electronAPI as EZPElectronAPI;

                let xmlCoords: Record<string, GetNodeResult> | null = null;

                if (electronAPI && electronAPI.getModelCoordinates) {
                    // Use Electron IPC API
                    xmlCoords = await electronAPI.getModelCoordinates();
                } else if (effectiveFrameServerUrl) {
                    // Use HTTP API for browser UI
                    try {
                        const response = await fetch(`${effectiveFrameServerUrl}/api/model-coordinates`);
                        if (response.ok) {
                            xmlCoords = await response.json();
                        }
                    } catch (fetchErr) {
                        console.error('[Preview3D] Failed to fetch model coordinates via HTTP:', fetchErr);
                    }
                }

                if (xmlCoords && Object.keys(xmlCoords).length > 0) {
                    const convertedData = convertXmlCoordinatesToModel3D(xmlCoords);

                    if (convertedData.points.length > 0) {
                        setModelData(convertedData);
                        setLoading(false);
                        return;
                    }
                }
            } catch (err) {
                console.error('[Preview3D] Error loading model coordinates:', err);
                // Silently handle errors - empty state will be shown
            }

            // No XML data available
            setModelData(null);
            setLoading(false);
        };

        loadFromXml();
    }, [initialModelData, showDirectory, effectiveFrameServerUrl]);

    // Handle item selection - detect model from point metadata and select entire model
    const handleItemClick = useCallback(
        (itemId: string) => {
            if (!modelData) return;

            // Find the clicked point to get its model name
            const clickedPoint = modelData.points.find((p) => p.id === itemId);
            const modelName = clickedPoint?.metadata?.modelName as string | undefined;

            if (!modelName) return;

            // Get all points belonging to this model
            const modelPoints = modelData.points.filter((p) => p.metadata?.modelName === modelName);
            const modelPointIds = new Set(modelPoints.map((p) => p.id));

            // Check if this model is currently selected
            const isModelSelected = selectedModelNames.has(modelName);

            if (isModelSelected) {
                // Deselect the entire model
                setSelectedModelNames((prev) => {
                    const newSelected = new Set(prev);
                    newSelected.delete(modelName);
                    return newSelected;
                });
                setSelectionState((prev) => {
                    const newSelectedIds = new Set(prev.selectedIds);
                    modelPointIds.forEach((id) => newSelectedIds.delete(id));
                    return { ...prev, selectedIds: newSelectedIds };
                });
            } else {
                // Select the entire model (clear other selections first)
                setSelectedModelNames(new Set([modelName]));
                setSelectionState((prev) => {
                    return {
                        selectedIds: new Set([...Array.from(modelPointIds)]),
                        hoveredId: prev.hoveredId,
                    };
                });
            }
        },
        [modelData, selectedModelNames],
    );

    // Handle item hover
    const handleItemHover = useCallback((itemId: string | null) => {
        setSelectionState((prev) => ({ ...prev, hoveredId: itemId }));
    }, []);

    // Handle view mode change
    const handleViewModeChange = useCallback((_event: React.MouseEvent<HTMLElement>, newMode: ViewMode | null) => {
        if (newMode !== null) {
            setViewMode(newMode);
        }
    }, []);

    // Handle model selection from model list
    const handleModelSelect = useCallback(
        (model: ModelMetadata | null) => {
            if (!model) {
                // Clear selection
                setSelectedModelNames(new Set<string>());
                setSelectionState({
                    selectedIds: new Set<string>(),
                    hoveredId: null,
                });
                return;
            }

            // Check if this model is currently selected
            const isCurrentlySelected = selectedModelNames.has(model.name);

            if (isCurrentlySelected) {
                // Deselect model
                setSelectedModelNames((prev) => {
                    const newSelected = new Set(prev);
                    newSelected.delete(model.name);
                    return newSelected;
                });

                // Deselect all points of this model
                if (modelData) {
                    const modelPoints = modelData.points.filter((p) => p.metadata?.modelName === model.name);
                    const pointIds = new Set(modelPoints.map((p) => p.id));

                    setSelectionState((prev) => {
                        const newSelectedIds = new Set(prev.selectedIds);
                        pointIds.forEach((id) => newSelectedIds.delete(id));
                        return {
                            selectedIds: newSelectedIds,
                            hoveredId: prev.hoveredId,
                        };
                    });
                }
            } else {
                // Select model (clear other selections first)
                setSelectedModelNames(new Set([model.name]));

                // Select all points of this model
                if (modelData) {
                    const modelPoints = modelData.points.filter((p) => p.metadata?.modelName === model.name);
                    const pointIds = new Set(modelPoints.map((p) => p.id));

                    setSelectionState((prev) => {
                        return {
                            selectedIds: new Set([...Array.from(pointIds)]),
                            hoveredId: prev.hoveredId,
                        };
                    });
                }
            }
        },
        [modelData, selectedModelNames],
    );

    // Check WebGL support
    const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
    const [webglError, setWebglError] = useState<string | null>(null);

    useEffect(() => {
        try {
            const canvas = document.createElement('canvas');
            const gl =
                canvas.getContext('webgl') || canvas.getContext('webgl2') || canvas.getContext('experimental-webgl');
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
                        {webglError ||
                            'WebGL is required to display 3D content but is not available in this environment.'}
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

    if (!modelData || !modelData.points || modelData.points.length === 0) {
        return (
            <Box
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
                <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center' }}>
                    No layout in the selected show folder.
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                overflow: 'hidden',
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
                        backgroundColor:
                            theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.background.paper,
                        zIndex: 100,
                        flexShrink: 0,
                        position: 'relative',
                    }}
                >
                    {/* View Mode Controls */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                            View:
                        </Typography>
                        <ToggleButtonGroup
                            value={viewMode}
                            exclusive
                            onChange={handleViewModeChange}
                            size="small"
                            sx={{
                                '& .MuiToggleButton-root': {
                                    color: theme.palette.text.primary,
                                    '&.Mui-selected': {
                                        color: theme.palette.primary.contrastText || '#ffffff',
                                        backgroundColor: theme.palette.primary.main,
                                        '& .MuiTypography-root': {
                                            color: theme.palette.primary.contrastText || '#ffffff',
                                        },
                                        '& .MuiSvgIcon-root': {
                                            color: theme.palette.primary.contrastText || '#ffffff',
                                        },
                                        '&:hover': {
                                            backgroundColor: theme.palette.primary.dark,
                                        },
                                    },
                                    '&:not(.Mui-selected)': {
                                        color: theme.palette.text.primary,
                                        backgroundColor: 'transparent',
                                        '& .MuiTypography-root': {
                                            color: theme.palette.text.primary,
                                        },
                                        '& .MuiSvgIcon-root': {
                                            color: theme.palette.text.primary,
                                        },
                                        '&:hover': {
                                            backgroundColor: theme.palette.action.hover,
                                        },
                                    },
                                },
                            }}
                        >
                            <ToggleButton
                                value="3d"
                                aria-label="3D view"
                                sx={{
                                    '&.Mui-selected': {
                                        '& .MuiTypography-root': {
                                            color: '#ffffff !important',
                                        },
                                        '& .MuiSvgIcon-root': {
                                            color: '#ffffff !important',
                                        },
                                    },
                                    '&:not(.Mui-selected)': {
                                        '& .MuiTypography-root': {
                                            color: `${theme.palette.text.primary} !important`,
                                        },
                                        '& .MuiSvgIcon-root': {
                                            color: `${theme.palette.text.primary} !important`,
                                        },
                                    },
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <View3DIcon fontSize="small" />
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            ml: 0.5,
                                            fontWeight: 600,
                                        }}
                                    >
                                        3D
                                    </Typography>
                                </Box>
                            </ToggleButton>
                            <ToggleButton
                                value="2d"
                                aria-label="2D view"
                                sx={{
                                    '&.Mui-selected': {
                                        '& .MuiTypography-root': {
                                            color: '#ffffff !important',
                                        },
                                        '& .MuiSvgIcon-root': {
                                            color: '#ffffff !important',
                                        },
                                    },
                                    '&:not(.Mui-selected)': {
                                        '& .MuiTypography-root': {
                                            color: `${theme.palette.text.primary} !important`,
                                        },
                                        '& .MuiSvgIcon-root': {
                                            color: `${theme.palette.text.primary} !important`,
                                        },
                                    },
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <View2DIcon fontSize="small" />
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            ml: 0.5,
                                            fontWeight: 600,
                                        }}
                                    >
                                        2D
                                    </Typography>
                                </Box>
                            </ToggleButton>
                        </ToggleButtonGroup>
                    </Box>

                    <Divider orientation="vertical" flexItem sx={{ height: 24 }} />

                    {/* Selection Info & Color Picker */}
                    {selectionState.selectedIds.size > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" color="primary" sx={{ fontWeight: 500 }}>
                                {selectionState.selectedIds.size} selected
                            </Typography>
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
                            <Tooltip title={showItemList ? 'Hide model library' : 'Show model library'}>
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

            <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <Box sx={{ flex: 1, position: 'relative', minWidth: 0, minHeight: 0 }}>
                    {viewMode === '3d' ? (
                        <Viewer3D
                            points={modelData.points}
                            shapes={modelData.shapes}
                            liveData={livePixels}
                            selectedIds={selectionState.selectedIds}
                            hoveredId={selectionState.hoveredId}
                            onPointClick={handleItemClick}
                            onPointHover={handleItemHover}
                            pointSize={pointSize}
                            selectedModelNames={selectedModelNames}
                        />
                    ) : (
                        <Viewer2D
                            points={modelData.points}
                            shapes={modelData.shapes}
                            selectedIds={selectionState.selectedIds}
                            hoveredId={selectionState.hoveredId}
                            onPointClick={handleItemClick}
                            onPointHover={handleItemHover}
                            viewPlane={'xy'}
                            pointSize={pointSize}
                            selectedModelNames={selectedModelNames}
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
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            borderLeft: `1px solid ${theme.palette.divider}`,
                            backgroundColor:
                                theme.palette.mode === 'dark'
                                    ? theme.palette.grey[900]
                                    : theme.palette.background.paper,
                            overflow: 'hidden',
                        }}
                    >
                        <Box
                            sx={{
                                p: 1.5,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                borderBottom: `1px solid ${theme.palette.divider}`,
                                backgroundColor:
                                    theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[50],
                                flexShrink: 0,
                            }}
                        >
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                Model Library
                            </Typography>
                            <IconButton size="small" onClick={() => setShowItemList(false)}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Box>
                        <ModelList
                            selectedModelNames={selectedModelNames}
                            onModelSelect={handleModelSelect}
                            searchable={true}
                            modelData={modelData}
                        />
                    </Paper>
                )}
            </Box>
        </Box>
    );
};
