/**
 * Example usage of Scene3D types
 * 
 * This file demonstrates how to create and use the internal 3D scene representation
 */

import type { Scene, PointsModel, MeshModel, Model } from './Scene3D.types';
import { isPointsModel, isMeshModel } from './Scene3D.types';

/**
 * Example 1: Creating a simple scene with a points model
 */
export const examplePointsScene: Scene = {
  models: [
    {
      id: 'points-001',
      name: 'LED Cube',
      modelType: 'points',
      pointCount: 8,
      // 8 points forming a cube: each point is [x, y, z]
      points: new Float32Array([
        // Bottom face
        -1, -1, -1,  // 0: back-left-bottom
         1, -1, -1,  // 1: back-right-bottom
         1, -1,  1,  // 2: front-right-bottom
        -1, -1,  1,  // 3: front-left-bottom
        // Top face
        -1,  1, -1,  // 4: back-left-top
         1,  1, -1,  // 5: back-right-top
         1,  1,  1,  // 6: front-right-top
        -1,  1,  1,  // 7: front-left-top
      ]),
      pixelStyle: 'circle',
      pixelSize: 0.1,
    },
  ],
};

/**
 * Example 2: Creating a complex scene with multiple model types
 */
export const exampleComplexScene: Scene = {
  models: [
    // Points model for LED strip
    {
      id: 'points-002',
      name: 'LED Strip',
      modelType: 'points',
      pointCount: 50,
      points: new Float32Array(
        // Generate 50 points along a line
        Array.from({ length: 50 }, (_, i) => [
          i * 0.1,  // x: 0 to 4.9
          0,        // y: 0
          0,        // z: 0
        ]).flat()
      ),
      pixelStyle: 'square',
      pixelSize: 0.05,
    },
    
    // Mesh model for stage structure (data will be added later)
    {
      id: 'mesh-001',
      name: 'Stage Floor',
      modelType: 'mesh',
      pointCount: 0, // Will be calculated from mesh vertices
    },
    
    // Moving head light
    {
      id: 'light-001',
      name: 'Moving Head 1',
      modelType: 'moving-head',
      pointCount: 1, // Single origin point
    },
  ],
  
  // Optional scene objects (cameras, ambient lights, etc.)
  otherObjects: [
    {
      id: 'camera-001',
      type: 'camera',
      position: [0, 5, 10],
      lookAt: [0, 0, 0],
    },
    {
      id: 'ambient-light',
      type: 'light',
      intensity: 0.5,
      color: [255, 255, 255],
    },
  ],
};

/**
 * Example 3: Type-safe model processing using type guards
 */
export function processModel(model: Model): void {
  // Common properties available for all models
  console.log(`Processing model: ${model.name} (${model.id})`);
  console.log(`Point count: ${model.pointCount}`);

  // Type-specific processing using discriminated union
  if (isPointsModel(model)) {
    // TypeScript knows this is a PointsModel
    // points, pixelStyle, and pixelSize are now available
    if (model.points) {
      console.log(`Points data length: ${model.points.length}`);
      console.log(`Pixel style: ${model.pixelStyle ?? 'default'}`);
      console.log(`Pixel size: ${model.pixelSize ?? 1.0}`);
    }
  } else if (isMeshModel(model)) {
    // TypeScript knows this is a MeshModel
    console.log('Processing mesh model...');
    // Future: process mesh-specific properties
  }
  // Additional type checks for other model types...
}

/**
 * Example 4: Creating a scene programmatically
 */
export function createGridScene(rows: number, cols: number, spacing: number): Scene {
  const points: number[] = [];
  
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      points.push(
        j * spacing - (cols * spacing) / 2,  // x: centered
        0,                                     // y: flat plane
        i * spacing - (rows * spacing) / 2    // z: centered
      );
    }
  }

  const gridModel: PointsModel = {
    id: 'grid-001',
    name: `LED Grid ${rows}x${cols}`,
    modelType: 'points',
    pointCount: rows * cols,
    points: new Float32Array(points),
    pixelStyle: 'circle',
    pixelSize: 0.05,
  };

  return {
    models: [gridModel],
  };
}

/**
 * Example 5: Type safety demonstration
 * This function only accepts PointsModel, not any Model
 */
export function analyzePointCloud(model: PointsModel): {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
} {
  if (!model.points || model.points.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
    };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < model.points.length; i += 3) {
    const x = model.points[i];
    const y = model.points[i + 1];
    const z = model.points[i + 2];

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ],
  };
}

