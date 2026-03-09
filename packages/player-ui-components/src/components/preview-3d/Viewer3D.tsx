import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import type { Point3D, Shape3D, ModelMetadata, ViewObject } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { GeometryManager } from './geometryManager';
import { getGammaFromModelConfiguration } from './pointShaders';
import { HouseMesh } from './HouseMesh';
import { ImagePlane } from './ImagePlane';
import { MovingHeadBeams } from './MovingHeadBeams';
import type { MhFixtureInfo } from 'xllayoutcalcs';

export interface Viewer3DProps {
    points: Point3D[];
    shapes?: Shape3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    showStats?: boolean;
    pointSize?: number; // Base point size (will be multiplied by pixelSizeMultiplier)
    selectedModelNames?: Set<string>;
    modelMetadata?: ModelMetadata[];
    viewObjects?: ViewObject[];
    frameServerUrl?: string;
    movingHeadFixtures?: MhFixtureInfo[];
    backgroundBrightness?: number; // 0-100, affects background meshes/images only
    pixelSizeMultiplier?: number; // Multiplier for pixel size (from settings)
}

// Optimized point cloud rendering using shader-based geometry batches
function OptimizedPointCloud({
    points,
    liveData,
    selectedIds,
    hoveredId,
    pointSize,
    selectedModelNames,
    modelMetadata,
    pixelSizeMultiplier,
}: {
    points: Point3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    pointSize?: number;
    selectedModelNames?: Set<string>;
    modelMetadata?: ModelMetadata[];
    onPointClick?: (pointId: string) => void;
    pixelSizeMultiplier?: number;
}) {
    const animationTimeRef = useRef(0);
    const geometryManagerRef = useRef<GeometryManager | null>(null);
    const groupRef = useRef<THREE.Group | null>(null);

    // Initialize geometry manager
    useEffect(() => {
        if (!points || points.length === 0) return;

        // Extract gamma explicitly from model configuration (or use default)
        const gamma = getGammaFromModelConfiguration(points);

        // Create map of modelName -> pixelSize from model metadata
        const modelPixelSizeMap = new Map<string, number>();
        // Create map of modelName -> pixelStyle from model metadata
        const modelPixelStyleMap = new Map<string, string>();
        // Create map of modelName -> transparency (0–100) from model metadata
        const modelTransparencyMap = new Map<string, number>();
        if (modelMetadata) {
            modelMetadata.forEach((model) => {
                if (model.pixelSize !== undefined) {
                    modelPixelSizeMap.set(model.name, model.pixelSize);
                }
                if (model.pixelStyle !== undefined) {
                    modelPixelStyleMap.set(model.name, model.pixelStyle);
                }
                if (model.transparency !== undefined) {
                    modelTransparencyMap.set(model.name, model.transparency);
                }
            });
        }

        const uniforms = {
            time: 0,
            brightness: 1.0,
            // Note: gamma is passed explicitly via options, not hardcoded here
            selectedColor: new THREE.Vector3(1.0, 1.0, 0.0), // Yellow
            hoveredColor: new THREE.Vector3(1.0, 1.0, 1.0), // White
            useLiveData: 0.0,
            totalPointCount: points.length,
        };

        const multiplier = pixelSizeMultiplier ?? 1.0;
        console.log(`[Viewer3D] Creating GeometryManager with pixelSizeMultiplier: ${multiplier}, base pointSize: ${pointSize}`);

        const manager = new GeometryManager(points, uniforms, {
            pointSize: pointSize,
            gamma,
            modelPixelSizeMap,
            modelPixelStyleMap,
            modelTransparencyMap,
            pixelSizeMultiplier: multiplier,
        });
        manager.initializeGroups();
        geometryManagerRef.current = manager;

        // Create group to hold all point objects
        const group = new THREE.Group();
        manager.getPointObjects().forEach((pointsObj) => {
            group.add(pointsObj);
        });
        groupRef.current = group;

        return () => {
            manager.dispose();
            geometryManagerRef.current = null;
            groupRef.current = null;
        };
    }, [points, pointSize, modelMetadata, pixelSizeMultiplier]);

    // Track selection/hover in refs so changes are applied in the render
    // loop without triggering React re-render cascades.
    const selectedIdsRef = useRef(selectedIds);
    const hoveredIdRef = useRef(hoveredId);
    const selectedModelNamesRef = useRef(selectedModelNames);
    selectedIdsRef.current = selectedIds;
    hoveredIdRef.current = hoveredId;
    selectedModelNamesRef.current = selectedModelNames;

    const prevSelectionRef = useRef<{
        selectedIds?: Set<string>;
        hoveredId?: string | null;
        selectedModelNames?: Set<string>;
    }>({});

    // Single useFrame handles both selection updates and animation
    useFrame((_state, delta) => {
        if (!geometryManagerRef.current) return;

        // Apply selection/hover changes (ref-based, no React effect needed)
        const prev = prevSelectionRef.current;
        if (
            prev.selectedIds !== selectedIdsRef.current ||
            prev.hoveredId !== hoveredIdRef.current ||
            prev.selectedModelNames !== selectedModelNamesRef.current
        ) {
            geometryManagerRef.current.updateStates(
                selectedIdsRef.current,
                hoveredIdRef.current,
                selectedModelNamesRef.current,
            );
            prevSelectionRef.current = {
                selectedIds: selectedIdsRef.current,
                hoveredId: hoveredIdRef.current,
                selectedModelNames: selectedModelNamesRef.current,
            };
        }

        animationTimeRef.current += delta;

        // Update time for procedural colors
        geometryManagerRef.current.updateTime(animationTimeRef.current);

        // Update live data colors
        geometryManagerRef.current.updateLiveDataColors(liveData);
    });

    // Use a key based on pixelSizeMultiplier to force React to recreate the primitive
    // when the multiplier changes, ensuring the new group is properly rendered
    const groupKey = `point-cloud-${pixelSizeMultiplier ?? 1.0}-${points.length}`;

    if (!groupRef.current) return null;

    return <primitive key={groupKey} object={groupRef.current} />;
}

