/**
 * Custom shaders for point rendering with GPU-based color calculation
 * Moves per-point visual logic (color, brightness, gamma, hover/selection) to GPU
 */

import * as THREE from 'three';
import type { Point3D } from '../../types/model3d';

/**
 * Default gamma correction value used when model configuration doesn't provide gamma
 * Standard sRGB gamma value for display correction
 */
export const DEFAULT_GAMMA = 2.2;

/**
 * Extract gamma value from model configuration
 * Currently checks point metadata for gamma, but can be extended to check model-level configuration
 * @param _points - Array of points to extract gamma from (currently unused, reserved for future extension)
 * @returns Gamma value from model configuration, or DEFAULT_GAMMA if not available
 */
export function getGammaFromModelConfiguration(_points: Point3D[]): number {
    // Check if any point has gamma in metadata (future extension point)
    // For now, we'll use the default since gamma isn't currently stored in point metadata
    // This function provides a clear extension point for when model configuration becomes available
    return DEFAULT_GAMMA;
}

/**
 * Attributes passed to the shader per vertex
 */
export interface PointShaderAttributes {
    /** Base color (RGB) - can be procedural or from live data */
    baseColor?: Float32Array; // [r, g, b] per point, normalized 0-1
    /** Selection state: 0 = not selected, 1 = selected */
    selectionState?: Float32Array; // per point
    /** Hover state: 0 = not hovered, 1 = hovered */
    hoverState?: Float32Array; // per point
    /** Original index for live data mapping */
    originalIndex?: Float32Array; // per point
}

/**
 * Uniforms passed to the shader (shared across all points)
 */
export interface PointShaderUniforms {
    /** Time for animated procedural colors */
    time: number;
    /** Brightness multiplier */
    brightness: number;
    /** Gamma correction value */
    gamma: number;
    /** Selected color (RGB) */
    selectedColor: THREE.Vector3;
    /** Hovered color (RGB) */
    hoveredColor: THREE.Vector3;
    /** Use live data (1.0) or procedural (0.0) */
    useLiveData: number;
    /** Total point count for procedural color calculation */
    totalPointCount: number;
    /** View plane: 0 = 3D, 1 = xy, 2 = xz, 3 = yz */
    viewPlane?: number;
}

/**
 * Vertex shader for point rendering
 * Handles position transformation and passes data to fragment shader
 * Note: 'position' attribute is provided by Three.js, so we don't redeclare it
 */
export const pointVertexShader = `
// Custom attributes (position is provided by Three.js)
attribute vec3 baseColor;
attribute float selectionState;
attribute float hoverState;
attribute float originalIndex;

uniform float time;
uniform float brightness;
uniform float gamma;
uniform vec3 selectedColor;
uniform vec3 hoveredColor;
uniform float useLiveData;
uniform float totalPointCount;
uniform float size;
uniform int viewPlane; // 0 = 3D, 1 = xy, 2 = xz, 3 = yz

varying vec3 vColor;
varying float vSelectionState;
varying float vHoverState;
varying vec3 vPosition;
varying float vOriginalIndex;

// Triangle wave function (must be at top level - GLSL doesn't support nested functions)
float triangleWave(float t) {
    float HALF = 128.0;
    float period = HALF * 2.0;
    float tt = mod(mod(t, period) + period, period);
    return tt <= HALF ? (tt / HALF) * 255.0 : ((period - tt) / HALF) * 255.0;
}

// Procedural color calculation (matches JavaScript logic)
vec3 calculateProceduralColor(vec3 pos, float idx) {
    float HALF = 128.0;
    
    // Calculate phase: x*13 + y*17 + z*19 + t*90 + offset
    float phase = pos.x * 13.0 + pos.y * 17.0 + pos.z * 19.0 + time * 90.0 + 150.0;
    
    // RGB with phase offsets
    float rPhase = phase;
    float gPhase = phase + 341.0;
    float bPhase = phase + 682.0;
    
    float r = triangleWave(rPhase);
    float g = triangleWave(gPhase);
    float b = triangleWave(bPhase);
    
    // Normalize to 0-1
    return vec3(r, g, b) / 255.0;
}

void main() {
    // Apply 2D view plane projection if needed
    vec3 projectedPosition = position;
    if (viewPlane == 1) {
        // xy plane: flatten z to 0
        projectedPosition = vec3(position.x, position.y, 0.0);
    } else if (viewPlane == 2) {
        // xz plane: flatten y to 0
        projectedPosition = vec3(position.x, 0.0, position.z);
    } else if (viewPlane == 3) {
        // yz plane: flatten x to 0
        projectedPosition = vec3(0.0, position.y, position.z);
    }
    
    vec4 mvPosition = modelViewMatrix * vec4(projectedPosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = size;
    
    // Calculate color (use original 3D position for procedural color calculation)
    vec3 color = baseColor;
    
    // Use procedural color if not using live data
    if (useLiveData < 0.5) {
        color = calculateProceduralColor(position, originalIndex);
    }
    
    // Apply brightness
    color *= brightness;
    
    // Pass to fragment shader
    vColor = color;
    vSelectionState = selectionState;
    vHoverState = hoverState;
    vPosition = position;
    vOriginalIndex = originalIndex;
}
`;

