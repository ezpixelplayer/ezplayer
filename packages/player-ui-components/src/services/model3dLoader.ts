/**
 * Service for loading and parsing 3D model data from model.json
 */

import type { Model3DData, Point3D, Shape3D } from '../types/model3d';
import sampleModels from '../components/preview-3d/sample-model.json';

export interface SampleModelData {
    models: Array<{
        name: string;
        pixelSize?: number;
        pixelStyle?: string;
        colorOrder?: string;
        nodes?: Array<{
            channel?: number;
            string?: number;
            coords?: Array<{
                wX?: number;
                wY?: number;
                wZ?: number;
                [key: string]: unknown;
            }>;
        }>;
    }>;
}

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
 * Converts a sample model from sample-model.json to Model3DData format
 */
export function convertSampleModelToModel3D(
    sampleModel: SampleModelData['models'][0],
    modelPrefix: string = '',
): Model3DData {
    const points: Point3D[] = [];
    let pointIndex = 0;

    if (sampleModel.nodes && Array.isArray(sampleModel.nodes)) {
        sampleModel.nodes.forEach((node, nodeIndex) => {
            if (node.coords && Array.isArray(node.coords)) {
                node.coords.forEach((coord, coordIndex) => {
                    points.push({
                        id: `${modelPrefix}point-${nodeIndex}-${coordIndex}`,
                        x: coord.wX || 0,
                        y: coord.wY || 0,
                        z: coord.wZ || 0,
                        color: '#00ff00', // Default green color
                        label: `${sampleModel.name} - Point ${pointIndex + 1}`,
                    });
                    pointIndex++;
                });
            }
        });
    }

    return {
        name: sampleModel.name,
        points,
        shapes: [],
        metadata: {
            pixelSize: sampleModel.pixelSize,
            pixelStyle: sampleModel.pixelStyle,
            colorOrder: sampleModel.colorOrder,
            modelName: sampleModel.name,
            source: 'sample',
            dataSource: 'sample-model.json',
        },
    };
}

/**
 * Converts XML model coordinates (from getModelCoordinates) to Model3DData format
 * This function handles the structure returned by xllayoutcalcs getModelCoordinates
 */
export function convertXmlCoordinatesToModel3D(
    xmlCoordinates: Record<string, unknown>,
): Model3DData {
    const allPoints: Point3D[] = [];
    const modelMetadata: Array<{ name: string; pointCount: number; startIndex: number; endIndex: number }> = [];

    // Iterate through each model's coordinates
    Object.entries(xmlCoordinates).forEach(([modelName, modelData], modelIndex) => {
        const startIndex = allPoints.length;
        let pointIndex = 0;

        // Handle different possible structures from getModelCoordinates
        // Structure might be: { nodes: [{ coords: [{wX, wY, wZ}] }] } or similar
        const data = modelData as any;

        // Try to extract points from various possible structures
        if (data && typeof data === 'object') {
            // Case 1: Structure with nodes array (similar to sample-model.json)
            if (Array.isArray(data.nodes)) {
                data.nodes.forEach((node: any, nodeIndex: number) => {
                    if (node.coords && Array.isArray(node.coords)) {
                        node.coords.forEach((coord: any, coordIndex: number) => {
                            allPoints.push({
                                id: `model${modelIndex}-node${nodeIndex}-${coordIndex}`,
                                x: coord.wX ?? coord.x ?? 0,
                                y: coord.wY ?? coord.y ?? 0,
                                z: coord.wZ ?? coord.z ?? 0,
                                color: '#00ff00',
                                label: `${modelName} - Point ${pointIndex + 1}`,
                                metadata: {
                                    modelName,
                                    modelIndex,
                                    nodeIndex,
                                    coordIndex,
                                },
                            });
                            pointIndex++;
                        });
                    }
                });
            }
            // Case 2: Direct array of coordinates
            else if (Array.isArray(data)) {
                data.forEach((coord: any, coordIndex: number) => {
                    allPoints.push({
                        id: `model${modelIndex}-point${coordIndex}`,
                        x: coord.wX ?? coord.x ?? coord[0] ?? 0,
                        y: coord.wY ?? coord.y ?? coord[1] ?? 0,
                        z: coord.wZ ?? coord.z ?? coord[2] ?? 0,
                        color: '#00ff00',
                        label: `${modelName} - Point ${pointIndex + 1}`,
                        metadata: {
                            modelName,
                            modelIndex,
                            coordIndex,
                        },
                    });
                    pointIndex++;
                });
            }
            // Case 3: Object with points array
            else if (Array.isArray(data.points)) {
                data.points.forEach((coord: any, coordIndex: number) => {
                    allPoints.push({
                        id: `model${modelIndex}-point${coordIndex}`,
                        x: coord.wX ?? coord.x ?? coord[0] ?? 0,
                        y: coord.wY ?? coord.y ?? coord[1] ?? 0,
                        z: coord.wZ ?? coord.z ?? coord[2] ?? 0,
                        color: '#00ff00',
                        label: `${modelName} - Point ${pointIndex + 1}`,
                        metadata: {
                            modelName,
                            modelIndex,
                            coordIndex,
                        },
                    });
                    pointIndex++;
                });
            }
            // Case 4: Try to find any array property that might contain coordinates
            else {
                for (const [key, value] of Object.entries(data)) {
                    if (Array.isArray(value)) {
                        value.forEach((item: any, itemIndex: number) => {
                            if (item && typeof item === 'object') {
                                const x = item.wX ?? item.x ?? item[0] ?? 0;
                                const y = item.wY ?? item.y ?? item[1] ?? 0;
                                const z = item.wZ ?? item.z ?? item[2] ?? 0;
                                // Only add if we found valid coordinates
                                if (x !== 0 || y !== 0 || z !== 0 || item.wX !== undefined || item.x !== undefined) {
                                    allPoints.push({
                                        id: `model${modelIndex}-${key}-${itemIndex}`,
                                        x,
                                        y,
                                        z,
                                        color: '#00ff00',
                                        label: `${modelName} - ${key} ${pointIndex + 1}`,
                                        metadata: {
                                            modelName,
                                            modelIndex,
                                            key,
                                            itemIndex,
                                        },
                                    });
                                    pointIndex++;
                                }
                            }
                        });
                        break; // Only process first array found
                    }
                }
            }
        }

        const endIndex = allPoints.length - 1;
        if (pointIndex > 0) {
            modelMetadata.push({
                name: modelName,
                pointCount: pointIndex,
                startIndex,
                endIndex,
            });
        }
    });

    return {
        name: 'XML Models',
        points: allPoints,
        shapes: [],
        metadata: {
            totalModels: modelMetadata.length,
            models: modelMetadata,
            description: 'Models loaded from xlights_rgbeffects.xml',
            source: 'xml',
            dataSource: 'xlights_rgbeffects.xml',
        },
    };
}

