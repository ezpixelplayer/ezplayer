/**
 * Geometry grouping system for categorizing points by type/behavior
 * Designed to support future batching of similar geometries
 */

import type { Point3D } from '../../types/model3d';

/**
 * Geometry type identifier - determines rendering behavior
 * Currently uses modelName as proxy, but designed to support explicit types
 */
export type GeometryType = string; // modelName or explicit type like 'floodLight', 'beam', 'houseGeometry'

/**
 * Represents a group of points that share the same rendering characteristics
 */
export interface GeometryGroup {
    /** Unique identifier for this geometry group */
    id: string;
    /** Type/category of geometry (e.g., modelName, 'floodLight', 'beam') */
    type: GeometryType;
    /** Points in this group */
    points: Point3D[];
    /** Original indices in the full points array (for live data mapping) */
    originalIndices: number[];
    /** Start index in the full points array */
    startIndex: number;
}

/**
 * Group points into geometries based on their type/behavior
 * Groups by modelName + brightness + gamma to batch geometries with same rendering properties
 */
export function groupPointsByGeometry(
    points: Point3D[],
    options?: {
        /** Custom grouping function - if provided, overrides default grouping */
        groupBy?: (point: Point3D, index: number) => GeometryType;
    },
): GeometryGroup[] {
    const groupMap = new Map<GeometryType, GeometryGroup>();

    const groupByFn =
        options?.groupBy ||
        ((point: Point3D) => {
            const modelName = point.metadata?.modelName as string | undefined;
            // Get brightness and gamma from point metadata (with defaults)
            const brightness = point.metadata?.brightness ?? 1.0;
            const gamma = point.metadata?.gamma ?? 2.2;
            // Create unique group key: modelName + brightness + gamma
            // This ensures geometries with same rendering properties are batched together
            return `${modelName || 'unknown'}|b${brightness}|g${gamma}`;
        });

    points.forEach((point, originalIndex) => {
        const type = groupByFn(point, originalIndex);

        if (!groupMap.has(type)) {
            groupMap.set(type, {
                id: type,
                type,
                points: [],
                originalIndices: [],
                startIndex: originalIndex,
            });
        }

        const group = groupMap.get(type)!;
        group.points.push(point);
        group.originalIndices.push(originalIndex);
    });

    return Array.from(groupMap.values());
}
