import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import type { Point3D, Shape3D, ModelMetadata, ViewObject } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { GeometryManager } from './geometryManager';
import { getGammaFromModelConfiguration } from './pointShaders';
import { HouseMesh } from './HouseMesh';
import { ImagePlane } from './ImagePlane';
import { MovingHeadBeams } from './MovingHeadBeams';
import type { MhFixtureInfo } from 'xllayoutcalcs';
import type { AssetResolver } from '../../services/assetResolver';

export interface CameraState3D {
    position: [number, number, number];
    target: [number, number, number];
    quaternion: [number, number, number, number];
}

export interface Viewer3DProps {
    points: Point3D[];
    shapes?: Shape3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    showStats?: boolean;
    pointSize?: number; // Base point size (will be multiplied by pixelSizeMultiplier)
    selectedModelNames?: Set<string>;
    modelMetadata?: ModelMetadata[];
    viewObjects?: ViewObject[];
    frameServerUrl?: string;
    /**
     * Resolves an asset path (mesh / texture / image) to a fetchable URL. Built by
     * `Preview3D` from `layoutAssets` + `frameServerUrl`. When omitted, leaves fall back
     * to constructing show-file URLs from `frameServerUrl` directly (legacy behaviour).
     */
    assetResolver?: AssetResolver;
    movingHeadFixtures?: MhFixtureInfo[];
    backgroundBrightness?: number; // 0-100, affects background images only
    brightnessMultiplier?: number; // 0-200, slider multiplier to apply to view object brightness
    pixelSizeMultiplier?: number; // Multiplier for pixel size (from settings)
    cameraState?: CameraState3D | null; // Saved camera state to restore
    onCameraStateChange?: (state: CameraState3D) => void; // Callback when camera state changes
    shouldAutoFit?: boolean; // Whether to auto-fit camera (for reset view)
    onAutoFitComplete?: () => void; // Callback when auto-fit completes
    cameraStateLoaded?: boolean; // Whether camera state has been loaded from storage
    onGetCurrentCameraState?: (getter: () => CameraState3D | null) => void; // Callback to register a function that gets current camera state
    /** When true, omit fixed minHeight so the canvas fills a flex parent (e.g. dialog). */
    fillContainer?: boolean;
    /** Force OrbitControls (the trackpad/touch variant) regardless of input detection.
     *  Used by the layout-edit visual mode where click-to-select + orbit/pan/zoom
     *  is the desired interaction model on every device. */
    forceOrbitControls?: boolean;
}

