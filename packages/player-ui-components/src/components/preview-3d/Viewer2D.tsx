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
}

// Optimized 2D point cloud rendering using THREE.Points
function Optimized2DPointCloud({
    points,
    selectedIds,
    hoveredId,
    colorData,
    pointSize,
    viewPlane,
    selectedModelNames,
}: {
    points: Point3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    pointSize?: number;
    viewPlane: 'xy' | 'xz' | 'yz';
    selectedModelNames?: Set<string>;
}) {
    const selectedPointsRef = useRef<THREE.Points>(null);
    const nonSelectedPointsRef = useRef<THREE.Points>(null);

    // Separate points into selected and non-selected for better visual feedback
    const { selectedPoints, nonSelectedPoints } = useMemo(() => {
        const selected: Point3D[] = [];
        const nonSelected: Point3D[] = [];

        points.forEach((point) => {
            const modelName = point.metadata?.modelName as string | undefined;
            const isModelSelected = modelName && selectedModelNames?.has(modelName);
            const isPointSelected = selectedIds?.has(point.id);

            if (isModelSelected || isPointSelected) {
                selected.push(point);
            } else {
                nonSelected.push(point);
            }
        });

        return { selectedPoints: selected, nonSelectedPoints: nonSelected };
    }, [points, selectedIds, selectedModelNames]);

    // Memoize geometry for selected points
    const selectedGeometry = useMemo(() => {
        if (selectedPoints.length === 0) return null;

        const positions = new Float32Array(selectedPoints.length * 3);
        const colors = new Float32Array(selectedPoints.length * 3);

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

            // Parse color
            let color = new THREE.Color(point.color || '#00ff00');

            // Apply colorData if available
            if (colorData) {
                const pointColorData = colorData.find((cd) => cd.pointId === point.id);
                if (pointColorData) {
                    color = new THREE.Color(pointColorData.color);
                }
            }

            // Highlight selected models in yellow
            const modelName = point.metadata?.modelName as string | undefined;
            const isModelSelected = modelName && selectedModelNames?.has(modelName);

            if (isModelSelected || selectedIds?.has(point.id)) {
                color = new THREE.Color('#ffff00');
            } else if (hoveredId === point.id) {
                color = new THREE.Color('#00ffff');
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        });

        return { positions, colors };
    }, [selectedPoints, selectedIds, hoveredId, colorData, viewPlane, selectedModelNames]);

    // Memoize geometry for non-selected points
    const nonSelectedGeometry = useMemo(() => {
        if (nonSelectedPoints.length === 0) return null;

        const positions = new Float32Array(nonSelectedPoints.length * 3);
        const colors = new Float32Array(nonSelectedPoints.length * 3);

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

            // Parse color
            let color = new THREE.Color(point.color || '#00ff00');

            // Apply colorData if available
            if (colorData) {
                const pointColorData = colorData.find((cd) => cd.pointId === point.id);
                if (pointColorData) {
                    color = new THREE.Color(pointColorData.color);
                }
            }

            if (hoveredId === point.id) {
                color = new THREE.Color('#00ffff');
            }

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        });

        return { positions, colors };
    }, [nonSelectedPoints, hoveredId, colorData, viewPlane]);

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
            {selectedGeometry && selectedPoints.length > 0 && (
                <points key={selectedKey} ref={selectedPointsRef}>
                    <bufferGeometry>
                        <bufferAttribute
                            attach="attributes-position"
                            count={selectedPoints.length}
                            array={selectedGeometry.positions}
                            itemSize={3}
                        />
                        <bufferAttribute
                            attach="attributes-color"
                            count={selectedPoints.length}
                            array={selectedGeometry.colors}
                            itemSize={3}
                        />
                    </bufferGeometry>
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
            {nonSelectedGeometry && nonSelectedPoints.length > 0 && (
                <points key={nonSelectedKey} ref={nonSelectedPointsRef}>
                    <bufferGeometry>
                        <bufferAttribute
                            attach="attributes-position"
                            count={nonSelectedPoints.length}
                            array={nonSelectedGeometry.positions}
                            itemSize={3}
                        />
                        <bufferAttribute
                            attach="attributes-color"
                            count={nonSelectedPoints.length}
                            array={nonSelectedGeometry.colors}
                            itemSize={3}
                        />
                    </bufferGeometry>
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
                        />
                    </Canvas>
                </Box>
            )}
        </Box>
    );
};

