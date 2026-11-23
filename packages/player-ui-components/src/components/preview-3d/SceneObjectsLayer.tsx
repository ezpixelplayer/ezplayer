/**
 * SceneObjectsLayer - draws the objects injected through /api/ezp/objects.
 *
 * The layer polls the player for scene deltas into a SceneObjectsStore. React
 * renders one node per object and re-renders only when an object arrives,
 * leaves or gets new content; placement and appearance are read from the store
 * inside useFrame, so a moving object costs no reconciliation.
 *
 * The same tree serves both viewers. The 2D viewer looks down -Z and squashes
 * Z for the pixels; the layer is squashed the same way, so the depth buffer
 * still decides what hides what.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type {
    SceneAppearance,
    SceneAssetInfo,
    SceneContent,
    SceneFileRef,
    SceneNode,
    ScenePlacement,
} from '@ezplayer/ezplayer-core';
import { SCENE_OBJECTS_PATH } from '@ezplayer/ezplayer-core';
import type { ViewObject } from '../../types/model3d';
import { type AssetResolver, createShowFileResolver } from '../../services/assetResolver';
import { pollSceneObjects, SceneObjectsStore } from '../../services/sceneObjectsStore';
import { HouseMesh } from './HouseMesh';
import { FLAT_DEPTH_SCALE } from './pointShaders';

const DEFAULT_SMOOTH_MS = 120;
const DEFAULT_POINT_SIZE = 4;
const DEFAULT_BEAM_ANGLE_DEG = 3;
/** The 2D viewer squashes Z the same way for the pixels, so depth compares like with like. */
const FLAT_SCALE: [number, number, number] = [1, 1, FLAT_DEPTH_SCALE];
/** Puts see-through objects after the pixels in the 2D draw order. */
const FLAT_RENDER_ORDER = 0.5;

// ---------------------------------------------------------------------------
// Placement and appearance
// ---------------------------------------------------------------------------

const _zAxis = new THREE.Vector3(0, 0, 1);
const _dir = new THREE.Vector3();
const _euler = new THREE.Euler();
const _matrix = new THREE.Matrix4();
const DEG = Math.PI / 180;

/** Resolve a placement into position / orientation / scale. */
export function placementToTRS(
    p: ScenePlacement | undefined,
    pos: THREE.Vector3,
    quat: THREE.Quaternion,
    scale: THREE.Vector3,
): void {
    pos.set(0, 0, 0);
    quat.identity();
    scale.set(1, 1, 1);
    if (!p) return;
    if (p.matrix?.length === 16) {
        _matrix.fromArray(p.matrix).decompose(pos, quat, scale);
        return;
    }
    if (p.position) pos.fromArray(p.position);
    if (p.quaternion) {
        quat.fromArray(p.quaternion);
        if (quat.lengthSq() < 1e-12) quat.identity();
        else quat.normalize();
    } else if (p.direction) {
        _dir.fromArray(p.direction);
        if (_dir.lengthSq() > 1e-12) quat.setFromUnitVectors(_zAxis, _dir.normalize());
    } else if (p.rotation) {
        // Same order HouseMesh uses for xLights view objects.
        quat.setFromEuler(_euler.set(p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG, 'ZYX'));
    }
    if (typeof p.scale === 'number') scale.setScalar(p.scale);
    else if (p.scale) scale.fromArray(p.scale);
}

/** An appearance with its ancestors folded in. A new identity whenever anything changed. */
export interface ResolvedAppearance {
    visible: boolean;
    color: string | undefined;
    opacity: number;
    additive: boolean | undefined;
}

const ROOT_APPEARANCE: ResolvedAppearance = { visible: true, color: undefined, opacity: 1, additive: undefined };

export function mergeAppearance(parent: ResolvedAppearance, a: SceneAppearance | undefined): ResolvedAppearance {
    if (!a) return parent;
    return {
        visible: parent.visible && a.visible !== false,
        color: a.color ?? parent.color,
        opacity: parent.opacity * (a.opacity ?? 1),
        additive: a.additive ?? parent.additive,
    };
}

type GetAppearance = () => ResolvedAppearance;

