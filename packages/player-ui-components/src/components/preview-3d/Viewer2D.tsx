import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrthographicCamera, Grid, MapControls } from '@react-three/drei';
import * as THREE from 'three';
import { useTheme, Typography } from '@mui/material';
import { Box } from '../box/Box';
import type { Point3D, Shape3D, PointColorData } from '../../types/model3d';

export interface Viewer2DProps {
    points: Point3D[];
    shapes?: Shape3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    className?: string;
    viewPlane?: 'xy' | 'xz' | 'yz';
    showGrid?: boolean;
    pointSize?: number;
    selectedModelNames?: Set<string>;
    /**
     * Phase shift (in pixels/points, not bytes) for the procedural color pattern.
     * Changing this value updates point colors in real time.
     */
    colorStartOffset?: number;
}

// Optimized 2D point cloud rendering using THREE.Points
function generateProceduralColorBuffer(pointCount: number, period: number, startOffset: number): Uint8Array {
    const colors = new Uint8Array(pointCount * 3);
    const safePeriod = Math.max(1, Math.floor(period));
    const half = safePeriod / 2;

    const triangle = (t: number) => {
        // Linear ramp 0 -> 255 -> 0 over one period.
        const tt = ((t % safePeriod) + safePeriod) % safePeriod;
        const v = tt <= half ? (tt / half) * 255 : ((safePeriod - tt) / half) * 255;
        const clamped = Math.min(255, Math.max(0, v));
        return Math.round(clamped);
    };

    const offset = Math.floor(startOffset);
    const phaseG = Math.floor(safePeriod / 3);
    const phaseB = Math.floor((safePeriod * 2) / 3);

    for (let i = 0; i < pointCount; i++) {
        const p = i + offset;
        colors[i * 3] = triangle(p);
        colors[i * 3 + 1] = triangle(p + phaseG);
        colors[i * 3 + 2] = triangle(p + phaseB);
    }

    return colors;
}

