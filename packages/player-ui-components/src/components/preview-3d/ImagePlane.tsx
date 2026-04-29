import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ViewObject } from '../../types/model3d';
import type { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';

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
    backgroundBrightness?: number; // 0-100, overrides viewObject brightness for background images
    /** Live frame ring buffer.  Only consumed by Image-model planes. */
    liveData?: LatestFrameRingBuffer;
}

// ---------------------------------------------------------------------------
// Texture helpers
// ---------------------------------------------------------------------------

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

/**
 * Bake "near-white = transparent" into the texture's alpha channel.  Returns
 * a canvas THREE wraps as a texture.  Mirrors xLights's `WhiteAsAlpha`.
 */
function bakeWhiteAsAlpha(img: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
    const w = img.width;
    const h = img.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    let id: ImageData;
    try {
        id = ctx.getImageData(0, 0, w, h);
    } catch (e) {
        // CORS-tainted canvas — give up on the bake and return the original.
        console.warn('[ImagePlane] WhiteAsAlpha bake failed (tainted canvas):', e);
        return canvas;
    }
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
        // alpha = 1 - whiteness, where whiteness = min(r,g,b).  Saturated
        // colours stay opaque; only near-white pixels fade out.
        const minRGB = Math.min(d[i], Math.min(d[i + 1], d[i + 2]));
        d[i + 3] = Math.min(d[i + 3], 255 - minRGB);
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
}

function parseHexColor(hex: string | undefined): [number, number, number] {
    if (!hex) return [1, 1, 1];
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return [1, 1, 1];
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

/**
 * Shared texture-loader.  Returns a Texture once loaded along with the
 * detected natural dimensions and alpha presence.  Optionally bakes
 * white-as-alpha into the canvas before handing it to THREE.
 */
function useImageTexture(imageFile: string | undefined, frameServerUrl: string | undefined, whiteAsAlpha: boolean) {
    const [texture, setTexture] = useState<THREE.Texture | null>(null);
    const [imgWidth, setImgWidth] = useState(1);
    const [imgHeight, setImgHeight] = useState(1);
    const [hasAlpha, setHasAlpha] = useState(false);

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
                let img = tex.image as HTMLImageElement | HTMLCanvasElement;
                if (img && img.width > 0 && img.height > 0) {
                    setImgWidth(img.width);
                    setImgHeight(img.height);
                    setHasAlpha(imageHasAlpha(img));

                    const scaled = downscaleTextureImage(img as HTMLImageElement, MAX_TEXTURE_SIZE);
                    if (scaled !== img) img = scaled;
                    if (whiteAsAlpha) img = bakeWhiteAsAlpha(img);

                    if (img !== tex.image) {
                        (tex as unknown as { image: HTMLCanvasElement | HTMLImageElement }).image = img;
                        tex.needsUpdate = true;
                    }
                }
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.generateMipmaps = false;
                tex.minFilter = THREE.LinearFilter;
                tex.magFilter = THREE.LinearFilter;
                setTexture(tex);
            },
            undefined,
            (err) => {
                if (!disposed) console.error(`[ImagePlane] Failed to load image "${imageFile}":`, err);
            },
        );

        return () => {
            disposed = true;
            setTexture((prev) => {
                if (prev) prev.dispose();
                return null;
            });
        };
    }, [imageFile, frameServerUrl, whiteAsAlpha]);

    return { texture, imgWidth, imgHeight, hasAlpha };
}

// ---------------------------------------------------------------------------
// Model-image plane: live brightness from frame data, world matrix from
// xllayoutcalcs, optional white-as-alpha cutout, optional custom tint.
// ---------------------------------------------------------------------------

