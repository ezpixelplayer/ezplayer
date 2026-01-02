import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { Box, useTheme, Typography } from '@mui/material';
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
}

interface Point2DMeshProps {
    point: Point3D;
    isSelected: boolean;
    isHovered: boolean;
    colorData?: PointColorData[];
    size: number;
    viewPlane: 'xy' | 'xz' | 'yz';
    onClick: (pointId: string) => void;
    onHover: (pointId: string | null) => void;
}

function Point2DMesh({ point, isSelected, isHovered, colorData, size, viewPlane, onClick, onHover }: Point2DMeshProps) {
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

    // Flatten based on view plane
    const position = useMemo((): [number, number, number] => {
        switch (viewPlane) {
            case 'xy':
                return [point.x, point.y, 0];
            case 'xz':
                return [point.x, 0, point.z];
            case 'yz':
                return [0, point.y, point.z];
            default:
                return [point.x, point.y, 0];
        }
    }, [point, viewPlane]);

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
        <mesh ref={meshRef} position={position} onClick={handleClick} onPointerOver={handlePointerOver} onPointerOut={handlePointerOut}>
            <circleGeometry args={[finalSize, 32]} />
            <meshStandardMaterial color={finalColor} emissive={finalColor} emissiveIntensity={0.5} />
        </mesh>
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
}) {
    const { camera } = useThree();

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
        const distance = maxDim * 1.5;

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
    }, [points, shapes, camera, viewPlane]);

    return (
        <>
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

            {points.map((point) => (
                <Point2DMesh
                    key={point.id}
                    point={point}
                    isSelected={selectedIds?.has(point.id) ?? false}
                    isHovered={hoveredId === point.id}
                    colorData={colorData}
                    size={pointSize || 0.1}
                    viewPlane={viewPlane}
                    onClick={onPointClick || (() => { })}
                    onHover={onPointHover || (() => { })}
                />
            ))}
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
    pointSize = 0.1,
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
                >
                    <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={50} />
                    {showGrid && <Grid args={[10, 10]} cellColor={theme.palette.divider} sectionColor={theme.palette.text.secondary} />}
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
                    />
                </Canvas>
            )}
        </Box>
    );
};

