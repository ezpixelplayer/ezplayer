import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { useTheme, Typography } from '@mui/material';
import { Box } from '../box/Box';
import type { Point3D, Shape3D, PointColorData } from '../../types/model3d';

export interface Viewer3DProps {
    points: Point3D[];
    shapes?: Shape3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    className?: string;
    showGrid?: boolean;
    showStats?: boolean;
    pointSize?: number;
    selectedModelNames?: Set<string>;
}

// PointMesh component removed - using optimized point cloud rendering instead

interface ShapeMeshProps {
    shape: Shape3D;
    isSelected: boolean;
    isHovered: boolean;
    onClick: (shapeId: string) => void;
    onHover: (shapeId: string | null) => void;
}

function ShapeMesh({ shape, isSelected, isHovered, onClick, onHover }: ShapeMeshProps) {
    const meshRef = useRef<THREE.Mesh>(null);

    const geometry = useMemo(() => {
        switch (shape.type) {
            case 'box':
                return <boxGeometry args={[1, 1, 1]} />;
            case 'sphere':
                return <sphereGeometry args={[0.5, 16, 16]} />;
            case 'cylinder':
                return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
            case 'plane':
                return <planeGeometry args={[1, 1]} />;
            default:
                return <boxGeometry args={[1, 1, 1]} />;
        }
    }, [shape.type]);

    const scale = shape.scale || { x: 1, y: 1, z: 1 };
    const rotation = shape.rotation || { x: 0, y: 0, z: 0 };
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
        <mesh
            ref={meshRef}
            position={[shape.position.x, shape.position.y, shape.position.z]}
            rotation={[rotation.x, rotation.y, rotation.z]}
            scale={[scale.x, scale.y, scale.z]}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
        >
            {geometry}
            <meshStandardMaterial color={color} wireframe={isSelected || isHovered} />
        </mesh>
    );
}

// Optimized point cloud rendering using THREE.Points
function OptimizedPointCloud({
    points,
    selectedIds,
    hoveredId,
    colorData,
    pointSize,
    selectedModelNames,
}: {
    points: Point3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    pointSize?: number;
    selectedModelNames?: Set<string>;
    onPointClick?: (pointId: string) => void;
}) {
    const selectedPointsRef = useRef<THREE.Points>(null);
    const nonSelectedPointsRef = useRef<THREE.Points>(null);
    const materialRef = useRef<THREE.PointsMaterial>(null);
    const animationTimeRef = useRef(0);

    // Reset animation time when selected models change
    useEffect(() => {
        animationTimeRef.current = 0;
    }, [selectedModelNames]);

    // Separate points into selected and non-selected for animation
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

    // Memoize geometry for selected points (with animation)
    const selectedGeometry = useMemo(() => {
        if (selectedPoints.length === 0) return null;

        const positions = new Float32Array(selectedPoints.length * 3);
        const colors = new Float32Array(selectedPoints.length * 3);

        selectedPoints.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;

            let color = new THREE.Color(point.color || '#00ff00');

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
    }, [selectedPoints, selectedIds, hoveredId, colorData, selectedModelNames]);

    // Memoize geometry for non-selected points
    const nonSelectedGeometry = useMemo(() => {
        if (nonSelectedPoints.length === 0) return null;

        const positions = new Float32Array(nonSelectedPoints.length * 3);
        const colors = new Float32Array(nonSelectedPoints.length * 3);

        nonSelectedPoints.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;

            let color = new THREE.Color(point.color || '#00ff00');

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
    }, [nonSelectedPoints, hoveredId, colorData]);

    // Animate selected model points with pulsing effect
    useFrame((_state, delta) => {
        if (materialRef.current && selectedModelNames && selectedModelNames.size > 0) {
            animationTimeRef.current += delta;
            const baseSize = pointSize || 3.0;

            // Create a pulsing animation for selected models
            const pulseSpeed = 2.0;
            const pulseAmount = 0.3;
            const pulse = 1.0 + Math.sin(animationTimeRef.current * pulseSpeed) * pulseAmount;

            // Apply animation to selected points
            materialRef.current.size = baseSize * pulse;
        } else if (materialRef.current) {
            // Smoothly return to base size when no model is selected
            const baseSize = pointSize || 3.0;
            if (Math.abs(materialRef.current.size - baseSize) > 0.01) {
                materialRef.current.size = THREE.MathUtils.lerp(materialRef.current.size, baseSize, 0.1);
            } else {
                materialRef.current.size = baseSize;
            }
        }
    });

    const baseSize = pointSize || 3.0;

    // Create a unique key that includes model names to force recreation when switching models
    const selectedKey = useMemo(() => {
        const modelNames = selectedModelNames ? Array.from(selectedModelNames).sort().join('-') : 'none';
        return `selected-${selectedPoints.length}-${modelNames}`;
    }, [selectedPoints.length, selectedModelNames]);

    const nonSelectedKey = useMemo(() => {
        const modelNames = selectedModelNames ? Array.from(selectedModelNames).sort().join('-') : 'none';
        return `nonselected-${nonSelectedPoints.length}-${modelNames}`;
    }, [nonSelectedPoints.length, selectedModelNames]);

    return (
        <>
            {/* Selected points with animation */}
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
                        ref={materialRef}
                        size={baseSize}
                        vertexColors
                        sizeAttenuation={true}
                        transparent={false}
                        depthWrite={true}
                    />
                </points>
            )}

            {/* Non-selected points - static */}
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
                        sizeAttenuation={true}
                        transparent={false}
                        depthWrite={true}
                    />
                </points>
            )}
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
    }, [onPointClick, points, raycaster, camera, gl, pointSize]);

    return null;
}