// Component to handle click events with raycasting
function ClickHandler({
    points,
    onPointClick,
    pointSize,
}: {
    points: Point3D[];
    onPointClick?: (pointId: string) => void;
    pointSize?: number;
}) {
    const { camera, raycaster, gl } = useThree();

    // Pre-compute 3D positions once when points change (same pattern as HoverHandler)
    const pointPositionsRef = useRef<THREE.Vector3[]>([]);
    const centerPointRef = useRef<THREE.Vector3 | null>(null);
    useEffect(() => {
        if (points.length === 0) {
            pointPositionsRef.current = [];
            centerPointRef.current = null;
            return;
        }
        pointPositionsRef.current = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        centerPointRef.current = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
    }, [points]);

    useEffect(() => {
        if (!onPointClick) return;

        const handleClick = (event: MouseEvent) => {
            // Get mouse position in normalized device coordinates
            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update raycaster with camera and mouse position
            raycaster.setFromCamera(mouse, camera);

            // Use pre-computed positions instead of allocating on every click
            const pointPositions = pointPositionsRef.current;
            if (pointPositions.length === 0) return;

            const pointSizeValue = pointSize || 3.0;

            // Calculate threshold based on point size and camera distance
            const cameraDistance = centerPointRef.current
                ? camera.position.distanceTo(centerPointRef.current)
                : 1000;
            const threshold = Math.max(pointSizeValue * 0.05, cameraDistance * 0.01);

            // Find the closest point to the ray
            let closestIndex = -1;
            let minDistance = Infinity;

            for (let i = 0; i < pointPositions.length; i++) {
                const distance = raycaster.ray.distanceToPoint(pointPositions[i]);
                if (distance < threshold && distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                }
            }

            // If a point was found, trigger click handler
            if (closestIndex >= 0 && closestIndex < points.length) {
                onPointClick(points[closestIndex].id);
            }
        };

        gl.domElement.addEventListener('click', handleClick);
        return () => {
            gl.domElement.removeEventListener('click', handleClick);
        };
    }, [onPointClick, points, raycaster, camera, gl, pointSize]);

    return null;
}

