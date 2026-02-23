import React, { useMemo, Suspense } from 'react';
import { useLoader } from '@react-three/fiber';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import * as THREE from 'three';
import type { ViewObject } from '../../types/model3d';

interface HouseMeshProps {
    viewObject: ViewObject;
    frameServerUrl?: string;
}

function HouseMeshContent({ viewObject, frameServerUrl }: HouseMeshProps) {
    const { objFile, worldPosX, worldPosY, worldPosZ, scaleX, scaleY, scaleZ, rotateX, rotateY, rotateZ, brightness } =
        viewObject;

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

    // Load MTL first if available, then OBJ
    // Only load MTL if URL is valid (not null)
    let materials = null;
    try {
        if (mtlUrl) {
            materials = useLoader(MTLLoader, mtlUrl);
        }
    } catch (err) {
        // MTL file might not exist, that's okay - OBJ can load without materials
        console.warn('[HouseMesh] Failed to load MTL file, continuing without materials:', err);
    }

    // Load OBJ file
    let obj = null;
    try {
        if (objUrl) {
            obj = useLoader(OBJLoader, objUrl, (loader) => {
                if (materials) {
                    try {
                        materials.preload();
                        (loader as OBJLoader).setMaterials(materials);
                    } catch (err) {
                        console.warn('[HouseMesh] Failed to set materials on OBJ loader:', err);
                    }
                }
            });
        }
    } catch (err) {
        console.error('[HouseMesh] Failed to load OBJ file:', err);
        return null;
    }

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

    // Apply brightness if specified
    React.useEffect(() => {
        if (obj && brightness !== undefined) {
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
    }, [obj, brightness]);

    if (!objUrl || !obj) {
        return null;
    }

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
        <Suspense fallback={null}>
            <HouseMeshContent {...props} />
        </Suspense>
    );
}