// Optimized point cloud rendering using shader-based geometry batches
function OptimizedPointCloud({
    points,
    liveData,
    selectedIds,
    hoveredId,
    pointSize,
    selectedModelNames,
    modelMetadata,
    pixelSizeMultiplier,
}: {
    points: Point3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    pointSize?: number;
    selectedModelNames?: Set<string>;
    modelMetadata?: ModelMetadata[];
    onPointClick?: (pointId: string) => void;
    pixelSizeMultiplier?: number;
}) {
    const animationTimeRef = useRef(0);
    const geometryManagerRef = useRef<GeometryManager | null>(null);
    const [group, setGroup] = useState<THREE.Group | null>(null);

    // Initialize geometry manager
    useEffect(() => {
        if (!points || points.length === 0) {
            setGroup(null);
            return;
        }

        // Clean up previous geometry manager and group first
        const prevManager = geometryManagerRef.current;
        if (prevManager) {
            prevManager.dispose();
            geometryManagerRef.current = null;
        }
        setGroup(null); // Clear old group immediately

        // Extract gamma explicitly from model configuration (or use default)
        const gamma = getGammaFromModelConfiguration(points);

        // Create map of modelName -> pixelSize from model metadata
        const modelPixelSizeMap = new Map<string, number>();
        // Create map of modelName -> pixelStyle from model metadata
        const modelPixelStyleMap = new Map<string, string>();
        // Create map of modelName -> transparency (0–100) from model metadata
        const modelTransparencyMap = new Map<string, number>();
        if (modelMetadata) {
            modelMetadata.forEach((model) => {
                if (model.pixelSize !== undefined) {
                    modelPixelSizeMap.set(model.name, model.pixelSize);
                }
                if (model.pixelStyle !== undefined) {
                    modelPixelStyleMap.set(model.name, model.pixelStyle);
                }
                if (model.transparency !== undefined) {
                    modelTransparencyMap.set(model.name, model.transparency);
                }
            });
        }

        const uniforms = {
            time: 0,
            brightness: 1.0,
            // Note: gamma is passed explicitly via options, not hardcoded here
            selectedColor: new THREE.Vector3(1.0, 1.0, 0.0), // Yellow
            hoveredColor: new THREE.Vector3(1.0, 1.0, 1.0), // White
            useLiveData: 0.0,
            totalPointCount: points.length,
        };

        const manager = new GeometryManager(points, uniforms, {
            pointSize: pointSize,
            gamma,
            modelPixelSizeMap,
            modelPixelStyleMap,
            modelTransparencyMap,
            pixelSizeMultiplier: pixelSizeMultiplier ?? 1.0,
        });
        manager.initializeGroups();
        geometryManagerRef.current = manager;

        // Create group to hold all point objects
        const nextGroup = new THREE.Group();
        manager.getPointObjects().forEach((pointsObj) => {
            nextGroup.add(pointsObj);
        });
        setGroup(nextGroup);

        return () => {
            if (geometryManagerRef.current) {
                geometryManagerRef.current.dispose();
                geometryManagerRef.current = null;
            }
            setGroup(null);
        };
        // NOTE: pixelSizeMultiplier is intentionally excluded — it is applied
        // via a cheap uniform update in useFrame, not a full geometry rebuild.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [points, pointSize, modelMetadata]);

    // Keep pixelSizeMultiplier in a ref so useFrame can apply it cheaply.
    const pixelSizeMultiplierRef = useRef(pixelSizeMultiplier ?? 1.0);
    pixelSizeMultiplierRef.current = pixelSizeMultiplier ?? 1.0;

    // Track selection/hover in refs so changes are applied in the render
    // loop without triggering React re-render cascades.
    const selectedIdsRef = useRef(selectedIds);
    const hoveredIdRef = useRef(hoveredId);
    const selectedModelNamesRef = useRef(selectedModelNames);
    selectedIdsRef.current = selectedIds;
    hoveredIdRef.current = hoveredId;
    selectedModelNamesRef.current = selectedModelNames;

    const prevSelectionRef = useRef<{
        selectedIds?: Set<string>;
        hoveredId?: string | null;
        selectedModelNames?: Set<string>;
    }>({});

    // Single useFrame handles selection updates, animation, and multiplier changes
    useFrame((_state, delta) => {
        if (!geometryManagerRef.current) return;

        // Apply pixel-size multiplier changes (cheap uniform update, < 1ms)
        geometryManagerRef.current.updatePixelSizeMultiplier(pixelSizeMultiplierRef.current);

        // Apply selection/hover changes (ref-based, no React effect needed)
        const prev = prevSelectionRef.current;
        if (
            prev.selectedIds !== selectedIdsRef.current ||
            prev.hoveredId !== hoveredIdRef.current ||
            prev.selectedModelNames !== selectedModelNamesRef.current
        ) {
            geometryManagerRef.current.updateStates(
                selectedIdsRef.current,
                hoveredIdRef.current,
                selectedModelNamesRef.current,
            );
            prevSelectionRef.current = {
                selectedIds: selectedIdsRef.current,
                hoveredId: hoveredIdRef.current,
                selectedModelNames: selectedModelNamesRef.current,
            };
        }

        animationTimeRef.current += delta;

        // Update time for procedural colors
        geometryManagerRef.current.updateTime(animationTimeRef.current);

        // Update live data colors
        geometryManagerRef.current.updateLiveDataColors(liveData);
    });

    const primitiveKey = `point-cloud-${points.length}`;

    if (!group) return null;

    return <primitive key={primitiveKey} object={group} />;
}

// Component to handle click events with raycasting
function ClickHandler({
    points,
    onPointClick,
    pointSize,
}: {
    points: Point3D[];
    onPointClick?: (pointId: string) => void;
    pointSize?: number;
}) {
    const { camera, raycaster, gl } = useThree();

    // Pre-compute 3D positions once when points change (same pattern as HoverHandler)
    const pointPositionsRef = useRef<THREE.Vector3[]>([]);
    const centerPointRef = useRef<THREE.Vector3 | null>(null);
    useEffect(() => {
        if (points.length === 0) {
            pointPositionsRef.current = [];
            centerPointRef.current = null;
            return;
        }
        pointPositionsRef.current = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        centerPointRef.current = new THREE.Vector3(points[0].x, points[0].y, points[0].z);
    }, [points]);

    useEffect(() => {
        if (!onPointClick) return;

        const handleClick = (event: MouseEvent) => {
            // Get mouse position in normalized device coordinates
            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update raycaster with camera and mouse position
            raycaster.setFromCamera(mouse, camera);

            // Use pre-computed positions instead of allocating on every click
            const pointPositions = pointPositionsRef.current;
            if (pointPositions.length === 0) return;

            const pointSizeValue = pointSize || 3.0;

            // Calculate threshold based on point size and camera distance
            const cameraDistance = centerPointRef.current ? camera.position.distanceTo(centerPointRef.current) : 1000;
            const threshold = Math.max(pointSizeValue * 0.05, cameraDistance * 0.01);

            // Find the closest point to the ray
            let closestIndex = -1;
            let minDistance = Infinity;

            for (let i = 0; i < pointPositions.length; i++) {
                const distance = raycaster.ray.distanceToPoint(pointPositions[i]);
                if (distance < threshold && distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                }
            }

            // If a point was found, trigger click handler
            if (closestIndex >= 0 && closestIndex < points.length) {
                onPointClick(points[closestIndex].id);
            }
        };

        gl.domElement.addEventListener('click', handleClick);
        return () => {
            gl.domElement.removeEventListener('click', handleClick);
        };
    }, [onPointClick, points, raycaster, camera, gl, pointSize]);

    return null;
}

// Component to handle hover events with raycasting
function HoverHandler({
    points,
    onPointHover,
    pointSize,
}: {
    points: Point3D[];
    onPointHover?: (pointId: string | null) => void;
    pointSize?: number;
}) {
    const { camera, raycaster, gl } = useThree();

    // Memoize 3D point positions to avoid recreating them on every mousemove
    const pointPositionsRef = useRef<THREE.Vector3[]>([]);
    const centerPointRef = useRef<THREE.Vector3 | null>(null);
    const currentHoveredIdRef = useRef<string | null>(null);
    const lastUpdateTimeRef = useRef<number>(0);
    const throttleDelay = 16; // ~60fps max update rate

    // Pre-compute point positions when points change
    useEffect(() => {
        if (points.length === 0) {
            pointPositionsRef.current = [];
            centerPointRef.current = null;
            return;
        }

        // Pre-compute all 3D positions once
        pointPositionsRef.current = points.map((p) => new THREE.Vector3(p.x, p.y, p.z));

        // Pre-compute center point for camera distance calculation
        const firstPoint = points[0];
        centerPointRef.current = new THREE.Vector3(firstPoint.x, firstPoint.y, firstPoint.z);
    }, [points]);

    useEffect(() => {
        if (!onPointHover) return;

        const handleMouseMove = (event: MouseEvent) => {
            // Throttle updates to ~60fps
            const now = performance.now();
            if (now - lastUpdateTimeRef.current < throttleDelay) {
                return;
            }
            lastUpdateTimeRef.current = now;

            // Get mouse position in normalized device coordinates
            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Update raycaster with camera and mouse position
            raycaster.setFromCamera(mouse, camera);

            // Use pre-computed point positions
            const pointPositions = pointPositionsRef.current;
            if (pointPositions.length === 0) {
                if (currentHoveredIdRef.current !== null) {
                    currentHoveredIdRef.current = null;
                    onPointHover(null);
                }
                return;
            }

            const pointSizeValue = pointSize || 3.0;

            // Calculate threshold based on point size and camera distance
            // Cache camera distance calculation (only recalculate if center point exists)
            const centerPoint = centerPointRef.current;
            const cameraDistance = centerPoint ? camera.position.distanceTo(centerPoint) : 1000; // fallback distance
            const threshold = Math.max(pointSizeValue * 0.15, cameraDistance * 0.02);

            // Find the closest point to the ray
            let closestIndex = -1;
            let minDistance = Infinity;

            // Use pre-computed positions instead of creating new ones
            for (let i = 0; i < pointPositions.length; i++) {
                const distance = raycaster.ray.distanceToPoint(pointPositions[i]);
                if (distance < threshold && distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                }
            }

            // Only update state if hovered point actually changed
            const newHoveredId = closestIndex >= 0 && closestIndex < points.length ? points[closestIndex].id : null;

            if (newHoveredId !== currentHoveredIdRef.current) {
                currentHoveredIdRef.current = newHoveredId;
                onPointHover(newHoveredId);
            }
        };

        const handleMouseLeave = () => {
            // Clear hover when mouse leaves the canvas
            if (currentHoveredIdRef.current !== null) {
                currentHoveredIdRef.current = null;
                onPointHover(null);
            }
        };

        gl.domElement.addEventListener('mousemove', handleMouseMove);
        gl.domElement.addEventListener('mouseleave', handleMouseLeave);
        return () => {
            gl.domElement.removeEventListener('mousemove', handleMouseMove);
            gl.domElement.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [onPointHover, points, raycaster, camera, gl, pointSize]);

    return null;
}

// Custom FPS-style camera controller
// Left drag: freelook (rotate in place). Right drag: orbit around raycast hit.
// Scroll: move forward/back. Keyboard: W/S forward/back, A/D turn, Z/C strafe, Q/E up/down.
function FreelookCameraController({ points, hoveredId }: { points: Point3D[]; hoveredId?: string | null }) {
    const { camera, gl, scene } = useThree();
    const { set } = useThree();

    // Keep hoveredId in a ref so event handlers always see the latest value
    const hoveredIdRef = useRef(hoveredId);
    hoveredIdRef.current = hoveredId;

    // Camera orientation
    const yawRef = useRef(0);
    const pitchRef = useRef(0);

    // Drag state
    const isDraggingRef = useRef(false);
    const dragButtonRef = useRef(-1);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const lastMouseRef = useRef({ x: 0, y: 0 });
    const wasDraggingRef = useRef(false);

    // Right-click orbit state
    const orbitPivotRef = useRef<THREE.Vector3 | null>(null);
    const orbitRadiusRef = useRef(0);
    const orbitStartPosRef = useRef(new THREE.Vector3());
    const orbitStartQuatRef = useRef(new THREE.Quaternion());

    // Right-click center animation: smooth look-at transition before orbit begins
    const centerAnimRef = useRef<{
        startQuat: THREE.Quaternion;
        endQuat: THREE.Quaternion;
        elapsed: number;
        duration: number;
    } | null>(null);

    // Keyboard state
    const keysRef = useRef<Record<string, boolean>>({});
    const holdTimeRef = useRef(0);

    // Controls object registered in R3F store
    const controlsRef = useRef<
        THREE.EventDispatcher<{ change: {} }> & {
            target: THREE.Vector3;
            update: () => void;
            syncFromCamera: () => void;
        }
    >(null!);

    // Helpers — defined as plain functions over refs (stable across renders)
    const applyCameraOrientation = () => {
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRef.current);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchRef.current);
        camera.quaternion.copy(qYaw).multiply(qPitch);
    };

    const updateTarget = () => {
        if (!controlsRef.current) return;
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        controlsRef.current.target.copy(camera.position).addScaledVector(dir, 100);
    };

    const notifyChange = () => {
        updateTarget();
        controlsRef.current?.dispatchEvent({ type: 'change' });
    };

    // Initialize controls object and register in R3F store
    useEffect(() => {
        // Derive initial yaw/pitch from camera's current quaternion
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        yawRef.current = euler.y;
        pitchRef.current = euler.x;

        const target = new THREE.Vector3();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        target.copy(camera.position).addScaledVector(dir, 100);

        const dispatcher = new THREE.EventDispatcher<{ change: {} }>();
        const controlsObj = Object.assign(dispatcher, {
            target,
            update: () => {
                const d = new THREE.Vector3();
                camera.getWorldDirection(d);
                target.copy(camera.position).addScaledVector(d, 100);
            },
            syncFromCamera: () => {
                const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
                yawRef.current = e.y;
                pitchRef.current = e.x;
                const d = new THREE.Vector3();
                camera.getWorldDirection(d);
                target.copy(camera.position).addScaledVector(d, 100);
            },
        });

        controlsRef.current = controlsObj;
        set({ controls: controlsObj as any });

        return () => {
            set({ controls: null as any });
        };
    }, [camera, set]);

    // Pointer + keyboard event listeners
    useEffect(() => {
        const canvas = gl.domElement;
        const DRAG_THRESHOLD = 3;
        const SENSITIVITY = 0.003;
        const PITCH_LIMIT = Math.PI / 2 - 0.01;
        const SCROLL_SPEED = 0.15;

        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0 && e.button !== 2) return;
            // Ignore if we're already tracking a different button
            if (dragButtonRef.current !== -1) return;

            isDraggingRef.current = false;
            dragButtonRef.current = e.button;
            dragStartRef.current = { x: e.clientX, y: e.clientY };
            lastMouseRef.current = { x: e.clientX, y: e.clientY };
            wasDraggingRef.current = false;
            canvas.setPointerCapture(e.pointerId);

            if (e.button === 2) {
                // Use the currently hovered point as the orbit pivot.
                // If nothing is hovered, fall back to mesh raycast.
                let hitPoint: THREE.Vector3 | null = null;

                const hId = hoveredIdRef.current;
                if (hId) {
                    const p = points.find((pt) => pt.id === hId);
                    if (p) hitPoint = new THREE.Vector3(p.x, p.y, p.z);
                }

                // Fallback: standard mesh raycast (houses, image planes, etc.)
                if (!hitPoint) {
                    const rect = canvas.getBoundingClientRect();
                    const ndc = new THREE.Vector2(
                        ((e.clientX - rect.left) / rect.width) * 2 - 1,
                        -((e.clientY - rect.top) / rect.height) * 2 + 1,
                    );
                    const raycaster = new THREE.Raycaster();
                    raycaster.setFromCamera(ndc, camera);
                    const meshHits = raycaster.intersectObjects(scene.children, true);
                    if (meshHits.length > 0) {
                        hitPoint = meshHits[0].point.clone();
                    }
                }

                if (hitPoint) {
                    orbitPivotRef.current = hitPoint;
                    orbitRadiusRef.current = camera.position.distanceTo(hitPoint);

                    // Start a smooth look-at animation toward the pivot
                    const startQuat = camera.quaternion.clone();
                    // Compute the target quaternion (camera looking at the pivot)
                    const tempCam = camera.clone();
                    tempCam.lookAt(hitPoint);
                    const endQuat = tempCam.quaternion.clone();

                    centerAnimRef.current = {
                        startQuat,
                        endQuat,
                        elapsed: 0,
                        duration: 0.25, // seconds
                    };

                    // The orbit start state will be set when the animation finishes
                } else {
                    orbitPivotRef.current = null;
                }
            }
        };

        const onPointerMove = (e: PointerEvent) => {
            if (dragButtonRef.current === -1) return;

            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;

            if (!isDraggingRef.current) {
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                isDraggingRef.current = true;
                wasDraggingRef.current = true;
            }

            if (dragButtonRef.current === 0) {
                // Left drag: freelook (rotate camera in place)
                const moveDx = e.clientX - lastMouseRef.current.x;
                const moveDy = e.clientY - lastMouseRef.current.y;
                lastMouseRef.current = { x: e.clientX, y: e.clientY };

                yawRef.current += moveDx * SENSITIVITY;
                pitchRef.current += moveDy * SENSITIVITY;
                pitchRef.current = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitchRef.current));
                applyCameraOrientation();
                notifyChange();
            } else if (dragButtonRef.current === 2 && orbitPivotRef.current && !centerAnimRef.current) {
                // Right drag: orbit around raycast hit point
                // Rotate both position offset AND camera orientation by the same
                // amount so the initial framing is preserved (no snap).
                const pivot = orbitPivotRef.current;
                const up = new THREE.Vector3(0, 1, 0);

                // Build orbit rotation from total mouse delta
                const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, -dx * SENSITIVITY);
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orbitStartQuatRef.current);
                const pitchQuat = new THREE.Quaternion().setFromAxisAngle(right, -dy * SENSITIVITY);
                const totalRotation = new THREE.Quaternion().multiplyQuaternions(yawQuat, pitchQuat);

                // Rotate the start offset around the pivot
                const startOffset = orbitStartPosRef.current.clone().sub(pivot);
                startOffset.applyQuaternion(totalRotation);
                startOffset.normalize().multiplyScalar(orbitRadiusRef.current);
                camera.position.copy(pivot).add(startOffset);

                // Rotate camera orientation by the same rotation
                camera.quaternion.copy(orbitStartQuatRef.current).premultiply(totalRotation);

                // Re-derive yaw/pitch so freelook continues seamlessly
                const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
                yawRef.current = euler.y;
                pitchRef.current = euler.x;
                notifyChange();
            }
        };

        const onPointerUp = (e: PointerEvent) => {
            canvas.releasePointerCapture(e.pointerId);
            isDraggingRef.current = false;
            dragButtonRef.current = -1;
            orbitPivotRef.current = null;
            centerAnimRef.current = null;
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            let dy = e.deltaY;
            if (e.deltaMode === 1) dy *= 33; // DOM_DELTA_LINE → approx pixels
            if (e.deltaMode === 2) dy *= 100; // DOM_DELTA_PAGE → approx pixels

            // ctrlKey is synthetically set by browsers for trackpad pinch gestures.
            // Pinch values are already small, so use a higher multiplier.
            // Mouse wheel notches (~100) need damping + clamp.
            const isPinch = e.ctrlKey;
            if (!isPinch) {
                dy = Math.max(-150, Math.min(150, dy));
            }
            const baseMultiplier = isPinch ? 1.0 : SCROLL_SPEED;

            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            const dist = camera.position.length() || 100;
            const scaledSpeed = baseMultiplier * Math.max(dist / 100, 0.5);
            camera.position.addScaledVector(dir, -dy * scaledSpeed);
            notifyChange();
        };

        const onContextMenu = (e: Event) => {
            e.preventDefault();
        };

        // Suppress click events after a drag so ClickHandler doesn't fire
        const onClickCapture = (e: MouseEvent) => {
            if (wasDraggingRef.current) {
                e.stopPropagation();
                wasDraggingRef.current = false;
            }
        };

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('contextmenu', onContextMenu);
        canvas.addEventListener('click', onClickCapture, { capture: true });

        // Keyboard listeners
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            keysRef.current[e.key.toLowerCase()] = true;
        };
        const onKeyUp = (e: KeyboardEvent) => {
            keysRef.current[e.key.toLowerCase()] = false;
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        return () => {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('contextmenu', onContextMenu);
            canvas.removeEventListener('click', onClickCapture, { capture: true });
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [camera, gl, scene]);

    // Per-frame: center animation + keyboard movement
    useFrame((_state, delta) => {
        // Animate smooth look-at transition on right-click before orbit starts
        const anim = centerAnimRef.current;
        if (anim) {
            anim.elapsed += delta;
            const t = Math.min(anim.elapsed / anim.duration, 1);
            // Smooth ease-out curve
            const ease = 1 - (1 - t) * (1 - t);
            camera.quaternion.copy(anim.startQuat).slerp(anim.endQuat, ease);

            // Sync yaw/pitch from the interpolated quaternion
            const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
            yawRef.current = euler.y;
            pitchRef.current = euler.x;
            notifyChange();

            if (t >= 1) {
                // Animation complete — snapshot current state as orbit start
                orbitStartPosRef.current.copy(camera.position);
                orbitStartQuatRef.current.copy(camera.quaternion);
                centerAnimRef.current = null;
            }
        }

        const keys = keysRef.current;
        const anyMovement = keys.w || keys.s || keys.z || keys.c || keys.q || keys.e || keys.a || keys.d;
        if (!anyMovement) {
            holdTimeRef.current = 0;
            return;
        }

        holdTimeRef.current += delta;

        const accelFactor = Math.min(1 + holdTimeRef.current * 3.0, 4.0);
        const speed = Math.min(120 * accelFactor, 900) * delta;

        // Ground-plane directions
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const up = camera.up.clone().normalize();
        const forwardOnPlane = forward.sub(up.clone().multiplyScalar(forward.dot(up))).normalize();
        if (!Number.isFinite(forwardOnPlane.x) || forwardOnPlane.lengthSq() < 1e-8) {
            camera.getWorldDirection(forwardOnPlane);
            forwardOnPlane.normalize();
        }
        const rightOnPlane = new THREE.Vector3().crossVectors(forwardOnPlane, up).normalize();

        const movement = new THREE.Vector3();
        if (keys.w) movement.addScaledVector(forwardOnPlane, speed);
        if (keys.s) movement.addScaledVector(forwardOnPlane, -speed);
        if (keys.c) movement.addScaledVector(rightOnPlane, speed);
        if (keys.z) movement.addScaledVector(rightOnPlane, -speed);
        if (keys.e) movement.addScaledVector(up, speed);
        if (keys.q) movement.addScaledVector(up, -speed);

        camera.position.add(movement);

        // A/D: yaw (turn head left/right)
        const turnRate = 0.5 * accelFactor;
        let yawDelta = 0;
        if (keys.a) yawDelta += turnRate * delta;
        if (keys.d) yawDelta -= turnRate * delta;
        if (yawDelta !== 0) {
            yawRef.current += yawDelta;
            applyCameraOrientation();
        }

        notifyChange();
    });

    return null;
}

