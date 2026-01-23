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
    /**
     * Phase shift (in pixels/points, not bytes) for the procedural color pattern.
     * Changing this value updates point colors in real time.
     */
    colorStartOffset?: number;
}

// PointMesh component removed - using optimized point cloud rendering instead

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
    colorData: _colorData,
    pointSize,
    selectedModelNames,
    colorStartOffset = 0,
}: {
    points: Point3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    pointSize?: number;
    selectedModelNames?: Set<string>;
    onPointClick?: (pointId: string) => void;
    colorStartOffset?: number;
}) {
    const selectedPointsRef = useRef<THREE.Points>(null);
    const nonSelectedPointsRef = useRef<THREE.Points>(null);
    const materialRef = useRef<THREE.PointsMaterial>(null);
    const selectedBufferGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const nonSelectedBufferGeometryRef = useRef<THREE.BufferGeometry | null>(null);
    const animationTimeRef = useRef(0);
    const colorOffsetRef = useRef(colorStartOffset);
    const selectedColorAttributeRef = useRef<THREE.BufferAttribute | null>(null);
    const nonSelectedColorAttributeRef = useRef<THREE.BufferAttribute | null>(null);
    const selectedPointsDataRef = useRef<{ point: Point3D; originalIndex: number }[]>([]);
    const nonSelectedPointsDataRef = useRef<{ point: Point3D; originalIndex: number }[]>([]);

    // Reset animation time when selected models change
    useEffect(() => {
        animationTimeRef.current = 0;
    }, [selectedModelNames]);

    // Update color offset ref when prop changes
    useEffect(() => {
        colorOffsetRef.current = colorStartOffset;
    }, [colorStartOffset]);

    // Separate points into selected and non-selected for animation
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

    // Store point data for per-frame color updates
    useEffect(() => {
        selectedPointsDataRef.current = selectedPoints.map((point, i) => ({
            point,
            originalIndex: selectedOriginalIndices[i],
        }));
        nonSelectedPointsDataRef.current = nonSelectedPoints.map((point, i) => ({
            point,
            originalIndex: nonSelectedOriginalIndices[i],
        }));
    }, [selectedPoints, nonSelectedPoints, selectedOriginalIndices, nonSelectedOriginalIndices]);

    // Memoize geometry for selected points (with animation)
    const selectedGeometry = useMemo(() => {
        if (selectedPoints.length === 0) return null;

        const positions = new Float32Array(selectedPoints.length * 3);
        // Generate color buffer for all points to get correct colors, then we'll override selected ones
        const allColors = generateProceduralColorBuffer(points.length, 300, colorStartOffset);
        const colors = new Uint8Array(selectedPoints.length * 3);

        selectedPoints.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;

            const originalIndex = selectedOriginalIndices[i];
            const modelName = point.metadata?.modelName as string | undefined;
            const isModelSelected = modelName && selectedModelNames?.has(modelName);
            const isPointSelected = selectedIds?.has(point.id);

            // Use original index to get the correct procedural color for this point
            // This ensures colors don't change when models are selected/deselected
            const baseColorIndex = originalIndex * 3;
            colors[i * 3] = allColors[baseColorIndex];
            colors[i * 3 + 1] = allColors[baseColorIndex + 1];
            colors[i * 3 + 2] = allColors[baseColorIndex + 2];

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
    }, [selectedPoints, selectedIds, hoveredId, selectedModelNames, colorStartOffset, selectedOriginalIndices, points.length]);

    // Memoize geometry for non-selected points
    const nonSelectedGeometry = useMemo(() => {
        if (nonSelectedPoints.length === 0) return null;

        const positions = new Float32Array(nonSelectedPoints.length * 3);
        // Generate color buffer for all points to get correct colors
        const allColors = generateProceduralColorBuffer(points.length, 300, colorStartOffset);
        const colors = new Uint8Array(nonSelectedPoints.length * 3);

        nonSelectedPoints.forEach((point, i) => {
            positions[i * 3] = point.x;
            positions[i * 3 + 1] = point.y;
            positions[i * 3 + 2] = point.z;

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
    }, [nonSelectedPoints, hoveredId, colorStartOffset, nonSelectedOriginalIndices, points.length]);

    const createOrUpdateBufferGeometry = useCallback(
        (
            geometryRef: React.MutableRefObject<THREE.BufferGeometry | null>,
            positions: Float32Array,
            colors: Uint8Array
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
                // This ensures color updates are properly applied when colorStartOffset changes
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

            // Hint Three.js that these attributes may be updated frequently (future real-time updates).
            posAttr.setUsage(THREE.DynamicDrawUsage);
            colAttr.setUsage(THREE.DynamicDrawUsage);

            geometry.setAttribute('position', posAttr);
            geometry.setAttribute('color', colAttr);
            geometryRef.current = geometry;
            return geometry;
        },
        []
    );

    // Keep BufferGeometry instances stable and update their attributes in-place when data changes.
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

    // Store color attribute references for per-frame updates
    useEffect(() => {
        // Use a small delay to ensure geometry is fully created
        const timer = setTimeout(() => {
            if (selectedBufferGeometryRef.current) {
                const attr = selectedBufferGeometryRef.current.getAttribute('color') as THREE.BufferAttribute | null;
                if (attr) {
                    selectedColorAttributeRef.current = attr;
                }
            }
            if (nonSelectedBufferGeometryRef.current) {
                const attr = nonSelectedBufferGeometryRef.current.getAttribute('color') as THREE.BufferAttribute | null;
                if (attr) {
                    nonSelectedColorAttributeRef.current = attr;
                }
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [selectedBufferGeometry, nonSelectedBufferGeometry]);

    // Dispose geometries on unmount.
    useEffect(() => {
        return () => {
            selectedBufferGeometryRef.current?.dispose();
            nonSelectedBufferGeometryRef.current?.dispose();
            selectedBufferGeometryRef.current = null;
            nonSelectedBufferGeometryRef.current = null;
        };
    }, []);

    // Triangle wave function for color generation
    const tri = useCallback((t: number) => {
        const HALF = 128;
        const period = HALF * 2;
        const tt = ((t % period) + period) % period;
        const v = tt <= HALF ? (tt / HALF) * 255 : ((period - tt) / HALF) * 255;
        return Math.min(255, Math.max(0, Math.round(v)));
    }, []);

    // Animate selected model points with pulsing effect and update colors per frame
    useFrame((_state, delta) => {
        animationTimeRef.current += delta;
        const t = animationTimeRef.current;
        const offset = colorOffsetRef.current;

        // Update point size animation
        if (materialRef.current && selectedModelNames && selectedModelNames.size > 0) {
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

        // Update colors per frame for ALL points using position-based phase calculations
        const HALF = 128;
        const pulseCenter = ((t * 10) % (HALF * 2)) - HALF;

        // Update non-selected points - get color attribute directly from geometry
        const nonSelectedGeometry = nonSelectedBufferGeometryRef.current;
        if (nonSelectedGeometry && nonSelectedPointsDataRef.current.length > 0) {
            const colorAttr = nonSelectedGeometry.getAttribute('color') as THREE.BufferAttribute | null;
            if (colorAttr) {
                const colorArray = colorAttr.array as Uint8Array;

                nonSelectedPointsDataRef.current.forEach(({ point }, i) => {
                    // Skip if hovered (will be handled by geometry update)
                    if (hoveredId === point.id) return;

                    // Calculate phase: x*13 + y*17 + z*19 + t*90 + offset
                    const phase = point.x * 13 + point.y * 17 + point.z * 19 + t * 90 + offset;

                    // RGB with phase offsets
                    const rPhase = phase;
                    const gPhase = phase + 341;
                    const bPhase = phase + 682;

                    // Calculate pulse effect (boost brightness for points near moving center)
                    const distanceToCenter = Math.abs(phase - pulseCenter);
                    const pulseBoost = distanceToCenter < HALF ? (1 - distanceToCenter / HALF) * 220 : 0;

                    // Generate RGB values
                    let r = tri(rPhase) + pulseBoost;
                    let g = tri(gPhase) + pulseBoost;
                    let b = tri(bPhase) + pulseBoost;

                    // Clamp to valid range
                    r = Math.min(255, Math.max(0, Math.round(r)));
                    g = Math.min(255, Math.max(0, Math.round(g)));
                    b = Math.min(255, Math.max(0, Math.round(b)));

                    const colorIndex = i * 3;
                    colorArray[colorIndex] = r;
                    colorArray[colorIndex + 1] = g;
                    colorArray[colorIndex + 2] = b;
                });

                colorAttr.needsUpdate = true;
            }
        }

        // Update selected points (only non-selected/non-hovered points get animated colors)
        const selectedGeometry = selectedBufferGeometryRef.current;
        if (selectedGeometry && selectedPointsDataRef.current.length > 0) {
            const colorAttr = selectedGeometry.getAttribute('color') as THREE.BufferAttribute | null;
            if (colorAttr) {
                const colorArray = colorAttr.array as Uint8Array;

                selectedPointsDataRef.current.forEach(({ point }, i) => {
                    const modelName = point.metadata?.modelName as string | undefined;
                    const isModelSelected = modelName && selectedModelNames?.has(modelName);
                    const isPointSelected = selectedIds?.has(point.id);

                    // Skip if selected or hovered (these keep their special colors from geometry update)
                    if (isModelSelected || isPointSelected || hoveredId === point.id) return;

                    // Calculate phase: x*13 + y*17 + z*19 + t*90 + offset
                    const phase = point.x * 13 + point.y * 17 + point.z * 19 + t * 90 + offset;

                    // RGB with phase offsets
                    const rPhase = phase;
                    const gPhase = phase + 341;
                    const bPhase = phase + 682;

                    // Calculate pulse effect (boost brightness for points near moving center)
                    const distanceToCenter = Math.abs(phase - pulseCenter);
                    const pulseBoost = distanceToCenter < HALF ? (1 - distanceToCenter / HALF) * 220 : 0;

                    // Generate RGB values
                    let r = tri(rPhase) + pulseBoost;
                    let g = tri(gPhase) + pulseBoost;
                    let b = tri(bPhase) + pulseBoost;

                    // Clamp to valid range
                    r = Math.min(255, Math.max(0, Math.round(r)));
                    g = Math.min(255, Math.max(0, Math.round(g)));
                    b = Math.min(255, Math.max(0, Math.round(b)));

                    const colorIndex = i * 3;
                    colorArray[colorIndex] = r;
                    colorArray[colorIndex + 1] = g;
                    colorArray[colorIndex + 2] = b;
                });

                colorAttr.needsUpdate = true;
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
            {selectedBufferGeometry && selectedPoints.length > 0 && (
                <points key={selectedKey} ref={selectedPointsRef} geometry={selectedBufferGeometry}>
                    <pointsMaterial
                        ref={materialRef}
                        size={baseSize}
                        vertexColors
                        sizeAttenuation={false}
                        transparent={false}
                        depthWrite={true}
                    />
                </points>
            )}

            {/* Non-selected points - static */}
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
    colorStartOffset,
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
    colorStartOffset?: number;
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
                colorStartOffset={colorStartOffset}
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
    pointSize = 1.2,
    selectedModelNames,
    colorStartOffset = 150,
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
                    🖱️ Left drag: Rotate
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
                    🖱️ Right drag: Pan
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}>
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
                            colorStartOffset={colorStartOffset}
                        />
                        {showStats && <Stats />}
                    </Canvas>
                </Box>
            )}
        </Box>
    );
};

