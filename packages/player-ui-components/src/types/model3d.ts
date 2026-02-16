/**
 * Types for 3D model data structure
 */

export interface ModelPointMetadata {
    modelName?: string;
    modelIndex?: number;
    nodeIndex?: number;
    coordIndex?: number;
    key?: string;
    itemIndex?: number;
    // Color channel offsets for handling different color orders (RGB, GRB, etc.)
    rOffset?: number; // Red channel offset (0, 1, or 2)
    gOffset?: number; // Green channel offset (0, 1, or 2)
    bOffset?: number; // Blue channel offset (0, 1, or 2)
    // Brightness and gamma for grouping geometries with same rendering properties
    brightness?: number; // Brightness multiplier (default: 1.0)
    gamma?: number; // Gamma correction value (default: 2.2)
}

export interface ModelShapeMetadata {}

export interface ModelMetadata {
    name: string;
    pointCount: number;
    startIndex?: number;
    endIndex?: number;
    pixelSize?: number;
    pixelStyle?: string;
    colorOrder?: string;
    brightness?: number; // Brightness multiplier from colorProfile (default: 1.0)
    gamma?: number; // Gamma correction value from colorProfile (default: 2.2)
}

export interface ModelSetMetadata {
    source?: 'xml' | 'default' | 'unknown';
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
    label?: string;
    metadata?: ModelPointMetadata;
    channel?: number;
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

export interface SelectionState {
    selectedIds: Set<string>;
    hoveredId: string | null;
}
