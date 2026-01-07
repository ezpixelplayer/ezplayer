/**
 * Internal 3D Scene Representation
 * 
 * This module defines the core data structures for representing 3D scenes
 * independent of any rendering engine or input format.
 */

/**
 * Base properties shared by all model types
 */
interface BaseModel {
  id: string;
  name: string;
  pointCount: number;
}

/**
 * Points-based model representation
 * Contains 3D point cloud data with configurable pixel rendering style
 */
export interface PointsModel extends BaseModel {
  modelType: 'points';
  /** XYZ positions stored as flat Float32Array [x1, y1, z1, x2, y2, z2, ...] */
  points?: Float32Array;
  /** Visual style for rendering individual points */
  pixelStyle?: 'square' | 'circle' | 'custom';
  /** Size of rendered pixels in scene units */
  pixelSize?: number;
}

/**
 * Mesh-based model representation
 * For future support of triangle meshes, surfaces, etc.
 */
export interface MeshModel extends BaseModel {
  modelType: 'mesh';
  // Future mesh-specific properties:
  // vertices?: Float32Array;
  // indices?: Uint32Array;
  // normals?: Float32Array;
  // uvs?: Float32Array;
}

/**
 * Image/texture model representation
 * For future support of 2D images in 3D space
 */
export interface ImageModel extends BaseModel {
  modelType: 'image';
  // Future image-specific properties:
  // texture?: string | Uint8Array;
  // width?: number;
  // height?: number;
  // position?: [number, number, number];
}

/**
 * Moving head light model representation
 * For future support of stage lighting equipment
 */
export interface MovingHeadModel extends BaseModel {
  modelType: 'moving-head';
  // Future moving-head-specific properties:
  // pan?: number;
  // tilt?: number;
  // beamAngle?: number;
  // color?: [number, number, number];
}

/**
 * Discriminated union of all model types
 * TypeScript will enforce that only properties valid for each modelType can be accessed
 */
export type Model = PointsModel | MeshModel | ImageModel | MovingHeadModel;

/**
 * Base interface for other scene objects (cameras, lights, etc.)
 * Provides extensibility for non-model scene entities
 */
export interface SceneObject {
  id: string;
  type: string;
  [key: string]: unknown; // Allow arbitrary properties for different object types
}

/**
 * Main scene container
 * Holds all models and optional scene objects
 */
export interface Scene {
  models: Model[];
  otherObjects?: SceneObject[];
}

/**
 * Type guard to check if a model is a PointsModel
 */
export function isPointsModel(model: Model): model is PointsModel {
  return model.modelType === 'points';
}

/**
 * Type guard to check if a model is a MeshModel
 */
export function isMeshModel(model: Model): model is MeshModel {
  return model.modelType === 'mesh';
}

/**
 * Type guard to check if a model is an ImageModel
 */
export function isImageModel(model: Model): model is ImageModel {
  return model.modelType === 'image';
}

/**
 * Type guard to check if a model is a MovingHeadModel
 */
export function isMovingHeadModel(model: Model): model is MovingHeadModel {
  return model.modelType === 'moving-head';
}

