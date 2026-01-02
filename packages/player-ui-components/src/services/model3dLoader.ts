/**
 * Service for loading and parsing 3D model data from model.json
 */

import type { Model3DData, Point3D, Shape3D } from '../types/model3d';

/**
 * Loads model data from a JSON file
 */
export async function loadModelFromJson(url: string): Promise<Model3DData> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load model: ${response.statusText}`);
        }
        const data = await response.json();
        return parseModelData(data);
    } catch (error) {
        console.error('Error loading model:', error);
        throw error;
    }
}

/**
 * Parses raw JSON data into Model3DData format
 */
export function parseModelData(data: unknown): Model3DData {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid model data: expected an object');
    }

    const model = data as Record<string, unknown>;

    // Parse points
    const points: Point3D[] = [];
    if (Array.isArray(model.points)) {
        points.push(
            ...model.points.map((point, index) => {
                if (typeof point !== 'object' || point === null) {
                    throw new Error(`Invalid point at index ${index}`);
                }
                const p = point as Record<string, unknown>;
                return {
                    id: String(p.id ?? `point-${index}`),
                    x: Number(p.x ?? 0),
                    y: Number(p.y ?? 0),
                    z: Number(p.z ?? 0),
                    color: typeof p.color === 'string' ? p.color : undefined,
                    label: typeof p.label === 'string' ? p.label : undefined,
                    metadata:
                        typeof p.metadata === 'object' && p.metadata !== null
                            ? (p.metadata as Record<string, unknown>)
                            : undefined,
                };
            }),
        );
    }

    // Parse shapes (optional)
    const shapes: Shape3D[] = [];
    if (Array.isArray(model.shapes)) {
        shapes.push(
            ...model.shapes.map((shape, index) => {
                if (typeof shape !== 'object' || shape === null) {
                    throw new Error(`Invalid shape at index ${index}`);
                }
                const s = shape as Record<string, unknown>;
                const position = s.position as Record<string, unknown> | undefined;
                const rotation = s.rotation as Record<string, unknown> | undefined;
                const scale = s.scale as Record<string, unknown> | undefined;

                return {
                    id: String(s.id ?? `shape-${index}`),
                    type: (s.type as Shape3D['type']) ?? 'box',
                    position: {
                        x: Number(position?.x ?? 0),
                        y: Number(position?.y ?? 0),
                        z: Number(position?.z ?? 0),
                    },
                    rotation: rotation
                        ? {
                              x: Number(rotation.x ?? 0),
                              y: Number(rotation.y ?? 0),
                              z: Number(rotation.z ?? 0),
                          }
                        : undefined,
                    scale: scale
                        ? {
                              x: Number(scale.x ?? 1),
                              y: Number(scale.y ?? 1),
                              z: Number(scale.z ?? 1),
                          }
                        : undefined,
                    color: typeof s.color === 'string' ? s.color : undefined,
                    label: typeof s.label === 'string' ? s.label : undefined,
                    metadata:
                        typeof s.metadata === 'object' && s.metadata !== null
                            ? (s.metadata as Record<string, unknown>)
                            : undefined,
                    points: Array.isArray(s.points) ? (s.points as Point3D[]) : undefined,
                };
            }),
        );
    }

    return {
        version: typeof model.version === 'string' ? model.version : undefined,
        name: typeof model.name === 'string' ? model.name : undefined,
        points,
        shapes: shapes.length > 0 ? shapes : undefined,
        metadata:
            typeof model.metadata === 'object' && model.metadata !== null
                ? (model.metadata as Record<string, unknown>)
                : undefined,
    };
}

/**
 * Creates a default/empty model for testing
 */
export function createDefaultModel(): Model3DData {
    return {
        name: 'Default Model',
        points: [
            { id: 'p1', x: 0, y: 0, z: 0, color: '#ff0000' },
            { id: 'p2', x: 1, y: 0, z: 0, color: '#00ff00' },
            { id: 'p3', x: 0, y: 1, z: 0, color: '#0000ff' },
            { id: 'p4', x: 0, y: 0, z: 1, color: '#ffff00' },
        ],
    };
}