/**
 * Converts all models from sample-model.json into a combined Model3DData structure
 */
export function convertAllSampleModelsToModel3D(): Model3DData {
    const sampleData = sampleModels as SampleModelData;

    if (!sampleData.models || sampleData.models.length === 0) {
        return {
            name: 'Empty Scene',
            points: [],
            shapes: [],
        };
    }

    const allPoints: Point3D[] = [];
    const modelMetadata: Array<{ name: string; pointCount: number; startIndex: number; endIndex: number }> = [];

    // Convert each model and combine all points
    sampleData.models.forEach((model, modelIndex) => {
        const startIndex = allPoints.length;
        let pointIndex = 0;

        if (model.nodes && Array.isArray(model.nodes)) {
            model.nodes.forEach((node, nodeIndex) => {
                if (node.coords && Array.isArray(node.coords)) {
                    node.coords.forEach((coord, coordIndex) => {
                        allPoints.push({
                            id: `model${modelIndex}-node${nodeIndex}-${coordIndex}`,
                            x: coord.wX || 0,
                            y: coord.wY || 0,
                            z: coord.wZ || 0,
                            color: '#00ff00',
                            label: `${model.name} - Point ${pointIndex + 1}`,
                            metadata: {
                                modelName: model.name,
                                modelIndex,
                                pixelSize: model.pixelSize,
                                pixelStyle: model.pixelStyle,
                                colorOrder: model.colorOrder,
                            },
                        });
                        pointIndex++;
                    });
                }
            });
        }

        const endIndex = allPoints.length - 1;
        modelMetadata.push({
            name: model.name,
            pointCount: pointIndex,
            startIndex,
            endIndex,
        });
    });

    return {
        name: 'All Models',
        points: allPoints,
        shapes: [],
        metadata: {
            totalModels: sampleData.models.length,
            models: modelMetadata,
            description: 'Combined view of all available models',
            source: 'sample',
            dataSource: 'sample-model.json',
        },
    };
}

/**
 * Helper function to check the data source of a Model3DData object
 * @param modelData - The Model3DData object to check
 * @returns Object with source information
 */
export function getModelDataSource(modelData: Model3DData | null | undefined): {
    source: 'xml' | 'sample' | 'default' | 'unknown';
    dataSource: string;
    isXml: boolean;
    isSample: boolean;
    isDefault: boolean;
} {
    if (!modelData || !modelData.metadata) {
        return {
            source: 'unknown',
            dataSource: 'unknown',
            isXml: false,
            isSample: false,
            isDefault: false,
        };
    }

    const source = (modelData.metadata.source as string) || 'unknown';
    const dataSource = (modelData.metadata.dataSource as string) || 'unknown';

    return {
        source: source as 'xml' | 'sample' | 'default' | 'unknown',
        dataSource,
        isXml: source === 'xml',
        isSample: source === 'sample',
        isDefault: source === 'default',
    };
}

/**
 * Creates a default model containing all models from sample-model.json
 */
export function createDefaultModel(): Model3DData {
    const sampleData = sampleModels as SampleModelData;

    if (sampleData.models && sampleData.models.length > 0) {
        // Return all models combined
        return convertAllSampleModelsToModel3D();
    }

    // Fallback to a simple model if sample data is not available
    return {
        name: 'Default Model',
        points: [
            { id: 'p1', x: 0, y: 0, z: 0, color: '#ff0000' },
            { id: 'p2', x: 1, y: 0, z: 0, color: '#00ff00' },
            { id: 'p3', x: 0, y: 1, z: 0, color: '#0000ff' },
            { id: 'p4', x: 0, y: 0, z: 1, color: '#ffff00' },
        ],
        metadata: {
            source: 'default',
            dataSource: 'hardcoded-default',
        },
    };
}
