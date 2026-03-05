/**
 * MovingHeadBeams — renders DMX moving head fixture bodies and light beams
 * in the 3D preview scene.
 *
 * Each fixture renders three meshes updated imperatively in useFrame:
 *   - A cylinder "body" at the fixture world position (static).
 *   - A small cone "direction arrow" always showing the current beam aim,
 *     even when the beam is inactive (shutter closed / dimmer = 0).
 *   - An additive-blended cone "beam" visible only when the fixture is live.
 *
 * Cone orientation convention (shared by arrow and beam):
 *   - Unit ConeGeometry(1,1,N): tip at +Y, base at -Y.
 *   - Quaternion aligns +Y with -beamDirection so the tip stays at the
 *     emission origin and the base opens in the beam direction.
 *   - mesh.position = beamOrigin + beamDirection * (coneLength / 2).
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { mhChannelsToState, computeBeamDescriptor } from 'xllayoutcalcs';
import type { MhFixtureInfo } from 'xllayoutcalcs';

const DEG_TO_RAD = Math.PI / 180;

// Arrow dimensions (scene units)
const ARROW_LENGTH = 30;
const ARROW_RADIUS = 3;

// Pre-allocated scratch objects — shared within a single frame to avoid
// per-frame heap allocations.
const _yAxis = new THREE.Vector3(0, 1, 0);
const _negDir = new THREE.Vector3();
const _quat = new THREE.Quaternion();

// Beam cone shader — fades alpha from full at the tip (vY = +0.5, near fixture)
// to zero at the base (vY = -0.5, far end), matching xLights' beam_color_end.alpha=0.
const BEAM_VERT = `
    varying float vY;
    void main() {
        vY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const BEAM_FRAG = `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying float vY;
    void main() {
        // vY: +0.5 at tip (head), -0.5 at base (far end).
        float alpha = clamp((vY + 0.5) * uOpacity, 0.0, uOpacity);
        gl_FragColor = vec4(uColor, alpha);
    }
`;

// ============================================================================
// Single fixture renderer
// ============================================================================

interface MovingHeadFixtureProps {
    fixture: MhFixtureInfo;
    liveData?: LatestFrameRingBuffer;
}

function MovingHeadFixture({ fixture, liveData }: MovingHeadFixtureProps) {
    const beamMeshRef = useRef<THREE.Mesh>(null);
    const beamMatRef = useRef<THREE.ShaderMaterial>(null);
    const dirMeshRef = useRef<THREE.Mesh>(null);
    const lastSeqRef = useRef<number>(0);

    // Uniforms are memoized so the same object is mutated imperatively in useFrame
    // rather than replaced on each render.
    const beamUniforms = useMemo(() => ({
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0.6 },
    }), []);

    const { worldPosX, worldPosY, worldPosZ } = fixture.worldTransform;

    useFrame(() => {
        const mesh = beamMeshRef.current;
        const dirMesh = dirMeshRef.current;
        if (!mesh) return;

        if (!liveData) {
            // No data source — hide everything and stay hidden.
            mesh.visible = false;
            if (dirMesh) dirMesh.visible = false;
            return;
        }

        // Skip if no new frame has arrived — leave mesh state from last update as-is.
        // Resetting visibility here would cause the beam to disappear on every render
        // frame that doesn't coincide with a new sequence frame (e.g. 60fps render
        // vs 40fps sequence = beam hidden every other render frame → flicker).
        const latest = liveData.tryReadLatest(lastSeqRef.current);
        if (!latest) return;
        lastSeqRef.current = latest.seq;

        // New frame arrived: reset beam visibility, then restore below if appropriate.
        mesh.visible = false;

        // Extract this fixture's DMX channels from the full frame buffer
        const { channelOffset, numChannels, definition, beamParams, worldTransform } = fixture;
        const channelData = latest.bytes.slice(channelOffset, channelOffset + numChannels);

        // Compute physical state (pan, tilt, color, dimmer, shutter)
        const state = mhChannelsToState(definition, channelData);

        // Compute world-space beam descriptor
        const beam = computeBeamDescriptor(state, beamParams, worldTransform);

        if (!beam) {
            if (dirMesh) dirMesh.visible = false;
            return;
        }

        // Validate and normalize direction — shared by arrow and beam cone
        const { origin, direction } = beam;
        const dirLenSq = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
        if (dirLenSq < 1e-12) {
            if (dirMesh) dirMesh.visible = false;
            return;
        }
        const dirLen = Math.sqrt(dirLenSq);
        const dx = direction[0] / dirLen;
        const dy = direction[1] / dirLen;
        const dz = direction[2] / dirLen;

        // Quaternion aligning cone +Y with -direction (tip at origin, base forward)
        _negDir.set(-dx, -dy, -dz);
        if (Math.abs(_negDir.y - 1) < 1e-6) {
            _quat.identity();
        } else if (Math.abs(_negDir.y + 1) < 1e-6) {
            _quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
        } else {
            _quat.setFromUnitVectors(_yAxis, _negDir);
        }

        // --- Direction arrow — always visible, shows current beam aim ---
        if (dirMesh) {
            dirMesh.position.set(
                origin[0] + dx * ARROW_LENGTH * 0.5,
                origin[1] + dy * ARROW_LENGTH * 0.5,
                origin[2] + dz * ARROW_LENGTH * 0.5,
            );
            dirMesh.quaternion.copy(_quat);
            dirMesh.visible = true;
        }

        // --- Beam cone — only when shutter open and dimmer > 0 ---
        const { length, coneHalfAngle, r, g, b, dimmer } = beam;
        if (!beam.shutterOpen || dimmer <= 0 || length <= 0) return;

        // Enforce a minimum display half-angle so thin beams remain visible
        const displayHalfAngle = Math.max(coneHalfAngle, 3);
        const baseRadius = length * Math.tan(displayHalfAngle * DEG_TO_RAD);
        if (baseRadius <= 0) return;

        mesh.scale.set(baseRadius, length, baseRadius);
        mesh.position.set(
            origin[0] + dx * length * 0.5,
            origin[1] + dy * length * 0.5,
            origin[2] + dz * length * 0.5,
        );
        mesh.quaternion.copy(_quat);

        // Include white channel (state.w) for RGBW fixtures — additive over RGB
        const mat = beamMatRef.current;
        if (mat) {
            const w = state.w;
            mat.uniforms.uColor.value.setRGB(
                Math.min(255, r + w) / 255,
                Math.min(255, g + w) / 255,
                Math.min(255, b + w) / 255,
            );
            mat.uniforms.uOpacity.value = Math.max(0.15, Math.min(0.85, dimmer * 0.8));
        }

        mesh.visible = true;
    });

    return (
        <group>
            {/* Fixture body — short cylinder at world position */}
            <mesh position={[worldPosX, worldPosY, worldPosZ]}>
                <cylinderGeometry args={[5, 7, 14, 12]} />
                <meshStandardMaterial color="#aaaaaa" metalness={0.4} roughness={0.6} />
            </mesh>

            {/* Direction arrow — small cone showing current beam aim */}
            <mesh ref={dirMeshRef} visible={false} frustumCulled={false}>
                <coneGeometry args={[ARROW_RADIUS, ARROW_LENGTH, 8]} />
                <meshBasicMaterial
                    color="#ffee44"
                    transparent={true}
                    opacity={0.75}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                    depthTest={false}
                />
            </mesh>

            {/* Beam cone — unit geometry, sized/positioned/oriented each frame.
                ShaderMaterial fades alpha from full at the tip to zero at the base. */}
            <mesh ref={beamMeshRef} visible={false} frustumCulled={false}>
                <coneGeometry args={[1, 1, 24]} />
                <shaderMaterial
                    ref={beamMatRef}
                    uniforms={beamUniforms}
                    vertexShader={BEAM_VERT}
                    fragmentShader={BEAM_FRAG}
                    transparent={true}
                    side={THREE.DoubleSide}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    depthTest={false}
                />
            </mesh>
        </group>
    );
}

// ============================================================================
// Container — renders all moving head fixtures
// ============================================================================

export interface MovingHeadBeamsProps {
    fixtures: MhFixtureInfo[];
    liveData?: LatestFrameRingBuffer;
}

export function MovingHeadBeams({ fixtures, liveData }: MovingHeadBeamsProps) {
    if (!fixtures || fixtures.length === 0) return null;

    return (
        <>
            {fixtures.map((fixture) => (
                <MovingHeadFixture key={fixture.name} fixture={fixture} liveData={liveData} />
            ))}
        </>
    );
}
