import type { Point3D } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';

/**
 * Triangle wave function for color generation
 * Generates a value that ramps from 0 -> 255 -> 0 over one period
 */
export function triangleWave(t: number): number {
    const HALF = 128;
    const period = HALF * 2;
    const tt = ((t % period) + period) % period;
    const v = tt <= HALF ? (tt / HALF) * 255 : ((period - tt) / HALF) * 255;
    return Math.min(255, Math.max(0, Math.round(v)));
}

/**
 * Generate procedural color buffer for all points
 * Uses the same algorithm as the 3D view to ensure consistency
 */
export function generateProceduralColorBuffer(pointCount: number): Uint8Array {
    return new Uint8Array(pointCount * 3);
}

/**
 * Calculate static procedural color for a single point based on its position (no time animation)
 * This is used for initial geometry setup in 2D view
 * Uses the same phase calculation as 3D view but with time=0 to ensure consistency
 */
export function calculateStaticProceduralColor(point: Point3D): [number, number, number] {
    // Use the same phase calculation as the animated version but with time=0
    // This ensures colors match the 3D view when time=0
    const time = 0;
    const phase = point.x * 13 + point.y * 17 + point.z * 19 + time * 90 + 150;

    // RGB with phase offsets (same as animated version)
    const rPhase = phase;
    const gPhase = phase + 341;
    const bPhase = phase + 682;

    // Generate RGB values (no pulse boost for static colors)
    const r = triangleWave(rPhase);
    const g = triangleWave(gPhase);
    const b = triangleWave(bPhase);

    return [r, g, b];
}

/**
 * Calculate procedural color for a single point based on its position and time
 * This matches the 3D view's per-frame color calculation
 */
export function calculateProceduralColor(
    point: Point3D,
    time: number,
    isModelSelected: boolean = false,
): [number, number, number] {
    const HALF = 128;
    const pulseCenter = ((time * 10) % (HALF * 2)) - HALF;

    // Calculate phase: x*13 + y*17 + z*19 + t*90 + offset
    const phase = point.x * 13 + point.y * 17 + point.z * 19 + time * 90 + 150;

    // RGB with phase offsets
    const rPhase = phase;
    const gPhase = phase + 341;
    const bPhase = phase + 682;

    // Calculate pulse effect for selected models
    let pulseBoost = 0;
    if (isModelSelected) {
        const distanceToCenter = Math.abs(phase - pulseCenter);
        pulseBoost = distanceToCenter < HALF ? (1 - distanceToCenter / HALF) * 220 : 0;
    }

    // Generate RGB values
    let r = triangleWave(rPhase) + pulseBoost;
    let g = triangleWave(gPhase) + pulseBoost;
    let b = triangleWave(bPhase) + pulseBoost;

    // Clamp to valid range
    r = Math.min(255, Math.max(0, Math.round(r)));
    g = Math.min(255, Math.max(0, Math.round(g)));
    b = Math.min(255, Math.max(0, Math.round(b)));

    return [r, g, b];
}

/**
 * Check if a point is selected (either individually or as part of a selected model)
 */
export function isPointSelected(
    point: Point3D,
    selectedIds?: Set<string>,
    selectedModelNames?: Set<string>,
): boolean {
    if (selectedIds?.has(point.id)) {
        return true;
    }
    const modelName = point.metadata?.modelName as string | undefined;
    return modelName ? selectedModelNames?.has(modelName) || false : false;
}

/**
 * Check if a model is selected by name
 */
export function isModelSelected(point: Point3D, selectedModelNames?: Set<string>): boolean {
    const modelName = point.metadata?.modelName as string | undefined;
    return modelName ? selectedModelNames?.has(modelName) || false : false;
}

/**
 * Get the color for a point considering selection, hover, and live data
 * Returns RGB values as [r, g, b] in range 0-255
 * 
 * Optimized version: pre-compute hoveredModelName to avoid repeated find() operations
 */
export function getPointColor(
    point: Point3D,
    originalIndex: number,
    options: {
        selectedIds?: Set<string>;
        hoveredId?: string | null;
        hoveredModelName?: string | null; // Pre-computed hovered model name for performance
        selectedModelNames?: Set<string>;
        liveData?: LatestFrameRingBuffer;
        time?: number;
        allPointsCount: number;
    },
): [number, number, number] {
    const { selectedIds, hoveredId, hoveredModelName, selectedModelNames, liveData, time } = options;

    // Get point's model name once (cached for reuse)
    const pointModelName = point.metadata?.modelName as string | undefined;

    // Check selection state (optimized: check model first as it's faster)
    if (pointModelName && selectedModelNames?.has(pointModelName)) {
        return [255, 255, 0]; // Yellow for selected model
    }
    if (selectedIds?.has(point.id)) {
        return [255, 255, 0]; // Yellow for selected point
    }

    // Check hover state (optimized: use pre-computed hoveredModelName)
    if (hoveredModelName && pointModelName === hoveredModelName) {
        return [255, 255, 255]; // White for hovered model
    }
    if (hoveredId === point.id) {
        return [255, 255, 255]; // White for hovered point (fallback)
    }

    // Use live data if available
    if (liveData) {
        const latestFrame = liveData.tryReadLatest(0);
        if (latestFrame?.bytes) {
            const colorIndex = point?.channel ?? originalIndex * 3;
            return [
                latestFrame.bytes[colorIndex],
                latestFrame.bytes[colorIndex + 1],
                latestFrame.bytes[colorIndex + 2],
            ];
        }
    }

    // Use procedural color if time is provided
    if (time !== undefined) {
        return calculateProceduralColor(point, time, false);
    }

    // Fallback: generate static procedural color (for initial geometry setup)
    return calculateStaticProceduralColor(point);
}

/**
 * Generate initial colors for geometry setup
 * This is used when creating the initial buffer geometry before per-frame updates
 * Optimized: pre-computes hoveredModelName once instead of finding it for each point
 */
export function generateInitialColors(
    points: Point3D[],
    originalIndices: number[],
    allPointsCount: number,
    selectedIds?: Set<string>,
    hoveredId?: string | null,
    selectedModelNames?: Set<string>,
    allPoints?: Point3D[], // Required for model-based hover detection
): Uint8Array {
    const colors = new Uint8Array(points.length * 3);

    // Pre-compute hovered model name once (performance optimization)
    let hoveredModelName: string | null = null;
    if (hoveredId && allPoints) {
        const hoveredPoint = allPoints.find((p) => p.id === hoveredId);
        if (hoveredPoint) {
            hoveredModelName = (hoveredPoint.metadata?.modelName as string | undefined) || null;
        }
    }

    points.forEach((point, i) => {
        const originalIndex = originalIndices[i];

        // Get color using optimized shared logic
        const [r, g, b] = getPointColor(point, originalIndex, {
            selectedIds,
            hoveredId,
            hoveredModelName,
            selectedModelNames,
            allPointsCount,
        });

        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
    });

    return colors;
}

