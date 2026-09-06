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

        const handle: PreviewRenderHandle = {
            beginFixedSize(width, height) {
                if (saved) handle.endFixedSize();
                const { gl, camera } = get();
                gl.getSize(sizeVec);
                saved = { width: sizeVec.x, height: sizeVec.y, pixelRatio: gl.getPixelRatio(), camera };

                gl.setPixelRatio(1);
                gl.setSize(width, height, false);

                if (camera instanceof THREE.PerspectiveCamera) {
                    saved.aspect = camera.aspect;
                    camera.aspect = width / height;
                    camera.updateProjectionMatrix();
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
                    const heightRatio = height / Math.max(1, saved.height);
                    camera.left = -width / 2;
                    camera.right = width / 2;
                    camera.top = height / 2;
                    camera.bottom = -height / 2;
                    camera.zoom = saved.ortho.zoom * heightRatio;
                    camera.updateProjectionMatrix();
                }
            },
            renderFrame(timeMs) {
                const state = get();
                // In frameloop='never' mode r3f derives useFrame's delta from this timestamp
                // (seconds), so procedural animations advance deterministically.
                state.advance(timeMs / 1000, true);
                return state.gl.domElement;
            },
            endFixedSize() {
                if (!saved) return;
                const { gl } = get();
                const { camera } = saved;
                gl.setPixelRatio(saved.pixelRatio);
                gl.setSize(saved.width, saved.height, false);
                if (camera instanceof THREE.PerspectiveCamera && saved.aspect !== undefined) {
                    camera.aspect = saved.aspect;
                    camera.updateProjectionMatrix();
                } else if (camera instanceof THREE.OrthographicCamera && saved.ortho) {
                    Object.assign(camera, saved.ortho);
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
