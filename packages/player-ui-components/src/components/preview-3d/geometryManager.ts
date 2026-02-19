/**
 * Geometry manager for efficient batch rendering
 * Manages multiple geometry groups and their updates
 */

import * as THREE from 'three';
import type { Point3D } from '../../types/model3d';
import { groupPointsByGeometry, type GeometryGroup } from './geometryGrouping';
import {
    createPointBufferGeometry,
    createPointShaderMaterial,
    updateShaderAttributes,
    type PointShaderUniforms,
    DEFAULT_GAMMA,
    getGammaFromModelConfiguration,
} from './pointShaders';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';

/**
 * Manages a single geometry group's rendering state
 */
export class GeometryGroupRenderer {
    public geometry: THREE.BufferGeometry;
    public material: THREE.ShaderMaterial;
    public points: THREE.Points;
    public group: GeometryGroup;
    public allPointsCount: number;

    private selectionStates: Float32Array;
    private hoverStates: Float32Array;
    private baseColors: Float32Array;

    // Reused across every onBeforeRender call to avoid per-frame heap allocations.
    private _sizeVec = new THREE.Vector2();
    // Tracks the last frame sequence number consumed from the ring buffer.
    // Passed to tryReadLatest() so it returns null (and we skip the O(n) scan)
    // when no new frame has been published since the last render.
    private _lastFrameSeq = 0;

    constructor(
        group: GeometryGroup,
        allPointsCount: number,
        uniforms: Partial<PointShaderUniforms>,
        options?: {
            pointSize?: number;
            viewPlane?: 'xy' | 'xz' | 'yz';
            gamma?: number;
            brightness?: number;
            pixelStyle?: number; // 0 = square, 1 = circle/round (default), 2 = blended circle
            opacity?: number; // 0.0 = fully transparent, 1.0 = fully opaque (derived from xLights Transparency)
        },
    ) {
        this.group = group;
        this.allPointsCount = allPointsCount;

        const pointCount = group.points.length;
        this.selectionStates = new Float32Array(pointCount);
        this.hoverStates = new Float32Array(pointCount);
        this.baseColors = new Float32Array(pointCount * 3);

        // Create geometry with initial attributes
        this.geometry = createPointBufferGeometry(
            group,
            {
                selectionState: this.selectionStates,
                hoverState: this.hoverStates,
                baseColor: this.baseColors,
            },
            allPointsCount,
        );

        // Extract gamma explicitly: from options > from uniforms > from model configuration > default
        const gammaValue =
            options?.gamma ?? uniforms.gamma ?? getGammaFromModelConfiguration(group.points) ?? DEFAULT_GAMMA;

        // Extract brightness: from options > from uniforms > default (1.0)
        const brightnessValue = options?.brightness ?? uniforms.brightness ?? 1.0;

        // Create shader material
        const materialUniforms = { ...uniforms };
        if (options?.viewPlane) {
            const viewPlaneMap = { xy: 1, xz: 2, yz: 3 };
            materialUniforms.viewPlane = viewPlaneMap[options.viewPlane];
        }
        // Ensure gamma and brightness are set in uniforms (for shader uniform)
        materialUniforms.gamma = gammaValue;
        materialUniforms.brightness = brightnessValue;
        this.material = createPointShaderMaterial(materialUniforms, {
            gamma: gammaValue, // Explicit gamma parameter
            size: options?.pointSize || 3.0,
            // Enable size attenuation by default so zoom/dolly scales pixels naturally.
            // This can be disabled by passing sizeAttenuation: false in the future if needed.
            sizeAttenuation: true,
            pixelStyle: options?.pixelStyle ?? 1, // 0 = square, 1 = circle/round (default), 2 = blended circle
            opacity: options?.opacity ?? 1.0, // 1.0 = fully opaque, 0.0 = fully transparent (from xLights Transparency)
        });

        // Create points object
        this.points = new THREE.Points(this.geometry, this.material);

        // Keep point sizing in sync with the active camera + renderer.
        // This is critical for correct behavior when zooming (orthographic) or dollying (perspective),
        // especially for large pixel sizes.
        this.points.onBeforeRender = (renderer, _scene, camera) => {
            const material = this.material;
            if (!material?.uniforms) return;

            const pixelRatio = typeof (renderer as any).getPixelRatio === 'function' ? (renderer as any).getPixelRatio() : 1;
            // Reuse pre-allocated Vector2 — avoids a heap allocation on every frame per group.
            renderer.getSize(this._sizeVec);
            // Use CSS pixel height here; we convert to device pixels in the shader via `pixelRatio`.
            const heightCssPx = Math.max(1, this._sizeVec.y);

            // Compute scale factor to convert world units to pixels for point sizing.
            // Perspective: pixels = worldSize * (H / (2*tan(fov/2))) / distance
            // Ortho: pixels = worldSize * (H / frustumHeight) * zoom
            let scale = 1.0;
            const anyCam = camera as any;
            if (anyCam?.isPerspectiveCamera) {
                const cam = camera as THREE.PerspectiveCamera;
                const fovRad = (cam.fov * Math.PI) / 180;
                scale = heightCssPx / (2 * Math.tan(fovRad / 2));
            } else if (anyCam?.isOrthographicCamera) {
                const cam = camera as THREE.OrthographicCamera;
                const frustumHeight = Math.max(0.0001, cam.top - cam.bottom);
                scale = (heightCssPx / frustumHeight) * (cam.zoom ?? 1.0);
            }

            // Max supported point size (GPU dependent); query once per material/context.
            if (material.uniforms.maxPointSize?.value === 2048.0) {
                try {
                    const gl = renderer.getContext();
                    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[];
                    const maxPointSize = Array.isArray(range) ? range[1] : (range as Float32Array)[1];
                    if (typeof maxPointSize === 'number' && Number.isFinite(maxPointSize) && maxPointSize > 0) {
                        material.uniforms.maxPointSize.value = maxPointSize;
                    }
                } catch {
                    // ignore; keep default
                }
            }

            material.uniforms.pixelRatio.value = pixelRatio;
            material.uniforms.scale.value = scale;
        };
    }

