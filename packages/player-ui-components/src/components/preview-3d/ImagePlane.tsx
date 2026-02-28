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

/**
 * Check whether an image has any non-opaque pixels by sampling the alpha
 * channel on a small off-screen canvas.  Uses a down-sampled copy (max
 * 128 px on the long edge) so even large textures are cheap to scan.
 */
function imageHasAlpha(img: HTMLImageElement | HTMLCanvasElement): boolean {
    const maxSample = 128;
    const scale = Math.min(1, maxSample / Math.max(img.width, img.height));
    const w = Math.max(1, Math.floor(img.width * scale));
    const h = Math.max(1, Math.floor(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) return true;
    }
    return false;
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
    const [hasAlpha, setHasAlpha] = useState(false);

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

                    // Detect alpha channel from the actual image pixels
                    setHasAlpha(imageHasAlpha(img));

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

    // Enable transparency when the xLights Transparency attribute is set OR
    // the image itself contains non-opaque pixels (detected from actual pixel data).
    const needsTransparency = opacity < 1 || hasAlpha;

    // Brightness as color multiplier (same as HouseMesh)
    // Three.js ColorManagement treats Color values as sRGB, so no explicit
    // gamma needed — brightness/100 gives the correct perceptual result.
    const bf = Math.max(0, Math.min(1, (brightness ?? 100) / 100));

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

export const ImagePlane = React.memo(function ImagePlane(props: ImagePlaneProps) {
    return (
        <Suspense fallback={null}>
            <ImagePlaneContent {...props} />
        </Suspense>
    );
});