// Component to handle hover events with raycasting
function HoverHandler({
    points,
    onPointHover,
    pointSize,
}: {
    points: Point3D[];
    onPointHover?: (pointId: string | null) => void;
    pointSize?: number;
}) {
    const { camera, raycaster, gl } = useThree();

    // Memoize 3D point positions to avoid recreating them on every mousemove
    const pointPositionsRef = useRef<THREE.Vector3[]>([]);
    const centerPointRef = useRef<THREE.Vector3 | null>(null);
    const currentHoveredIdRef = useRef<string | null>(null);
    const lastUpdateTimeRef = useRef<number>(0);
    const throttleDelay = 16; // ~60fps max update rate

    // Pre-compute point positions when points change
    useEffect(() => {
        if (points.length === 0) {
            pointPositionsRef.current = [];
            centerPointRef.current = null;
            return;
        }

        // Pre-compute all 3D positions once
        pointPositionsRef.current = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));

        // Pre-compute center point for camera distance calculation
        const firstPoint = points[0];
        centerPointRef.current = new THREE.Vector3(firstPoint.x, firstPoint.y, firstPoint.z);
    }, [points]);

    useEffect(() => {
        if (!onPointHover) return;

        const handleMouseMove = (event: MouseEvent) => {
            // Throttle updates to ~60fps
            const now = performance.now();
            if (now - lastUpdateTimeRef.current < throttleDelay) {
                return;
            }
            lastUpdateTimeRef.current = now;

            // Get mouse position in normalized device coordinates
            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update raycaster with camera and mouse position
            raycaster.setFromCamera(mouse, camera);

            // Use pre-computed point positions
            const pointPositions = pointPositionsRef.current;
            if (pointPositions.length === 0) {
                if (currentHoveredIdRef.current !== null) {
                    currentHoveredIdRef.current = null;
                    onPointHover(null);
                }
                return;
            }

            const pointSizeValue = pointSize || 3.0;

            // Calculate threshold based on point size and camera distance
            // Cache camera distance calculation (only recalculate if center point exists)
            const centerPoint = centerPointRef.current;
            const cameraDistance = centerPoint ? camera.position.distanceTo(centerPoint) : 1000; // fallback distance
            const threshold = Math.max(pointSizeValue * 0.15, cameraDistance * 0.02);

            // Find the closest point to the ray
            let closestIndex = -1;
            let minDistance = Infinity;

            // Use pre-computed positions instead of creating new ones
            for (let i = 0; i < pointPositions.length; i++) {
                const distance = raycaster.ray.distanceToPoint(pointPositions[i]);
                if (distance < threshold && distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                }
            }

            // Only update state if hovered point actually changed
            const newHoveredId = closestIndex >= 0 && closestIndex < points.length ? points[closestIndex].id : null;

            if (newHoveredId !== currentHoveredIdRef.current) {
                currentHoveredIdRef.current = newHoveredId;
                onPointHover(newHoveredId);
            }
        };

        const handleMouseLeave = () => {
            // Clear hover when mouse leaves the canvas
            if (currentHoveredIdRef.current !== null) {
                currentHoveredIdRef.current = null;
                onPointHover(null);
            }
        };

        gl.domElement.addEventListener('mousemove', handleMouseMove);
        gl.domElement.addEventListener('mouseleave', handleMouseLeave);
        return () => {
            gl.domElement.removeEventListener('mousemove', handleMouseMove);
            gl.domElement.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [onPointHover, points, raycaster, camera, gl, pointSize]);

    return null;
}

// Component to handle WASD + Q/E keyboard navigation
function KeyboardNavigationHandler() {
    const { camera, controls } = useThree();
    const keysRef = useRef<Record<string, boolean>>({});
    const holdTimeRef = useRef(0);

    useEffect(() => {
        const onDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            keysRef.current[e.key.toLowerCase()] = true;
        };
        const onUp = (e: KeyboardEvent) => {
            keysRef.current[e.key.toLowerCase()] = false;
        };
        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup', onUp);
        return () => {
            window.removeEventListener('keydown', onDown);
            window.removeEventListener('keyup', onUp);
        };
    }, []);

    useFrame((_state, delta) => {
        const keys = keysRef.current;
        const anyMovement = keys.w || keys.a || keys.s || keys.d || keys.q || keys.e;
        if (!anyMovement) {
            holdTimeRef.current = 0;
            return;
        }

        holdTimeRef.current += delta;

        const orbitControls = controls as { target: THREE.Vector3; update: () => void } | null;
        const targetDist = orbitControls?.target
            ? camera.position.distanceTo(orbitControls.target) : 100;
        // Accelerate from 1x to 8x over ~1 second of holding
        const accelFactor = Math.min(1 + holdTimeRef.current * 7.0, 8.0);
        const speed = targetDist * 1.5 * delta * accelFactor;

        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

        const movement = new THREE.Vector3();
        if (keys.w) movement.addScaledVector(forward, speed);
        if (keys.s) movement.addScaledVector(forward, -speed);
        if (keys.d) movement.addScaledVector(right, speed);
        if (keys.a) movement.addScaledVector(right, -speed);
        if (keys.e) movement.addScaledVector(camera.up, speed);
        if (keys.q) movement.addScaledVector(camera.up, -speed);

        camera.position.add(movement);
        if (orbitControls?.target) {
            orbitControls.target.add(movement);
            orbitControls.update();
        }
    });

    return null;
}

