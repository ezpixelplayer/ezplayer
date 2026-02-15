import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrthographicCamera, MapControls } from '@react-three/drei';
import * as THREE from 'three';
import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import type { Point3D, Shape3D } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { GeometryManager } from './geometryManager';
import { getGammaFromModelConfiguration } from './pointShaders';

export interface Viewer2DProps {
    points: Point3D[];
    shapes?: Shape3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    viewPlane?: 'xy' | 'xz' | 'yz';
    pointSize?: number;
    selectedModelNames?: Set<string>;
}

function Optimized2DPointCloud({
    points,
    liveData,
    selectedIds,
    hoveredId,
    pointSize,
    viewPlane,
    selectedModelNames,
}: {
    points: Point3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    pointSize?: number;
    viewPlane: 'xy' | 'xz' | 'yz';
    selectedModelNames?: Set<string>;
}) {
    const geometryManagerRef = useRef<GeometryManager | null>(null);
    const groupRef = useRef<THREE.Group | null>(null);
    const animationTimeRef = useRef(0);

    // Initialize geometry manager
    useEffect(() => {
        if (!points || points.length === 0) return;

        // Extract gamma explicitly from model configuration (or use default)
        const gamma = getGammaFromModelConfiguration(points);

        const uniforms = {
            time: 0,
            brightness: 1.0,
            // Note: gamma is passed explicitly via options, not hardcoded here
            selectedColor: new THREE.Vector3(1.0, 1.0, 0.0), // Yellow
            hoveredColor: new THREE.Vector3(1.0, 1.0, 1.0), // White
            useLiveData: 0.0,
            totalPointCount: points.length,
        };

        const manager = new GeometryManager(points, uniforms, { pointSize, viewPlane, gamma });
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
    }, [points, pointSize, viewPlane]);

    // Reset animation time when selected models change
    useEffect(() => {
        animationTimeRef.current = 0;
    }, [selectedModelNames]);

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

interface Shape2DMeshProps {
    shape: Shape3D;
    isSelected: boolean;
    isHovered: boolean;
    viewPlane: 'xy' | 'xz' | 'yz';
    onClick: (shapeId: string) => void;
    onHover: (shapeId: string | null) => void;
}

function Shape2DMesh({ shape, isSelected, isHovered, viewPlane, onClick, onHover }: Shape2DMeshProps) {
    const position = useMemo((): [number, number, number] => {
        switch (viewPlane) {
            case 'xy':
                return [shape.position.x, shape.position.y, 0];
            case 'xz':
                return [shape.position.x, 0, shape.position.z];
            case 'yz':
                return [0, shape.position.y, shape.position.z];
            default:
                return [shape.position.x, shape.position.y, 0];
        }
    }, [shape.position, viewPlane]);

    const color = isSelected ? '#ffff00' : isHovered ? '#00ffff' : shape.color || '#ffffff';

    const handleClick = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onClick(shape.id);
        },
        [onClick, shape.id],
    );

    const handlePointerOver = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHover(shape.id);
        },
        [onHover, shape.id],
    );

    const handlePointerOut = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHover(null);
        },
        [onHover],
    );

    return (
        <mesh
            position={position}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
        >
            <circleGeometry args={[0.5, 32]} />
            <meshStandardMaterial color={color} wireframe={isSelected || isHovered} />
        </mesh>
    );
}