/**
 * Fragment shader for point rendering
 * Handles color selection, hover highlighting, and gamma correction
 */
export const pointFragmentShader = `
uniform float gamma;
uniform vec3 selectedColor;
uniform vec3 hoveredColor;

varying vec3 vColor;
varying float vSelectionState;
varying float vHoverState;

void main() {
    vec3 color = vColor;
    
    // Apply selection color (yellow)
    if (vSelectionState > 0.5) {
        color = selectedColor;
    }
    // Apply hover color (white) - hover takes precedence over selection
    else if (vHoverState > 0.5) {
        color = hoveredColor;
    }
    
    // Apply gamma correction
    color = pow(color, vec3(1.0 / gamma));
    
    // Output final color
    gl_FragColor = vec4(color, 1.0);
}
`;

/**
 * Create a custom shader material for point rendering
 * @param uniforms - Partial uniforms object (gamma should be provided explicitly via options.gamma)
 * @param options - Material options including explicit gamma parameter
 * @param options.gamma - Explicit gamma value (required - no default/hardcoded value)
 * @param options.size - Point size
 * @param options.sizeAttenuation - Whether point size should attenuate with distance
 */
export function createPointShaderMaterial(
    uniforms: Partial<PointShaderUniforms>,
    options: {
        gamma: number; // Explicit gamma parameter - required, no default
        size?: number;
        sizeAttenuation?: boolean;
    },
): THREE.ShaderMaterial {
    // Use explicit gamma from options - no hardcoded default
    const gammaValue = options.gamma;

    const defaultUniforms: Record<string, THREE.IUniform> = {
        time: { value: 0.0 },
        brightness: { value: 1.0 },
        gamma: { value: gammaValue }, // Explicit gamma from parameter
        selectedColor: { value: new THREE.Vector3(1.0, 1.0, 0.0) }, // Yellow
        hoveredColor: { value: new THREE.Vector3(1.0, 1.0, 1.0) }, // White
        useLiveData: { value: 0.0 },
        totalPointCount: { value: 0.0 },
        size: { value: options?.size || 3.0 },
        viewPlane: { value: 0 }, // 0 = 3D, 1 = xy, 2 = xz, 3 = yz (int uniform)
    };

    // Merge provided uniforms
    Object.entries(uniforms).forEach(([key, value]) => {
        if (defaultUniforms[key]) {
            if (defaultUniforms[key].value instanceof THREE.Vector3 && value instanceof THREE.Vector3) {
                defaultUniforms[key].value.copy(value);
            } else if (key === 'viewPlane' && typeof value === 'number') {
                // Ensure viewPlane is an integer
                defaultUniforms[key].value = Math.floor(value);
            } else {
                defaultUniforms[key].value = value;
            }
        } else {
            if (key === 'viewPlane' && typeof value === 'number') {
                defaultUniforms[key] = { value: Math.floor(value) };
            } else {
                defaultUniforms[key] = { value };
            }
        }
    });

    return new THREE.ShaderMaterial({
        uniforms: defaultUniforms,
        vertexShader: pointVertexShader,
        fragmentShader: pointFragmentShader,
        vertexColors: false, // We're using custom attributes
        transparent: false,
        depthWrite: true,
    });
}