    /**
     * Update selection and hover states
     */
    updateStates(
        selectedIds?: Set<string>,
        hoveredId?: string | null,
        hoveredModelName?: string | null,
        selectedModelNames?: Set<string>,
    ): void {
        const pointCount = this.group.points.length;
        let needsUpdate = false;

        for (let i = 0; i < pointCount; i++) {
            const point = this.group.points[i];
            const pointModelName = point.metadata?.modelName as string | undefined;

            // Update selection state
            const isSelected =
                selectedIds?.has(point.id) || (pointModelName && selectedModelNames?.has(pointModelName));
            const newSelectionState = isSelected ? 1.0 : 0.0;
            if (this.selectionStates[i] !== newSelectionState) {
                this.selectionStates[i] = newSelectionState;
                needsUpdate = true;
            }

            // Update hover state
            const isHovered = hoveredId === point.id || (hoveredModelName && pointModelName === hoveredModelName);
            const newHoverState = isHovered ? 1.0 : 0.0;
            if (this.hoverStates[i] !== newHoverState) {
                this.hoverStates[i] = newHoverState;
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            updateShaderAttributes(this.geometry, this.selectionStates, this.hoverStates);
        }
    }

    /**
     * Update base colors from live data
     */
    updateLiveDataColors(liveData?: LatestFrameRingBuffer): void {
        if (!liveData) {
            // No live data available - use procedural colors
            this.material.uniforms.useLiveData.value = 0.0;
            return;
        }

        // Pass the last seen seq so tryReadLatest returns null when nothing new
        // has been published — this skips the entire O(n) point scan for frames
        // that have already been processed, which is the common case at 60 fps.
        const latestFrame = liveData.tryReadLatest(this._lastFrameSeq);
        if (!latestFrame?.bytes) {
            // No new frame since last render — keep current colors as-is.
            // Do NOT reset useLiveData here; the existing color data is still valid.
            return;
        }
        // NOTE: The exported frame bytes are already the "final" 0–255 channel values that the
        // player sends to controllers. We should not apply any additional inverse gamma here,
        // otherwise gamma would effectively be applied twice (once here, and again in the shader).
        // So we only normalize bytes to 0–1 and let the shader handle display gamma once.

        const pointCount = this.group.points.length;
        let needsUpdate = false;

        for (let i = 0; i < pointCount; i++) {
            const point = this.group.points[i];
            const originalIndex = this.group.originalIndices[i];
            const colorIndex = point.channel ?? originalIndex * 3;

            if (colorIndex + 2 < latestFrame.bytes.length) {
                // Get color channel offsets from point metadata (defaults to RGB order: 0,1,2)
                const rOffset = point.metadata?.rOffset ?? 0;
                const gOffset = point.metadata?.gOffset ?? 1;
                const bOffset = point.metadata?.bOffset ?? 2;

                // Read bytes using the correct channel offsets
                // This handles different color orders (RGB, GRB, RBG, etc.)
                const rByte = latestFrame.bytes[colorIndex + rOffset];
                const gByte = latestFrame.bytes[colorIndex + gOffset];
                const bByte = latestFrame.bytes[colorIndex + bOffset];

                const r = rByte / 255.0;
                const g = gByte / 255.0;
                const b = bByte / 255.0;

                const baseColorIndex = i * 3;
                if (
                    this.baseColors[baseColorIndex] !== r ||
                    this.baseColors[baseColorIndex + 1] !== g ||
                    this.baseColors[baseColorIndex + 2] !== b
                ) {
                    this.baseColors[baseColorIndex] = r;
                    this.baseColors[baseColorIndex + 1] = g;
                    this.baseColors[baseColorIndex + 2] = b;
                    needsUpdate = true;
                }
            }
        }

        // Mark this sequence as consumed so the next call skips the O(n) scan
        // if no new frame has been written to the ring buffer in the meantime.
        this._lastFrameSeq = latestFrame.seq;

        // Always set useLiveData to 1.0 when live data is available (even if colors didn't change)
        // This ensures FSEQ colors are used instead of procedural colors
        this.material.uniforms.useLiveData.value = 1.0;

        if (needsUpdate) {
            updateShaderAttributes(this.geometry, this.selectionStates, this.hoverStates, this.baseColors);
        }
    }

    /**
     * Update time uniform for procedural colors
     * Note: This should NOT reset useLiveData - that's handled by updateLiveDataColors
     */
    updateTime(time: number): void {
        this.material.uniforms.time.value = time;
        // Removed the code that was resetting useLiveData - that was causing FSEQ colors to be overridden
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
    }
}

/**
 * Manages multiple geometry groups for batch rendering
 */
export class GeometryManager {
    private renderers: Map<string, GeometryGroupRenderer> = new Map();
    private allPoints: Point3D[];
    private allPointsCount: number;
    private uniforms: Partial<PointShaderUniforms>;
    private pointSize: number;
    private viewPlane?: 'xy' | 'xz' | 'yz';
    private gamma: number;
    private pointIdToModelNameCache: Map<string, string | null> = new Map();
    private cachedHoveredId: string | null = null;
    private cachedHoveredModelName: string | null = null;
    private modelPixelSizeMap: Map<string, number> = new Map();
    private modelPixelStyleMap: Map<string, string> = new Map(); // Store pixelStyle as string from XML
    private modelTransparencyMap: Map<string, number> = new Map(); // Store transparency (0–100) from XML