// Component to handle click events with raycasting (adapted for 2D view planes)
function ClickHandler2D({
    points,
    onPointClick,
    pointSize,
    viewPlane,
}: {
    points: Point3D[];
    onPointClick?: (pointId: string) => void;
    pointSize?: number;
    viewPlane: 'xy' | 'xz' | 'yz';
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

            // Get all points as 2D positions based on view plane
            const pointPositions = points.map((p) => {
                switch (viewPlane) {
                    case 'xy':
                        return new THREE.Vector3(p.x, p.y, 0);
                    case 'xz':
                        return new THREE.Vector3(p.x, 0, p.z);
                    case 'yz':
                        return new THREE.Vector3(0, p.y, p.z);
                }
            });
            const pointSizeValue = pointSize || 3.0;

            // Calculate threshold based on point size and camera distance
            // Use a more generous threshold for point selection
            const cameraDistance = camera.position.distanceTo(
                points.length > 0
                    ? (() => {
                        const firstPoint = points[0];
                        switch (viewPlane) {
                            case 'xy':
                                return new THREE.Vector3(firstPoint.x, firstPoint.y, 0);
                            case 'xz':
                                return new THREE.Vector3(firstPoint.x, 0, firstPoint.z);
                            case 'yz':
                                return new THREE.Vector3(0, firstPoint.y, firstPoint.z);
                        }
                    })()
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
    }, [onPointClick, points, raycaster, camera, gl, pointSize, viewPlane]);

    return null;
}

// Component to handle hover events with raycasting (adapted for 2D view planes)
function HoverHandler2D({
    points,
    onPointHover,
    pointSize,
    viewPlane,
}: {
    points: Point3D[];
    onPointHover?: (pointId: string | null) => void;
    pointSize?: number;
    viewPlane: 'xy' | 'xz' | 'yz';
}) {
    const { camera, raycaster, gl } = useThree();

    // Memoize 2D point positions to avoid recreating them on every mousemove
    const pointPositionsRef = useRef<THREE.Vector3[]>([]);
    const centerPointRef = useRef<THREE.Vector3 | null>(null);
    const currentHoveredIdRef = useRef<string | null>(null);
    const lastUpdateTimeRef = useRef<number>(0);
    const throttleDelay = 16; // ~60fps max update rate

    // Pre-compute point positions when points or viewPlane changes
    useEffect(() => {
        if (points.length === 0) {
            pointPositionsRef.current = [];
            centerPointRef.current = null;
            return;
        }

        // Pre-compute all 2D positions once
        pointPositionsRef.current = points.map((p) => {
            switch (viewPlane) {
                case 'xy':
                    return new THREE.Vector3(p.x, p.y, 0);
                case 'xz':
                    return new THREE.Vector3(p.x, 0, p.z);
                case 'yz':
                    return new THREE.Vector3(0, p.y, p.z);
            }
        });

        // Pre-compute center point for camera distance calculation
        const firstPoint = points[0];
        switch (viewPlane) {
            case 'xy':
                centerPointRef.current = new THREE.Vector3(firstPoint.x, firstPoint.y, 0);
                break;
            case 'xz':
                centerPointRef.current = new THREE.Vector3(firstPoint.x, 0, firstPoint.z);
                break;
            case 'yz':
                centerPointRef.current = new THREE.Vector3(0, firstPoint.y, firstPoint.z);
                break;
        }
    }, [points, viewPlane]);

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
    }, [onPointHover, points, raycaster, camera, gl, pointSize, viewPlane]);

    return null;
}