function Optimized2DPointCloud({
    points,
    selectedIds,
    hoveredId,
    colorData: _colorData,
    pointSize,
    viewPlane,
    selectedModelNames,
    colorStartOffset = 150,
}: {
    points: Point3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    pointSize?: number;
    viewPlane: 'xy' | 'xz' | 'yz';
    selectedModelNames?: Set<string>;
    colorStartOffset?: number;
}) {
    const selectedPointsRef = useRef<THREE.Points>(null);
    const nonSelectedPointsRef = useRef<THREE.Points>(null);
    const selectedBufferGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const nonSelectedBufferGeometryRef = useRef<THREE.BufferGeometry | null>(null);

    // Separate points into selected and non-selected for better visual feedback
    // Track original indices to preserve correct procedural colors
    const { selectedPoints, nonSelectedPoints, selectedOriginalIndices, nonSelectedOriginalIndices } = useMemo(() => {
        const selected: Point3D[] = [];
        const nonSelected: Point3D[] = [];
        const selectedIndices: number[] = [];
        const nonSelectedIndices: number[] = [];

        points.forEach((point, originalIndex) => {
            const modelName = point.metadata?.modelName as string | undefined;
            const isModelSelected = modelName && selectedModelNames?.has(modelName);
            const isPointSelected = selectedIds?.has(point.id);

            if (isModelSelected || isPointSelected) {
                selected.push(point);
                selectedIndices.push(originalIndex);
            } else {
                nonSelected.push(point);
                nonSelectedIndices.push(originalIndex);
            }
        });

        return {
            selectedPoints: selected,
            nonSelectedPoints: nonSelected,
            selectedOriginalIndices: selectedIndices,
            nonSelectedOriginalIndices: nonSelectedIndices
        };
    }, [points, selectedIds, selectedModelNames]);

    // Memoize geometry for selected points
    const selectedGeometry = useMemo(() => {
        if (selectedPoints.length === 0) return null;

        const positions = new Float32Array(selectedPoints.length * 3);
        // Generate color buffer for all points to get correct colors, then we'll override selected ones
        const allColors = generateProceduralColorBuffer(points.length, 300, colorStartOffset);
        const colors = new Uint8Array(selectedPoints.length * 3);

        selectedPoints.forEach((point, i) => {
            // Flatten based on view plane
            switch (viewPlane) {
                case 'xy':
                    positions[i * 3] = point.x;
                    positions[i * 3 + 1] = point.y;
                    positions[i * 3 + 2] = 0;
                    break;
                case 'xz':
                    positions[i * 3] = point.x;
                    positions[i * 3 + 1] = 0;
                    positions[i * 3 + 2] = point.z;
                    break;
                case 'yz':
                    positions[i * 3] = 0;
                    positions[i * 3 + 1] = point.y;
                    positions[i * 3 + 2] = point.z;
                    break;
            }

            // Use original index to get the correct procedural color for this point
            // This ensures colors don't change when models are selected/deselected
            const originalIndex = selectedOriginalIndices[i];
            const baseColorIndex = originalIndex * 3;
            colors[i * 3] = allColors[baseColorIndex];
            colors[i * 3 + 1] = allColors[baseColorIndex + 1];
            colors[i * 3 + 2] = allColors[baseColorIndex + 2];

            // Highlight selected models in yellow
            const modelName = point.metadata?.modelName as string | undefined;
            const isModelSelected = modelName && selectedModelNames?.has(modelName);
            const isPointSelected = selectedIds?.has(point.id);

            // Only color points that are actually selected (by model or individually)
            // This prevents color bleeding to non-selected models
            if (isModelSelected || isPointSelected) {
                colors[i * 3] = 255;
                colors[i * 3 + 1] = 255;
                colors[i * 3 + 2] = 0;
            } else if (hoveredId === point.id) {
                // Hovered points get cyan color
                colors[i * 3] = 0;
                colors[i * 3 + 1] = 255;
                colors[i * 3 + 2] = 255;
            }
            // If point is neither selected nor hovered, it keeps the procedural color from original index
        });

        return { positions, colors };
    }, [selectedPoints, selectedIds, hoveredId, viewPlane, selectedModelNames, colorStartOffset, selectedOriginalIndices, points.length]);

    // Memoize geometry for non-selected points
    const nonSelectedGeometry = useMemo(() => {
        if (nonSelectedPoints.length === 0) return null;

        const positions = new Float32Array(nonSelectedPoints.length * 3);
        // Generate color buffer for all points to get correct colors
        const allColors = generateProceduralColorBuffer(points.length, 300, colorStartOffset);
        const colors = new Uint8Array(nonSelectedPoints.length * 3);

        nonSelectedPoints.forEach((point, i) => {
            // Flatten based on view plane
            switch (viewPlane) {
                case 'xy':
                    positions[i * 3] = point.x;
                    positions[i * 3 + 1] = point.y;
                    positions[i * 3 + 2] = 0;
                    break;
                case 'xz':
                    positions[i * 3] = point.x;
                    positions[i * 3 + 1] = 0;
                    positions[i * 3 + 2] = point.z;
                    break;
                case 'yz':
                    positions[i * 3] = 0;
                    positions[i * 3 + 1] = point.y;
                    positions[i * 3 + 2] = point.z;
                    break;
            }

            // Use original index to get the correct procedural color for this point
            // This ensures colors don't change when other models are selected/deselected
            const originalIndex = nonSelectedOriginalIndices[i];
            const baseColorIndex = originalIndex * 3;
            colors[i * 3] = allColors[baseColorIndex];
            colors[i * 3 + 1] = allColors[baseColorIndex + 1];
            colors[i * 3 + 2] = allColors[baseColorIndex + 2];

            if (hoveredId === point.id) {
                colors[i * 3] = 0;
                colors[i * 3 + 1] = 255;
                colors[i * 3 + 2] = 255;
            }
        });

        return { positions, colors };
    }, [nonSelectedPoints, hoveredId, viewPlane, colorStartOffset, nonSelectedOriginalIndices, points.length]);

    const createOrUpdateBufferGeometry = useCallback(
        (
            geometryRef: React.MutableRefObject<THREE.BufferGeometry | null>,
            positions: Float32Array,
            colors: Uint8Array
        ): THREE.BufferGeometry => {
            const pointCount = positions.length / 3;
            const existing = geometryRef.current;

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

            const geometry = new THREE.BufferGeometry();
            const posAttr = new THREE.BufferAttribute(positions, 3);
            const colAttr = new THREE.BufferAttribute(colors, 3, true);

            posAttr.setUsage(THREE.DynamicDrawUsage);
            colAttr.setUsage(THREE.DynamicDrawUsage);

            geometry.setAttribute('position', posAttr);
            geometry.setAttribute('color', colAttr);
            geometryRef.current = geometry;
            return geometry;
        },
        []
    );

    const selectedBufferGeometry = useMemo(() => {
        if (!selectedGeometry) return null;
        return createOrUpdateBufferGeometry(
            selectedBufferGeometryRef,
            selectedGeometry.positions,
            selectedGeometry.colors
        );
    }, [selectedGeometry, createOrUpdateBufferGeometry]);

    const nonSelectedBufferGeometry = useMemo(() => {
        if (!nonSelectedGeometry) return null;
        return createOrUpdateBufferGeometry(
            nonSelectedBufferGeometryRef,
            nonSelectedGeometry.positions,
            nonSelectedGeometry.colors
        );
    }, [nonSelectedGeometry, createOrUpdateBufferGeometry]);

    useEffect(() => {
        return () => {
            selectedBufferGeometryRef.current?.dispose();
            nonSelectedBufferGeometryRef.current?.dispose();
            selectedBufferGeometryRef.current = null;
            nonSelectedBufferGeometryRef.current = null;
        };
    }, []);

    const baseSize = pointSize || 3.0;

    // Create unique keys for proper re-rendering
    const selectedKey = useMemo(() => {
        const modelNames = selectedModelNames ? Array.from(selectedModelNames).sort().join('-') : 'none';
        return `selected-2d-${selectedPoints.length}-${modelNames}`;
    }, [selectedPoints.length, selectedModelNames]);

    const nonSelectedKey = useMemo(() => {
        const modelNames = selectedModelNames ? Array.from(selectedModelNames).sort().join('-') : 'none';
        return `nonselected-2d-${nonSelectedPoints.length}-${modelNames}`;
    }, [nonSelectedPoints.length, selectedModelNames]);

    return (
        <>
            {/* Selected points */}
            {selectedBufferGeometry && selectedPoints.length > 0 && (
                <points key={selectedKey} ref={selectedPointsRef} geometry={selectedBufferGeometry}>
                    <pointsMaterial
                        size={baseSize}
                        vertexColors
                        sizeAttenuation={false}
                        transparent={false}
                        depthWrite={true}
                    />
                </points>
            )}

            {/* Non-selected points */}
            {nonSelectedBufferGeometry && nonSelectedPoints.length > 0 && (
                <points key={nonSelectedKey} ref={nonSelectedPointsRef} geometry={nonSelectedBufferGeometry}>
                    <pointsMaterial
                        size={baseSize}
                        vertexColors
                        sizeAttenuation={false}
                        transparent={false}
                        depthWrite={true}
                    />
                </points>
            )}
        </>
    );
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
        [onClick, shape.id]
    );

    const handlePointerOver = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHover(shape.id);
        },
        [onHover, shape.id]
    );

    const handlePointerOut = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHover(null);
        },
        [onHover]
    );

    return (
        <mesh position={position} onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
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
                    : new THREE.Vector3(0, 0, 0)
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

function Scene2DContent({
    points,
    shapes,
    selectedIds,
    hoveredId,
    colorData,
    onPointClick,
    onPointHover,
    viewPlane,
    pointSize,
    selectedModelNames,
    colorStartOffset,
}: {
    points: Point3D[];
    shapes?: Shape3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    viewPlane: 'xy' | 'xz' | 'yz';
    pointSize?: number;
    selectedModelNames?: Set<string>;
    colorStartOffset?: number;
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
                selectedIds={selectedIds}
                hoveredId={hoveredId}
                colorData={colorData}
                pointSize={pointSize}
                viewPlane={viewPlane}
                selectedModelNames={selectedModelNames}
                colorStartOffset={colorStartOffset}
            />
        </>
    );
}

export const Viewer2D: React.FC<Viewer2DProps> = ({
    points,
    shapes,
    selectedIds,
    hoveredId,
    colorData,
    onPointClick,
    onPointHover,
    className,
    viewPlane = 'xy',
    showGrid = true,
    pointSize = 3.0,
    selectedModelNames,
    colorStartOffset = 0,
}) => {
    const theme = useTheme();
    const [error, setError] = useState<string | null>(null);

    return (
        <Box
            className={className}
            sx={{
                width: '100%',
                height: '100%',
                minHeight: 600,
                position: 'relative',
                backgroundColor: '#000',
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
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                        Controls:
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                        🖱️ Left drag: Pan
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                        🖱️ Right drag: Pan
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
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
                            dampingFactor={0.05}
                            enableRotate={false}
                            enablePan={true}
                            enableZoom={true}
                            panSpeed={1.0}
                            zoomSpeed={1.0}
                            screenSpacePanning={true}
                            mouseButtons={{
                                LEFT: THREE.MOUSE.PAN,
                                MIDDLE: THREE.MOUSE.DOLLY,
                                RIGHT: THREE.MOUSE.PAN
                            }}
                        />
                        {showGrid && <Grid args={[200, 200]} cellColor={theme.palette.divider} sectionColor={theme.palette.text.secondary} />}
                        <Scene2DContent
                            points={points}
                            shapes={shapes}
                            selectedIds={selectedIds}
                            hoveredId={hoveredId}
                            colorData={colorData}
                            onPointClick={onPointClick}
                            onPointHover={onPointHover}
                            viewPlane={viewPlane}
                            pointSize={pointSize}
                            selectedModelNames={selectedModelNames}
                            colorStartOffset={colorStartOffset}
                        />
                    </Canvas>
                </Box>
            )}
        </Box>
    );
};

