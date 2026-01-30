/**
 * Service for loading and parsing 3D model data from XML coordinates
 */

import type { Model3DData, Point3D } from '../types/model3d';

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
            // Case 1: Structure with nodes array
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
 * Helper function to check the data source of a Model3DData object
 * @param modelData - The Model3DData object to check
 * @returns Object with source information
 */
export function getModelDataSource(modelData: Model3DData | null | undefined): {
    source: 'xml' | 'default' | 'unknown';
    dataSource: string;
    isXml: boolean;
    isDefault: boolean;
} {
    if (!modelData || !modelData.metadata) {
        return {
            source: 'unknown',
            dataSource: 'unknown',
            isXml: false,
            isDefault: false,
        };
    }

    const source = (modelData.metadata.source as string) || 'unknown';
    const dataSource = (modelData.metadata.dataSource as string) || 'unknown';

    return {
        source: source as 'xml' | 'default' | 'unknown',
        dataSource,
        isXml: source === 'xml',
        isDefault: source === 'default',
    };
}
