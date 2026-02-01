/**
 * Types for 3D model data structure
 */

export interface ModelPointMetadata {
    modelName ?: string;
    modelIndex ?: number;
    nodeIndex ?: number;
    coordIndex ?: number;
    key ?: string;
    itemIndex ?: number;
}

export interface ModelShapeMetadata {
}

export interface ModelMetadata {
    name: string;
    pointCount: number;
    startIndex: number;
    endIndex: number;
    pixelSize?: number;
    pixelStyle?: string;
    colorOrder?: string;
}

export interface ModelSetMetadata {
    source?: string;
    dataSource?: string;
    totalModels: number;
    models: ModelMetadata[];
    description: string;
 }

export interface Point3D {
    id: string;
    x: number;
    y: number;
    z: number;
    color?: string;
    label?: string;
    metadata?: ModelPointMetadata;
}

export interface Shape3D {
    id: string;
    type: 'box' | 'sphere' | 'cylinder' | 'plane' | 'custom';
    position: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
    scale?: { x: number; y: number; z: number };
    color?: string;
    label?: string;
    metadata?: ModelShapeMetadata;
    points?: Point3D[];
}

export interface Model3DData {
    version?: string;
    name?: string;
    points: Point3D[];
    shapes?: Shape3D[];
    metadata?: ModelSetMetadata;
}

export interface PointColorData {
    pointId: string;
    color: string;
}

export interface SelectionState {
    selectedIds: Set<string>;
    hoveredId: string | null;
}