function Scene2DContent({
    points,
    shapes,
    liveData,
    selectedIds,
    hoveredId,
    onPointClick,
    onPointHover,
    viewPlane,
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
    viewPlane: 'xy' | 'xz' | 'yz';
    pointSize?: number;
    selectedModelNames?: Set<string>;
}) {
    const { camera, controls } = useThree();

    // Auto-fit camera to scene
    useEffect(() => {
        if (points.length === 0) return;

        const box = new THREE.Box3();
        points.forEach((point) => {
            let x, y, z;
            switch (viewPlane) {
                case 'xy':
                    x = point.x;
                    y = point.y;
                    z = 0;
                    break;
                case 'xz':
                    x = point.x;
                    y = 0;
                    z = point.z;
                    break;
                case 'yz':
                    x = 0;
                    y = point.y;
                    z = point.z;
                    break;
            }
            box.expandByPoint(new THREE.Vector3(x, y, z));
        });

        if (shapes) {
            shapes.forEach((shape) => {
                let x, y, z;
                switch (viewPlane) {
                    case 'xy':
                        x = shape.position.x;
                        y = shape.position.y;
                        z = 0;
                        break;
                    case 'xz':
                        x = shape.position.x;
                        y = 0;
                        z = shape.position.z;
                        break;
                    case 'yz':
                        x = 0;
                        y = shape.position.y;
                        z = shape.position.z;
                        break;
                }
                box.expandByPoint(new THREE.Vector3(x, y, z));
            });
        }

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // Increase distance multiplier to ensure all models fit in view
        const distance = maxDim * 2.5;

        // Position camera based on view plane
        switch (viewPlane) {
            case 'xy':
                camera.position.set(center.x, center.y, distance);
                break;
            case 'xz':
                camera.position.set(center.x, distance, center.z);
                break;
            case 'yz':
                camera.position.set(distance, center.y, center.z);
                break;
        }
        camera.lookAt(center);

        // Adjust orthographic camera zoom to fit the scene
        if (camera instanceof THREE.OrthographicCamera && maxDim > 0) {
            // Calculate appropriate zoom based on scene size
            const targetZoom = 100 / maxDim;
            camera.zoom = Math.max(0.5, Math.min(targetZoom, 50));
            camera.updateProjectionMatrix();
        }

        // Reset controls target to match camera lookAt
        if (controls && 'target' in controls) {
            const mapControls = controls as { target: THREE.Vector3; update?: () => void };
            if (mapControls.target) {
                mapControls.target.copy(center);
                mapControls.update?.();
            }
        }
    }, [points, shapes, camera, controls, viewPlane]);

    return (
        <>
            <ClickHandler2D points={points} onPointClick={onPointClick} pointSize={pointSize} viewPlane={viewPlane} />
            <HoverHandler2D points={points} onPointHover={onPointHover} pointSize={pointSize} viewPlane={viewPlane} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[10, 10, 5]} intensity={0.5} />

            {shapes?.map((shape) => (
                <Shape2DMesh
                    key={shape.id}
                    shape={shape}
                    isSelected={selectedIds?.has(shape.id) ?? false}
                    isHovered={hoveredId === shape.id}
                    viewPlane={viewPlane}
                    onClick={onPointClick || (() => { })}
                    onHover={onPointHover || (() => { })}
                />
            ))}

            <Optimized2DPointCloud
                points={points}
                liveData={liveData}
                selectedIds={selectedIds}
                hoveredId={hoveredId}
                pointSize={pointSize}
                viewPlane={viewPlane}
                selectedModelNames={selectedModelNames}
            />
        </>
    );
}

export const Viewer2D: React.FC<Viewer2DProps> = ({
    points,
    shapes,
    liveData,
    selectedIds,
    hoveredId,
    onPointClick,
    onPointHover,
    viewPlane = 'xy',
    pointSize = 3.0,
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
            {!error && (
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
                        🖱️ Left drag: Pan
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
            )}
            {error ? (
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100%',
                        color: 'error.main',
                        p: 2,
                    }}
                >
                    <Typography variant="body2">Error rendering 2D view: {error}</Typography>
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
                            // Check if WebGL context was created successfully
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
                        <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={0.5} near={0.1} far={50000} />
                        <MapControls
                            key={`controls-${viewPlane}`}
                            enableDamping
                            dampingFactor={0.35}
                            enableRotate={false}
                            enablePan={true}
                            enableZoom={true}
                            zoomToCursor={true}
                            panSpeed={1.0}
                            zoomSpeed={1.0}
                            screenSpacePanning={true}
                            mouseButtons={{
                                LEFT: THREE.MOUSE.PAN,
                                MIDDLE: THREE.MOUSE.DOLLY,
                                RIGHT: THREE.MOUSE.PAN,
                            }}
                        />
                        <Scene2DContent
                            points={points}
                            shapes={shapes}
                            liveData={liveData}
                            selectedIds={selectedIds}
                            hoveredId={hoveredId}
                            onPointClick={onPointClick}
                            onPointHover={onPointHover}
                            viewPlane={viewPlane}
                            pointSize={pointSize}
                            selectedModelNames={selectedModelNames}
                        />
                    </Canvas>
                </Box>
            )}
        </Box>
    );
};
