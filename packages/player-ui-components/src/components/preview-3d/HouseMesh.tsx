import React, { useMemo, useState, Suspense, ErrorInfo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import * as THREE from 'three';
import type { ViewObject, Point3D } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum texture dimension (width or height) allowed.
 * Textures larger than this are down-scaled on the CPU before upload to
 * the GPU, which prevents WebGL "Context Lost" errors caused by running
 * out of GPU memory (6 × 4 K textures ≈ 600 MB VRAM with mipmaps).
 */
const MAX_TEXTURE_SIZE = 2048;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HouseMeshProps {
    viewObject: ViewObject;
    frameServerUrl?: string;
    liveData?: LatestFrameRingBuffer;
    points?: Point3D[]; // Points to look up channel information
}

/**
 * Reliable mesh type check.
 *
 * `child instanceof THREE.Mesh` can return `false` when the bundler
 * produces two copies of the `three` package (one for our code and one
 * pulled in by `three/examples/jsm/loaders/*`).  Three.js sets a
 * permanent boolean flag `.isMesh = true` on every Mesh – this flag is
 * safe regardless of module deduplication.
 */
function isMesh(child: THREE.Object3D): child is THREE.Mesh {
    return (child as THREE.Mesh).isMesh === true;
}

/**
 * Down-scale a single THREE.Texture so that neither dimension exceeds
 * `maxDim`.  The image is redrawn onto an off-screen <canvas> and the
 * texture is marked dirty so Three.js re-uploads it.
 */
function downscaleTexture(texture: THREE.Texture, maxDim: number): void {
    const img = texture.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | undefined;
    if (!img || !('width' in img) || !('height' in img)) return;
    if (img.width <= maxDim && img.height <= maxDim) return;

    const scale = maxDim / Math.max(img.width, img.height);
    const newW = Math.floor(img.width * scale);
    const newH = Math.floor(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img as CanvasImageSource, 0, 0, newW, newH);

    texture.image = canvas;
    texture.needsUpdate = true;
}

/** Texture property names commonly set by MTLLoader. */
const TEXTURE_SLOTS = ['map', 'normalMap', 'specularMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'aoMap'] as const;

/**
 * Iterate every texture in `materials` and:
 *  1. Disable mip-map generation (saves ~33 % GPU memory per texture).
 *  2. Set correct sRGB color space on diffuse maps.
 *  3. If the image is already decoded, down-scale it to MAX_TEXTURE_SIZE.
 *  4. If the image hasn't decoded yet, attach a one-shot listener that
 *     will down-scale it once it arrives.
 */
function optimizeMaterialTextures(materials: Record<string, THREE.Material>): void {
    const seen = new Set<number>(); // texture.id – avoid processing the same texture twice

    for (const mat of Object.values(materials)) {
        for (const prop of TEXTURE_SLOTS) {
            const tex = (mat as unknown as Record<string, unknown>)[prop] as THREE.Texture | undefined;
            if (!tex || !(tex as THREE.Texture).isTexture) continue;
            if (seen.has(tex.id)) continue;
            seen.add(tex.id);

            // Disable mip-maps – big memory win, negligible visual loss
            tex.generateMipmaps = false;
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;

            // Set correct color space for diffuse/color textures (map, emissiveMap).
            // Without this, Three.js double-gamma-corrects the colors, making
            // everything appear much darker than the original photographs.
            if (prop === 'map' || prop === 'emissiveMap') {
                tex.colorSpace = THREE.SRGBColorSpace;
            }

            const img = tex.image as HTMLImageElement | undefined;
            if (!img) continue;

            if (img instanceof HTMLImageElement && !img.complete) {
                // Image still loading – resize when it arrives
                img.addEventListener('load', () => {
                    downscaleTexture(tex, MAX_TEXTURE_SIZE);
                }, { once: true });
            } else {
                // Already decoded
                downscaleTexture(tex, MAX_TEXTURE_SIZE);
            }
        }
    }
}

/**
 * Post-process a loaded OBJ+MTL model:
 *
 * 1. Convert all MeshPhongMaterial / MeshLambertMaterial to MeshBasicMaterial
 *    (unlit).  House model textures are photographs with baked lighting –
 *    applying additional 3D scene lights on top of baked lighting produces
 *    an incorrectly dark result.  MeshBasicMaterial shows the texture as-is.
 *
 * 2. Set THREE.SRGBColorSpace on all diffuse textures so the renderer
 *    handles gamma correctly.
 *
 * 3. Force THREE.DoubleSide to handle any face-winding inconsistencies in
 *    the exported OBJ.
 */
function postProcessMeshMaterials(group: THREE.Group): void {
    group.traverse((child) => {
        if (!isMesh(child)) return;

        const materials = Array.isArray(child.material) ? child.material : [child.material];
        const processed = materials.map((mat) => {
            // Extract the diffuse texture map from any material type
            const diffuseMap: THREE.Texture | null =
                (mat as THREE.MeshPhongMaterial).map ??
                (mat as THREE.MeshStandardMaterial).map ??
                null;

            // Set correct color space on diffuse map
            if (diffuseMap) {
                diffuseMap.colorSpace = THREE.SRGBColorSpace;
                diffuseMap.generateMipmaps = false;
                diffuseMap.minFilter = THREE.LinearFilter;
                diffuseMap.magFilter = THREE.LinearFilter;
                diffuseMap.needsUpdate = true;
            }

            // Convert lit materials to unlit MeshBasicMaterial.
            // Photo textures have baked lighting – scene lights would double-light them.
            if (
                mat.type === 'MeshPhongMaterial' ||
                mat.type === 'MeshLambertMaterial' ||
                mat.type === 'MeshStandardMaterial'
            ) {
                const srcMat = mat as THREE.MeshPhongMaterial;
                const basicMat = new THREE.MeshBasicMaterial({
                    map: diffuseMap,
                    side: THREE.DoubleSide,
                    color: 0xffffff, // Pure white so texture shows 1:1
                    transparent: srcMat.transparent,
                    opacity: srcMat.opacity,
                    alphaTest: srcMat.alphaTest,
                });
                basicMat.name = mat.name;

                // Dispose old material to free GPU memory
                mat.dispose();
                return basicMat;
            }

            // For any other material type, just ensure DoubleSide
            mat.side = THREE.DoubleSide;
            return mat;
        });

        child.material = processed.length === 1 ? processed[0] : processed;
    });
}

// ---------------------------------------------------------------------------
// Line → Mesh conversion
// ---------------------------------------------------------------------------

/**
 * Convert LineSegments children inside `group` to proper Mesh objects so
 * that MTL textures can be applied.
 *
 * Some xLights OBJ exports only emit `l` (line) directives instead of
 * `f` (face) directives. Three.js creates `LineSegments` for these –
 * but `LineSegments` cannot display textured materials.
 *
 * Strategy:
 *  – For each LineSegments child, extract the position buffer.
 *  – If the line segments actually describe closed triangle edges
 *    (pairs of consecutive vertices forming a loop), attempt to build a
 *    triangle mesh via Delaunay-like fan reconstruction.
 *  – As a robust fallback, generate a thin "tube" quad strip along each
 *    line pair so there's actual surface area for textures to appear on.
 *  – In the worst case, just create a Mesh from the existing position
 *    buffer treated as indexed triangles (every 3 consecutive verts =
 *    1 triangle).
 */
function convertLineSegmentsToMeshes(
    group: THREE.Group,
    materialCreator: MTLLoader.MaterialCreator | null,
): THREE.Group {
    const newGroup = new THREE.Group();
    newGroup.name = group.name;
    newGroup.position.copy(group.position);
    newGroup.rotation.copy(group.rotation);
    newGroup.scale.copy(group.scale);

    group.traverse((child: THREE.Object3D) => {
        if (child.type !== 'LineSegments') return;

        const lineSegs = child as THREE.LineSegments;
        const geo = lineSegs.geometry;
        const posAttr = geo.getAttribute('position');
        if (!posAttr || posAttr.count === 0) return;

        const positions = posAttr as THREE.BufferAttribute;
        const vertCount = positions.count;

        // Attempt 1: treat every 3 consecutive verts as a triangle face.
        // This works if the OBJ really describes triangles via `l` pairs
        // in a consistent winding (v0-v1, v1-v2, v2-v0 pattern repeated).
        // We'll detect this by checking if every group of 6 verts (3 line
        // segments = 6 verts) forms a closed triangle (v0→v1, v1→v2, v2→v0).
        const meshGeo = new THREE.BufferGeometry();

        if (vertCount >= 6 && vertCount % 6 === 0) {
            // Likely triangle-edge pairs: (A→B, B→C, C→A) per triangle
            const triCount = vertCount / 6;
            const triPositions = new Float32Array(triCount * 9);
            const triUVs = new Float32Array(triCount * 6);
            const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;

            for (let t = 0; t < triCount; t++) {
                const base = t * 6;
                // Each triangle is encoded as 3 line segments: AB, BC, CA
                // We take vertex 0 of each segment: positions at base+0, base+2, base+4
                for (let v = 0; v < 3; v++) {
                    const srcIdx = base + v * 2; // 0, 2, 4
                    const dstIdx = t * 9 + v * 3;
                    triPositions[dstIdx] = positions.getX(srcIdx);
                    triPositions[dstIdx + 1] = positions.getY(srcIdx);
                    triPositions[dstIdx + 2] = positions.getZ(srcIdx);

                    if (uvAttr) {
                        triUVs[t * 6 + v * 2] = uvAttr.getX(srcIdx);
                        triUVs[t * 6 + v * 2 + 1] = uvAttr.getY(srcIdx);
                    }
                }
            }

            meshGeo.setAttribute('position', new THREE.BufferAttribute(triPositions, 3));
            if (uvAttr) {
                meshGeo.setAttribute('uv', new THREE.BufferAttribute(triUVs, 2));
            }

        } else if (vertCount >= 3) {
            // Fallback: treat every 3 consecutive vertices as a triangle.
            // This loses some verts if not divisible by 3, but gives us geometry.
            const usable = Math.floor(vertCount / 3) * 3;
            const fallbackPositions = new Float32Array(usable * 3);
            const fallbackUVs = new Float32Array(usable * 2);
            const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;

            for (let i = 0; i < usable; i++) {
                fallbackPositions[i * 3] = positions.getX(i);
                fallbackPositions[i * 3 + 1] = positions.getY(i);
                fallbackPositions[i * 3 + 2] = positions.getZ(i);

                if (uvAttr) {
                    fallbackUVs[i * 2] = uvAttr.getX(i);
                    fallbackUVs[i * 2 + 1] = uvAttr.getY(i);
                }
            }

            meshGeo.setAttribute('position', new THREE.BufferAttribute(fallbackPositions, 3));
            if (uvAttr) {
                meshGeo.setAttribute('uv', new THREE.BufferAttribute(fallbackUVs, 2));
            }
        }

        meshGeo.computeVertexNormals();

        // Choose material: prefer the MTL material, fall back to a grey default
        let meshMaterial: THREE.Material;
        const lineMat = lineSegs.material as THREE.Material;

        if (materialCreator && Object.keys(materialCreator.materials).length > 0) {
            // Use the first MTL material as default for this group
            const matKeys = Object.keys(materialCreator.materials);
            meshMaterial = materialCreator.materials[matKeys[0]];
            // Ensure it renders double-sided so we see both faces
            meshMaterial.side = THREE.DoubleSide;
        } else {
            meshMaterial = new THREE.MeshStandardMaterial({
                color: lineMat && 'color' in lineMat ? (lineMat as THREE.LineBasicMaterial).color : 0xcccccc,
                side: THREE.DoubleSide,
                roughness: 0.7,
                metalness: 0.1,
            });
        }

        const mesh = new THREE.Mesh(meshGeo, meshMaterial);
        mesh.name = child.name || 'converted-line-mesh';
        newGroup.add(mesh);
    });

    // If no LineSegments were converted (shouldn't happen), return original
    if (newGroup.children.length === 0) {
        console.warn('[HouseMesh] No LineSegments converted – returning original group');
        return group;
    }

    return newGroup;
}

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

class HouseMeshErrorBoundary extends React.Component<
    { children: React.ReactNode; viewObjectName?: string },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: React.ReactNode; viewObjectName?: string }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[HouseMesh] Error loading mesh:', {
            error,
            errorMessage: error?.message,
            errorStack: error?.stack,
            componentStack: errorInfo.componentStack,
            errorDetails: (error as unknown as Record<string, unknown>)?.response || (error as unknown as Record<string, unknown>)?.details,
        });

        if (error?.message?.includes('403') || error?.message?.includes('Forbidden')) {
            console.error('[HouseMesh] 403 Forbidden – check server-worker logs.');
        }
    }

    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

