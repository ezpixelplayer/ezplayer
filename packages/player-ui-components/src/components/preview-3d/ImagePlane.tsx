import React, { useState, useEffect, Suspense } from 'react';
import * as THREE from 'three';
import type { ViewObject } from '../../types/model3d';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TEXTURE_SIZE = 2048;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImagePlaneProps {
    viewObject: ViewObject;
    frameServerUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Down-scale a texture so neither dimension exceeds `maxDim`.
 */
function downscaleTextureImage(
    img: HTMLImageElement,
    maxDim: number,
): HTMLCanvasElement | HTMLImageElement {
    if (img.width <= maxDim && img.height <= maxDim) return img;

    const scale = maxDim / Math.max(img.width, img.height);
    const newW = Math.floor(img.width * scale);
    const newH = Math.floor(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img;

    ctx.drawImage(img, 0, 0, newW, newH);
    return canvas;
}

// ---------------------------------------------------------------------------
// ImagePlaneContent – the actual R3F component
// ---------------------------------------------------------------------------

function ImagePlaneContent({ viewObject, frameServerUrl }: ImagePlaneProps) {
    const {
        imageFile,
        worldPosX, worldPosY, worldPosZ,
        scaleX, scaleY, scaleZ,
        rotateX, rotateY, rotateZ,
        brightness,
        transparency,
    } = viewObject;

    const [texture, setTexture] = useState<THREE.Texture | null>(null);
    const [imgWidth, setImgWidth] = useState(1);
    const [imgHeight, setImgHeight] = useState(1);

    // Load texture via /api/show-file
    useEffect(() => {
        if (!imageFile || !frameServerUrl) return;

        let disposed = false;

        const url = new URL('/api/show-file', frameServerUrl);
        url.searchParams.set('path', imageFile);

        const loader = new THREE.TextureLoader();
        loader.load(
            url.toString(),
            (tex) => {
                if (disposed) {
                    tex.dispose();
                    return;
                }

                // Capture natural dimensions before any downscale
                const img = tex.image as HTMLImageElement;
                if (img && img.width > 0 && img.height > 0) {
                    setImgWidth(img.width);
                    setImgHeight(img.height);
                    // Downscale if needed
                    const scaled = downscaleTextureImage(img, MAX_TEXTURE_SIZE);
                    if (scaled !== img) {
                        (tex as unknown as { image: HTMLCanvasElement | HTMLImageElement }).image = scaled;
                        tex.needsUpdate = true;
                    }
                }

                tex.colorSpace = THREE.SRGBColorSpace;
                tex.generateMipmaps = false;
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;

                setTexture(tex);
            },
            undefined, // onProgress
            (err) => {
                if (!disposed) {
                    console.error(`[ImagePlane] Failed to load image "${imageFile}":`, err);
                }
            },
        );

        return () => {
            disposed = true;
            setTexture((prev) => {
                if (prev) prev.dispose();
                return null;
            });
        };
    }, [imageFile, frameServerUrl]);

    if (!texture) return null;

    // Transforms
    const position = new THREE.Vector3(worldPosX, worldPosY, worldPosZ);
    const scale = new THREE.Vector3(scaleX, scaleY, scaleZ);
    const rotation = new THREE.Euler(
        (rotateX * Math.PI) / 180,
        (rotateY * Math.PI) / 180,
        (rotateZ * Math.PI) / 180,
        'ZYX', // Same rotation order as HouseMesh (xLights convention)
    );

    // Transparency: xLights 0=opaque, 100=transparent → THREE.js opacity 1=opaque, 0=transparent
    const opacity = 1 - Math.max(0, Math.min(100, transparency ?? 0)) / 100;

    // When the whole plane is semi-transparent (Transparency > 0), use blending.
    // Otherwise, rely on alphaTest to discard transparent PNG pixels while
    // keeping correct depth writes for opaque pixels.
    const needsTransparency = opacity < 1;

    // Brightness as color multiplier (same as HouseMesh)
    // Apply gamma 2.2 to convert xLights perceptual brightness to linear-space color.
    const bf = Math.pow(Math.max(0, Math.min(1, (brightness ?? 100) / 100)), 2.2);

    return (
        <mesh position={position} rotation={rotation} scale={scale} renderOrder={-1}>
            <planeGeometry args={[imgWidth, imgHeight]} />
            <meshBasicMaterial
                map={texture}
                transparent={needsTransparency}
                opacity={opacity}
                alphaTest={0.5}
                depthWrite={true}
                side={THREE.DoubleSide}
                color={new THREE.Color(bf, bf, bf)}
            />
        </mesh>
    );
}

// ---------------------------------------------------------------------------
// Public export with Suspense wrapper
// ---------------------------------------------------------------------------

export function ImagePlane(props: ImagePlaneProps) {
    return (
        <Suspense fallback={null}>
            <ImagePlaneContent {...props} />
        </Suspense>
    );
}