function SceneContent({
    points,
    shapes,
    liveData,
    selectedIds,
    hoveredId,
    onPointClick,
    onPointHover,
    pointSize,
    selectedModelNames,
    modelMetadata,
    viewObjects,
    frameServerUrl,
    assetResolver,
    movingHeadFixtures,
    backgroundBrightness: _backgroundBrightness,
    brightnessMultiplier,
    pixelSizeMultiplier,
    cameraState,
    onCameraStateChange,
    shouldAutoFit,
    onAutoFitComplete,
    cameraStateLoaded,
    onGetCurrentCameraState,
}: {
    points: Point3D[];
    shapes?: Shape3D[];
    liveData?: LatestFrameRingBuffer;
    selectedIds?: Set<string>;
    hoveredId?: string | null;
    onPointClick?: (pointId: string) => void;
    onPointHover?: (pointId: string | null) => void;
    pointSize?: number;
    selectedModelNames?: Set<string>;
    modelMetadata?: ModelMetadata[];
    viewObjects?: ViewObject[];
    frameServerUrl?: string;
    /**
     * Resolves an asset path (mesh / texture / image) to a fetchable URL. Built by
     * `Preview3D` from `layoutAssets` + `frameServerUrl`. When omitted, leaves fall back
     * to constructing show-file URLs from `frameServerUrl` directly (legacy behaviour).
     */
    assetResolver?: AssetResolver;
    movingHeadFixtures?: MhFixtureInfo[];
    backgroundBrightness?: number;
    brightnessMultiplier?: number;
    pixelSizeMultiplier?: number;
    cameraState?: CameraState3D | null;
    onCameraStateChange?: (state: CameraState3D) => void;
    shouldAutoFit?: boolean;
    onAutoFitComplete?: () => void;
    cameraStateLoaded?: boolean;
    onGetCurrentCameraState?: (getter: () => CameraState3D | null) => void;
}) {
    const { camera, controls } = useThree();
    const hasRestoredCameraRef = useRef(false);
    const lastCameraStateRef = useRef<CameraState3D | null>(null);
    const lastCameraStatePropRef = useRef<CameraState3D | null | undefined>(cameraState);
    const [restoreTrigger, setRestoreTrigger] = useState(0);

    // Keep onGetCurrentCameraState in a ref so the camera-tracking effect
    // doesn't tear down / rebuild every time Preview3D re-renders with a new
    // inline callback reference.
    const onGetCurrentCameraStateRef = useRef(onGetCurrentCameraState);
    onGetCurrentCameraStateRef.current = onGetCurrentCameraState;

    // Reset restore flag when cameraState prop changes (compare by value, not reference)
    useEffect(() => {
        const currentStateStr = JSON.stringify(cameraState);
        const lastStateStr = JSON.stringify(lastCameraStatePropRef.current);
        if (currentStateStr !== lastStateStr) {
            hasRestoredCameraRef.current = false;
            setRestoreTrigger((prev) => prev + 1);
            lastCameraStatePropRef.current = cameraState;
        }
    }, [cameraState]);

    // Restore saved camera state
    useEffect(() => {
        // Wait for camera state to be loaded before attempting restore
        if (cameraStateLoaded === false) {
            return;
        }

        // If no camera state to restore, skip
        if (!cameraState) {
            return;
        }

        // Wait for scene to be ready
        if (points.length === 0 && (!viewObjects || viewObjects.length === 0)) {
            return;
        }

        // If already restored this camera state, skip
        if (hasRestoredCameraRef.current) {
            return;
        }

        // Wait for controls to be ready - retry with a delay if not ready
        if (!controls) {
            const retryTimeout = setTimeout(() => {
                setRestoreTrigger((prev) => prev + 1);
            }, 100);
            return () => clearTimeout(retryTimeout);
        }

        const ctrl = controls as unknown as { target: THREE.Vector3; update?: () => void; syncFromCamera?: () => void };
        if (!ctrl || !ctrl.target) {
            const retryTimeout = setTimeout(() => {
                setRestoreTrigger((prev) => prev + 1);
            }, 100);
            return () => clearTimeout(retryTimeout);
        }

        // Restore camera position and rotation
        camera.position.set(cameraState.position[0], cameraState.position[1], cameraState.position[2]);
        camera.quaternion.set(
            cameraState.quaternion[0],
            cameraState.quaternion[1],
            cameraState.quaternion[2],
            cameraState.quaternion[3],
        );
        camera.updateMatrixWorld();

        // Sync controller state (yaw/pitch/target) from the restored quaternion
        if (ctrl.syncFromCamera) {
            ctrl.syncFromCamera();
        } else if (ctrl.update) {
            ctrl.update();
        }

        // Mark as restored after ensuring the values are set
        // Use a small delay to ensure the camera state is fully applied
        const restoreTimeout = setTimeout(() => {
            hasRestoredCameraRef.current = true;
        }, 100);

        return () => {
            clearTimeout(restoreTimeout);
        };
    }, [cameraState, camera, controls, points.length, viewObjects, cameraStateLoaded, restoreTrigger]);

    // Reset restore flag when shouldAutoFit becomes true
    useEffect(() => {
        if (shouldAutoFit) {
            hasRestoredCameraRef.current = false;
        }
    }, [shouldAutoFit]);

    // Auto-fit camera to scene (including house meshes)
    useEffect(() => {
        if (points.length === 0 && (!viewObjects || viewObjects.length === 0)) return;

        // Wait for camera state to be loaded before deciding whether to auto-fit
        if (cameraStateLoaded === false) {
            return;
        }

        // If we have a saved camera state, NEVER auto-fit unless explicitly requested
        // (restoration will happen in the restore effect)
        if (cameraState && !shouldAutoFit) {
            // Only skip if restoration hasn't completed yet - give it one more frame
            if (!hasRestoredCameraRef.current) {
                // Defer to next frame to allow restore to complete
                requestAnimationFrame(() => {
                    // If still not restored after a frame, restoration might have failed
                    // but we still won't auto-fit if cameraState exists
                });
                return;
            }
            // Restoration completed, skip auto-fit
            return;
        }

        const box = new THREE.Box3();

        // Include points
        points.forEach((point) => {
            box.expandByPoint(new THREE.Vector3(point.x, point.y, point.z));
        });

        // Include shapes
        if (shapes) {
            shapes.forEach((shape) => {
                box.expandByPoint(new THREE.Vector3(shape.position.x, shape.position.y, shape.position.z));
            });
        }

        // Include house meshes and image planes (viewObjects) in bounding box calculation
        if (viewObjects) {
            viewObjects.forEach((viewObj) => {
                if (viewObj.displayAs === 'Mesh' && viewObj.active !== false) {
                    // Add the house position to the bounding box
                    // Account for scale - estimate size based on typical house dimensions
                    // Scale values are multipliers, so estimate house is ~10-20 units in OBJ file
                    const baseHouseSize = 15; // Estimated base size of house in OBJ file units
                    const maxScale = Math.max(viewObj.scaleX, viewObj.scaleY, viewObj.scaleZ);
                    const estimatedSize = baseHouseSize * maxScale;
                    const halfSize = estimatedSize / 2;

                    // Add corners of the bounding box for the house
                    box.expandByPoint(
                        new THREE.Vector3(
                            viewObj.worldPosX - halfSize,
                            viewObj.worldPosY - halfSize,
                            viewObj.worldPosZ - halfSize,
                        ),
                    );
                    box.expandByPoint(
                        new THREE.Vector3(
                            viewObj.worldPosX + halfSize,
                            viewObj.worldPosY + halfSize,
                            viewObj.worldPosZ + halfSize,
                        ),
                    );

                    // Also add the center point
                    box.expandByPoint(new THREE.Vector3(viewObj.worldPosX, viewObj.worldPosY, viewObj.worldPosZ));
                }
                if (viewObj.displayAs === 'Image' && viewObj.active !== false) {
                    box.expandByPoint(new THREE.Vector3(viewObj.worldPosX, viewObj.worldPosY, viewObj.worldPosZ));
                }
            });
        }

        // If box is empty, set a default
        if (box.isEmpty()) {
            box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 100, 100));
        }

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 100;
        const distance = maxDim * 2.5;

        camera.position.set(center.x + distance, center.y + distance, center.z + distance);
        camera.lookAt(center);

        // Sync controller state from the new camera orientation
        if (controls && 'syncFromCamera' in controls) {
            (controls as unknown as { syncFromCamera: () => void }).syncFromCamera();
        } else if (controls && 'update' in controls) {
            (controls as unknown as { update: () => void }).update();
        }

        // Reset the restore flag when auto-fitting
        hasRestoredCameraRef.current = false;

        // Notify that auto-fit completed
        if (shouldAutoFit && onAutoFitComplete) {
            requestAnimationFrame(() => {
                onAutoFitComplete?.();
            });
        }
    }, [
        points,
        shapes,
        viewObjects,
        camera,
        controls,
        cameraState,
        shouldAutoFit,
        onAutoFitComplete,
        cameraStateLoaded,
    ]);

    // Register a getter so Preview3D can read the exact camera state on demand
    // (e.g. when the user clicks "Ok" or switches view modes).
    // This is intentionally separate from any change-tracking so it works even
    // when onCameraStateChange is not provided.
    useEffect(() => {
        if (!controls) return;

        const orbitControls = controls as unknown as { target: THREE.Vector3 };
        if (!orbitControls?.target) return;

        const getCurrentStateFn = (): CameraState3D | null => {
            return {
                position: [camera.position.x, camera.position.y, camera.position.z],
                target: [orbitControls.target.x, orbitControls.target.y, orbitControls.target.z],
                quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
            };
        };

        if (onGetCurrentCameraStateRef.current) {
            onGetCurrentCameraStateRef.current(getCurrentStateFn);
        }
    }, [camera, controls]);

    // Optional: track camera state changes and notify parent via throttled callback.
    // This is only active when onCameraStateChange is provided.
    useEffect(() => {
        if (!onCameraStateChange || !controls) return;

        const orbitControls = controls as unknown as { target: THREE.Vector3 };
        if (!orbitControls?.target) return;

        let timeoutId: NodeJS.Timeout | null = null;
        const throttledUpdate = () => {
            if (timeoutId) return;
            timeoutId = setTimeout(() => {
                const state: CameraState3D = {
                    position: [camera.position.x, camera.position.y, camera.position.z],
                    target: [orbitControls.target.x, orbitControls.target.y, orbitControls.target.z],
                    quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
                };
                const stateStr = JSON.stringify(state);
                const lastStr = JSON.stringify(lastCameraStateRef.current);
                if (stateStr !== lastStr) {
                    lastCameraStateRef.current = state;
                    onCameraStateChange(state);
                }
                timeoutId = null;
            }, 100);
        };

        const controlsObj = controls as unknown as {
            addEventListener?: (event: string, handler: () => void) => void;
            removeEventListener?: (event: string, handler: () => void) => void;
        };
        if (controlsObj.addEventListener) {
            controlsObj.addEventListener('change', throttledUpdate);
        }

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            if (controlsObj.removeEventListener) {
                controlsObj.removeEventListener('change', throttledUpdate);
            }
        };
    }, [camera, controls, onCameraStateChange]);

    return (
        <>
            <ClickHandler points={points} onPointClick={onPointClick} pointSize={pointSize} />
            <HoverHandler points={points} onPointHover={onPointHover} pointSize={pointSize} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            <pointLight position={[-10, -10, -10]} intensity={0.5} />

            <OptimizedPointCloud
                points={points}
                liveData={liveData}
                selectedIds={selectedIds}
                hoveredId={hoveredId}
                pointSize={pointSize}
                selectedModelNames={selectedModelNames}
                modelMetadata={modelMetadata}
                onPointClick={onPointClick}
                pixelSizeMultiplier={pixelSizeMultiplier}
            />

            {/* Render house meshes from view objects */}
            {viewObjects?.map((viewObj) => {
                if (viewObj.displayAs === 'Mesh' && viewObj.objFile && viewObj.active !== false) {
                    // Calculate brightness for this view object: xmlBrightness * (sliderMultiplier / 100)
                    // Use ONLY the view object's own brightness from XML, multiplied by the slider
                    // Do NOT use background brightness - only use the house model's brightness
                    const viewObjectXmlBrightness = viewObj.brightness;

                    if (viewObjectXmlBrightness === undefined || viewObjectXmlBrightness === null) {
                        // If no brightness in XML, pass undefined so HouseMesh uses viewObject.brightness
                        return (
                            <HouseMesh
                                key={viewObj.name}
                                viewObject={viewObj}
                                frameServerUrl={frameServerUrl}
                                liveData={liveData}
                                points={points}
                                backgroundBrightness={undefined}
                            />
                        );
                    }

                    // Calculate brightness: house model XML brightness * (slider / 100)
                    // This ensures we ONLY use the house model's brightness, never background brightness
                    const calculatedBrightness =
                        brightnessMultiplier !== undefined
                            ? viewObjectXmlBrightness * (brightnessMultiplier / 100)
                            : viewObjectXmlBrightness;

                    return (
                        <HouseMesh
                            key={viewObj.name}
                            viewObject={viewObj}
                            frameServerUrl={frameServerUrl}
                            assetResolver={assetResolver}
                            liveData={liveData}
                            points={points}
                            backgroundBrightness={calculatedBrightness}
                        />
                    );
                }
                return null;
            })}

            {/* Render image planes from view objects */}
            {viewObjects?.map((viewObj) => {
                if (viewObj.displayAs === 'Image' && viewObj.imageFile && viewObj.active !== false) {
                    // Image *models* drive their own brightness from live channel data
                    // via the ImagePlane shader path — ignore the view-object brightness slider.
                    if (viewObj.imageInfo) {
                        return (
                            <ImagePlane
                                key={viewObj.name}
                                viewObject={viewObj}
                                frameServerUrl={frameServerUrl}
                                assetResolver={assetResolver}
                                liveData={liveData}
                            />
                        );
                    }

                    // Calculate brightness for this image view object: xmlBrightness * (sliderMultiplier / 100)
                    // Use ONLY the view object's own brightness from XML, multiplied by the slider
                    // Do NOT use background brightness - only use the view object's brightness
                    const viewObjectXmlBrightness = viewObj.brightness;

                    if (viewObjectXmlBrightness === undefined || viewObjectXmlBrightness === null) {
                        // If no brightness in XML, pass undefined so ImagePlane uses viewObject.brightness
                        return (
                            <ImagePlane
                                key={viewObj.name}
                                viewObject={viewObj}
                                frameServerUrl={frameServerUrl}
                                assetResolver={assetResolver}
                                backgroundBrightness={undefined}
                            />
                        );
                    }

                    // Calculate brightness: view object XML brightness * (slider / 100)
                    // This ensures we ONLY use the view object's brightness, never background brightness
                    const calculatedBrightness =
                        brightnessMultiplier !== undefined
                            ? viewObjectXmlBrightness * (brightnessMultiplier / 100)
                            : viewObjectXmlBrightness;

                    return (
                        <ImagePlane
                            key={viewObj.name}
                            viewObject={viewObj}
                            frameServerUrl={frameServerUrl}
                            assetResolver={assetResolver}
                            backgroundBrightness={calculatedBrightness}
                        />
                    );
                }
                return null;
            })}

            {/* Render DMX moving head fixture bodies and beams */}
            {movingHeadFixtures && movingHeadFixtures.length > 0 && (
                <MovingHeadBeams fixtures={movingHeadFixtures} liveData={liveData} />
            )}
        </>
    );
}

