/**
 * Service for loading and parsing 3D model data from XML coordinates
 */

import type { Model3DData, ModelMetadata, Point3D } from '../types/model3d';
import type { GetNodeResult } from '@ezplayer/ezplayer-core';

/**
 * Parse color channel offsets from StringType (e.g., "RGB Nodes", "GRB Nodes")
 * Returns [rOffset, gOffset, bOffset] where each is 0, 1, or 2
 */
function parseColorOffsets(stringType?: string): [number, number, number] {
    if (!stringType) {
        return [0, 1, 2]; // Default RGB
    }

    // Extract color order from strings like "RGB Nodes", "GRB Nodes", etc.
    const match = stringType.match(/^([RGB]{3})\s+Nodes/i);
    if (!match) {
        return [0, 1, 2]; // Default RGB
    }

    const colorOrder = match[1].toUpperCase();
    
    // Map each color to its position in the string (0-based index)
    const rOffset = colorOrder.indexOf('R');
    const gOffset = colorOrder.indexOf('G');
    const bOffset = colorOrder.indexOf('B');

    // Validate that we found all three colors
    if (rOffset === -1 || gOffset === -1 || bOffset === -1) {
        return [0, 1, 2]; // Default RGB
    }

    return [rOffset, gOffset, bOffset];
}

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

        // Parse color order for this model (GRB, RGB, etc.)
        const [rOffset, gOffset, bOffset] = parseColorOffsets(modelData.stringType);

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
                                label: `${modelName} - Point ${pointIndex + 1}`,
                                channel: node.channel,
                                metadata: {
                                    modelName,
                                    modelIndex,
                                    nodeIndex,
                                    coordIndex,
                                    rOffset,
                                    gOffset,
                                    bOffset,
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
        name: 'Models',
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
