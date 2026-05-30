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
    FormControl,
    Select,
    MenuItem,
    InputLabel,
    Menu,
    ListSubheader,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import { useSelector } from 'react-redux';
import { Box } from '../box/Box';
import View3DIcon from '@mui/icons-material/ViewInAr';
import VideocamIcon from '@mui/icons-material/Videocam';
import View2DIcon from '@mui/icons-material/ViewQuilt';
import ListIcon from '@mui/icons-material/List';
import CloseIcon from '@mui/icons-material/Close';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { Viewer3D, type CameraState3D } from './Viewer3D';
import { Viewer2D, type CameraState2D } from './Viewer2D';
import { useOrbitPreference } from '../../util/orbitPreference';
import { ModelList } from './ModelList';
import { PreviewSettings, SettingsButton, type PreviewSettingsData } from './PreviewSettings';
import { convertXmlCoordinatesToModel3D } from '../../services/model3dLoader';
import type {
    Model3DData,
    ModelMetadata,
    SelectionState,
    ViewObject,
    LayoutSettings,
} from '../../types/model3d';
import type { LayoutGroupInfo, MhFixtureInfo, ViewpointInfo } from 'xllayoutcalcs';
import { viewpointToCameraState } from './viewpointCamera';
import { GetNodeResult, LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import { useAudioStream } from '../../hooks/useAudioStream';
import { isElectron } from '@ezplayer/shared-ui-components';
import type { RootState } from '../../store/Store';
import {
    type AssetResolver,
    combineResolvers,
    createShowFileResolver,
    createZipAssetResolver,
} from '../../services/assetResolver';

export type ViewMode = '3d' | '2d';
export type ViewPlane = 'xy' | 'xz' | 'yz';
type PreviewSelectionValue = 'default' | 'all' | `group:${string}`;
type SelectionViewState = {
    mode: ViewMode;
    cameraState2D: CameraState2D | null;
    cameraState3D: CameraState3D | null;
};

interface PreviewSelectionOption {
    value: PreviewSelectionValue;
    label: string;
    groupName?: string;
}

/**
 * Restrict a Model3DData to the models whose metadata reports `layoutGroup === groupName`.
 * When `groupName` is null, returns the input unchanged.
 */
function filterModelDataByLayoutGroup(data: Model3DData | null, groupName: string | null): Model3DData | null {
    if (!data || !groupName) return data;
    const groupModels = new Set<string>(
        (data.metadata?.models ?? [])
            .filter((m) => m.layoutGroup === groupName)
            .map((m) => m.name),
    );
    const filteredPoints = data.points.filter((p) => {
        const name = p.metadata?.modelName;
        return Boolean(name && groupModels.has(name));
    });
    const filteredModels = (data.metadata?.models ?? []).filter((m) => groupModels.has(m.name));
    return {
        ...data,
        points: filteredPoints,
        metadata: data.metadata
            ? { ...data.metadata, totalModels: filteredModels.length, models: filteredModels }
            : data.metadata,
    };
}

export interface Preview3DProps {
    modelData?: Model3DData;
    /** Optional 2D-projected layout from the caller (e.g. browser XSQZ); used by the 2D viewer when set. */
    modelData2D?: Model3DData;
    /** Optional layout settings from caller (e.g. browser XSQZ parsing path). */
    layoutSettings?: LayoutSettings;
    /**
     * Optional map of layout asset paths → blob URLs supplied by callers that have the layout
     * zip in hand (e.g. the browser-preview path via `useBrowserPlayback`). Keyed by lowercase
     * forward-slash relative path. Preview3D builds a chained `AssetResolver` from this map
     * (preferred) plus `frameServerUrl` (fallback) and passes it down to leaves so the same
     * components work in cloud-only, FSEQ-only, and local-Koa hosting.
     */
    layoutAssets?: Map<string, string>;
    /**
     * Optional view objects (mesh / image planes) parsed from rgbeffects. When supplied,
     * Preview3D uses them directly and skips the `frameServerUrl/api/view-objects` fetch —
     * required for the cloud-only path where there is no Koa server. When omitted, falls
     * back to the show-server fetch (Electron / local browser).
     */
    viewObjects?: ViewObject[];
    /**
     * Optional DMX moving-head fixtures. Same role as `viewObjects` for the
     * `frameServerUrl/api/moving-heads` fetch — supply when the caller has already extracted
     * them client-side (e.g. via `xllayoutcalcs.getAllMovingHeads`).
     */
    movingHeadFixtures?: MhFixtureInfo[];
    showList?: boolean;
    initialShowList?: boolean;
    showControls?: boolean;
    defaultViewMode?: ViewMode;
    pointSize?: number; // TODO This will come from models individually
    frameServerUrl?: string; // URL for the frame/model server, e.g., "http://localhost:3000"
    /** Live frame ring buffer produced by the caller (e.g. useFrameBuffer or useBrowserPlayback). */
    liveData?: LatestFrameRingBuffer;
    /**
     * localStorage key for preview settings (sliders, camera, view mode).
     * Default `previewSettings`. Use a distinct key for an isolated preview so it does not share state with the live player preview.
     */
    previewSettingsStorageKey?: string;
    /**
     * `'standalone'` (default) — live-player preview page. Click-to-select, audio mute toggle,
     * and the layout name label are all shown.
     *
     * `'embedded'` — hosted inside a dialog / card with its own shell. Disables click-to-select,
     * hides the audio toggle (audio is the caller's responsibility), and hides the layout label
     * to avoid redundancy with the caller's own title/chrome.
     */
    mode?: 'standalone' | 'embedded';
    /** When true, viewers use minHeight 0 so the preview fills a flex/dialog container instead of forcing 600px. */
    compact?: boolean;
}

export const Preview3D: React.FC<Preview3DProps> = ({
    modelData: initialModelData,
    modelData2D: initialModelData2D,
    layoutSettings: initialLayoutSettings,
    layoutAssets,
    viewObjects: initialViewObjects,
    movingHeadFixtures: initialMovingHeadFixtures,
    showList = false,
    initialShowList = false,
    showControls = true,
    defaultViewMode = '3d',
    pointSize = 3.0,
    frameServerUrl,
    liveData,
    previewSettingsStorageKey = 'previewSettings',
    mode = 'standalone',
    compact = false,
}) => {
    const theme = useTheme();
    const preferOrbitControls = useOrbitPreference();
    const embedded = mode === 'embedded';
    const disableModelSelection = embedded;
    const hideAudioControls = embedded;
    const showLayoutLabel = !embedded;
    const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
    const [showItemList, setShowItemList] = useState(showList && initialShowList);
    const [modelData, setModelData] = useState<Model3DData | null>(initialModelData || null);
    const [modelData2D, setModelData2D] = useState<Model3DData | null>(null);
    // Lazy init from the prop so the first render already has live data when available.
    // `liveData` is used directly — no local state mirror needed.
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
        brightnessMultiplier: 100, // Percentage multiplier applied to XML brightness (0–200, where 100 = 1x, 200 = 2x)
    });

    // Camera state for 2D and 3D views (loaded from localStorage on mount,
    // updated on mode switches to preserve position when toggling 3D↔2D).
    const [cameraState2D, setCameraState2D] = useState<CameraState2D | null>(null);
    const [cameraState3D, setCameraState3D] = useState<CameraState3D | null>(null);
    const [previewSelection, setPreviewSelection] = useState<PreviewSelectionValue>('default');
    const [shouldAutoFit, setShouldAutoFit] = useState(false);
    const [cameraStateLoaded, setCameraStateLoaded] = useState(false);
    const [viewStateBySelection, setViewStateBySelection] = useState<Record<string, SelectionViewState>>({});
    const [viewpointMenuAnchor, setViewpointMenuAnchor] = useState<null | HTMLElement>(null);

    // Refs to store getter functions registered by the viewers — called on
    // "Ok" click and mode switch to read the exact current camera state.
    const getCurrentCameraState2DRef = React.useRef<(() => CameraState2D | null) | null>(null);
    const getCurrentCameraState3DRef = React.useRef<(() => CameraState3D | null) | null>(null);

    // Set on mount when localStorage has a saved group selection; applied once layoutGroups arrive.
    // Used to avoid race conditions where the invalid-selection reset effect clobbers the saved value
    // before layoutSettings has been fetched.
    const pendingRestoreRef = React.useRef<{
        selection: PreviewSelectionValue;
        viewState: SelectionViewState | undefined;
    } | null>(null);

    // Stable callbacks for registering getter functions from viewers
    const handleGetCurrentCameraState3D = useCallback((getter: () => CameraState3D | null) => {
        getCurrentCameraState3DRef.current = getter;
    }, []);
    const handleGetCurrentCameraState2D = useCallback((getter: () => CameraState2D | null) => {
        getCurrentCameraState2DRef.current = getter;
    }, []);

    const layoutGroupOptions = React.useMemo<PreviewSelectionOption[]>(() => {
        const groups = (layoutSettings.layoutGroups ?? [])
            .filter((g): g is LayoutGroupInfo => Boolean(g?.name))
            .map((g) => ({ value: `group:${g.name}` as const, label: g.name, groupName: g.name }));
        return [
            { value: 'default', label: 'Default' },
            { value: 'all', label: 'All Models' },
            ...groups,
        ];
    }, [layoutSettings.layoutGroups]);

    const activeLayoutGroupName = React.useMemo(() => {
        return previewSelection.startsWith('group:') ? previewSelection.slice('group:'.length) : null;
    }, [previewSelection]);

    const activeLayoutGroup = React.useMemo(
        () => (activeLayoutGroupName ? layoutSettings.layoutGroups?.find((g) => g.name === activeLayoutGroupName) : undefined),
        [layoutSettings.layoutGroups, activeLayoutGroupName],
    );

    const filteredModelData = React.useMemo(
        () => filterModelDataByLayoutGroup(modelData, activeLayoutGroupName),
        [modelData, activeLayoutGroupName],
    );

    const filteredModelData2D = React.useMemo(
        () => filterModelDataByLayoutGroup(modelData2D, activeLayoutGroupName),
        [modelData2D, activeLayoutGroupName],
    );

    const effectiveLayoutSettings = React.useMemo<LayoutSettings>(() => {
        if (!activeLayoutGroup) return layoutSettings;
        return {
            ...layoutSettings,
            backgroundImage: activeLayoutGroup.backgroundImage ?? layoutSettings.backgroundImage,
            backgroundBrightness: activeLayoutGroup.backgroundBrightness ?? layoutSettings.backgroundBrightness,
            previewWidth: activeLayoutGroup.paneWidth ?? layoutSettings.previewWidth,
            previewHeight: activeLayoutGroup.paneHeight ?? layoutSettings.previewHeight,
        };
    }, [layoutSettings, activeLayoutGroup]);
    const renderedModelData = filteredModelData;
    const renderedModelData2D = (filteredModelData2D ?? filteredModelData) as Model3DData;

    // If the currently-selected preview doesn't exist in the options, fall back to 'default'.
    // Guarded on `layoutGroups !== undefined` so we don't reset before the settings have loaded
    // (otherwise a saved `group:Foo` selection would be clobbered during mount).
    useEffect(() => {
        if (layoutSettings.layoutGroups === undefined) return;
        if (pendingRestoreRef.current) return;
        const hasSelection = layoutGroupOptions.some((opt) => opt.value === previewSelection);
        if (!hasSelection) {
            setPreviewSelection('default');
        }
    }, [layoutGroupOptions, previewSelection, layoutSettings.layoutGroups]);

    // Restore a saved group selection once the layoutGroups have actually loaded and contain it.
    // If the group was deleted from the show, we leave previewSelection at 'default'.
    useEffect(() => {
        const pending = pendingRestoreRef.current;
        if (!pending) return;
        if (layoutSettings.layoutGroups === undefined) return;
        pendingRestoreRef.current = null;
        if (layoutGroupOptions.some((opt) => opt.value === pending.selection)) {
            setPreviewSelection(pending.selection);
            if (pending.viewState) {
                setViewMode(pending.viewState.mode);
                setCameraState2D(pending.viewState.cameraState2D);
                setCameraState3D(pending.viewState.cameraState3D);
            }
        }
    }, [layoutGroupOptions, layoutSettings.layoutGroups]);

    // Get show folder from Redux store to detect changes
    const showDirectory = useSelector((state: RootState) => state.auth.showDirectory);

    // Load preview settings and camera state from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(previewSettingsStorageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.pixelSize !== undefined) {
                    // Clamp brightnessMultiplier to valid range (0-200) for backward compatibility
                    const brightnessMultiplier = parsed.brightnessMultiplier ?? 100;
                    const clampedBrightness = Math.max(0, Math.min(200, brightnessMultiplier));
                    setPreviewSettings({
                        pixelSize: parsed.pixelSize ?? 1.0,
                        brightnessMultiplier: clampedBrightness,
                    });
                }
                // Restore view mode if saved
                if (parsed.mode === '2d' || parsed.mode === '3d') {
                    setViewMode(parsed.mode);
                }
                // Restore camera states if saved
                if (parsed.cameraState2D) {
                    setCameraState2D(parsed.cameraState2D);
                }
                if (parsed.cameraState3D) {
                    setCameraState3D(parsed.cameraState3D);
                }
                const parsedViewStateBySelection = (
                    parsed.viewStateBySelection && typeof parsed.viewStateBySelection === 'object'
                        ? parsed.viewStateBySelection
                        : {}
                ) as Record<string, SelectionViewState>;
                setViewStateBySelection(parsedViewStateBySelection);

                // Restore the previously-active selection. 'default' and 'all' are always valid and
                // can be applied immediately; 'group:*' values require layoutGroups to be loaded first
                // (handled by a separate effect via pendingRestoreRef).
                const savedSelection: PreviewSelectionValue =
                    typeof parsed.previewSelection === 'string' ? parsed.previewSelection : 'default';
                const restoreViewState = parsedViewStateBySelection[savedSelection];

                if (savedSelection === 'default' || savedSelection === 'all') {
                    setPreviewSelection(savedSelection);
                    if (restoreViewState) {
                        setViewMode(restoreViewState.mode);
                        setCameraState2D(restoreViewState.cameraState2D);
                        setCameraState3D(restoreViewState.cameraState3D);
                    }
                } else if (savedSelection.startsWith('group:')) {
                    pendingRestoreRef.current = { selection: savedSelection, viewState: restoreViewState };
                }
            }
            // Mark camera state as loaded (even if null, we've checked localStorage)
            setCameraStateLoaded(true);
        } catch (err) {
            console.error('[Preview3D] Failed to load preview settings:', err);
            setCameraStateLoaded(true);
        }
    }, [previewSettingsStorageKey]);

    // Sync preview selection + per-selection view state to localStorage whenever they change.
    // Centralising the write avoids closure-staleness bugs that happened when individual handlers
    // persisted these fields manually. Guard on `cameraStateLoaded` so the initial mount (before
    // the load effect has read existing storage) doesn't overwrite saved state with defaults.
    useEffect(() => {
        if (!cameraStateLoaded) return;
        try {
            let existing: Record<string, unknown> = {};
            const raw = localStorage.getItem(previewSettingsStorageKey);
            if (raw) existing = JSON.parse(raw);
            localStorage.setItem(
                previewSettingsStorageKey,
                JSON.stringify({ ...existing, previewSelection, viewStateBySelection }),
            );
        } catch (err) {
            console.error('[Preview3D] Failed to persist preview selection state:', err);
        }
    }, [previewSelection, viewStateBySelection, cameraStateLoaded, previewSettingsStorageKey]);

    // Resolve the server URL (auto-detects Electron port or falls back to same-origin).
    const { url: effectiveFrameServerUrl } = useFrameServerUrl({ frameServerUrl });

    // Build the asset resolver leaves use to turn a layout asset path into a fetchable URL.
    // Zip-blob first so any asset present in the caller-supplied layout zip wins; show-file
    // second so disk-served assets are still resolvable when running against local Koa
    // (Electron / local browser). When neither yields a URL the leaves fall back to no-op.
    const assetResolver = React.useMemo<AssetResolver>(
        () =>
            combineResolvers(
                createZipAssetResolver(layoutAssets),
                createShowFileResolver(effectiveFrameServerUrl),
            ),
        [layoutAssets, effectiveFrameServerUrl],
    );

    // Audio stream for the standalone web client. In embedded mode the host (e.g. the browser
    // preview dialog) owns audio, so we pass no baseUrl — that short-circuits `useAudioStream`
    // before any HTTP polling, even if audioEnabled somehow flips on.
    const { audioEnabled, toggleAudio } = useAudioStream({
        baseUrl: embedded ? undefined : effectiveFrameServerUrl,
    });

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
            setSelectionState({ selectedIds: new Set<string>(), hoveredId: null });
            setSelectedModelNames(new Set<string>());
        }
    }, [showDirectory]);

    // Load model from XML coordinates if available (Electron environment or HTTP API)
    useEffect(() => {
        // If initialModelData is provided, use it
        if (initialModelData) {
            setModelData(initialModelData);
            setModelData2D(initialModelData2D ?? null);
            setLayoutSettings(initialLayoutSettings ?? {});
            // Caller-supplied view objects + moving heads (cloud-only path) — when present we
            // skip the corresponding `frameServerUrl/api/...` fetches entirely, since the
            // parser in `useBrowserPlayback` already produced them client-side.
            if (initialViewObjects !== undefined) {
                setViewObjects(initialViewObjects);
            }
            if (initialMovingHeadFixtures !== undefined) {
                setMovingHeadFixtures(initialMovingHeadFixtures);
            }
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
    }, [initialModelData, initialModelData2D, initialLayoutSettings, initialViewObjects, initialMovingHeadFixtures, showDirectory, effectiveFrameServerUrl]);

    // Handle item selection - detect model from point metadata and select entire model
    const handleItemClick = useCallback(
        (itemId: string) => {
            if (!filteredModelData) return;

            // Find the clicked point to get its model name
            const clickedPoint = filteredModelData.points.find((p) => p.id === itemId);
            const modelName = clickedPoint?.metadata?.modelName as string | undefined;

            if (!modelName) return;

            // Get all points belonging to this model
            const modelPoints = filteredModelData.points.filter((p) => p.metadata?.modelName === modelName);
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
        [filteredModelData, selectedModelNames],
    );

    // Handle item hover
    const handleItemHover = useCallback((itemId: string | null) => {
        setSelectionState((prev) => ({ ...prev, hoveredId: itemId }));
    }, []);

    // Viewpoint chooser — lists xLights saved cameras. 3D only; read-only (no write-back to XML).
    const layoutViewpoints = layoutSettings.viewpoints;
    const userViewpoints3D = React.useMemo<ViewpointInfo[]>(
        () => (layoutViewpoints?.viewpoints ?? []).filter((v) => v.is3D),
        [layoutViewpoints],
    );
    const defaultViewpoint3D = layoutViewpoints?.default3D;
    const hasAnyViewpoints = Boolean(defaultViewpoint3D || userViewpoints3D.length > 0);

    const handleViewpointMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
        setViewpointMenuAnchor(event.currentTarget);
    }, []);
    const handleViewpointMenuClose = useCallback(() => {
        setViewpointMenuAnchor(null);
    }, []);
    const handleViewpointPick = useCallback((vp: ViewpointInfo) => {
        setCameraState3D(viewpointToCameraState(vp));
        setShouldAutoFit(false);
        setViewpointMenuAnchor(null);
    }, []);

    // Close the viewpoint menu if the user switches out of 3D mode while it is open,
    // since the anchor button disappears and the floating menu would be orphaned.
    useEffect(() => {
        if (viewMode !== '3d') setViewpointMenuAnchor(null);
    }, [viewMode]);

    // Handle view mode change — capture the current viewer's camera state
    // before switching so it can be restored when the user toggles back.
    const handleViewModeChange = useCallback((_event: React.MouseEvent<HTMLElement>, newMode: ViewMode | null) => {
        if (newMode !== null) {
            // Snapshot the outgoing viewer's camera so it can be restored later
            if (viewMode === '3d' && getCurrentCameraState3DRef.current) {
                const state = getCurrentCameraState3DRef.current();
                if (state) setCameraState3D(state);
            } else if (viewMode === '2d' && getCurrentCameraState2DRef.current) {
                const state = getCurrentCameraState2DRef.current();
                if (state) setCameraState2D(state);
            }
            setViewMode(newMode);
        }
    }, [viewMode]);

    const handlePreviewSelectionChange = useCallback((event: SelectChangeEvent<PreviewSelectionValue>) => {
        const nextSelection = event.target.value as PreviewSelectionValue;
        const currentSelectionState: SelectionViewState = {
            mode: viewMode,
            cameraState2D: getCurrentCameraState2DRef.current?.() ?? cameraState2D,
            cameraState3D: getCurrentCameraState3DRef.current?.() ?? cameraState3D,
        };

        // Snapshot the outgoing selection's view state; the sync-to-storage effect handles persistence.
        setViewStateBySelection((prev) => ({ ...prev, [previewSelection]: currentSelectionState }));

        const nextState = viewStateBySelection[nextSelection];
        if (nextState) {
            setViewMode(nextState.mode);
            setCameraState2D(nextState.cameraState2D);
            setCameraState3D(nextState.cameraState3D);
            setShouldAutoFit(false);
        } else {
            setCameraState2D(null);
            setCameraState3D(null);
            setShouldAutoFit(true);
        }
        setPreviewSelection(nextSelection);
        setSelectionState({ selectedIds: new Set<string>(), hoveredId: null });
        setSelectedModelNames(new Set<string>());
    }, [previewSelection, viewMode, cameraState2D, cameraState3D, viewStateBySelection]);

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

    // Handle OK — persist slider values to localStorage and close
    const handleSettingsOk = useCallback(() => {
        try {
            let existing: Record<string, unknown> = {};
            try {
                const raw = localStorage.getItem(previewSettingsStorageKey);
                if (raw) existing = JSON.parse(raw);
            } catch { /* ignore parse errors */ }

            const updated = {
                ...existing,
                pixelSize: previewSettings.pixelSize,
                brightnessMultiplier: previewSettings.brightnessMultiplier,
            };
            localStorage.setItem(previewSettingsStorageKey, JSON.stringify(updated));
        } catch (err) {
            console.error('[Preview3D] Failed to save slider settings:', err);
        }
        setSettingsAnchorPosition(null);
    }, [previewSettings, previewSettingsStorageKey]);

    // Handle settings change
    const handleSettingsChange = useCallback((newSettings: PreviewSettingsData) => {
        // Validate and clamp values
        const clampedPixelSize = Math.max(0.5, Math.min(3.0, Number(newSettings.pixelSize) || 1.0));
        const clampedMultiplier = Math.max(0, Math.min(200, Number(newSettings.brightnessMultiplier) || 100));

        setPreviewSettings({
            pixelSize: clampedPixelSize,
            brightnessMultiplier: clampedMultiplier,
        });
    }, []);

    // Handle reset view
    const handleResetView = useCallback(() => {
        setShouldAutoFit(true);
        setCameraState2D(null);
        setCameraState3D(null);
        setViewStateBySelection((prev) => {
            const next = { ...prev };
            delete next[previewSelection];
            return next;
        });
        // Clear legacy top-level camera fields; viewStateBySelection is handled by the sync effect.
        try {
            const saved = localStorage.getItem(previewSettingsStorageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                delete parsed.cameraState2D;
                delete parsed.cameraState3D;
                localStorage.setItem(previewSettingsStorageKey, JSON.stringify(parsed));
            }
        } catch (err) {
            console.error('[Preview3D] Failed to clear camera state:', err);
        }
    }, [previewSettingsStorageKey, previewSelection]);

    // Handle auto-fit complete
    const handleAutoFitComplete = useCallback(() => {
        setShouldAutoFit(false);
    }, []);

    // Handle save as default view — persists only the camera position/angle/zoom
    // and 2D/3D mode. Slider values (pixel size, brightness) are NOT saved here;
    // they are saved separately via the OK button flow.
    const handleSaveAsDefault = useCallback(() => {
        const currentCameraState2D = getCurrentCameraState2DRef.current?.() ?? null;
        const currentCameraState3D = getCurrentCameraState3DRef.current?.() ?? null;

        setViewStateBySelection((prev) => ({
            ...prev,
            [previewSelection]: {
                mode: viewMode,
                cameraState2D: currentCameraState2D,
                cameraState3D: currentCameraState3D,
            },
        }));

        // Also write legacy top-level fields for backwards compatibility with saves created before
        // the per-selection feature. The sync effect handles viewStateBySelection itself.
        try {
            let existing: Record<string, unknown> = {};
            try {
                const raw = localStorage.getItem(previewSettingsStorageKey);
                if (raw) existing = JSON.parse(raw);
            } catch { /* ignore parse errors */ }
            localStorage.setItem(
                previewSettingsStorageKey,
                JSON.stringify({
                    ...existing,
                    mode: viewMode,
                    cameraState2D: currentCameraState2D,
                    cameraState3D: currentCameraState3D,
                }),
            );
        } catch (err) {
            console.error('[Preview3D] Failed to save default view:', err);
        }
    }, [viewMode, previewSettingsStorageKey, previewSelection]);

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
                if (filteredModelData) {
                    const modelPoints = filteredModelData.points.filter((p) => p.metadata?.modelName === model.name);
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
                if (filteredModelData) {
                    const modelPoints = filteredModelData.points.filter((p) => p.metadata?.modelName === model.name);
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
        [filteredModelData, selectedModelNames],
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

    if (error && !renderedModelData) {
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

    const hasRenderablePoints = Boolean(renderedModelData && renderedModelData.points && renderedModelData.points.length > 0);
    const isEmptySelectedGroup = !hasRenderablePoints && Boolean(activeLayoutGroupName);

    if (!hasRenderablePoints && !isEmptySelectedGroup) {
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
                    {activeLayoutGroupName
                        ? `No models in preview group "${activeLayoutGroupName}".`
                        : 'No layout in the selected show folder.'}
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
                minHeight: compact ? 0 : undefined,
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

                    <FormControl size="small" sx={{ minWidth: 210 }}>
                        <InputLabel id="preview-select-label">Preview</InputLabel>
                        <Select
                            labelId="preview-select-label"
                            value={previewSelection}
                            label="Preview"
                            onChange={handlePreviewSelectionChange}
                        >
                            {layoutGroupOptions.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {viewMode === '3d' && hasAnyViewpoints && (
                        <Tooltip title="Camera viewpoints">
                            <IconButton size="small" onClick={handleViewpointMenuOpen}>
                                <VideocamIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Menu
                        anchorEl={viewpointMenuAnchor}
                        open={Boolean(viewpointMenuAnchor)}
                        onClose={handleViewpointMenuClose}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                    >
                        {defaultViewpoint3D && (
                            <MenuItem onClick={() => handleViewpointPick(defaultViewpoint3D)}>
                                Default ({defaultViewpoint3D.name})
                            </MenuItem>
                        )}
                        {defaultViewpoint3D && userViewpoints3D.length > 0 && <Divider />}
                        {userViewpoints3D.length > 0 && [
                            <ListSubheader key="__hdr" sx={{ lineHeight: 1.8 }}>
                                Saved viewpoints
                            </ListSubheader>,
                            ...userViewpoints3D.map((vp) => (
                                <MenuItem key={vp.name} onClick={() => handleViewpointPick(vp)}>
                                    {vp.name}
                                </MenuItem>
                            )),
                        ]}
                    </Menu>

                    <Divider orientation="vertical" flexItem sx={{ height: 24 }} />

                    {/* Settings Button */}
                    <SettingsButton onClick={handleSettingsClick} />

                    <Divider orientation="vertical" flexItem sx={{ height: 24 }} />

                    {/* Selection Info & Color Picker */}
                    {!disableModelSelection && selectionState.selectedIds.size > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" color="primary" sx={{ fontWeight: 500 }}>
                                {selectionState.selectedIds.size} selected
                            </Typography>
                        </Box>
                    )}

                    <Box sx={{ flex: 1 }} />

                    {/* Right Side Controls */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {showLayoutLabel && renderedModelData?.name && (
                            <Typography variant="body2" color="text.secondary" sx={{ mr: 1, fontStyle: 'italic' }}>
                                {renderedModelData?.name}
                            </Typography>
                        )}
                        {!isElectron() && !hideAudioControls && (
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
                    {isEmptySelectedGroup ? (
                        <Box
                            sx={{
                                width: '100%',
                                height: '100%',
                                minHeight: compact ? 0 : 600,
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                p: 3,
                            }}
                        >
                            <Typography variant="h6" color="text.secondary" sx={{ textAlign: 'center' }}>
                                {`No models in preview group "${activeLayoutGroupName}". Use the Preview dropdown to switch groups.`}
                            </Typography>
                        </Box>
                    ) : (() => {
                        // Use ONLY house model brightness - do NOT use background image brightness
                        // The slider value (0-200) is converted to a multiplier (0-2x)
                        // Example: slider at 100% = 1x multiplier, slider at 200% = 2x multiplier

                        return viewMode === '3d' ? (
                            <Viewer3D
                                points={renderedModelData?.points ?? []}
                                shapes={renderedModelData?.shapes}
                                liveData={liveData}
                                selectedIds={selectionState.selectedIds}
                                hoveredId={selectionState.hoveredId}
                                onPointClick={disableModelSelection ? undefined : handleItemClick}
                                onPointHover={disableModelSelection ? undefined : handleItemHover}
                                pointSize={pointSize}
                                selectedModelNames={selectedModelNames}
                                modelMetadata={renderedModelData?.metadata?.models}
                                viewObjects={viewObjects}
                                frameServerUrl={effectiveFrameServerUrl}
                                assetResolver={assetResolver}
                                movingHeadFixtures={movingHeadFixtures}
                                backgroundBrightness={undefined}
                                brightnessMultiplier={previewSettings.brightnessMultiplier}
                                pixelSizeMultiplier={previewSettings.pixelSize}
                                cameraState={cameraState3D}
                                shouldAutoFit={shouldAutoFit}
                                onAutoFitComplete={handleAutoFitComplete}
                                cameraStateLoaded={cameraStateLoaded}
                                onGetCurrentCameraState={handleGetCurrentCameraState3D}
                                fillContainer={compact}
                                forceOrbitControls={preferOrbitControls}
                            />
                        ) : (
                            <Viewer2D
                                points={renderedModelData2D.points}
                                shapes={renderedModelData2D.shapes}
                                liveData={liveData}
                                selectedIds={selectionState.selectedIds}
                                hoveredId={selectionState.hoveredId}
                                onPointClick={disableModelSelection ? undefined : handleItemClick}
                                onPointHover={disableModelSelection ? undefined : handleItemHover}
                                viewPlane={'xy'}
                                pointSize={pointSize}
                                selectedModelNames={selectedModelNames}
                                modelMetadata={renderedModelData2D.metadata?.models}
                                layoutSettings={effectiveLayoutSettings}
                                frameServerUrl={effectiveFrameServerUrl}
                                assetResolver={assetResolver}
                                movingHeadFixtures={movingHeadFixtures}
                                backgroundBrightness={undefined}
                                pixelSizeMultiplier={previewSettings.pixelSize}
                                cameraState={cameraState2D}
                                shouldAutoFit={shouldAutoFit}
                                onAutoFitComplete={handleAutoFitComplete}
                                cameraStateLoaded={cameraStateLoaded}
                                onGetCurrentCameraState={handleGetCurrentCameraState2D}
                                fillContainer={compact}
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
                            modelData={renderedModelData}
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
                onOk={handleSettingsOk}
                onResetView={handleResetView}
            />
        </Box>
    );
};