export const Viewer3D: React.FC<Viewer3DProps> = ({
    points,
    shapes,
    liveData,
    selectedIds,
    hoveredId,
    onPointClick,
    onPointHover,
    showStats = false,
    pointSize = 1.2,
    selectedModelNames,
    modelMetadata,
    viewObjects,
    frameServerUrl,
    assetResolver,
    movingHeadFixtures,
    backgroundBrightness = 100,
    brightnessMultiplier = 100,
    pixelSizeMultiplier = 1.0,
    cameraState,
    onCameraStateChange,
    shouldAutoFit,
    onAutoFitComplete,
    cameraStateLoaded = true,
    onGetCurrentCameraState,
    fillContainer = false,
    forceOrbitControls = false,
}) => {
    const [error, setError] = useState<string | null>(null);

    // Detect touch-only devices (tablets, kiosks) via runtime input detection.
    // Media queries are unreliable on Windows kiosks, so we detect based on
    // actual input: default to touch mode if the device has touch support,
    // then switch to mouse mode on the first real mouse event.
    const [isTouchOnly, setIsTouchOnly] = useState(() => {
        if (typeof window === 'undefined') return false;
        return navigator.maxTouchPoints > 0;
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        // If we defaulted to touch mode, listen for a real mouse event to switch.
        // mousemove with non-zero movement means an actual mouse, not a touch-generated event.
        if (!isTouchOnly) return;
        const onMouseMove = (e: MouseEvent) => {
            if (e.movementX !== 0 || e.movementY !== 0) {
                setIsTouchOnly(false);
                window.removeEventListener('mousemove', onMouseMove);
            }
        };
        window.addEventListener('mousemove', onMouseMove);
        return () => window.removeEventListener('mousemove', onMouseMove);
    }, [isTouchOnly]);

    // Show empty state if no points
    if (!points || points.length === 0) {
        return (
            <Box
                sx={{
                    width: '100%',
                    height: '100%',
                    minHeight: fillContainer ? 0 : 600,
                    position: 'relative',
                    backgroundColor: '#191919',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flexDirection: 'column',
                    gap: 2,
                    p: 3,
                }}
            >
                <Typography
                    variant="h6"
                    color="text.secondary"
                    sx={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.7)' }}
                >
                    No layout in the selected show folder.
                </Typography>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                width: '100%',
                height: '100%',
                minHeight: fillContainer ? 0 : 600,
                position: 'relative',
                backgroundColor: '#191919',
            }}
        >
            {/* Control hints overlay */}
            <Box
                sx={{
                    position: 'absolute',
                    bottom: 16,
                    left: 16,
                    zIndex: 1000,
                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: 1,
                    fontSize: '0.75rem',
                    pointerEvents: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                }}
            >
                <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                >
                    Controls:
                </Typography>
                {isTouchOnly ? (
                    <>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            👆 One finger: Rotate
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            👆 Two fingers: Pan / Zoom
                        </Typography>
                    </>
                ) : forceOrbitControls ? (
                    // Orbit hints must mirror the OrbitControls mouseButtons mapping
                    // below — change them together if you remap LEFT/MIDDLE/RIGHT.
                    <>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            🖱️ Left drag: Rotate
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            🖱️ Right drag: Pan
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            🖱️ Scroll / Middle drag: Zoom
                        </Typography>
                    </>
                ) : (
                    <>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            🖱️ Left drag: Look around
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            🖱️ Right drag: Orbit object
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            🖱️ Scroll: Move forward/back
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: 'rgba(255, 255, 255, 0.95)', textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
                        >
                            ⌨️ W/S: Move &nbsp; A/D: Turn &nbsp; Z/C: Strafe &nbsp; Q/E: Down/Up
                        </Typography>
                    </>
                )}
            </Box>
            {error ? (
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100%',
                        color: 'error.main',
                        p: 2,
                        flexDirection: 'column',
                        gap: 1,
                    }}
                >
                    <Typography variant="body2">Error rendering 3D view: {error}</Typography>
                    <Typography variant="caption" color="text.secondary">
                        Check the browser console for more details
                    </Typography>
                </Box>
            ) : (
                <Box
                    sx={{
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                        zIndex: 1,
                    }}
                >
                    <Canvas
                        onCreated={({ gl }) => {
                            gl.setClearColor('#191919', 1);
                            if (!gl.getContext()) {
                                setError('Failed to create WebGL context');
                            }
                        }}
                        gl={{
                            antialias: true,
                            alpha: false,
                            powerPreference: 'high-performance',
                        }}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                        }}
                    >
                        <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={75} near={0.1} far={50000} />
                        {isTouchOnly || forceOrbitControls ? (
                            <OrbitControls
                                makeDefault
                                enableDamping
                                dampingFactor={0.35}
                                minDistance={10}
                                maxDistance={10000}
                                enablePan={true}
                                enableRotate={true}
                                enableZoom={true}
                                zoomToCursor={true}
                                panSpeed={1.0}
                                rotateSpeed={1.0}
                                zoomSpeed={1.0}
                                mouseButtons={{
                                    LEFT: THREE.MOUSE.ROTATE,
                                    MIDDLE: THREE.MOUSE.DOLLY,
                                    RIGHT: THREE.MOUSE.PAN,
                                }}
                                touches={{
                                    ONE: THREE.TOUCH.ROTATE,
                                    TWO: THREE.TOUCH.DOLLY_PAN,
                                }}
                            />
                        ) : (
                            <FreelookCameraController points={points} hoveredId={hoveredId} />
                        )}
                        <SceneContent
                            points={points}
                            shapes={shapes}
                            liveData={liveData}
                            selectedIds={selectedIds}
                            hoveredId={hoveredId}
                            onPointClick={onPointClick}
                            onPointHover={onPointHover}
                            pointSize={pointSize}
                            selectedModelNames={selectedModelNames}
                            modelMetadata={modelMetadata}
                            viewObjects={viewObjects}
                            frameServerUrl={frameServerUrl}
                            assetResolver={assetResolver}
                            movingHeadFixtures={movingHeadFixtures}
                            backgroundBrightness={backgroundBrightness}
                            brightnessMultiplier={brightnessMultiplier}
                            pixelSizeMultiplier={pixelSizeMultiplier}
                            cameraState={cameraState}
                            onCameraStateChange={onCameraStateChange}
                            shouldAutoFit={shouldAutoFit}
                            onAutoFitComplete={onAutoFitComplete}
                            cameraStateLoaded={cameraStateLoaded}
                            onGetCurrentCameraState={onGetCurrentCameraState}
                        />
                        {showStats && <Stats />}
                    </Canvas>
                </Box>
            )}
        </Box>
    );
};
