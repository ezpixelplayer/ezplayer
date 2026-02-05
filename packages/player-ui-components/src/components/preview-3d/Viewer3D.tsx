import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import type { Point3D, Shape3D } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { getPointColor } from './viewerUtils';

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

// Interface for model data grouped by model name
interface ModelData {
    modelName: string;
    points: Point3D[];
    originalIndices: number[]; // Original indices in the full points array
    startIndex: number; // Start index in the full points array for live data mapping
}

// Individual model point cloud component
function ModelPointCloud({
    modelData,
    allPointsCount,
    allPoints,
    liveData,
    selectedIds,
    hoveredId,
    pointSize,
    isModelSelected,
    animationTime,
    selectedModelNames,
}: {
    modelData: ModelData;
    allPointsCount: number;
    allPoints: Point3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    pointSize?: number;
    isModelSelected: boolean;
    animationTime: React.MutableRefObject<number>;
    selectedModelNames?: Set<string>;
}) {
    const pointsRef = useRef<THREE.Points>(null);
    const materialRef = useRef<THREE.PointsMaterial>(null);
    const bufferGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const colorAttributeRef = useRef<THREE.BufferAttribute | null>(null);
    const pointsDataRef = useRef<{ point: Point3D; originalIndex: number }[]>([]);

    // Keep liveData in a ref so useFrame callback always has current value
    const liveDataRef = useRef<LatestFrameRingBuffer | undefined>(liveData);
    useEffect(() => {
        liveDataRef.current = liveData;
    }, [liveData]);

    // Store point data for per-frame color updates
    useEffect(() => {
        pointsDataRef.current = modelData.points.map((point, i) => ({
            point,
            originalIndex: modelData.originalIndices[i],
        }));
    }, [modelData]);


    // Memoize geometry for this model's points
    const geometry = useMemo(() => {
        if (modelData.points.length === 0) return null;

        const positions = new Float32Array(modelData.points.length * 3);
        const colors = new Uint8Array(modelData.points.length * 3);

        // Pre-compute hovered model name once (performance optimization)
        let hoveredModelName: string | null = null;
        if (hoveredId && allPoints) {
            const hoveredPoint = allPoints.find((p) => p.id === hoveredId);
            if (hoveredPoint) {
                hoveredModelName = (hoveredPoint.metadata?.modelName as string | undefined) || null;
            }
        }

        modelData.points.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;

            // Use original index to get the correct procedural color for this point
            const originalIndex = modelData.originalIndices[i];

            // Use optimized color calculation logic
            const [r, g, b] = getPointColor(point, originalIndex, {
                selectedIds,
                hoveredId,
                hoveredModelName,
                selectedModelNames,
                allPointsCount,
            });
            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        });

        return { positions, colors };
    }, [modelData, selectedIds, hoveredId, allPointsCount, allPoints, selectedModelNames]);

    const createOrUpdateBufferGeometry = useCallback(
        (
            geometryRef: React.MutableRefObject<THREE.BufferGeometry | null>,
            positions: Float32Array,
            colors: Uint8Array,
        ): THREE.BufferGeometry => {
            const pointCount = positions.length / 3;
            const existing = geometryRef.current;

            // Reuse geometry + typed arrays when the point count is unchanged; otherwise recreate.
            if (
                existing &&
                (existing.getAttribute('position') as THREE.BufferAttribute | undefined)?.count === pointCount &&
                (existing.getAttribute('color') as THREE.BufferAttribute | undefined)?.count === pointCount
            ) {
                const posAttr = existing.getAttribute('position') as THREE.BufferAttribute;
                const colAttr = existing.getAttribute('color') as THREE.BufferAttribute;

                (posAttr.array as Float32Array).set(positions);

                // Copy color values element-by-element to handle normalized Uint8Array correctly
                const colorArray = colAttr.array as Uint8Array;
                for (let i = 0; i < colors.length; i++) {
                    colorArray[i] = colors[i];
                }

                posAttr.needsUpdate = true;
                colAttr.needsUpdate = true;
                return existing;
            }

            if (existing) existing.dispose();

            const newGeometry = new THREE.BufferGeometry();
            const posAttr = new THREE.BufferAttribute(positions, 3);
            const colAttr = new THREE.BufferAttribute(colors, 3, true);

            // Hint Three.js that these attributes may be updated frequently
            posAttr.setUsage(THREE.DynamicDrawUsage);
            colAttr.setUsage(THREE.DynamicDrawUsage);

            newGeometry.setAttribute('position', posAttr);
            newGeometry.setAttribute('color', colAttr);
            geometryRef.current = newGeometry;
            return newGeometry;
        },
        [],
    );

    // Keep BufferGeometry instance stable and update its attributes in-place when data changes
    const bufferGeometry = useMemo(() => {
        if (!geometry) return null;
        return createOrUpdateBufferGeometry(bufferGeometryRef, geometry.positions, geometry.colors);
    }, [geometry, createOrUpdateBufferGeometry]);

    // Store color attribute reference for per-frame updates
    useEffect(() => {
        const timer = setTimeout(() => {
            if (bufferGeometryRef.current) {
                const attr = bufferGeometryRef.current.getAttribute('color') as THREE.BufferAttribute | null;
                if (attr) {
                    colorAttributeRef.current = attr;
                }
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [bufferGeometry]);

    // Dispose geometry on unmount
    useEffect(() => {
        return () => {
            bufferGeometryRef.current?.dispose();
            bufferGeometryRef.current = null;
        };
    }, []);

    // Animate selected model points with pulsing effect and update colors per frame
    useFrame((_state) => {
        const t = animationTime.current;

        // Check if this model is hovered (any point in the model belongs to hovered model)
        // Pre-compute hovered model name once for performance
        let hoveredModelName: string | null = null;
        if (hoveredId && allPoints) {
            const hoveredPoint = allPoints.find((p) => p.id === hoveredId);
            if (hoveredPoint) {
                hoveredModelName = (hoveredPoint.metadata?.modelName as string | undefined) || null;
            }
        }
        const hasHoveredPoint = hoveredModelName && modelData.points.length > 0
            ? modelData.points[0].metadata?.modelName === hoveredModelName
            : false;

        // Update point size animation for selected models
        if (materialRef.current && isModelSelected) {
            const baseSize = pointSize || 3.0;
            const pulseSpeed = 2.0;
            const pulseAmount = 0.3;
            const pulse = 1.0 + Math.sin(t * pulseSpeed) * pulseAmount;
            materialRef.current.size = baseSize * pulse;
        } else if (materialRef.current && hasHoveredPoint) {
            // Increase size for hovered points
            const baseSize = pointSize || 3.0;
            materialRef.current.size = baseSize * 1.5;
        } else if (materialRef.current) {
            // Smoothly return to base size when not selected or hovered
            const baseSize = pointSize || 3.0;
            if (Math.abs(materialRef.current.size - baseSize) > 0.01) {
                materialRef.current.size = THREE.MathUtils.lerp(materialRef.current.size, baseSize, 0.1);
            } else {
                materialRef.current.size = baseSize;
            }
        }

        // Update colors per frame
        if (bufferGeometryRef.current && pointsDataRef.current.length > 0) {
            const colorAttr = bufferGeometryRef.current.getAttribute('color') as THREE.BufferAttribute | null;
            if (colorAttr) {
                const colorArray = colorAttr.array as Uint8Array;
                const currentLiveData = liveDataRef.current;
                const ld = currentLiveData?.tryReadLatest(0)?.bytes;

                // Pre-compute hovered model name once (performance optimization)
                let hoveredModelName: string | null = null;
                if (hoveredId && allPoints) {
                    const hoveredPoint = allPoints.find((p) => p.id === hoveredId);
                    if (hoveredPoint) {
                        hoveredModelName = (hoveredPoint.metadata?.modelName as string | undefined) || null;
                    }
                }

                if (ld) {
                    // Use live data - map from all points array to this model's points
                    pointsDataRef.current.forEach(({ point, originalIndex }, i) => {
                        // Skip if selected (hovered colors are updated here, not skipped)
                        if (selectedIds?.has(point.id) || isModelSelected) return;

                        // Use optimized color calculation with pre-computed hoveredModelName
                        const [r, g, b] = getPointColor(point, originalIndex, {
                            selectedIds,
                            hoveredId,
                            hoveredModelName,
                            selectedModelNames,
                            liveData: currentLiveData,
                            allPointsCount,
                        });

                        const modelColorIndex = i * 3;
                        colorArray[modelColorIndex] = r;
                        colorArray[modelColorIndex + 1] = g;
                        colorArray[modelColorIndex + 2] = b;
                    });
                } else {
                    // Use procedural colors with shared calculation logic
                    pointsDataRef.current.forEach(({ point, originalIndex }, i) => {
                        // Skip if selected (hovered colors are updated here, not skipped)
                        if (selectedIds?.has(point.id) || isModelSelected) return;

                        // Use optimized color calculation with pre-computed hoveredModelName
                        const [r, g, b] = getPointColor(point, originalIndex, {
                            selectedIds,
                            hoveredId,
                            hoveredModelName,
                            selectedModelNames,
                            time: t,
                            allPointsCount,
                        });

                        const colorIndex = i * 3;
                        colorArray[colorIndex] = r;
                        colorArray[colorIndex + 1] = g;
                        colorArray[colorIndex + 2] = b;
                    });
                }

                colorAttr.needsUpdate = true;
            }
        }
    });

    const baseSize = pointSize || 3.0;

    if (!bufferGeometry || modelData.points.length === 0) return null;

    return (
        <points ref={pointsRef} geometry={bufferGeometry}>
            <pointsMaterial
                ref={materialRef}
                size={baseSize}
                vertexColors
                sizeAttenuation={false}
                transparent={false}
                depthWrite={true}
            />
        </points>
    );
}

// Optimized point cloud rendering using per-model point clouds
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

    // Reset animation time when selected models change
    useEffect(() => {
        animationTimeRef.current = 0;
    }, [selectedModelNames]);

    // Group points by model name
    const modelsData = useMemo(() => {
        const modelMap = new Map<string, ModelData>();

        points.forEach((point, originalIndex) => {
            const modelName = point.metadata?.modelName as string | undefined;
            const key = modelName || 'unknown';

            if (!modelMap.has(key)) {
                modelMap.set(key, {
                    modelName: key,
                    points: [],
                    originalIndices: [],
                    startIndex: originalIndex,
                });
            }

            const modelData = modelMap.get(key)!;
            modelData.points.push(point);
            modelData.originalIndices.push(originalIndex);
        });

        return Array.from(modelMap.values());
    }, [points]);

    // Update animation time in useFrame
    useFrame((_state, delta) => {
        animationTimeRef.current += delta;
    });

    return (
        <>
            {modelsData.map((modelData) => {
                const isModelSelected = selectedModelNames?.has(modelData.modelName) || false;
                return (
                    <ModelPointCloud
                        key={modelData.modelName}
                        modelData={modelData}
                        allPointsCount={points.length}
                        allPoints={points}
                        liveData={liveData}
                        selectedIds={selectedIds}
                        hoveredId={hoveredId}
                        pointSize={pointSize}
                        isModelSelected={isModelSelected}
                        animationTime={animationTimeRef}
                        selectedModelNames={selectedModelNames}
                    />
                );
            })}
        </>
    );
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

    useEffect(() => {
        if (!onPointHover) return;

        const handleMouseMove = (event: MouseEvent) => {
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
            // Use a more generous threshold for hover detection (increased for better visibility)
            const cameraDistance = camera.position.distanceTo(
                points.length > 0
                    ? new THREE.Vector3(points[0].x, points[0].y, points[0].z)
                    : new THREE.Vector3(0, 0, 0),
            );
            const threshold = Math.max(pointSizeValue * 0.15, cameraDistance * 0.02);

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

            // If a point was found, trigger hover handler
            if (closestIndex >= 0 && closestIndex < points.length) {
                onPointHover(points[closestIndex].id);
            } else {
                // No point found, clear hover
                onPointHover(null);
            }
        };

        const handleMouseLeave = () => {
            // Clear hover when mouse leaves the canvas
            onPointHover(null);
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
                    backgroundColor: '#000',
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
                backgroundColor: '#000',
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