/** '#rrggbb' as raw 0..1 components, for shaders that write the framebuffer directly. */
function hexToRaw(hex: string | undefined, out: THREE.Vector3): THREE.Vector3 {
    const v = hex ? parseInt(hex.slice(1), 16) : 0xffffff;
    return out.set(((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255);
}

/** Run `apply` from the render loop whenever the resolved appearance changes. */
function useAppearance(getAppearance: GetAppearance, apply: (a: ResolvedAppearance) => void, deps: unknown[]): void {
    const applied = useRef<ResolvedAppearance | null>(null);
    useEffect(() => {
        applied.current = null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    useFrame(() => {
        const a = getAppearance();
        if (a === applied.current) return;
        applied.current = a;
        apply(a);
    });
}

function applyToBasicMaterial(mat: THREE.MeshBasicMaterial, a: ResolvedAppearance): void {
    const additive = a.additive === true;
    mat.color.set(a.color ?? '#ffffff');
    mat.opacity = a.opacity;
    mat.transparent = a.opacity < 1 || additive || !!mat.map;
    mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.depthWrite = !mat.transparent;
    mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Per-object context
// ---------------------------------------------------------------------------

interface ObjectContext {
    objectKey: string;
    frameServerUrl: string | undefined;
    /** Uploaded assets first (by file name), then the host's resolver. */
    resolver: AssetResolver;
    assets: Record<string, SceneAssetInfo>;
}

const baseName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() ?? path;

function resolveRef(ctx: ObjectContext, ref: SceneFileRef): string | null {
    if (ref.asset !== undefined) return ctx.assets[ref.asset] ? ctx.resolver(ref.asset) : null;
    return ref.file ? ctx.resolver(ref.file.replace(/\\/g, '/')) : null;
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

const POINTS_VERT = `
    attribute vec3 aColor;
    uniform float uSize;
    uniform float uViewportH;
    varying vec3 vColor;
    void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // World-unit diameter to pixels, for either camera type.
        float px = uSize * length(modelMatrix[0].xyz) * uViewportH * 0.5 * projectionMatrix[1][1];
        if (projectionMatrix[2][3] == -1.0) px /= max(0.001, -mv.z);
        gl_PointSize = clamp(px, 1.5, 256.0);
    }
`;
const POINTS_FRAG = `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uSmooth;
    varying vec3 vColor;
    void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float falloff = mix(1.0, pow(1.0 - d, 1.5), uSmooth);
        gl_FragColor = vec4(vColor * uColor, uOpacity * falloff);
    }
`;

function PointsContent({
    content,
    getAppearance,
}: {
    content: Extract<SceneContent, { type: 'points' }>;
    getAppearance: GetAppearance;
}) {
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(content.positions, 3));
        const colors = new Float32Array(content.positions.length).fill(1);
        if (content.colors) for (let i = 0; i < colors.length; i++) colors[i] = content.colors[i] / 255;
        g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        return g;
    }, [content]);
    const material = useMemo(
        () =>
            new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Vector3(1, 1, 1) },
                    uOpacity: { value: 1 },
                    uSize: { value: content.size ?? DEFAULT_POINT_SIZE },
                    uSmooth: { value: content.smooth ? 1 : 0 },
                    uViewportH: { value: 600 },
                },
                vertexShader: POINTS_VERT,
                fragmentShader: POINTS_FRAG,
                transparent: true,
                depthWrite: false,
            }),
        [content],
    );
    useEffect(
        () => () => {
            geometry.dispose();
            material.dispose();
        },
        [geometry, material],
    );
    useFrame((state) => {
        material.uniforms.uViewportH.value = state.size.height * state.viewport.dpr;
    });
    useAppearance(
        getAppearance,
        (a) => {
            hexToRaw(a.color, material.uniforms.uColor.value);
            material.uniforms.uOpacity.value = a.opacity;
            material.blending = a.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        },
        [material],
    );
    return <points geometry={geometry} material={material} frustumCulled={false} />;
}

const BEAM_VERT = `
    uniform float uLength;
    varying float vT;
    void main() {
        vT = position.z / uLength;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
// Brightest at the origin, fading to nothing at the far end.
const BEAM_FRAG = `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vT;
    void main() {
        gl_FragColor = vec4(uColor, (1.0 - clamp(vT, 0.0, 1.0)) * uOpacity);
    }
