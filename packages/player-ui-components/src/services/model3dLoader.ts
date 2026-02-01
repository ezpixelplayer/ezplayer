/**
 * Service for loading and parsing 3D model data from XML coordinates
 */

import type { Model3DData, ModelMetadata, Point3D } from '../types/model3d';
import type { GetNodeResult } from '@ezplayer/ezplayer-core';

/**
 * Converts XML model coordinates (from getModelCoordinates) to Model3DData format
 * This function handles the structure returned by xllayoutcalcs getModelCoordinates
 */
export function convertXmlCoordinatesToModel3D(modelCoordinates: Record<string, GetNodeResult>): Model3DData {
    const allPoints: Point3D[] = [];
    const modelMetadata: ModelMetadata[] = [];

    // Iterate through each model's coordinates
    Object.entries(modelCoordinates).forEach(([modelName, modelData], modelIndex) => {
        const startIndex = allPoints.length;
        let pointIndex = 0;

        // Extract points
        if (modelData) {
            // Case 1: Structure with nodes array
            if (Array.isArray(modelData.nodes)) {
                modelData.nodes.forEach((node, nodeIndex: number) => {
                    if (node.coords && Array.isArray(node.coords)) {
                        node.coords.forEach((coord, coordIndex: number) => {
                            allPoints.push({
                                id: `model${modelIndex}-node${nodeIndex}-${coordIndex}`,
                                x: coord.wX ?? 0,
                                y: coord.wY ?? 0,
                                z: coord.wZ ?? 0,
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