    constructor(
        points: Point3D[],
        uniforms: Partial<PointShaderUniforms>,
        options?: {
            pointSize?: number;
            viewPlane?: 'xy' | 'xz' | 'yz';
            gamma?: number;
            modelPixelSizeMap?: Map<string, number>;
            modelPixelStyleMap?: Map<string, string>; // pixelStyle as string from XML
            modelTransparencyMap?: Map<string, number>; // transparency (0–100) from xLights XML
        },
    ) {
        this.allPoints = points;
        this.allPointsCount = points.length;
        this.uniforms = uniforms;
        this.pointSize = options?.pointSize || 3.0;
        this.viewPlane = options?.viewPlane;
        // Extract gamma explicitly: from options > from uniforms > from model configuration > default
        this.gamma =
            options?.gamma ??
            uniforms.gamma ??
            getGammaFromModelConfiguration(points) ??
            DEFAULT_GAMMA;
        // Store model pixel size map for per-model point size lookup
        this.modelPixelSizeMap = options?.modelPixelSizeMap || new Map();
        // Store model pixel style map for per-model pixel shape lookup
        this.modelPixelStyleMap = options?.modelPixelStyleMap || new Map();
        // Store model transparency map for per-model opacity lookup
        this.modelTransparencyMap = options?.modelTransparencyMap || new Map();
    }

