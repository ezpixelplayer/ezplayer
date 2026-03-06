/**
 * MovingHeadMarkers2D — renders DMX moving head fixture markers in the 2D view.
 *
 * Each fixture shows:
 *   - A small circle at the fixture world position (static body marker).
 *   - A thin yellow rectangle "direction indicator" that always tracks the current
 *     beam aim projected onto the active view plane.
 *   - A triangular "beam" visible only when the fixture is live. Width is derived
 *     from the cone half-angle; alpha fades from full at the tip to zero at the
 *     far end, matching the 3D beam shader.
 *
 * Beam geometry convention (PlaneGeometry 1×1, unit local coords):
 *   - Local Y = -0.5: fixture head (tip of cone, zero width)
 *   - Local Y = +0.5: far end of beam (full width, fully transparent)
 *   - scale.set(baseWidth, projLength, 1) maps local coords to world coords.
 *   - The shader clips to a triangle (width ∝ t = Y+0.5) and fades alpha (∝ 1-t).
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { mhChannelsToState, computeBeamDescriptor } from 'xllayoutcalcs';
import type { MhFixtureInfo } from 'xllayoutcalcs';

const DEG_TO_RAD = Math.PI / 180;

// Direction indicator — short fixed-length arrow, always visible when fixture is tracked
const INDICATOR_LENGTH = 40;
const INDICATOR_WIDTH = 4;

// Minimum display cone half-angle so very narrow beams remain visible
const MIN_CONE_HALF_ANGLE = 2;

// Beam shader — triangular cone shape, bright at tip, transparent at far end.
// Local Y: -0.5 = tip (fixture head), +0.5 = base (far end).
// t = Y + 0.5 ∈ [0, 1]; triangle clips |X| > t*0.5; alpha = (1-t)*uOpacity.
const BEAM_VERT = `
    varying vec2 vLocal;
    void main() {
        vLocal = vec2(position.x, position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const BEAM_FRAG = `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec2 vLocal;
    void main() {
        float t = vLocal.y + 0.5;          // 0 at tip, 1 at far end
        if (abs(vLocal.x) > t * 0.5) discard; // triangle clip
        float alpha = (1.0 - t) * uOpacity;   // fade to transparent at far end
        gl_FragColor = vec4(uColor, alpha);
    }
`;

type ViewPlane = 'xy' | 'xz' | 'yz';

// ============================================================================
// Single fixture marker
// ============================================================================

interface MovingHeadMarker2DProps {
    fixture: MhFixtureInfo;
    liveData?: LatestFrameRingBuffer;
    viewPlane: ViewPlane;
}

function MovingHeadMarker2D({ fixture, liveData, viewPlane }: MovingHeadMarker2DProps) {
    const indicatorRef = useRef<THREE.Mesh>(null);
    const beamMeshRef = useRef<THREE.Mesh>(null);
    const beamMatRef = useRef<THREE.ShaderMaterial>(null);
    const lastSeqRef = useRef<number>(0);

    const { worldPosX, worldPosY, worldPosZ } = fixture.worldTransform;

    // Body position projected to the view plane (slightly in front of bg at z=0.5)
    const bodyPos = useMemo((): [number, number, number] => {
        switch (viewPlane) {
            case 'xy': return [worldPosX, worldPosY, 0.5];
            case 'xz': return [worldPosX, worldPosZ, 0.5];
            case 'yz': return [worldPosY, worldPosZ, 0.5];
        }
    }, [worldPosX, worldPosY, worldPosZ, viewPlane]);

    const beamUniforms = useMemo(() => ({
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0.6 },
    }), []);

    useFrame(() => {
        const indicator = indicatorRef.current;
        const beamMesh = beamMeshRef.current;
        if (!indicator) return;

        if (!liveData) {
            indicator.visible = false;
            if (beamMesh) beamMesh.visible = false;
            return;
        }

        const latest = liveData.tryReadLatest(lastSeqRef.current);
        if (!latest) return;
        lastSeqRef.current = latest.seq;

        const { channelOffset, numChannels, definition, beamParams, worldTransform } = fixture;
        const channelData = latest.bytes.slice(channelOffset, channelOffset + numChannels);
        const state = mhChannelsToState(definition, channelData);
        const beam = computeBeamDescriptor(state, beamParams, worldTransform);

        if (!beam) {
            indicator.visible = false;
            if (beamMesh) beamMesh.visible = false;
            return;
        }

        // Project beam direction onto the view plane
        const [dx, dy, dz] = beam.direction;
        let ax: number, ay: number, originX: number, originY: number;
        switch (viewPlane) {
            case 'xy': ax = dx; ay = dy; originX = worldPosX; originY = worldPosY; break;
            case 'xz': ax = dx; ay = dz; originX = worldPosX; originY = worldPosZ; break;
            case 'yz': ax = dy; ay = dz; originX = worldPosY; originY = worldPosZ; break;
        }

        const aLen = Math.sqrt(ax * ax + ay * ay);
        if (aLen < 1e-6) {
            // Beam points straight in/out of view — hide both
            indicator.visible = false;
            if (beamMesh) beamMesh.visible = false;
            return;
        }

        const anx = ax / aLen;
        const any = ay / aLen;
        // PlaneGeometry default: face in XY, long axis along Y (angle 0 = pointing up).
        // Rotate around Z so the long axis aligns with the projected direction.
        const angle = Math.atan2(any, anx) - Math.PI / 2;

        // --- Direction indicator: short fixed length, always visible ---
        indicator.position.set(
            originX + anx * INDICATOR_LENGTH * 0.5,
            originY + any * INDICATOR_LENGTH * 0.5,
            0.5,
        );
        indicator.rotation.z = angle;
        indicator.visible = true;

        // --- Beam: triangular cone shape, world-projected length ---
        if (beamMesh) {
            const w = state.w;
            const isActive = beam.shutterOpen && beam.dimmer > 0;
            const totalColor = beam.r + beam.g + beam.b + w;
            if (isActive && totalColor > 0) {
                // beam.length is the world-scaled 3D beam length.
                // aLen = cos(angle from view plane) gives correct projected 2D length.
                const projLength = beam.length * aLen;

                // Base width from cone half-angle (same min as 3D view)
                const displayHalfAngle = Math.max(beam.coneHalfAngle, MIN_CONE_HALF_ANGLE);
                const baseWidth = 2 * projLength * Math.tan(displayHalfAngle * DEG_TO_RAD);

                // scale maps unit plane to (baseWidth × projLength) in world coords.
                // The shader triangle clip and alpha fade work in local [-0.5, 0.5] space.
                beamMesh.scale.set(baseWidth, projLength, 1);
                beamMesh.position.set(
                    originX + anx * projLength * 0.5,
                    originY + any * projLength * 0.5,
                    0.4, // slightly behind the indicator
                );
                beamMesh.rotation.z = angle;

                const mat = beamMatRef.current;
                if (mat) {
                    mat.uniforms.uColor.value.setRGB(
                        Math.min(255, beam.r + w) / 255,
                        Math.min(255, beam.g + w) / 255,
                        Math.min(255, beam.b + w) / 255,
                    );
                    mat.uniforms.uOpacity.value = Math.max(0.3, Math.min(0.85, beam.dimmer * 0.85));
                }
                beamMesh.visible = true;
            } else {
                beamMesh.visible = false;
            }
        }
    });

    return (
        <group>
            {/* Body marker — small circle at fixture world position */}
            <mesh position={bodyPos}>
                <circleGeometry args={[7, 12]} />
                <meshBasicMaterial color="#888888" side={THREE.DoubleSide} depthWrite={false} />
            </mesh>

            {/* Direction indicator — thin yellow rectangle, always tracks beam aim */}
            <mesh ref={indicatorRef} visible={false} frustumCulled={false}>
                <planeGeometry args={[INDICATOR_WIDTH, INDICATOR_LENGTH]} />
                <meshBasicMaterial
                    color="#ffee44"
                    transparent={true}
                    opacity={0.7}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                    depthTest={false}
                />
            </mesh>

            {/* Beam — triangular cone, tapers to tip at fixture head, fades at far end */}
            <mesh ref={beamMeshRef} visible={false} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
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
// Container
// ============================================================================

export interface MovingHeadMarkers2DProps {
    fixtures: MhFixtureInfo[];
    liveData?: LatestFrameRingBuffer;
    viewPlane: ViewPlane;
}

export function MovingHeadMarkers2D({ fixtures, liveData, viewPlane }: MovingHeadMarkers2DProps) {
    if (!fixtures || fixtures.length === 0) return null;

    return (
        <>
            {fixtures.map((fixture) => (
                <MovingHeadMarker2D
                    key={fixture.name}
                    fixture={fixture}
                    liveData={liveData}
                    viewPlane={viewPlane}
                />
            ))}
        </>
    );
}
