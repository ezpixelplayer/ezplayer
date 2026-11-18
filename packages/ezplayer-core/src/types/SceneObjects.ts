/*
 * Scene objects: display-only objects injected into the live preview through
 * /api/ezp/objects. They are held under a lease and never touch pixel output.
 * Coordinates are xLights world units, the same space as the layout.
 */

export type SceneVec3 = [number, number, number];

/** Where an object sits. Orientation precedence: matrix, quaternion, direction, rotation. */
export interface ScenePlacement {
    position?: SceneVec3;
    /** Degrees about X, Y, Z, applied in xLights order (Z, then Y, then X). */
    rotation?: SceneVec3;
    /** [x, y, z, w] */
    quaternion?: [number, number, number, number];
    /** Aims the object's local +Z axis along this vector. */
    direction?: SceneVec3;
    scale?: number | SceneVec3;
    /** Column-major 4x4; replaces every field above. */
    matrix?: number[];
}

export interface SceneAppearance {
    visible?: boolean;
    /** '#rrggbb' */
    color?: string;
    /** 0..1 */
    opacity?: number;
    /** Additive blending, so the object reads as light. Beams default to true. */
    additive?: boolean;
}

export type SceneShapeKind = 'sphere' | 'box' | 'cylinder' | 'cone' | 'plane';

/** A file is named either in the show folder (`file`) or as an asset uploaded under the object's key (`asset`). */
export interface SceneFileRef {
    file?: string;
    asset?: string;
}

export type SceneContent =
    | {
          type: 'points';
          /** Flat x, y, z per point. */
          positions: number[];
          /** Flat r, g, b (0..255) per point; the appearance color when absent. */
          colors?: number[];
          /** Point diameter in world units. */
          size?: number;
          /** Soft round falloff instead of a hard disc. */
          smooth?: boolean;
      }
    | {
          type: 'beam';
          /** World units along local +Z. */
          length: number;
          /** Cone half-angle in degrees. */
          angle?: number;
          /** Radius at the origin. */
          radius?: number;
      }
    | {
          type: 'shape';
          shape: SceneShapeKind;
          /** Extent in world units; a single number is a uniform size. */
          size?: number | SceneVec3;
          wireframe?: boolean;
      }
    | ({ type: 'mesh' } & SceneFileRef)
    | ({
          type: 'image';
          /** World units; height follows the image aspect when absent. */
          width?: number;
          height?: number;
      } & SceneFileRef)
    | {
          type: 'group';
          children: SceneNode[];
      };

export type SceneContentType = SceneContent['type'];

/** One member of a group. */
export interface SceneNode {
    name?: string;
    placement?: ScenePlacement;
    appearance?: SceneAppearance;
    content: SceneContent;
}

export type SceneView = 'both' | '2d' | '3d';

/** Body of a create / replace. */
export interface SceneObjectRequest {
    /** The key, when creating without one in the URL. */
    name?: string;
    /** Caller-chosen write token; later writes must present it. */
    token?: string;
    ttlMs?: number;
    view?: SceneView;
    /** Motion smoothing time constant in the viewer; 0 snaps. */
    smoothMs?: number;
    placement?: ScenePlacement;
    appearance?: SceneAppearance;
    content: SceneContent;
}

/** Body of a PATCH. placement / appearance merge by field (null clears one); content replaces. */
export interface SceneObjectPatch {
    ttlMs?: number;
    view?: SceneView;
    smoothMs?: number;
    placement?: { [K in keyof ScenePlacement]?: ScenePlacement[K] | null };
    appearance?: { [K in keyof SceneAppearance]?: SceneAppearance[K] | null };
    content?: SceneContent;
}

export interface SceneAssetInfo {
    size: number;
    /** Changes when the bytes are replaced. */
    rev: number;
    contentType: string;
}

/** An object as the API reports it. */
export interface SceneObjectInfo {
    key: string;
    /** True when writes need the token. */
    protected: boolean;
    ttlMs: number;
    /** Milliseconds of lease left when reported. */
    expiresInMs: number;
    /** Scene revision of the last change of any kind. */
    rev: number;
    /** Scene revision of the last content or asset change. */
    contentRev: number;
    view: SceneView;
    smoothMs?: number;
    placement: ScenePlacement;
    appearance: SceneAppearance;
    content: SceneContent;
    assets: Record<string, SceneAssetInfo>;
}

/** An entry of a scene delta: content and assets are present only when they changed. */
export type SceneObjectDelta = Omit<SceneObjectInfo, 'content' | 'assets' | 'protected' | 'ttlMs' | 'expiresInMs'> & {
    content?: SceneContent;
    assets?: Record<string, SceneAssetInfo>;
};

/** GET /api/ezp/scene: what a viewer needs to bring its copy up to `rev`. */
export interface SceneDelta {
    /** Changes when the player restarts; a viewer then starts over. */
    epoch: string;
    rev: number;
    /** Every live key, so a viewer can drop the ones that went away. */
    keys: string[];
    objects: SceneObjectDelta[];
}

export const SCENE_OBJECTS_PATH = '/api/ezp/objects';
/** The viewer feed. */
export const SCENE_FEED_PATH = '/api/ezp/scene';
