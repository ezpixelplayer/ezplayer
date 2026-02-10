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

    constructor(
        group: GeometryGroup,
        allPointsCount: number,
        uniforms: Partial<PointShaderUniforms>,
        options?: { pointSize?: number; viewPlane?: 'xy' | 'xz' | 'yz' },
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

        // Create shader material
        const materialUniforms = { ...uniforms };
        if (options?.viewPlane) {
            const viewPlaneMap = { xy: 1, xz: 2, yz: 3 };
            materialUniforms.viewPlane = viewPlaneMap[options.viewPlane];
        }
        this.material = createPointShaderMaterial(materialUniforms, {
            size: options?.pointSize || 3.0,
        });

        // Create points object
        this.points = new THREE.Points(this.geometry, this.material);
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
            const isHovered =
                hoveredId === point.id || (hoveredModelName && pointModelName === hoveredModelName);
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

        const latestFrame = liveData.tryReadLatest(0);
        if (!latestFrame?.bytes) {
            // Live data exists but no frame available - use procedural colors
            this.material.uniforms.useLiveData.value = 0.0;
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
                const rByte = latestFrame.bytes[colorIndex];
                const gByte = latestFrame.bytes[colorIndex + 1];
                const bByte = latestFrame.bytes[colorIndex + 2];

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
    private pointIdToModelNameCache: Map<string, string | null> = new Map();
    private cachedHoveredId: string | null = null;
    private cachedHoveredModelName: string | null = null;

    constructor(
        points: Point3D[],
        uniforms: Partial<PointShaderUniforms>,
        options?: { pointSize?: number; viewPlane?: 'xy' | 'xz' | 'yz' },
    ) {
        this.allPoints = points;
        this.allPointsCount = points.length;
        this.uniforms = uniforms;
        this.pointSize = options?.pointSize || 3.0;
        this.viewPlane = options?.viewPlane;
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
            const renderer = new GeometryGroupRenderer(group, this.allPointsCount, this.uniforms, {
                pointSize: this.pointSize,
                viewPlane: this.viewPlane,
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
    updateStates(
        selectedIds?: Set<string>,
        hoveredId?: string | null,
        selectedModelNames?: Set<string>,
    ): void {
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