function ModelImagePlane({ viewObject, frameServerUrl, liveData }: ImagePlaneProps) {
    const { imageFile, transparency, imageInfo, worldMatrix, startChannel } = viewObject;

    const whiteAsAlpha = !!imageInfo?.whiteAsAlpha;
    const { texture } = useImageTexture(imageFile, frameServerUrl, whiteAsAlpha);

    const tint = useMemo(() => parseHexColor(imageInfo?.customColor), [imageInfo?.customColor]);
    const offBright = useMemo(
        () => Math.max(0, Math.min(1, (imageInfo?.offBrightness ?? 80) / 100)),
        [imageInfo?.offBrightness],
    );

    const matrix = useMemo(() => {
        if (!worldMatrix || worldMatrix.length !== 16) return null;
        const m = new THREE.Matrix4();
        m.fromArray(worldMatrix);
        return m;
    }, [worldMatrix]);

    const meshRef = useRef<THREE.Mesh>(null);
    const lastFrameSeqRef = useRef<number | undefined>(undefined);
    const lastIntensityRef = useRef<number>(-1);

    // Apply the world matrix once both matrix and mesh exist.  Depends on
    // `texture` because the mesh isn't mounted until the texture loads
    // (the `return null` below gates render on texture), so the first run
    // of this effect finds meshRef.current=null.  Re-running when the
    // texture arrives is what lets the matrix actually land on the mesh.
    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh || !matrix) return;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(matrix);
        mesh.matrixWorldNeedsUpdate = true;
    }, [matrix, texture]);

    useFrame(() => {
        const mesh = meshRef.current;
        if (!mesh || startChannel === undefined) return;
        const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (!mat?.color) return;

        let intensity: number;
        if (liveData) {
            const latest = liveData.tryReadLatest(lastFrameSeqRef.current);
            if (!latest?.bytes) {
                if (lastIntensityRef.current >= 0) return; // no new frame, hold
                intensity = 0;
            } else if (startChannel >= latest.bytes.length) {
                return;
            } else {
                intensity = latest.bytes[startChannel] / 255;
                lastFrameSeqRef.current = latest.seq;
            }
        } else {
            intensity = 0;
        }

        if (intensity === lastIntensityRef.current) return;
        lastIntensityRef.current = intensity;

        const bf = offBright + (1 - offBright) * intensity;
        mat.color.setRGB(tint[0] * bf, tint[1] * bf, tint[2] * bf, THREE.SRGBColorSpace);
    });

    if (!texture || !matrix) return null;

    const baseOpacity = 1 - Math.max(0, Math.min(100, transparency ?? 0)) / 100;
    const initBf = offBright;
    const initColor = new THREE.Color().setRGB(
        tint[0] * initBf,
        tint[1] * initBf,
        tint[2] * initBf,
        THREE.SRGBColorSpace,
    );

    return (
        <mesh ref={meshRef} renderOrder={-1}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
                map={texture}
                transparent={true}
                opacity={baseOpacity}
                alphaTest={whiteAsAlpha ? 0.05 : 0}
                depthWrite={false}
                side={THREE.DoubleSide}
                color={initColor}
                toneMapped={false}
            />
        </mesh>
    );
}

// ---------------------------------------------------------------------------
// View-object image plane: static brightness, no live channel coupling.
// (Original behaviour, preserved verbatim.)
// ---------------------------------------------------------------------------

function ViewObjectImagePlane({ viewObject, frameServerUrl, backgroundBrightness }: ImagePlaneProps) {
    const {
        imageFile,
        worldPosX, worldPosY, worldPosZ,
        scaleX, scaleY, scaleZ,
        rotateX, rotateY, rotateZ,
        brightness: viewObjectBrightness,
        transparency,
    } = viewObject;

    const brightness = backgroundBrightness !== undefined ? backgroundBrightness : viewObjectBrightness;
    const { texture, imgWidth, imgHeight, hasAlpha } = useImageTexture(imageFile, frameServerUrl, false);

    if (!texture) return null;

    const position = new THREE.Vector3(worldPosX, worldPosY, worldPosZ);
    const scale = new THREE.Vector3(scaleX, scaleY, scaleZ);
    const rotation = new THREE.Euler(
        (rotateX * Math.PI) / 180,
        (rotateY * Math.PI) / 180,
        (rotateZ * Math.PI) / 180,
        'ZYX',
    );

    const opacity = 1 - Math.max(0, Math.min(100, transparency ?? 0)) / 100;
    const needsTransparency = opacity < 1 || hasAlpha;
    const bf = Math.max(0, Math.min(1, (brightness ?? 100) / 100));
    const brightnessColor = new THREE.Color().setRGB(bf, bf, bf, THREE.SRGBColorSpace);

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
                color={brightnessColor}
                toneMapped={false}
            />
        </mesh>
    );
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export const ImagePlane = React.memo(function ImagePlane(props: ImagePlaneProps) {
    return (
        <Suspense fallback={null}>
            {props.viewObject.imageInfo
                ? <ModelImagePlane {...props} />
                : <ViewObjectImagePlane {...props} />}
        </Suspense>
    );
});
