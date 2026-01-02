/**
 * Types for 3D model data structure
 */

export interface Point3D {
    id: string;
    x: number;
    y: number;
    z: number;
    color?: string;
    label?: string;
    metadata?: Record<string, unknown>;
}

export interface Shape3D {
    id: string;
    type: 'box' | 'sphere' | 'cylinder' | 'plane' | 'custom';
    position: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    color?: string;
    label?: string;
    metadata?: Record<string, unknown>;
    points?: Point3D[];
}

export interface Model3DData {
    version?: string;
    name?: string;
    points: Point3D[];
    shapes?: Shape3D[];
    metadata?: Record<string, unknown>;
}

export interface PointColorData {
    pointId: string;
    color: string;
    timestamp?: number;
}

export interface SelectionState {
    selectedIds: Set<string>;
    hoveredId: string | null;
}
