import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
}

interface PointMeshProps {
    point: Point3D;
    isSelected: boolean;
    isHovered: boolean;
    colorData?: PointColorData[];
    size: number;
    onClick: (pointId: string) => void;
    onHover: (pointId: string | null) => void;
}

function PointMesh({ point, isSelected, isHovered, colorData, size, onClick, onHover }: PointMeshProps) {
    const meshRef = useRef<THREE.Mesh>(null);
    const [currentColor, setCurrentColor] = React.useState(point.color || '#ffffff');

    // Update color from colorData if available
    useEffect(() => {
        if (colorData) {
            const pointColorData = colorData.find((cd) => cd.pointId === point.id);
            if (pointColorData) {
                setCurrentColor(pointColorData.color);
            }
        } else if (point.color) {
            setCurrentColor(point.color);
        }
    }, [colorData, point.id, point.color]);

    // Animate color transitions
    useFrame(() => {
        if (meshRef.current && colorData) {
            const pointColorData = colorData.find((cd) => cd.pointId === point.id);
            if (pointColorData) {
                const targetColor = new THREE.Color(pointColorData.color);
                const current = new THREE.Color(currentColor);
                const newColor = current.lerp(targetColor, 0.1);
                setCurrentColor(`#${newColor.getHexString()}`);
            }
        }
    });

    const handleClick = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onClick(point.id);
        },
        [onClick, point.id]
    );

    const handlePointerOver = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHover(point.id);
        },
        [onHover, point.id]
    );

    const handlePointerOut = useCallback(
        (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onHover(null);
        },
        [onHover]
    );

    const finalColor = isSelected ? '#ffff00' : isHovered ? '#00ffff' : currentColor;
    const finalSize = isSelected || isHovered ? size * 1.5 : size;

    return (
        <mesh
            ref={meshRef}
            position={[point.x, point.y, point.z]}
            onClick={handleClick}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
        >
            <sphereGeometry args={[finalSize, 16, 16]} />
            <meshStandardMaterial color={finalColor} emissive={finalColor} emissiveIntensity={0.5} />
        </mesh>
    );
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

function SceneContent({
    points,
    shapes,
    selectedIds,
    hoveredId,
    colorData,
    onPointClick,
    onPointHover,
    pointSize,
}: {
    points: Point3D[];
    shapes?: Shape3D[];
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    colorData?: PointColorData[];
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    pointSize?: number;
}) {
    const { camera } = useThree();

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
        const distance = maxDim * 2;

        camera.position.set(center.x + distance, center.y + distance, center.z + distance);
        camera.lookAt(center);
    }, [points, shapes, camera]);

    return (
        <>
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

            {points.map((point) => (
                <PointMesh
                    key={point.id}
                    point={point}
                    isSelected={selectedIds?.has(point.id) ?? false}
                    isHovered={hoveredId === point.id}
                    colorData={colorData}
                    size={pointSize || 0.1}
                    onClick={onPointClick || (() => { })}
                    onHover={onPointHover || (() => { })}
                />
            ))}
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
}) => {
    const theme = useTheme();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Log WebGL info for debugging
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                console.log('WebGL Renderer:', gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
                console.log('WebGL Vendor:', gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL));
            }
            console.log('WebGL Version:', gl.getParameter(gl.VERSION));
        } else {
            console.error('WebGL not available');
        }
    }, []);

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
                    onCreated={({ gl, scene, camera }) => {
                        console.log('Three.js Canvas created successfully');
                        console.log('WebGL Context:', gl.getContext());
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
                >
                    <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={50} />
                    <OrbitControls enableDamping dampingFactor={0.05} minDistance={1} maxDistance={100} />
                    {showGrid && <Grid args={[10, 10]} cellColor={theme.palette.divider} sectionColor={theme.palette.text.secondary} />}
                    <SceneContent
                        points={points}
                        shapes={shapes}
                        selectedIds={selectedIds}
                        hoveredId={hoveredId}
                        colorData={colorData}
                        onPointClick={onPointClick}
                        onPointHover={onPointHover}
                        pointSize={pointSize}
                    />
                    {showStats && <Stats />}
                </Canvas>
            )}
        </Box>
    );
};

