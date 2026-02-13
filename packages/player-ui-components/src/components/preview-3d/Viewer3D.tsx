import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import type { Point3D, Shape3D } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { GeometryManager } from './geometryManager';

export interface Viewer3DProps {
    points: Point3D[];
    shapes?: Shape3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    showStats?: boolean;
    pointSize?: number;
    selectedModelNames?: Set<string>;
}

// Optimized point cloud rendering using shader-based geometry batches
function OptimizedPointCloud({
    points,
    liveData,
    selectedIds,
    hoveredId,
    pointSize,
    selectedModelNames,
}: {
    points: Point3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    pointSize?: number;
    selectedModelNames?: Set<string>;
    onPointClick?: (pointId: string) => void;
}) {
    const animationTimeRef = useRef(0);
    const geometryManagerRef = useRef<GeometryManager | null>(null);
    const groupRef = useRef<THREE.Group | null>(null);

    // Initialize geometry manager
    useEffect(() => {
        if (!points || points.length === 0) return;

        const uniforms = {
            time: 0,
            brightness: 1.0,
            gamma: 2.2,
            selectedColor: new THREE.Vector3(1.0, 1.0, 0.0), // Yellow
            hoveredColor: new THREE.Vector3(1.0, 1.0, 1.0), // White
            useLiveData: 0.0,
            totalPointCount: points.length,
        };

        const manager = new GeometryManager(points, uniforms, { pointSize });
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
    }, [points, pointSize]);

    // Update states when selection/hover changes
    useEffect(() => {
        if (!geometryManagerRef.current) return;
        geometryManagerRef.current.updateStates(selectedIds, hoveredId, selectedModelNames);
    }, [selectedIds, hoveredId, selectedModelNames]);

    // Update animation time and point sizes
    useFrame((_state, delta) => {
        if (!geometryManagerRef.current) return;

        animationTimeRef.current += delta;

        // Update time for procedural colors
        geometryManagerRef.current.updateTime(animationTimeRef.current);

        // Update live data colors
        geometryManagerRef.current.updateLiveDataColors(liveData);
    });

    if (!groupRef.current) return null;

    return <primitive object={groupRef.current} />;
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

            // Get all points as 3D positions
            const pointPositions = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
            const pointSizeValue = pointSize || 3.0;

            // Calculate threshold based on point size and camera distance
            // Use a more generous threshold for point selection
            const cameraDistance = camera.position.distanceTo(
                points.length > 0
                    ? new THREE.Vector3(points[0].x, points[0].y, points[0].z)
                    : new THREE.Vector3(0, 0, 0),
            );
            const threshold = Math.max(pointSizeValue * 0.05, cameraDistance * 0.01);

            // Find the closest point to the ray
            let closestIndex = -1;
            let minDistance = Infinity;

            pointPositions.forEach((position, index) => {
                const distance = raycaster.ray.distanceToPoint(position);
                if (distance < threshold && distance < minDistance) {
                    minDistance = distance;
                    closestIndex = index;
                }
            });

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
}) {
    const { camera, controls } = useThree();

    // Auto-fit camera to scene
    useEffect(() => {
        if (points.length === 0) return;

        const box = new THREE.Box3();
        points.forEach((point) => {
            box.expandByPoint(new THREE.Vector3(point.x, point.y, point.z));
        });

        if (shapes) {
            shapes.forEach((shape) => {
                box.expandByPoint(new THREE.Vector3(shape.position.x, shape.position.y, shape.position.z));
            });
        }

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const distance = maxDim * 2.5;

        camera.position.set(center.x + distance, center.y + distance, center.z + distance);
        camera.lookAt(center);

        // Update OrbitControls target to scene center
        if (controls && 'target' in controls) {
            const orbitControls = controls as unknown as { target: THREE.Vector3; update: () => void };
            orbitControls.target.copy(center);
            orbitControls.update();
        }
    }, [points, shapes, camera, controls]);

    return (
        <>
            <ClickHandler points={points} onPointClick={onPointClick} pointSize={pointSize} />
            <HoverHandler points={points} onPointHover={onPointHover} pointSize={pointSize} />
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
                onPointClick={onPointClick}
            />
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
                    backgroundColor: '#111111',
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
                backgroundColor: '#111111',
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
                        />
                        {showStats && <Stats />}
                    </Canvas>
                </Box>
            )}
        </Box>
    );
};