    /**
     * Initialize geometry groups from points
     */
    initializeGroups(): void {
        // Dispose existing renderers
        this.dispose();

        // Build point ID to model name cache for fast lookups
        this.pointIdToModelNameCache.clear();
        this.allPoints.forEach((point) => {
            const modelName = (point.metadata?.modelName as string | undefined) || null;
            this.pointIdToModelNameCache.set(point.id, modelName);
        });

        // Reset hover cache
        this.cachedHoveredId = null;
        this.cachedHoveredModelName = null;

        // Group points by geometry type
        const groups = groupPointsByGeometry(this.allPoints);

        // Create renderer for each group
        groups.forEach((group) => {
            // Extract modelName, brightness, and gamma from group
            // Since points are grouped by modelName + brightness + gamma, all points in a group have the same values
            const firstPoint = group.points[0];
            const modelName = firstPoint.metadata?.modelName as string | undefined;
            const groupBrightness = firstPoint.metadata?.brightness ?? 1.0;
            const groupGamma = firstPoint.metadata?.gamma ?? this.gamma;

            // Look up pixelSize for this model
            // Use model's pixelSize from XML if available, otherwise fall back to default pointSize
            const modelPixelSize = modelName ? this.modelPixelSizeMap.get(modelName) : undefined;
            const effectivePointSize = modelPixelSize !== undefined ? modelPixelSize : this.pointSize;

            // Look up pixelStyle for this model
            // Convert pixelStyle string to number:
            //   "Circle" or "Round" -> 1
            //   "Blended Circle" -> 2
            //   "Square" -> 0
            // Default to circle (1) if not specified in XML
            const modelPixelStyleStr = modelName ? this.modelPixelStyleMap.get(modelName) : undefined;
            let effectivePixelStyle = 1; // Default to circle
            if (modelPixelStyleStr !== undefined) {
                // Convert string to number (case-insensitive)
                const styleLower = modelPixelStyleStr.toLowerCase();
                if (styleLower === 'blended circle') {
                    effectivePixelStyle = 2; // Blended circle with smooth alpha falloff
                } else if (styleLower === 'circle' || styleLower === 'round') {
                    effectivePixelStyle = 1; // Hard-edged circle
                } else if (styleLower === 'square') {
                    effectivePixelStyle = 0; // Square
                } else {
                    // Default to circle for unknown values
                    effectivePixelStyle = 1;
                }
            }

            // Create uniforms with per-group brightness and gamma
            const groupUniforms = {
                ...this.uniforms,
                brightness: groupBrightness,
                gamma: groupGamma,
            };

            // Look up transparency for this model (xLights Transparency: 0–100, 0 = opaque, 100 = transparent)
            // Convert to shader opacity (0.0–1.0, 1.0 = opaque, 0.0 = transparent)
            const modelTransparencyPercent = modelName ? this.modelTransparencyMap.get(modelName) : undefined;
            const effectiveOpacity =
                modelTransparencyPercent !== undefined
                    ? 1.0 - Math.max(0, Math.min(100, modelTransparencyPercent)) / 100.0
                    : 1.0;

            const renderer = new GeometryGroupRenderer(group, this.allPointsCount, groupUniforms, {
                pointSize: effectivePointSize,
                viewPlane: this.viewPlane,
                gamma: groupGamma, // Pass group-specific gamma
                brightness: groupBrightness, // Pass group-specific brightness
                pixelStyle: effectivePixelStyle, // Pass model-specific pixel style
                opacity: effectiveOpacity, // Pass model-specific opacity (derived from xLights Transparency)
            });
            this.renderers.set(group.id, renderer);
        });
    }

    /**
     * Get all point objects for rendering
     */
    getPointObjects(): THREE.Points[] {
        return Array.from(this.renderers.values()).map((renderer) => renderer.points);
    }

    /**
     * Update selection and hover states across all geometries
     */
    updateStates(selectedIds?: Set<string>, hoveredId?: string | null, selectedModelNames?: Set<string>): void {
        // Pre-compute hovered model name using cache for O(1) lookup
        let hoveredModelName: string | null = null;
        if (hoveredId) {
            hoveredModelName = this.pointIdToModelNameCache.get(hoveredId) ?? null;
        }

        // Update each renderer
        this.renderers.forEach((renderer) => {
            renderer.updateStates(selectedIds, hoveredId, hoveredModelName, selectedModelNames);
        });
    }

    /**
     * Update live data colors across all geometries
     */
    updateLiveDataColors(liveData?: LatestFrameRingBuffer): void {
        this.renderers.forEach((renderer) => {
            renderer.updateLiveDataColors(liveData);
        });
    }

    /**
     * Update time for procedural colors
     */
    updateTime(time: number): void {
        this.renderers.forEach((renderer) => {
            renderer.updateTime(time);
        });
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.renderers.forEach((renderer) => renderer.dispose());
        this.renderers.clear();
    }
}