function SceneContent({
    points,
    shapes,
    selectedIds,
    hoveredId,
    colorData,
    onPointClick,
    onPointHover,
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
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <pointLight position={[-10, -10, -10]} intensity={0.5} />

            {shapes?.map((shape) => (
                <ShapeMesh
                    key={shape.id}
                    shape={shape}
                    isSelected={selectedIds?.has(shape.id) ?? false}
                    isHovered={hoveredId === shape.id}
                    onClick={onPointClick || (() => { })}
                    onHover={onPointHover || (() => { })}
                />
            ))}

            <OptimizedPointCloud
                points={points}
                selectedIds={selectedIds}
                hoveredId={hoveredId}
                colorData={colorData}
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
    selectedIds,
    hoveredId,
    colorData,
    onPointClick,
    onPointHover,
    className,
    showGrid = true,
    showStats = false,
    pointSize = 0.1,
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
            <Box
                sx={{
                    position: 'absolute',
                    bottom: 16,
                    left: 16,
                    zIndex: 10,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: 1,
                    fontSize: '0.75rem',
                    pointerEvents: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                }}
            >
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'white' }}>
                    Controls:
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
                    🖱️ Left drag: Rotate
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
                    🖱️ Right drag: Pan
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.9)' }}>
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
                >
                    <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={75} near={0.1} far={50000} />
                    <OrbitControls
                        enableDamping
                        dampingFactor={0.05}
                        minDistance={10}
                        maxDistance={10000}
                        enablePan={true}
                        enableRotate={true}
                        enableZoom={true}
                        panSpeed={1.0}
                        rotateSpeed={1.0}
                        zoomSpeed={1.0}
                        mouseButtons={{
                            LEFT: THREE.MOUSE.ROTATE,
                            MIDDLE: THREE.MOUSE.DOLLY,
                            RIGHT: THREE.MOUSE.PAN
                        }}
                        touches={{
                            ONE: THREE.TOUCH.ROTATE,
                            TWO: THREE.TOUCH.DOLLY_PAN
                        }}
                    />
                    {showGrid && <Grid args={[200, 200]} cellColor={theme.palette.divider} sectionColor={theme.palette.text.secondary} />}
                    <SceneContent
                        points={points}
                        shapes={shapes}
                        selectedIds={selectedIds}
                        hoveredId={hoveredId}
                        colorData={colorData}
                        onPointClick={onPointClick}
                        onPointHover={onPointHover}
                        pointSize={pointSize}
                        selectedModelNames={selectedModelNames}
                    />
                    {showStats && <Stats />}
                </Canvas>
            )}
        </Box>
    );
};