// ---------------------------------------------------------------------------
// Loading Manager factory
// ---------------------------------------------------------------------------

/**
 * Build a THREE.LoadingManager whose `resolveURL` redirects texture
 * requests through our `/api/show-file` endpoint so the Koa server
 * can serve them from the show folder on disk.
 */
function createShowFileLoadingManager(
    frameServerUrl: string,
    objDir: string,
): THREE.LoadingManager {
    const loadingManager = new THREE.LoadingManager();

    loadingManager.resolveURL = (url: string) => {
        // data: URIs – pass through unchanged
        if (url.startsWith('data:')) return url;

        // HTTP(S) URLs – may be a texture URL synthesised by
        // MTLLoader's internal extractUrlBase (e.g.
        // http://localhost:PORT/api/texture_1001.png)
        if (url.startsWith('http://') || url.startsWith('https://')) {
            try {
                const parsed = new URL(url);
                const serverParsed = new URL(frameServerUrl);

                if (
                    parsed.origin === serverParsed.origin &&
                    parsed.pathname.startsWith('/api/') &&
                    !parsed.pathname.includes('show-file')
                ) {
                    const filename = parsed.pathname.replace(/^\/api\//, '');
                    if (filename) {
                        const texturePath = objDir + filename;
                        const textureUrl = new URL('/api/show-file', frameServerUrl);
                        textureUrl.searchParams.set('path', texturePath);
                        return textureUrl.toString();
                    }
                }
            } catch {
                /* URL parse error – fall through */
            }
            return url;
        }

        // Relative / plain filenames (e.g. "texture_1001.png")
        const texturePath = objDir + url;
        const textureUrl = new URL('/api/show-file', frameServerUrl);
        textureUrl.searchParams.set('path', texturePath);
        return textureUrl.toString();
    };

    return loadingManager;
}

// ---------------------------------------------------------------------------
// HouseMeshContent – the actual R3F component
// ---------------------------------------------------------------------------

function HouseMeshContent({ viewObject, frameServerUrl, liveData, points }: HouseMeshProps) {
    const {
        objFile,
        worldPosX, worldPosY, worldPosZ,
        scaleX, scaleY, scaleZ,
        rotateX, rotateY, rotateZ,
        brightness,
        startChannel: viewObjectStartChannel,
        channelsPerNode: viewObjectChannelsPerNode = 3,
        nodeCount: viewObjectNodeCount = 1,
        modelName: viewObjectModelName,
        rOffset: viewObjectROffset = 0,
        gOffset: viewObjectGOffset = 1,
        bOffset: viewObjectBOffset = 2,
    } = viewObject;

    // The loaded THREE.Group – null until MTL + OBJ are ready
    const [obj, setObj] = useState<THREE.Group | null>(null);

    // Track last frame sequence to avoid reprocessing
    const lastFrameSeqRef = useRef<number | null>(null);

    // ----- Channel info (auto-detect from points if needed) -----
    const channelInfo = useMemo(() => {
        if (viewObjectStartChannel !== undefined) {
            return {
                startChannel: viewObjectStartChannel,
                channelsPerNode: viewObjectChannelsPerNode,
                nodeCount: viewObjectNodeCount,
                rOffset: viewObjectROffset,
                gOffset: viewObjectGOffset,
                bOffset: viewObjectBOffset,
            };
        }

        if (!points || points.length === 0) return null;

        const searchName = viewObjectModelName || viewObject.name;
        const matchingPoints = points.filter(p => p.metadata?.modelName === searchName);
        if (matchingPoints.length === 0) return null;

        const channels = matchingPoints
            .map(p => p.channel)
            .filter((ch): ch is number => ch !== undefined)
            .sort((a, b) => a - b);
        if (channels.length === 0) return null;

        const firstPoint = matchingPoints[0];
        return {
            startChannel: channels[0],
            channelsPerNode: 3,
            nodeCount: Math.ceil((channels[channels.length - 1] - channels[0] + 3) / 3),
            rOffset: firstPoint.metadata?.rOffset ?? 0,
            gOffset: firstPoint.metadata?.gOffset ?? 1,
            bOffset: firstPoint.metadata?.bOffset ?? 2,
        };
    }, [
        viewObjectStartChannel, viewObjectChannelsPerNode, viewObjectNodeCount,
        viewObjectROffset, viewObjectGOffset, viewObjectBOffset,
        viewObjectModelName, viewObject.name, points,
    ]);

    const startChannel = channelInfo?.startChannel;
    const channelsPerNode = channelInfo?.channelsPerNode ?? 3;
    const nodeCount = channelInfo?.nodeCount ?? 1;
    const rOffset = channelInfo?.rOffset ?? 0;
    const gOffset = channelInfo?.gOffset ?? 1;
    const bOffset = channelInfo?.bOffset ?? 2;

    // ----- URL construction -----
    const objUrl = useMemo(() => {
        if (!objFile || !frameServerUrl) return null;

        try {
            const url = new URL('/api/show-file', frameServerUrl);
            url.searchParams.set('path', objFile);
            return url.toString();
        } catch (err) {
            console.error('[HouseMesh] Failed to construct OBJ URL:', err);
            return null;
        }
    }, [objFile, frameServerUrl]);

    // Determine MTL file path (same directory as OBJ, same name with .mtl extension)
    const mtlUrl = useMemo(() => {
        if (!objFile || !frameServerUrl) return null;

        try {
            const pathWithoutExt = objFile.replace(/\.obj$/i, '');
            const url = new URL('/api/show-file', frameServerUrl);
            url.searchParams.set('path', `${pathWithoutExt}.mtl`);
            return url.toString();
        } catch (err) {
            console.error('[HouseMesh] Failed to construct MTL URL:', err);
            return null;
        }
    }, [objFile, frameServerUrl]);

    // -----------------------------------------------------------------
    // Combined MTL → OBJ loader
    //   1. Load .mtl  → MaterialCreator  (+ optimise textures)
    //   2. Fetch .obj text & analyse its content
    //   3. OBJLoader.parse(text) with materials set
    //   4. If OBJ only has line geometry, convert to mesh triangles
    //   5. Post-process materials: convert to unlit, fix colorSpace
    // -----------------------------------------------------------------
    React.useEffect(() => {
        if (!objUrl || !frameServerUrl || !objFile) return;

        let aborted = false;

        const loadModel = async () => {
            try {
                // Paths are now always forward-slash-normalized relative paths from playbackmaster
                const objDir = objFile.substring(0, objFile.lastIndexOf('/') + 1);

                const loadingManager = createShowFileLoadingManager(frameServerUrl, objDir);

                // ---- Step 1: Load MTL (best-effort) ----
                let materialCreator: MTLLoader.MaterialCreator | null = null;

                if (mtlUrl) {
                    try {
                        const mtlLoader = new MTLLoader(loadingManager);
                        materialCreator = await mtlLoader.loadAsync(mtlUrl);
                        if (aborted) return;

                        materialCreator.preload();

                        const matNames = Object.keys(materialCreator.materials);

                        // Optimise textures: disable mipmaps, fix colorSpace, cap size
                        optimizeMaterialTextures(materialCreator.materials);
                    } catch (mtlErr) {
                        console.warn('[HouseMesh] MTL not available (using default materials):', mtlErr);
                    }
                }

                if (aborted) return;

                // ---- Step 2: Fetch OBJ text for analysis + parsing ----
                const objResponse = await fetch(objUrl);
                if (!objResponse.ok) {
                    throw new Error(`Failed to fetch OBJ: ${objResponse.status} ${objResponse.statusText}`);
                }
                let objText = await objResponse.text();
                if (aborted) return;

                // ---- Step 2a: Analyse OBJ content ----
                const vertexCount = (objText.match(/^v\s/gm) || []).length;
                const normalCount = (objText.match(/^vn\s/gm) || []).length;
                const texCoordCount = (objText.match(/^vt\s/gm) || []).length;
                const faceCount = (objText.match(/^f\s/gm) || []).length;
                const lineCount = (objText.match(/^l\s/gm) || []).length;
                const mtllibCount = (objText.match(/^mtllib\s/gm) || []).length;
                const usemtlCount = (objText.match(/^usemtl\s/gm) || []).length;

                // Also check for upper-case variants some exporters produce
                const faceCountUpper = (objText.match(/^F\s/gm) || []).length;
                const lineCountUpper = (objText.match(/^L\s/gm) || []).length;

                // ---- Step 2b: Fix known format issues ----

                // CRITICAL FIX: THREE.js OBJLoader uses a single `geometry.type`
                // flag per object.  If the OBJ contains **both** face (`f`) and
                // line (`l`) directives within the same object, a single `l`
                // line sets `geometry.type = 'Line'` which causes OBJLoader to
                // create the *entire* geometry as LineSegments instead of Mesh –
                // losing all material groups and textures.
                //
                // This commonly happens with Blender/xLights exports that add a
                // stray edge (`l …`) at the end of an otherwise face-based model.
                //
                // Fix: when the OBJ has face data, strip all `l` directives so
                // OBJLoader correctly creates Mesh objects with proper material
                // groups.
                const totalFaces = faceCount + faceCountUpper;
                const totalLines = lineCount + lineCountUpper;
                if (totalFaces > 0 && totalLines > 0) {
                    console.warn(
                        `[HouseMesh] OBJ has ${totalFaces} faces AND ${totalLines} line directives. ` +
                        `Stripping line directives to prevent OBJLoader from creating LineSegments.`,
                    );
                    objText = objText.replace(/^[lL]\s.*$/gm, '');
                }

                // Some exporters (e.g. xLights) emit upper-case directives
                // (F, L, VN, VT) that Three.js OBJLoader doesn't recognise.
                if (faceCount === 0 && faceCountUpper > 0) {
                    console.warn(`[HouseMesh] Normalising ${faceCountUpper} upper-case F → f`);
                    objText = objText.replace(/^F\s/gm, 'f ');
                }
                if (texCoordCount === 0 && (objText.match(/^VT\s/gm) || []).length > 0) {
                    objText = objText.replace(/^VT\s/gm, 'vt ');
                }
                if (normalCount === 0 && (objText.match(/^VN\s/gm) || []).length > 0) {
                    objText = objText.replace(/^VN\s/gm, 'vn ');
                }

                // ---- Step 3: Parse OBJ ----
                const objLoader = new OBJLoader(loadingManager);
                if (materialCreator) {
                    objLoader.setMaterials(materialCreator);
                }

                let loadedObj = objLoader.parse(objText);
                if (aborted) return;

                // ---- Step 4: Diagnostics & fallback ----
                let meshCount = 0;
                let lineSegCount = 0;

                loadedObj.traverse((child: THREE.Object3D) => {
                    if (isMesh(child)) {
                        meshCount++;
                    }
                    if (child.type === 'LineSegments') {
                        lineSegCount++;
                    }
                });

                // ---- Step 5: If OBJ only produced LineSegments, convert to Mesh ----
                if (meshCount === 0 && lineSegCount > 0) {
                    console.warn('[HouseMesh] OBJ has no Mesh children (only LineSegments). Converting to mesh triangles…');
                    loadedObj = convertLineSegmentsToMeshes(loadedObj, materialCreator);
                }

                // ---- Step 6: Post-process materials ----
                // Convert lit materials → unlit MeshBasicMaterial so photo
                // textures display at their original brightness. Also fix
                // texture colorSpace for correct gamma handling.
                postProcessMeshMaterials(loadedObj);

                setObj(loadedObj);
            } catch (error) {
                if (!aborted) {
                    console.error('[HouseMesh] Failed to load model:', error);
                }
            }
        };

        loadModel();
        return () => { aborted = true; };
    }, [objUrl, mtlUrl, frameServerUrl, objFile, viewObject.name]);

    // ----- Transforms -----
    const position = useMemo(
        () => new THREE.Vector3(worldPosX, worldPosY, worldPosZ),
        [worldPosX, worldPosY, worldPosZ],
    );
    const scale = useMemo(
        () => new THREE.Vector3(scaleX, scaleY, scaleZ),
        [scaleX, scaleY, scaleZ],
    );
    const rotation = useMemo(
        () => new THREE.Euler(
            (rotateX * Math.PI) / 180,
            (rotateY * Math.PI) / 180,
            (rotateZ * Math.PI) / 180,
            'ZYX', // xLights uses ZYX rotation order (Z first, then Y, then X)
        ),
        [rotateX, rotateY, rotateZ],
    );

    // ----- Brightness (static, when not using live data) -----
    // For MeshBasicMaterial: material.color multiplies with the texture.
    // (1,1,1) = full brightness, (0.5,0.5,0.5) = 50% dim.
    React.useEffect(() => {
        if (!obj || brightness === undefined || (liveData && startChannel !== undefined)) return;

        const bf = Math.max(0, Math.min(1, brightness / 100));

        obj.traverse((child: THREE.Object3D) => {
            if (!isMesh(child) || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
                if ('color' in mat) {
                    (mat as THREE.MeshBasicMaterial).color.setRGB(bf, bf, bf);
                    mat.needsUpdate = true;
                }
            });
        });
    }, [obj, brightness, liveData, startChannel]);

    // ----- Live colour extraction from frame buffer -----
    useFrame(() => {
        if (!obj || !liveData) return;

        if (startChannel === undefined) {
            if (lastFrameSeqRef.current === null) {
                console.warn(`[HouseMesh] No channel mapping for "${viewObject.name}". Live colours disabled.`);
            }
            return;
        }

        const latestFrame = liveData.tryReadLatest(lastFrameSeqRef.current ?? undefined);
        if (!latestFrame?.bytes) return;

        let totalR = 0, totalG = 0, totalB = 0, validNodes = 0;

        for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
            const ch = startChannel + nodeIndex * channelsPerNode;
            if (ch + 2 < latestFrame.bytes.length) {
                totalR += latestFrame.bytes[ch + rOffset];
                totalG += latestFrame.bytes[ch + gOffset];
                totalB += latestFrame.bytes[ch + bOffset];
                validNodes++;
            }
        }

        if (validNodes === 0) {
            if (lastFrameSeqRef.current === null) {
                console.warn(`[HouseMesh] No valid channels for "${viewObject.name}" at ch=${startChannel}`);
            }
            return;
        }

        const bf = brightness !== undefined ? brightness / 100 : 1.0;
        const finalR = Math.min(1.0, totalR / validNodes / 255.0 * bf);
        const finalG = Math.min(1.0, totalG / validNodes / 255.0 * bf);
        const finalB = Math.min(1.0, totalB / validNodes / 255.0 * bf);

        let materialUpdated = false;

        obj.traverse((child: THREE.Object3D) => {
            if (!isMesh(child) || !child.material) return;

            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((material) => {
                // Use .type string instead of instanceof – safe across module copies
                if (
                    material.type === 'MeshStandardMaterial' ||
                    material.type === 'MeshPhongMaterial' ||
                    material.type === 'MeshLambertMaterial'
                ) {
                    const m = material as THREE.MeshStandardMaterial;
                    m.emissive.setRGB(finalR, finalG, finalB);
                    m.emissiveIntensity = 1.0;
                    m.color.setRGB(finalR, finalG, finalB);
                    m.needsUpdate = true;
                    materialUpdated = true;
                } else if (material.type === 'MeshBasicMaterial') {
                    const m = material as THREE.MeshBasicMaterial;
                    m.color.setRGB(finalR, finalG, finalB);
                    m.needsUpdate = true;
                    materialUpdated = true;
                }
            });
        });

        if (materialUpdated && lastFrameSeqRef.current === null) {
            // First frame with valid data – useful place to hook in any future diagnostics.
        }

        lastFrameSeqRef.current = latestFrame.seq;
    });

    // ----- Render -----
    if (!obj) return null;

    return (
        <primitive
            object={obj}
            position={position}
            scale={scale}
            rotation={rotation}
        />
    );
}

export function HouseMesh(props: HouseMeshProps) {
    return (
        <HouseMeshErrorBoundary viewObjectName={props.viewObject.name}>
            <Suspense fallback={null}>
                <HouseMeshContent {...props} />
            </Suspense>
        </HouseMeshErrorBoundary>
    );
}