/**
 * Create buffer geometry with shader attributes for a geometry group
 */
export function createPointBufferGeometry(
    group: { points: Point3D[]; originalIndices: number[] },
    attributes: Partial<PointShaderAttributes>,
    _allPointsCount: number,
): THREE.BufferGeometry {
    const pointCount = group.points.length;
    const geometry = new THREE.BufferGeometry();

    // Position attribute (required - Three.js provides 'position' attribute automatically)
    const positions = new Float32Array(pointCount * 3);
    group.points.forEach((point, i) => {
        positions[i * 3] = point.x;
        positions[i * 3 + 1] = point.y;
        positions[i * 3 + 2] = point.z;
    });
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Base color attribute (default to procedural, will be calculated in shader)
    const baseColors = attributes.baseColor || new Float32Array(pointCount * 3);
    geometry.setAttribute('baseColor', new THREE.BufferAttribute(baseColors, 3));

    // Selection state attribute
    const selectionStates = attributes.selectionState || new Float32Array(pointCount);
    geometry.setAttribute('selectionState', new THREE.BufferAttribute(selectionStates, 1));

    // Hover state attribute
    const hoverStates = attributes.hoverState || new Float32Array(pointCount);
    geometry.setAttribute('hoverState', new THREE.BufferAttribute(hoverStates, 1));

    // Original index attribute (for live data mapping)
    const originalIndices = attributes.originalIndex || new Float32Array(pointCount);
    if (!attributes.originalIndex) {
        group.originalIndices.forEach((idx, i) => {
            originalIndices[i] = idx;
        });
    }
    geometry.setAttribute('originalIndex', new THREE.BufferAttribute(originalIndices, 1));

    // Set usage hints for performance
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    if (posAttr) {
        posAttr.setUsage(THREE.DynamicDrawUsage);
    }
    const baseColorAttr = geometry.attributes.baseColor as THREE.BufferAttribute;
    if (baseColorAttr) {
        baseColorAttr.setUsage(THREE.DynamicDrawUsage);
    }
    const selectionAttr = geometry.attributes.selectionState as THREE.BufferAttribute;
    if (selectionAttr) {
        selectionAttr.setUsage(THREE.DynamicDrawUsage);
    }
    const hoverAttr = geometry.attributes.hoverState as THREE.BufferAttribute;
    if (hoverAttr) {
        hoverAttr.setUsage(THREE.DynamicDrawUsage);
    }

    return geometry;
}

/**
 * Update shader attributes for selection/hover state changes
 */
export function updateShaderAttributes(
    geometry: THREE.BufferGeometry,
    selectionStates: Float32Array,
    hoverStates: Float32Array,
    baseColors?: Float32Array,
): void {
    const selectionAttr = geometry.getAttribute('selectionState') as THREE.BufferAttribute;
    const hoverAttr = geometry.getAttribute('hoverState') as THREE.BufferAttribute;

    if (selectionAttr && selectionStates.length === selectionAttr.count) {
        (selectionAttr.array as Float32Array).set(selectionStates);
        selectionAttr.needsUpdate = true;
    }

    if (hoverAttr && hoverStates.length === hoverAttr.count) {
        (hoverAttr.array as Float32Array).set(hoverStates);
        hoverAttr.needsUpdate = true;
    }

    if (baseColors) {
        const colorAttr = geometry.getAttribute('baseColor') as THREE.BufferAttribute;
        if (colorAttr && baseColors.length === colorAttr.count * 3) {
            (colorAttr.array as Float32Array).set(baseColors);
            colorAttr.needsUpdate = true;
        }
    }
}