function SceneContent({
    points,
    shapes,
    liveData,
    selectedIds,
    hoveredId,
    onPointClick,
    onPointHover,
    pointSize,
    selectedModelNames,
    modelMetadata,
    viewObjects,
    frameServerUrl,
    movingHeadFixtures,
    backgroundBrightness,
    pixelSizeMultiplier,
}: {
    points: Point3D[];
    shapes?: Shape3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    pointSize?: number;
    selectedModelNames?: Set<string>;
    modelMetadata?: ModelMetadata[];
    viewObjects?: ViewObject[];
    frameServerUrl?: string;
    movingHeadFixtures?: MhFixtureInfo[];
    backgroundBrightness?: number;
    pixelSizeMultiplier?: number;
}) {
    const { camera, controls } = useThree();

    // Auto-fit camera to scene (including house meshes)
    useEffect(() => {
        if (points.length === 0 && (!viewObjects || viewObjects.length === 0)) return;

        const box = new THREE.Box3();

        // Include points
        points.forEach((point) => {
            box.expandByPoint(new THREE.Vector3(point.x, point.y, point.z));
        });

        // Include shapes
        if (shapes) {
            shapes.forEach((shape) => {
                box.expandByPoint(new THREE.Vector3(shape.position.x, shape.position.y, shape.position.z));
            });
        }

        // Include house meshes and image planes (viewObjects) in bounding box calculation
        if (viewObjects) {
            viewObjects.forEach((viewObj) => {
                if (viewObj.displayAs === 'Mesh' && viewObj.active !== false) {
                    // Add the house position to the bounding box
                    // Account for scale - estimate size based on typical house dimensions
                    // Scale values are multipliers, so estimate house is ~10-20 units in OBJ file
                    const baseHouseSize = 15; // Estimated base size of house in OBJ file units
                    const maxScale = Math.max(viewObj.scaleX, viewObj.scaleY, viewObj.scaleZ);
                    const estimatedSize = baseHouseSize * maxScale;
                    const halfSize = estimatedSize / 2;

                    // Add corners of the bounding box for the house
                    box.expandByPoint(new THREE.Vector3(
                        viewObj.worldPosX - halfSize,
                        viewObj.worldPosY - halfSize,
                        viewObj.worldPosZ - halfSize
                    ));
                    box.expandByPoint(new THREE.Vector3(
                        viewObj.worldPosX + halfSize,
                        viewObj.worldPosY + halfSize,
                        viewObj.worldPosZ + halfSize
                    ));

                    // Also add the center point
                    box.expandByPoint(new THREE.Vector3(
                        viewObj.worldPosX,
                        viewObj.worldPosY,
                        viewObj.worldPosZ
                    ));
                }
                if (viewObj.displayAs === 'Image' && viewObj.active !== false) {
                    box.expandByPoint(new THREE.Vector3(
                        viewObj.worldPosX,
                        viewObj.worldPosY,
                        viewObj.worldPosZ
                    ));
                }
            });
        }

        // If box is empty, set a default
        if (box.isEmpty()) {
            box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 100, 100));
        }

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 100;
        const distance = maxDim * 2.5;

        camera.position.set(center.x + distance, center.y + distance, center.z + distance);
        camera.lookAt(center);

        // Update OrbitControls target to scene center
        if (controls && 'target' in controls) {
            const orbitControls = controls as unknown as { target: THREE.Vector3; update: () => void };
            orbitControls.target.copy(center);
            orbitControls.update();
        }
    }, [points, shapes, viewObjects, camera, controls]);

    return (
        <>
            <ClickHandler points={points} onPointClick={onPointClick} pointSize={pointSize} />
            <HoverHandler points={points} onPointHover={onPointHover} pointSize={pointSize} />
            <KeyboardNavigationHandler />
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <pointLight position={[-10, -10, -10]} intensity={0.5} />

            <OptimizedPointCloud
                points={points}
                liveData={liveData}
                selectedIds={selectedIds}
                hoveredId={hoveredId}
                pointSize={pointSize}
                selectedModelNames={selectedModelNames}
                modelMetadata={modelMetadata}
                onPointClick={onPointClick}
                pixelSizeMultiplier={pixelSizeMultiplier}
            />

            {/* Render house meshes from view objects */}
            {viewObjects?.map((viewObj) => {
                if (viewObj.displayAs === 'Mesh' && viewObj.objFile && viewObj.active !== false) {
                    return (
                        <HouseMesh
                            key={viewObj.name}
                            viewObject={viewObj}
                            frameServerUrl={frameServerUrl}
                            liveData={liveData}
                            points={points}
                            backgroundBrightness={backgroundBrightness}
                        />
                    );
                }
                return null;
            })}

            {/* Render image planes from view objects */}
            {viewObjects?.map((viewObj) => {
                if (viewObj.displayAs === 'Image' && viewObj.imageFile && viewObj.active !== false) {
                    return (
                        <ImagePlane
                            key={viewObj.name}
                            viewObject={viewObj}
                            frameServerUrl={frameServerUrl}
                            backgroundBrightness={backgroundBrightness}
                        />
                    );
                }
                return null;
            })}

            {/* Render DMX moving head fixture bodies and beams */}
            {movingHeadFixtures && movingHeadFixtures.length > 0 && (
                <MovingHeadBeams fixtures={movingHeadFixtures} liveData={liveData} />
            )}
        </>
    );
}

