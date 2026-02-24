import React, { useMemo, Suspense, ErrorInfo, useRef, useEffect } from 'react';
import { useLoader, useFrame } from '@react-three/fiber';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import * as THREE from 'three';
import type { ViewObject, Point3D } from '../../types/model3d';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';

interface HouseMeshProps {
    viewObject: ViewObject;
    frameServerUrl?: string;
    liveData?: LatestFrameRingBuffer;
    points?: Point3D[]; // Points to look up channel information
}

// Error boundary component for HouseMesh
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
            // Try to extract more details from the error
            errorDetails: (error as any)?.response || (error as any)?.details
        });

        // If it's a 403 error, log additional debugging info
        if (error?.message?.includes('403') || error?.message?.includes('Forbidden')) {
            console.error('[HouseMesh] 403 Forbidden - This usually means:');
            console.error('  1. Show folder is not set on the server');
            console.error('  2. File path is outside the show folder');
            console.error('  3. Check the Electron main process console for [server-worker] logs');
        }
    }

    render() {
        if (this.state.hasError) {
            // Silently fail - don't render anything if mesh fails to load
            // This prevents the entire 3D viewer from crashing
            return null;
        }

        return this.props.children;
    }
}

function HouseMeshContent({ viewObject, frameServerUrl, liveData, points }: HouseMeshProps) {
    const {
        objFile,
        worldPosX,
        worldPosY,
        worldPosZ,
        scaleX,
        scaleY,
        scaleZ,
        rotateX,
        rotateY,
        rotateZ,
        brightness,
        startChannel: viewObjectStartChannel,
        channelsPerNode: viewObjectChannelsPerNode = 3,
        nodeCount: viewObjectNodeCount = 1,
        modelName: viewObjectModelName,
        rOffset: viewObjectROffset = 0,
        gOffset: viewObjectGOffset = 1,
        bOffset: viewObjectBOffset = 2,
    } = viewObject;

    // Track last frame sequence to avoid reprocessing
    const lastFrameSeqRef = useRef<number | null>(null);

    // Auto-detect channel information from points if not provided
    const channelInfo = useMemo(() => {
        // If channel info is explicitly provided, use it
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

        // Try to find channel info from points by matching model name
        if (!points || points.length === 0) {
            return null;
        }

        // Try to match by modelName first, then by viewObject name
        const searchName = viewObjectModelName || viewObject.name;
        const matchingPoints = points.filter(p => p.metadata?.modelName === searchName);

        if (matchingPoints.length === 0) {
            return null;
        }

        // Get channels from matching points
        const channels = matchingPoints
            .map(p => p.channel)
            .filter((ch): ch is number => ch !== undefined)
            .sort((a, b) => a - b);

        if (channels.length === 0) {
            return null;
        }

        // Use the first channel as startChannel
        const detectedStartChannel = channels[0];
        const detectedChannelsPerNode = 3; // Assume RGB
        const detectedNodeCount = Math.ceil((channels[channels.length - 1] - channels[0] + 3) / 3);

        // Get color offsets from first point's metadata
        const firstPoint = matchingPoints[0];
        const detectedROffset = firstPoint.metadata?.rOffset ?? 0;
        const detectedGOffset = firstPoint.metadata?.gOffset ?? 1;
        const detectedBOffset = firstPoint.metadata?.bOffset ?? 2;

        return {
            startChannel: detectedStartChannel,
            channelsPerNode: detectedChannelsPerNode,
            nodeCount: detectedNodeCount,
            rOffset: detectedROffset,
            gOffset: detectedGOffset,
            bOffset: detectedBOffset,
        };
    }, [viewObjectStartChannel, viewObjectChannelsPerNode, viewObjectNodeCount, viewObjectROffset, viewObjectGOffset, viewObjectBOffset, viewObjectModelName, viewObject.name, points]);

    const startChannel = channelInfo?.startChannel;
    const channelsPerNode = channelInfo?.channelsPerNode ?? 3;
    const nodeCount = channelInfo?.nodeCount ?? 1;
    const rOffset = channelInfo?.rOffset ?? 0;
    const gOffset = channelInfo?.gOffset ?? 1;
    const bOffset = channelInfo?.bOffset ?? 2;

    // Construct URL for OBJ file - use frameServerUrl to serve files from show folder
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

    if (!objUrl) {
        return null;
    }

    // Load OBJ file - useLoader will suspend if loading
    // Errors will be caught by ErrorBoundary
    const obj = useLoader(OBJLoader, objUrl);

    // Apply transforms
    const position = useMemo(
        () => new THREE.Vector3(worldPosX, worldPosY, worldPosZ),
        [worldPosX, worldPosY, worldPosZ],
    );
    const scale = useMemo(() => new THREE.Vector3(scaleX, scaleY, scaleZ), [scaleX, scaleY, scaleZ]);
    const rotation = useMemo(
        () => new THREE.Euler((rotateX * Math.PI) / 180, (rotateY * Math.PI) / 180, (rotateZ * Math.PI) / 180),
        [rotateX, rotateY, rotateZ],
    );

    // Apply brightness if specified (only when NOT using live data)
    // When live data is available, brightness is applied in the useFrame hook
    React.useEffect(() => {
        if (obj && brightness !== undefined && (!liveData || startChannel === undefined)) {
            obj.traverse((child: THREE.Object3D) => {
                if (child instanceof THREE.Mesh && child.material) {
                    const material = Array.isArray(child.material) ? child.material[0] : child.material;
                    if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhongMaterial) {
                        // Adjust emissive or multiply color by brightness
                        const brightnessFactor = brightness / 100;
                        if (material.color) {
                            material.color.multiplyScalar(brightnessFactor);
                        }
                    }
                }
            });
        }
    }, [obj, brightness, liveData, startChannel]);

    // Apply materials to OBJ if available
    React.useEffect(() => {
        if (obj && mtlUrl && frameServerUrl && objFile) {
            // Try to load materials asynchronously and apply them
            const loadMaterials = async () => {
                try {
                    // Extract the directory path from the OBJ file path for texture resolution
                    const objDir = objFile.substring(0, objFile.lastIndexOf('\\') + 1) ||
                        objFile.substring(0, objFile.lastIndexOf('/') + 1) || '';

                    // Create a custom LoadingManager that intercepts texture URLs
                    const loadingManager = new THREE.LoadingManager();
                    const originalResolveURL = loadingManager.resolveURL.bind(loadingManager);

                    loadingManager.resolveURL = (url: string) => {
                        // If it's already a full URL (http/https/data), use as-is
                        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
                            return originalResolveURL(url);
                        }

                        // If it's a relative texture path, route it through our API
                        // MTL files reference textures like "texture_1001.png" relative to MTL location
                        const texturePath = objDir + url;
                        const textureUrl = new URL('/api/show-file', frameServerUrl);
                        textureUrl.searchParams.set('path', texturePath);
                        return textureUrl.toString();
                    };

                    const loader = new MTLLoader(loadingManager);

                    // Set the base path for texture resolution
                    // Extract directory from MTL URL path
                    const mtlPathWithoutExt = objFile.replace(/\.obj$/i, '');
                    const mtlDir = mtlPathWithoutExt.substring(0, mtlPathWithoutExt.lastIndexOf('\\') + 1) ||
                        mtlPathWithoutExt.substring(0, mtlPathWithoutExt.lastIndexOf('/') + 1) || '';

                    // Set path so MTLLoader knows where to look for textures
                    // But we'll intercept via LoadingManager anyway
                    loader.setPath(mtlDir);

                    // Load MTL file
                    const materials = await loader.loadAsync(mtlUrl);
                    materials.preload();

                    // Apply materials to meshes
                    obj.traverse((child: THREE.Object3D) => {
                        if (child instanceof THREE.Mesh && child.material) {
                            const materialName = typeof child.material.name === 'string' ? child.material.name : '';
                            if (materials.materials[materialName]) {
                                child.material = materials.materials[materialName];
                            }
                        }
                    });
                } catch (error) {
                    // MTL file might not exist, that's okay - OBJ can render without materials
                    console.warn('[HouseMesh] Failed to load MTL file asynchronously:', error);
                }
            };
            loadMaterials();
        }
    }, [obj, mtlUrl, frameServerUrl, objFile]);

    // Extract and apply live colors from frame buffer
    useFrame(() => {
        if (!obj || !liveData) {
            return;
        }

        // If no startChannel is defined, we can't extract colors
        // Log this once for debugging
        if (startChannel === undefined) {
            if (lastFrameSeqRef.current === null) {
                console.warn(`[HouseMesh] No channel mapping for "${viewObject.name}". Live colors disabled. Set startChannel in view object to enable.`);
            }
            return;
        }

        // Get latest frame
        const latestFrame = liveData.tryReadLatest(lastFrameSeqRef.current ?? undefined);
        if (!latestFrame?.bytes) {
            return;
        }

        // Calculate average color from all nodes in this view object
        // For simplicity, we'll average all channels for the entire mesh
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let validNodes = 0;

        for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
            const channelIndex = startChannel + (nodeIndex * channelsPerNode);

            if (channelIndex + 2 < latestFrame.bytes.length) {
                // Read bytes using the correct channel offsets
                const rByte = latestFrame.bytes[channelIndex + rOffset];
                const gByte = latestFrame.bytes[channelIndex + gOffset];
                const bByte = latestFrame.bytes[channelIndex + bOffset];

                totalR += rByte;
                totalG += gByte;
                totalB += bByte;
                validNodes++;
            }
        }

        if (validNodes === 0) {
            // Log once if we can't find valid channels
            if (lastFrameSeqRef.current === null) {
                console.warn(`[HouseMesh] No valid channels found for "${viewObject.name}" at startChannel=${startChannel}, nodeCount=${nodeCount}`);
            }
            return;
        }

        // Calculate average color
        const avgR = totalR / validNodes / 255.0;
        const avgG = totalG / validNodes / 255.0;
        const avgB = totalB / validNodes / 255.0;

        // Apply brightness if specified
        const brightnessFactor = brightness !== undefined ? brightness / 100 : 1.0;
        const finalR = Math.min(1.0, avgR * brightnessFactor);
        const finalG = Math.min(1.0, avgG * brightnessFactor);
        const finalB = Math.min(1.0, avgB * brightnessFactor);

        // Apply color to all materials in the mesh
        let materialUpdated = false;
        obj.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                materials.forEach((material) => {
                    if (material instanceof THREE.MeshStandardMaterial ||
                        material instanceof THREE.MeshPhongMaterial ||
                        material instanceof THREE.MeshLambertMaterial) {
                        // Set emissive color to create the lighting effect
                        // This works better than just setting color for dynamic lighting
                        material.emissive.setRGB(finalR, finalG, finalB);
                        material.emissiveIntensity = 1.0;
                        // Also set the base color for better compatibility
                        material.color.setRGB(finalR, finalG, finalB);
                        material.needsUpdate = true;
                        materialUpdated = true;
                    } else if (material instanceof THREE.MeshBasicMaterial) {
                        // MeshBasicMaterial doesn't have emissive, just set color
                        material.color.setRGB(finalR, finalG, finalB);
                        material.needsUpdate = true;
                        materialUpdated = true;
                    }
                });
            }
        });

        // Log first successful color update for debugging
        if (materialUpdated && lastFrameSeqRef.current === null) {
            console.log(`[HouseMesh] Live colors enabled for "${viewObject.name}": RGB(${Math.round(finalR * 255)}, ${Math.round(finalG * 255)}, ${Math.round(finalB * 255)}) from ${validNodes} nodes`);
        }

        // Mark this frame as processed
        lastFrameSeqRef.current = latestFrame.seq;
    });

    // Debug: Log mesh info when it loads
    React.useEffect(() => {
        if (obj) {
            const box = new THREE.Box3();
            box.setFromObject(obj);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            console.log('[HouseMesh] Mesh loaded:', {
                name: viewObject.name,
                position: { x: position.x, y: position.y, z: position.z },
                scale: { x: scale.x, y: scale.y, z: scale.z },
                rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
                meshBounds: {
                    center: { x: center.x, y: center.y, z: center.z },
                    size: { x: size.x, y: size.y, z: size.z }
                },
                worldBounds: {
                    min: {
                        x: position.x + center.x - size.x / 2,
                        y: position.y + center.y - size.y / 2,
                        z: position.z + center.z - size.z / 2
                    },
                    max: {
                        x: position.x + center.x + size.x / 2,
                        y: position.y + center.y + size.y / 2,
                        z: position.z + center.z + size.z / 2
                    }
                },
                channelInfo: startChannel !== undefined ? {
                    startChannel,
                    channelsPerNode,
                    nodeCount,
                    colorOrder: `R=${rOffset}, G=${gOffset}, B=${bOffset}`,
                    source: viewObjectStartChannel !== undefined ? 'explicit' : 'auto-detected from points'
                } : 'No channel mapping - using static materials',
                liveDataEnabled: !!liveData && startChannel !== undefined,
                matchingPoints: points ? points.filter(p => p.metadata?.modelName === (viewObjectModelName || viewObject.name)).length : 0
            });
        }
    }, [obj, position, scale, rotation, viewObject.name, startChannel, channelsPerNode, nodeCount, liveData, viewObjectStartChannel, points, viewObjectModelName]);

    return (
        <primitive
            object={obj}
            position={position}
            scale={scale}
            rotation={rotation}
            castShadow
            receiveShadow
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

