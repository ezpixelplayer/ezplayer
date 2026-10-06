import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Imperative handle for deterministic, frame-stepped rendering of a preview canvas —
 * the primitive behind offline video export.
 *
 * Intended use (caller side):
 *  1. Set the viewer's `renderOnDemand` prop so the r3f frameloop stops (`'never'`).
 *  2. `beginFixedSize(w, h)` — the drawing buffer switches to exactly w×h at DPR 1 while the
 *     CSS size is left alone, and the active camera is adjusted so the current framing is
 *     preserved vertically (perspective: aspect only; orthographic: frustum + zoom).
 *  3. For each frame: publish its data to the ring buffer, then `renderFrame(timeMs)` — this
 *     runs every `useFrame` subscriber once (so the viewers pick up the new ring-buffer frame)
 *     and renders synchronously. Read the returned canvas *immediately* (same task): the
 *     context is created without `preserveDrawingBuffer`, so the pixels are only guaranteed
 *     until the browser next composites.
 *  4. `endFixedSize()` restores the on-screen size / camera; clear `renderOnDemand`.
 *
 * r3f keeps a ResizeObserver on the container and, whenever its measured size changes,
 * re-applies the on-screen drawing-buffer size and camera framing (the store subscription in
 * its `createRoot`). Any layout shift during an export — a reflow of the surrounding modal,
 * a scrollbar appearing — therefore silently undid `beginFixedSize`, and the on-screen-shaped
 * canvas got stretched into the export frame from that point on. So the fixed size is
 * re-asserted at the start of every `renderFrame`, not only once at the beginning.
 */
export interface PreviewRenderHandle {
    beginFixedSize(width: number, height: number): void;
    renderFrame(timeMs: number): HTMLCanvasElement;
    endFixedSize(): void;
}

interface SavedViewport {
    width: number;
    height: number;
    pixelRatio: number;
    camera: THREE.Camera;
    aspect?: number;
    ortho?: { left: number; right: number; top: number; bottom: number; zoom: number };
    /** The export size being held, plus the ortho zoom computed for it. */
    fixed: { width: number; height: number; zoom?: number };
}

/**
 * Mount inside an r3f `<Canvas>`. Registers a {@link PreviewRenderHandle} with `onRegister`
 * (and `null` on unmount). Also re-kicks the render loop when the frameloop returns to
 * `'always'`: r3f does not restart its rAF loop on that transition by itself.
 */
export function RenderBridge({ onRegister }: { onRegister?: (handle: PreviewRenderHandle | null) => void }) {
    const get = useThree((s) => s.get);
    const frameloop = useThree((s) => s.frameloop);
    const invalidate = useThree((s) => s.invalidate);
    const onRegisterRef = useRef(onRegister);
    onRegisterRef.current = onRegister;

    useEffect(() => {
        if (frameloop === 'always') invalidate();
    }, [frameloop, invalidate]);

    useEffect(() => {
        let saved: SavedViewport | null = null;
        const sizeVec = new THREE.Vector2();

        /** (Re)apply the held export size and camera framing; a no-op when nothing drifted. */
        const applyFixed = () => {
            if (!saved) return;
            const { gl } = get();
            const { camera, fixed } = saved;
            gl.getSize(sizeVec);
            if (sizeVec.x !== fixed.width || sizeVec.y !== fixed.height || gl.getPixelRatio() !== 1) {
                gl.setPixelRatio(1);
                gl.setSize(fixed.width, fixed.height, false);
            }
            if (camera instanceof THREE.PerspectiveCamera) {
                const aspect = fixed.width / fixed.height;
                if (camera.aspect !== aspect) {
                    camera.aspect = aspect;
                    camera.updateProjectionMatrix();
                }
            } else if (camera instanceof THREE.OrthographicCamera && fixed.zoom !== undefined) {
                if (
                    camera.left !== -fixed.width / 2 ||
                    camera.right !== fixed.width / 2 ||
                    camera.top !== fixed.height / 2 ||
                    camera.bottom !== -fixed.height / 2 ||
                    camera.zoom !== fixed.zoom
                ) {
                    camera.left = -fixed.width / 2;
                    camera.right = fixed.width / 2;
                    camera.top = fixed.height / 2;
                    camera.bottom = -fixed.height / 2;
                    camera.zoom = fixed.zoom;
                    camera.updateProjectionMatrix();
                }
            }
        };

        const handle: PreviewRenderHandle = {
            beginFixedSize(width, height) {
                if (saved) handle.endFixedSize();
                const { gl, camera } = get();
                gl.getSize(sizeVec);
                saved = {
                    width: sizeVec.x,
                    height: sizeVec.y,
                    pixelRatio: gl.getPixelRatio(),
                    camera,
                    fixed: { width, height },
                };

                if (camera instanceof THREE.PerspectiveCamera) {
                    saved.aspect = camera.aspect;
                } else if (camera instanceof THREE.OrthographicCamera) {
                    saved.ortho = {
                        left: camera.left,
                        right: camera.right,
                        top: camera.top,
                        bottom: camera.bottom,
                        zoom: camera.zoom,
                    };
                    // r3f sizes an ortho frustum in logical pixels (±size/2); keep the same
                    // vertical world extent by scaling zoom with the height ratio.
                    saved.fixed.zoom = camera.zoom * (height / Math.max(1, saved.height));
                }
                applyFixed();
            },
            renderFrame(timeMs) {
                const state = get();
                // A container resize during the export makes r3f put the on-screen size
                // back (see the header comment); hold the export size for every frame.
                applyFixed();
                // In frameloop='never' mode r3f derives useFrame's delta from this timestamp
                // (seconds), so procedural animations advance deterministically.
                state.advance(timeMs / 1000, true);
                return state.gl.domElement;
            },
            endFixedSize() {
                if (!saved) return;
                const { gl, size, viewport } = get();
                const { camera } = saved;
                // Restore to r3f's current notion of the on-screen size — the container may
                // have been resized while the export size was held — falling back to what
                // was captured at begin.
                const width = size.width > 0 ? size.width : saved.width;
                const height = size.height > 0 ? size.height : saved.height;
                gl.setPixelRatio(viewport.dpr || saved.pixelRatio);
                gl.setSize(width, height, false);
                if (camera instanceof THREE.PerspectiveCamera && saved.aspect !== undefined) {
                    camera.aspect = width / height;
                    camera.updateProjectionMatrix();
                } else if (camera instanceof THREE.OrthographicCamera && saved.ortho) {
                    camera.left = -width / 2;
                    camera.right = width / 2;
                    camera.top = height / 2;
                    camera.bottom = -height / 2;
                    camera.zoom = saved.ortho.zoom;
                    camera.updateProjectionMatrix();
                }
                saved = null;
                invalidate();
            },
        };

        onRegisterRef.current?.(handle);
        return () => {
            handle.endFixedSize();
            onRegisterRef.current?.(null);
        };
    }, [get, invalidate]);

    return null;
}