`;

function BeamContent({
    content,
    getAppearance,
}: {
    content: Extract<SceneContent, { type: 'beam' }>;
    getAppearance: GetAppearance;
}) {
    const length = Math.max(content.length, 1e-3);
    const geometry = useMemo(() => {
        const near = content.radius ?? 0;
        const far = near + length * Math.tan((content.angle ?? DEFAULT_BEAM_ANGLE_DEG) * DEG);
        // Cylinder axis is +Y; turn it onto +Z with the narrow end at the origin.
        const g = new THREE.CylinderGeometry(Math.max(far, 1e-3), near, length, 24, 1, true);
        g.rotateX(Math.PI / 2);
        g.translate(0, 0, length / 2);
        return g;
    }, [content, length]);
    const material = useMemo(
        () =>
            new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Vector3(1, 1, 1) },
                    uOpacity: { value: 1 },
                    uLength: { value: length },
                },
                vertexShader: BEAM_VERT,
                fragmentShader: BEAM_FRAG,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            }),
        [length],
    );
    useEffect(
        () => () => {
            geometry.dispose();
            material.dispose();
        },
        [geometry, material],
    );
    useAppearance(
        getAppearance,
        (a) => {
            hexToRaw(a.color, material.uniforms.uColor.value);
            // Both walls of the cone add up, so hold each well under full.
            material.uniforms.uOpacity.value = a.opacity * 0.5;
            material.blending = a.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending;
        },
        [material],
    );
    return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

function ShapeContent({
    content,
    getAppearance,
}: {
    content: Extract<SceneContent, { type: 'shape' }>;
    getAppearance: GetAppearance;
}) {
    const geometry = useMemo(() => {
        switch (content.shape) {
            case 'sphere':
                return new THREE.SphereGeometry(0.5, 24, 16);
            case 'box':
                return new THREE.BoxGeometry(1, 1, 1);
            case 'cylinder':
                return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
            case 'cone':
                return new THREE.ConeGeometry(0.5, 1, 24);
            case 'plane':
                return new THREE.PlaneGeometry(1, 1);
        }
    }, [content.shape]);
    const material = useMemo(
        () =>
            new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, wireframe: !!content.wireframe, toneMapped: false }),
        [content.wireframe],
    );
    useEffect(
        () => () => {
            geometry.dispose();
            material.dispose();
        },
        [geometry, material],
    );
    useAppearance(getAppearance, (a) => applyToBasicMaterial(material, a), [material]);
    const size = content.size ?? 1;
    const scale: [number, number, number] = typeof size === 'number' ? [size, size, size] : size;
    return <mesh geometry={geometry} material={material} scale={scale} />;
}

function ImageContent({
    content,
    getAppearance,
    ctx,
}: {
    content: Extract<SceneContent, { type: 'image' }>;
    getAppearance: GetAppearance;
    ctx: ObjectContext;
}) {
    const url = resolveRef(ctx, content);
    const [loaded, setLoaded] = useState<{ texture: THREE.Texture; aspect: number } | null>(null);
    useEffect(() => {
        if (!url) return;
        let disposed = false;
        let texture: THREE.Texture | undefined;
        new THREE.TextureLoader().load(
            url,
            (t) => {
                if (disposed) {
                    t.dispose();
                    return;
                }
                texture = t;
                t.colorSpace = THREE.SRGBColorSpace;
                const img = t.image as { width?: number; height?: number } | undefined;
                setLoaded({ texture: t, aspect: img?.width && img?.height ? img.width / img.height : 1 });
            },
            undefined,
            () => console.warn(`[SceneObjects] could not load image for '${ctx.objectKey}': ${url}`),
        );
        return () => {
            disposed = true;
            texture?.dispose();
            setLoaded(null);
        };
    }, [url, ctx.objectKey]);

    const material = useMemo(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), []);
    useEffect(() => () => material.dispose(), [material]);
    useEffect(() => {
        material.map = loaded?.texture ?? null;
        material.needsUpdate = true;
    }, [material, loaded]);
    useAppearance(getAppearance, (a) => applyToBasicMaterial(material, a), [material, loaded]);

    if (!loaded) return null;
    const natural = loaded.texture.image as { width?: number } | undefined;
    const width = content.width ?? (content.height ? content.height * loaded.aspect : (natural?.width ?? 100));
    const height = content.height ?? width / loaded.aspect;
    return (
        <mesh material={material} scale={[width, height, 1]}>
            <planeGeometry args={[1, 1]} />
        </mesh>
    );
}

type Tintable = THREE.Material & { color?: THREE.Color; userData: { sceneBaseOpacity?: number } };

function MeshContent({
    content,
    getAppearance,
    ctx,
}: {
    content: Extract<SceneContent, { type: 'mesh' }>;
    getAppearance: GetAppearance;
    ctx: ObjectContext;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const objFile = content.asset ?? content.file?.replace(/\\/g, '/');
    const ready = content.asset === undefined || !!ctx.assets[content.asset];
    const viewObject = useMemo<ViewObject>(
        () => ({
            name: ctx.objectKey,
            displayAs: 'Mesh',
            objFile,
            worldPosX: 0,
            worldPosY: 0,
            worldPosZ: 0,
            scaleX: 1,
            scaleY: 1,
            scaleZ: 1,
            rotateX: 0,
            rotateY: 0,
            rotateZ: 0,
            brightness: 100,
        }),
        [ctx.objectKey, objFile],
    );

    // HouseMesh loads asynchronously, so re-tint whenever its mesh count changes.
    const applied = useRef<{ a: ResolvedAppearance | null; meshes: number }>({ a: null, meshes: 0 });
    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        const a = getAppearance();
        let meshes = 0;
        group.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) meshes++;
        });
        if (a === applied.current.a && meshes === applied.current.meshes) return;
        applied.current = { a, meshes };
        group.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || !mesh.material) return;
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                const mat = m as Tintable;
                mat.userData.sceneBaseOpacity ??= mat.opacity;
                mat.color?.set(a.color ?? '#ffffff');
                mat.opacity = mat.userData.sceneBaseOpacity * a.opacity;
                if (mat.opacity < 1) mat.transparent = true;
                mat.blending = a.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
                mat.needsUpdate = true;
            }
        });
    });

    if (!objFile || !ready) return null;
    return (
        <group ref={groupRef}>
            <HouseMesh
                viewObject={viewObject}
                frameServerUrl={ctx.frameServerUrl}
                assetResolver={ctx.resolver}
                backgroundBrightness={100}
            />
        </group>
    );
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

function ChildNode({
    node,
    getParentAppearance,
    ctx,
}: {
    node: SceneNode;
    getParentAppearance: GetAppearance;
    ctx: ObjectContext;
}) {
    const trs = useMemo(() => {
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        placementToTRS(node.placement, pos, quat, scale);
        return { pos, quat, scale };
    }, [node.placement]);
    const getAppearance = useMemo<GetAppearance>(() => {
        let lastParent: ResolvedAppearance | null = null;
        let last = ROOT_APPEARANCE;
        return () => {
            const parent = getParentAppearance();
            if (parent !== lastParent) {
                lastParent = parent;
                last = mergeAppearance(parent, node.appearance);
            }
            return last;
        };
    }, [getParentAppearance, node.appearance]);
    return (
        <group position={trs.pos} quaternion={trs.quat} scale={trs.scale} visible={node.appearance?.visible !== false}>
            <NodeContent content={node.content} getAppearance={getAppearance} ctx={ctx} />
        </group>
    );
}

function NodeContent({
    content,
    getAppearance,
    ctx,
}: {
    content: SceneContent;
    getAppearance: GetAppearance;
    ctx: ObjectContext;
}) {
    switch (content.type) {
        case 'points':
            return <PointsContent content={content} getAppearance={getAppearance} />;
        case 'beam':
            return <BeamContent content={content} getAppearance={getAppearance} />;
        case 'shape':
            return <ShapeContent content={content} getAppearance={getAppearance} />;
        case 'image':
            return <ImageContent content={content} getAppearance={getAppearance} ctx={ctx} />;
        case 'mesh':
            return <MeshContent content={content} getAppearance={getAppearance} ctx={ctx} />;
        case 'group':
            return (
                <>
                    {content.children.map((child, i) => (
                        <ChildNode key={i} node={child} getParentAppearance={getAppearance} ctx={ctx} />
                    ))}
                </>
            );
        default:
            // Content from a newer player than this viewer.
            return null;
    }
}

/** A failing object (bad mesh, bad texture) must not take the whole preview down. */
class ObjectBoundary extends React.Component<{ objectKey: string; children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: Error) {
        console.warn(`[SceneObjects] '${this.props.objectKey}' failed to render:`, error);
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}

function SceneObjectRoot({
    objectKey,
    contentRev,
    store,
    frameServerUrl,
    hostResolver,
}: {
    objectKey: string;
    contentRev: number;
    store: SceneObjectsStore;
    frameServerUrl: string | undefined;
    hostResolver: AssetResolver;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const motion = useRef({
        seeded: false,
        placement: undefined as ScenePlacement | undefined,
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        scale: new THREE.Vector3(1, 1, 1),
    });
    const look = useRef({ source: undefined as SceneAppearance | undefined, resolved: ROOT_APPEARANCE });
    const getAppearance = useCallback<GetAppearance>(() => look.current.resolved, []);

    useFrame((_state, delta) => {
        const group = groupRef.current;
        const o = store.get(objectKey);
        if (!group || !o) return;

        const m = motion.current;
        if (o.placement !== m.placement) {
            m.placement = o.placement;
            placementToTRS(o.placement, m.pos, m.quat, m.scale);
        }
        const tau = (o.smoothMs ?? DEFAULT_SMOOTH_MS) / 1000;
        if (!m.seeded || tau <= 0) {
            group.position.copy(m.pos);
            group.quaternion.copy(m.quat);
            group.scale.copy(m.scale);
            m.seeded = true;
        } else {
            // Clamp the step so a backgrounded tab does not overshoot on return.
            const t = 1 - Math.exp(-Math.min(delta, 0.1) / tau);
            group.position.lerp(m.pos, t);
            group.quaternion.slerp(m.quat, t);
            group.scale.lerp(m.scale, t);
        }

        const l = look.current;
        if (o.appearance !== l.source) {
            l.source = o.appearance;
            l.resolved = mergeAppearance(ROOT_APPEARANCE, o.appearance);
        }
        group.visible = l.resolved.visible;
    });

    // Content and assets only change along with contentRev, which re-renders us.
    const object = store.get(objectKey);
    const assets = object?.assets;
    const ctx = useMemo<ObjectContext>(() => {
        const held = assets ?? {};
        const base = (frameServerUrl ?? '').replace(/\/+$/, '');
        const prefix = `${base}${SCENE_OBJECTS_PATH}/${encodeURIComponent(objectKey)}/assets/`;
        return {
            objectKey,
            frameServerUrl,
            assets: held,
            resolver: (path) => {
                let name = baseName(path);
                // Loaders hand back percent-encoded names for files they found inside an MTL.
                if (!held[name] && name.includes('%')) {
                    try {
                        name = decodeURIComponent(name);
                    } catch {
                        /* not an encoding; use as is */
                    }
                }
                const asset = held[name];
                return asset ? `${prefix}${encodeURIComponent(name)}?rev=${asset.rev}` : hostResolver(path);
            },
        };
    }, [objectKey, frameServerUrl, hostResolver, assets]);

    if (!object) return null;
    return (
        <group ref={groupRef} visible={false}>
            <ObjectBoundary key={contentRev} objectKey={objectKey}>
                <NodeContent content={object.content} getAppearance={getAppearance} ctx={ctx} />
            </ObjectBoundary>
        </group>
    );
}

export interface SceneObjectsLayerProps {
    /** Player base URL; the layer is inert without one. */
    frameServerUrl?: string;
    /** Resolver for show-folder files; defaults to show-file URLs on frameServerUrl. */
    assetResolver?: AssetResolver;
    mode: '2d' | '3d';
    /** False stops polling and shows nothing. */
    enabled?: boolean;
}

export function SceneObjectsLayer({ frameServerUrl, assetResolver, mode, enabled = true }: SceneObjectsLayerProps) {
    const store = useMemo(() => new SceneObjectsStore(), []);
    // A stopped frameloop means frame-stepped export, which shows the layout alone.
    const live = useThree((s) => s.frameloop) !== 'never' && enabled;
    useEffect(() => {
        if (!live || !frameServerUrl) {
            store.clear();
            return;
        }
        return pollSceneObjects(frameServerUrl, store);
    }, [store, frameServerUrl, live]);

    const structure = useSyncExternalStore(store.subscribe, store.getStructure);
    const hostResolver = useMemo(
        () => assetResolver ?? createShowFileResolver(frameServerUrl),
        [assetResolver, frameServerUrl],
    );

    const flat = mode === '2d';
    return (
        <group renderOrder={flat ? FLAT_RENDER_ORDER : 0} scale={flat ? FLAT_SCALE : undefined}>
            {structure
                .filter((e) => e.view === 'both' || e.view === mode)
                .map((e) => (
                    <SceneObjectRoot
                        key={e.key}
                        objectKey={e.key}
                        contentRev={e.contentRev}
                        store={store}
                        frameServerUrl={frameServerUrl}
                        hostResolver={hostResolver}
                    />
                ))}
        </group>
    );
}
