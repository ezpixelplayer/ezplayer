/**
 * Service for loading and parsing 3D model data from XML coordinates
 */

import type { Model3DData, ModelMetadata, Point3D } from '../types/model3d';
import type { ChannelRole, GetNodeResult } from '@ezplayer/ezplayer-core';

// xLights warm-white in 0–1 (#ffe5cc).
const WARM_WHITE: [number, number, number] = [1.0, 0xe5 / 255, 0xcc / 255];

function parseHex(hex: string | undefined): [number, number, number] {
    if (!hex) return [1, 1, 1];
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return [1, 1, 1];
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

function roleTint(role: ChannelRole): [number, number, number] {
    switch (role.kind) {
        case 'red':
            return [1, 0, 0];
        case 'green':
            return [0, 1, 0];
        case 'blue':
            return [0, 0, 1];
        case 'white':
            return [1, 1, 1];
        case 'warmWhite':
            return WARM_WHITE;
        case 'intensity':
        case 'tint':
            return parseHex(role.tint);
        case 'unused':
            return [0, 0, 0];
    }
}

/**
 * Bake xllayoutcalcs `channelRoles` into a flat Float32Array the per-frame
 * loop can sum without any branching on `kind`.
 */
function buildColorMix(channelRoles: ChannelRole[] | undefined): { mix: Float32Array; maxOffset: number } | undefined {
    if (!channelRoles?.length) return undefined;
    const mix = new Float32Array(channelRoles.length * 4);
    let maxOffset = 0;
    for (let i = 0; i < channelRoles.length; i++) {
        const role = channelRoles[i];
        const [r, g, b] = roleTint(role);
        mix[i * 4 + 0] = role.offset;
        mix[i * 4 + 1] = r;
        mix[i * 4 + 2] = g;
        mix[i * 4 + 3] = b;
        if (role.offset > maxOffset) maxOffset = role.offset;
    }
    return { mix, maxOffset };
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
        // Image models render as a textured plane via ImagePlane (driven by
        // viewObjects), not as discrete light points.  Their two corner
        // coords would otherwise show as stray dots at the image bounds.
        if (modelData.modelType === 'Image') return;

        const startIndex = allPoints.length;
        let pointIndex = 0;

        // Build a baked channel-to-RGB mixer once per model from channelRoles.
        // Shared by reference across every point in the model — no per-point copy.
        const baked = buildColorMix(modelData.channelRoles);
        const colorMix = baked?.mix;
        const colorMixMaxOffset = baked?.maxOffset;

        // Extract brightness and gamma from colorProfile.
        const brightness = modelData.colorProfile?.allBrightness ?? 1.0;
        const gamma = modelData.colorProfile?.allGamma ?? 1.0;

        // Extract transparency (0–100 percentage from xLights XML Transparency attribute)
        // 0 = fully opaque (default), 100 = fully transparent
        const transparency = modelData.transparency;
        const layoutGroup = modelData.layoutGroup;

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
                                    colorMix,
                                    colorMixMaxOffset,
                                    brightness,
                                    gamma,
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
            // Display channel is the first node's channel. This is the same channel
            // the preview actually samples from, so any off-by-one in channel
            // resolution will surface here directly.
            // node.channel is 0-based; convert to 1-based for display.
            const firstNodeChannel = allPoints[startIndex].channel;
            const firstNodeChannel1Based = firstNodeChannel !== undefined ? firstNodeChannel + 1 : undefined;

            const metadata = {
                name: modelName,
                pointCount: pointIndex,
                startIndex,
                endIndex,
                // Extract pixelSize and pixelStyle from XML
                pixelSize: modelData.pixelSize,
                pixelStyle: modelData.pixelStyle,
                // Extract transparency from XML (0–100 integer, 0 = opaque, 100 = transparent)
                transparency,
                layoutGroup,
                // Extract brightness and gamma from colorProfile
                brightness,
                gamma,
                firstNodeChannel: firstNodeChannel1Based,
            };
            modelMetadata.push(metadata);
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