export const Viewer3D: React.FC<Viewer3DProps> = ({
    points,
    shapes,
    liveData,
    selectedIds,
    hoveredId,
    onPointClick,
    onPointHover,
    showStats = false,
    pointSize = 1.2,
    selectedModelNames,
    modelMetadata,
    viewObjects,
    frameServerUrl,
    movingHeadFixtures,
    backgroundBrightness = 100,
    pixelSizeMultiplier = 1.0,
}) => {
    const [error, setError] = useState<string | null>(null);

    // Show empty state if no points
    if (!points || points.length === 0) {
        return (
            <Box
                sx={{
                    width: '100%',
                    height: '100%',
                    minHeight: 600,
                    position: 'relative',
                    backgroundColor: '#191919',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flexDirection: 'column',
                    gap: 2,
                    p: 3,
                }}
            >
                <Typography
                    variant="h6"
                    color="text.secondary"
                    sx={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.7)' }}
                >
                    No layout in the selected show folder.
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                width: '100%',
                height: '100%',
                minHeight: 600,
                position: 'relative',
                backgroundColor: '#191919',
            }}
        >
            {/* Control hints overlay */}
            <Box
                sx={{
                    position: 'absolute',
                    bottom: 16,
                    left: 16,
                    zIndex: 1000,
                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: 1,
                    fontSize: '0.75rem',
                    pointerEvents: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                }}
            >
                <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                    Controls:
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                    🖱️ Left drag: Rotate
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                    🖱️ Right drag: Pan
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                    🖱️ Scroll: Zoom
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                    ⌨️ WASD: Move &nbsp; Q/E: Down/Up
                </Typography>
            </Box>
            {error ? (
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100%',
                        color: 'error.main',
                        p: 2,
                        flexDirection: 'column',
                        gap: 1,
                    }}
                >
                    <Typography variant="body2">Error rendering 3D view: {error}</Typography>
                    <Typography variant="caption" color="text.secondary">
                        Check the browser console for more details
                    </Typography>
                </Box>
            ) : (
                <Box
                    sx={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        zIndex: 1,
                    }}
                >
                    <Canvas
                        onCreated={({ gl }) => {
                            gl.setClearColor('#191919', 1);
                            if (!gl.getContext()) {
                                setError('Failed to create WebGL context');
                            }
                        }}
                        gl={{
                            antialias: true,
                            alpha: false,
                            powerPreference: 'high-performance',
                        }}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                        }}
                    >
                        <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={75} near={0.1} far={50000} />
                        <OrbitControls
                            enableDamping
                            dampingFactor={0.35}
                            minDistance={10}
                            maxDistance={10000}
                            enablePan={true}
                            enableRotate={true}
                            enableZoom={true}
                            zoomToCursor={true}
                            panSpeed={1.0}
                            rotateSpeed={1.0}
                            zoomSpeed={1.0}
                            mouseButtons={{
                                LEFT: THREE.MOUSE.ROTATE,
                                MIDDLE: THREE.MOUSE.DOLLY,
                                RIGHT: THREE.MOUSE.PAN,
                            }}
                            touches={{
                                ONE: THREE.TOUCH.ROTATE,
                                TWO: THREE.TOUCH.DOLLY_PAN,
                            }}
                        />
                        <SceneContent
                            points={points}
                            shapes={shapes}
                            liveData={liveData}
                            selectedIds={selectedIds}
                            hoveredId={hoveredId}
                            onPointClick={onPointClick}
                            onPointHover={onPointHover}
                            pointSize={pointSize}
                            selectedModelNames={selectedModelNames}
                            modelMetadata={modelMetadata}
                            viewObjects={viewObjects}
                            frameServerUrl={frameServerUrl}
                            movingHeadFixtures={movingHeadFixtures}
                            backgroundBrightness={backgroundBrightness}
                            pixelSizeMultiplier={pixelSizeMultiplier}
                        />
                        {showStats && <Stats />}
                    </Canvas>
                </Box>
            )}
        </Box>
    );
};
