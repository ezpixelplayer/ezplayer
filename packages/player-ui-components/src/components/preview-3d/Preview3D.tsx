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
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { Viewer3D, type CameraState3D } from './Viewer3D';
import { Viewer2D, type CameraState2D } from './Viewer2D';
import { ModelList } from './ModelList';
import { PreviewSettings, SettingsButton, type PreviewSettingsData } from './PreviewSettings';
import { convertXmlCoordinatesToModel3D } from '../../services/model3dLoader';
import type { Model3DData, ModelMetadata, SelectionState, ViewObject, LayoutSettings } from '../../types/model3d';
import type { MhFixtureInfo } from 'xllayoutcalcs';
import { EZPElectronAPI, GetNodeResult, LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { useFrameBuffer } from '../../hooks/useFrameBuffer';
import { useAudioStream } from '../../hooks/useAudioStream';
import { isElectron } from '@ezplayer/shared-ui-components';
import type { RootState } from '../../store/Store';

export type ViewMode = '3d' | '2d';
export type ViewPlane = 'xy' | 'xz' | 'yz';

export interface Preview3DProps {
    modelData?: Model3DData;
    showList?: boolean;
    initialShowList?: boolean;
    showControls?: boolean;
    defaultViewMode?: ViewMode;
    pointSize?: number; // TODO This will come from models individually
    frameServerUrl?: string; // URL for frame data server, e.g., "http://localhost:3000"
    compressed?: boolean; // Use ZSTD-compressed frame endpoint for lower bandwidth
}

export const Preview3D: React.FC<Preview3DProps> = ({
    modelData: initialModelData,
    showList = false,
    initialShowList = false,
    showControls = true,
    defaultViewMode = '3d',
    pointSize = 3.0,
    frameServerUrl,
    compressed = false,
}) => {
    const theme = useTheme();
    const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
    const [showItemList, setShowItemList] = useState(showList && initialShowList);
    const [modelData, setModelData] = useState<Model3DData | null>(initialModelData || null);
    const [modelData2D, setModelData2D] = useState<Model3DData | null>(null);
    const [livePixels, setLivePixels] = useState<LatestFrameRingBuffer | undefined>(undefined);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [viewObjects, setViewObjects] = useState<ViewObject[]>([]);
    const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>({});
    const [movingHeadFixtures, setMovingHeadFixtures] = useState<MhFixtureInfo[]>([]);
    // This is the selection state of the 2D/3D view
    const [selectionState, setSelectionState] = useState<SelectionState>({
        selectedIds: new Set<string>(),
        hoveredId: null,
    });
    // This is the selection state of the model list
    const [selectedModelNames, setSelectedModelNames] = useState<Set<string>>(new Set<string>());

    // Settings state
    const [settingsAnchorPosition, setSettingsAnchorPosition] = useState<{ top: number; left: number } | null>(null);
    const [previewSettings, setPreviewSettings] = useState<PreviewSettingsData>({
        pixelSize: 1.0,
        brightnessMultiplier: 100, // Percentage multiplier applied to XML brightness (0–100)
    });

    // Camera state for 2D and 3D views
    const [cameraState2D, setCameraState2D] = useState<CameraState2D | null>(null);
    const [cameraState3D, setCameraState3D] = useState<CameraState3D | null>(null);
    const [shouldAutoFit, setShouldAutoFit] = useState(false);
    const [cameraStateLoaded, setCameraStateLoaded] = useState(false);

    // Refs to track latest camera state (always current, even if state hasn't updated yet)
    const cameraState2DRef = React.useRef<CameraState2D | null>(null);
    const cameraState3DRef = React.useRef<CameraState3D | null>(null);

    // Refs to store callbacks to get current camera state immediately
    const getCurrentCameraState2DRef = React.useRef<(() => CameraState2D | null) | null>(null);
    const getCurrentCameraState3DRef = React.useRef<(() => CameraState3D | null) | null>(null);

    // Get show directory from Redux store to detect changes
    const showDirectory = useSelector((state: RootState) => state.auth.showDirectory);

    // Load preview settings and camera state from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem('previewSettings');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.pixelSize !== undefined) {
                    setPreviewSettings({
                        pixelSize: parsed.pixelSize ?? 1.0,
                        brightnessMultiplier: parsed.brightnessMultiplier ?? 100,
                    });
                }
                // Restore view mode if saved
                if (parsed.mode === '2d' || parsed.mode === '3d') {
                    setViewMode(parsed.mode);
                }
                // Restore camera states if saved
                if (parsed.cameraState2D) {
                    console.log('[Preview3D] Loading saved cameraState2D:', parsed.cameraState2D);
                    setCameraState2D(parsed.cameraState2D);
                    cameraState2DRef.current = parsed.cameraState2D;
                }
                if (parsed.cameraState3D) {
                    console.log('[Preview3D] Loading saved cameraState3D:', parsed.cameraState3D);
                    setCameraState3D(parsed.cameraState3D);
                    cameraState3DRef.current = parsed.cameraState3D;
                }
            }
            // Mark camera state as loaded (even if null, we've checked localStorage)
            setCameraStateLoaded(true);
            console.log('[Preview3D] Camera state loaded from localStorage');
        } catch (err) {
            console.error('[Preview3D] Failed to load preview settings:', err);
            setCameraStateLoaded(true);
        }
    }, []);

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

    // Frame buffer for live pixel data from server.
    // resetKey forces the poll loop to restart when the show folder changes
    // (clearing stale buffers and resetting error counters).
    const { buffer: livePixelBuffer } = useFrameBuffer({
        baseUrl: effectiveFrameServerUrl,
        enabled: !!effectiveFrameServerUrl,
        compressed,
        resetKey: showDirectory,
    });

    // Audio stream for web client (not used in Electron — it has its own audio window)
    const { audioEnabled, toggleAudio } = useAudioStream({
        baseUrl: effectiveFrameServerUrl,
    });

    // Update livePixels when the frame buffer changes
    useEffect(() => {
        setLivePixels(livePixelBuffer);
    }, [livePixelBuffer]);

    // Clear stale state immediately when show folder changes so old data
    // is never rendered with new frame buffers (or vice versa).
    const prevShowDirRef = React.useRef(showDirectory);
    useEffect(() => {
        if (prevShowDirRef.current !== showDirectory) {
            prevShowDirRef.current = showDirectory;
            setModelData(null);
            setModelData2D(null);
            setViewObjects([]);
            setLayoutSettings({});
            setMovingHeadFixtures([]);
            setLivePixels(undefined);
            setSelectionState({ selectedIds: new Set<string>(), hoveredId: null });
            setSelectedModelNames(new Set<string>());
        }
    }, [showDirectory]);

    // Load model from XML coordinates if available (Electron environment or HTTP API)
    useEffect(() => {
        // If initialModelData is provided, use it
        if (initialModelData) {
            setModelData(initialModelData);
            setLoading(false);
            return;
        }

        let cancelled = false;

        // Try to load from API, with retry when server returns empty data
        // (the playback worker may still be parsing the new show's XML)
        const fetchShowData = async (attempt: number): Promise<boolean> => {
            if (cancelled) return false;

            try {
                let xmlCoords: Record<string, GetNodeResult> | null = null;

                if (effectiveFrameServerUrl) {
                    // Use HTTP API (works in both Electron and browser — avoids IPC/RPC round-trip to playback worker)
                    try {
                        const response = await fetch(`${effectiveFrameServerUrl}/api/model-coordinates`);
                        if (response.ok) {
                            xmlCoords = await response.json();
                        }
                    } catch (fetchErr) {
                        console.error('[Preview3D] Failed to fetch model coordinates via HTTP:', fetchErr);
                    }

                    if (cancelled) return false;

                    // Also fetch view objects (meshes like house models)
                    try {
                        const viewObjectsResponse = await fetch(`${effectiveFrameServerUrl}/api/view-objects`);
                        if (viewObjectsResponse.ok) {
                            const viewObjs = await viewObjectsResponse.json();
                            if (Array.isArray(viewObjs)) {
                                setViewObjects(viewObjs);
                            }
                        }
                    } catch (fetchErr) {
                        console.error('[Preview3D] Failed to fetch view objects via HTTP:', fetchErr);
                    }

                    // Fetch layout settings (background image, preview dimensions)
                    try {
                        const settingsResponse = await fetch(`${effectiveFrameServerUrl}/api/layout-settings`);
                        if (settingsResponse.ok) {
                            const settings = await settingsResponse.json();
                            if (settings && typeof settings === 'object') {
                                setLayoutSettings(settings);
                            }
                        }
                    } catch (fetchErr) {
                        console.error('[Preview3D] Failed to fetch layout settings via HTTP:', fetchErr);
                    }

                    // Fetch moving head fixture definitions
                    try {
                        const mhResponse = await fetch(`${effectiveFrameServerUrl}/api/moving-heads`);
                        if (mhResponse.ok) {
                            const mhFixtures = await mhResponse.json();
                            if (Array.isArray(mhFixtures)) {
                                setMovingHeadFixtures(mhFixtures as MhFixtureInfo[]);
                            }
                        }
                    } catch (fetchErr) {
                        console.error('[Preview3D] Failed to fetch moving heads via HTTP:', fetchErr);
                    }

                    // Also fetch 2D-projected coordinates for the 2D viewer
                    try {
                        const response2D = await fetch(`${effectiveFrameServerUrl}/api/model-coordinates-2d`);
                        if (response2D.ok) {
                            const xmlCoords2D = await response2D.json();
                            if (xmlCoords2D && Object.keys(xmlCoords2D).length > 0) {
                                setModelData2D(convertXmlCoordinatesToModel3D(xmlCoords2D));
                            }
                        }
                    } catch (fetchErr) {
                        console.error('[Preview3D] Failed to fetch 2D model coordinates via HTTP:', fetchErr);
                    }
                }

                if (xmlCoords && Object.keys(xmlCoords).length > 0) {
                    const convertedData = convertXmlCoordinatesToModel3D(xmlCoords);

                    if (convertedData.points.length > 0) {
                        setModelData(convertedData);
                        setLoading(false);
                        return true; // success
                    }
                }
            } catch (err) {
                console.error('[Preview3D] Error loading model coordinates:', err);
            }

            return false; // no data yet
        };

        const loadFromXml = async () => {
            setLoading(true);
            setError(null);

            // Poll until data arrives.  On a show folder change the server
            // worker cache is cleared immediately while the playback worker
            // re-parses the new layout XML, so the first fetches return
            // empty data.  We keep polling with exponential back-off
            // (500ms → 1s → 2s → 4s, capped at 4s) until the server has
            // the new data ready.
            let delay = 0;
            for (; ;) {
                if (cancelled) return;
                if (delay > 0) {
                    await new Promise((r) => setTimeout(r, delay));
                    if (cancelled) return;
                }
                const success = await fetchShowData(0);
                if (success || cancelled) return;
                // Exponential back-off: 500, 1000, 2000, 4000, 4000, …
                delay = delay === 0 ? 500 : Math.min(delay * 2, 4000);
            }
        };

        loadFromXml();
        return () => { cancelled = true; };
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

    // Handle settings button click
    const handleSettingsClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setSettingsAnchorPosition({
            top: Math.round(rect.bottom),
            left: Math.round(rect.left),
        });
    }, []);

    // Handle settings close
    const handleSettingsClose = useCallback(() => {
        setSettingsAnchorPosition(null);
    }, []);

    // Handle settings change
    const handleSettingsChange = useCallback((newSettings: PreviewSettingsData) => {
        // Validate and clamp values
        const clampedPixelSize = Math.max(0.5, Math.min(3.0, Number(newSettings.pixelSize) || 1.0));
        const clampedMultiplier = Math.max(0, Math.min(100, Number(newSettings.brightnessMultiplier) || 100));

        setPreviewSettings({
            pixelSize: clampedPixelSize,
            brightnessMultiplier: clampedMultiplier,
        });
    }, []);

    // Handle camera state changes
    const handleCameraStateChange2D = useCallback((state: CameraState2D) => {
        setCameraState2D(state);
        cameraState2DRef.current = state; // Keep ref updated with latest value
        // Auto-save to localStorage for persistence when switching screens
        try {
            const saved = localStorage.getItem('previewSettings');
            const parsed = saved ? JSON.parse(saved) : {};
            parsed.cameraState2D = state;
            localStorage.setItem('previewSettings', JSON.stringify(parsed));
        } catch (err) {
            console.error('[Preview3D] Failed to save camera state:', err);
        }
    }, []);

    const handleCameraStateChange3D = useCallback((state: CameraState3D) => {
        setCameraState3D(state);
        cameraState3DRef.current = state; // Keep ref updated with latest value
        // Auto-save to localStorage for persistence when switching screens
        try {
            const saved = localStorage.getItem('previewSettings');
            const parsed = saved ? JSON.parse(saved) : {};
            parsed.cameraState3D = state;
            localStorage.setItem('previewSettings', JSON.stringify(parsed));
        } catch (err) {
            console.error('[Preview3D] Failed to save camera state:', err);
        }
    }, []);

    // Handle reset view
    const handleResetView = useCallback(() => {
        setShouldAutoFit(true);
        // Clear saved camera states
        setCameraState2D(null);
        setCameraState3D(null);
        cameraState2DRef.current = null;
        cameraState3DRef.current = null;
        // Clear from localStorage
        try {
            const saved = localStorage.getItem('previewSettings');
            if (saved) {
                const parsed = JSON.parse(saved);
                delete parsed.cameraState2D;
                delete parsed.cameraState3D;
                localStorage.setItem('previewSettings', JSON.stringify(parsed));
            }
        } catch (err) {
            console.error('[Preview3D] Failed to clear camera state:', err);
        }
    }, []);

    // Handle auto-fit complete
    const handleAutoFitComplete = useCallback(() => {
        setShouldAutoFit(false);
    }, []);

    // Handle save as default - saves current camera state at the moment of clicking "Ok"
    const handleSaveAsDefault = useCallback(() => {
        try {
            // First try to get current camera state directly from viewers (bypasses throttling)
            let currentCameraState2D = cameraState2DRef.current;
            let currentCameraState3D = cameraState3DRef.current;

            // If refs are null, try to get current state directly from viewers
            if (viewMode === '2d' && getCurrentCameraState2DRef.current) {
                const directState = getCurrentCameraState2DRef.current();
                if (directState) {
                    currentCameraState2D = directState;
                    cameraState2DRef.current = directState;
                }
            } else if (viewMode === '3d' && getCurrentCameraState3DRef.current) {
                const directState = getCurrentCameraState3DRef.current();
                if (directState) {
                    currentCameraState3D = directState;
                    cameraState3DRef.current = directState;
                }
            }

            console.log('[Preview3D] Saving camera state:', {
                mode: viewMode,
                cameraState2D: currentCameraState2D,
                cameraState3D: currentCameraState3D
            });

            const settingsToSave = {
                mode: viewMode,
                pixelSize: previewSettings.pixelSize,
                brightnessMultiplier: previewSettings.brightnessMultiplier,
                cameraState2D: currentCameraState2D,
                cameraState3D: currentCameraState3D,
            };
            localStorage.setItem('previewSettings', JSON.stringify(settingsToSave));

            // Also update state to ensure consistency
            if (currentCameraState2D) {
                setCameraState2D(currentCameraState2D);
            }
            if (currentCameraState3D) {
                setCameraState3D(currentCameraState3D);
            }

            console.log('[Preview3D] Camera state saved successfully');
        } catch (err) {
            console.error('[Preview3D] Failed to save preview settings:', err);
        }
    }, [viewMode, previewSettings]);

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

                    {/* Settings Button */}
                    <SettingsButton onClick={handleSettingsClick} />

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
                        {!isElectron() && (
                            <Tooltip title={audioEnabled ? 'Mute audio' : 'Play audio'}>
                                <IconButton
                                    size="small"
                                    onClick={toggleAudio}
                                    color={audioEnabled ? 'primary' : 'default'}
                                >
                                    {audioEnabled ? <VolumeUpIcon /> : <VolumeOffIcon />}
                                </IconButton>
                            </Tooltip>
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
                    {(() => {
                        // Compute final brightness: xmlBrightness * (sliderPercent / 100)
                        const baseBrightness = layoutSettings.backgroundBrightness ?? 100;
                        const finalBrightness = baseBrightness * (previewSettings.brightnessMultiplier / 100);

                        return viewMode === '3d' ? (
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
                                modelMetadata={modelData.metadata?.models}
                                viewObjects={viewObjects}
                                frameServerUrl={effectiveFrameServerUrl}
                                movingHeadFixtures={movingHeadFixtures}
                                backgroundBrightness={finalBrightness}
                                pixelSizeMultiplier={previewSettings.pixelSize}
                                cameraState={cameraState3D}
                                onCameraStateChange={handleCameraStateChange3D}
                                shouldAutoFit={shouldAutoFit}
                                onAutoFitComplete={handleAutoFitComplete}
                                cameraStateLoaded={cameraStateLoaded}
                                onGetCurrentCameraState={(setFn) => {
                                    setFn((fn) => {
                                        getCurrentCameraState3DRef.current = fn;
                                    });
                                }}
                            />
                        ) : (
                            <Viewer2D
                                points={(modelData2D ?? modelData).points}
                                shapes={(modelData2D ?? modelData).shapes}
                                liveData={livePixels}
                                selectedIds={selectionState.selectedIds}
                                hoveredId={selectionState.hoveredId}
                                onPointClick={handleItemClick}
                                onPointHover={handleItemHover}
                                viewPlane={'xy'}
                                pointSize={pointSize}
                                selectedModelNames={selectedModelNames}
                                modelMetadata={(modelData2D ?? modelData).metadata?.models}
                                layoutSettings={layoutSettings}
                                frameServerUrl={effectiveFrameServerUrl}
                                movingHeadFixtures={movingHeadFixtures}
                                backgroundBrightness={finalBrightness}
                                pixelSizeMultiplier={previewSettings.pixelSize}
                                cameraState={cameraState2D}
                                onCameraStateChange={handleCameraStateChange2D}
                                shouldAutoFit={shouldAutoFit}
                                onAutoFitComplete={handleAutoFitComplete}
                                cameraStateLoaded={cameraStateLoaded}
                                onGetCurrentCameraState={(setFn) => {
                                    setFn((fn) => {
                                        getCurrentCameraState2DRef.current = fn;
                                    });
                                }}
                            />
                        );
                    })()}
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

            {/* Settings Popover */}
            <PreviewSettings
                anchorPosition={settingsAnchorPosition}
                open={Boolean(settingsAnchorPosition)}
                onClose={handleSettingsClose}
                settings={previewSettings}
                onSettingsChange={handleSettingsChange}
                onSaveAsDefault={handleSaveAsDefault}
                onResetView={handleResetView}
            />
        </Box>
    );
};
