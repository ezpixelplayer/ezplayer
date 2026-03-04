/**
 * MovingHeadMarkers2D — renders DMX moving head fixture markers in the 2D view.
 *
 * Each fixture shows:
 *   - A small circle at the fixture world position (static body marker).
 *   - A thin yellow rectangle "direction indicator" that always tracks the current
 *     beam aim projected onto the active view plane.
 *   - A wider colored rectangle "beam" visible only when the fixture is live,
 *     scaled to the world-projected beam length (beam.length * aLen).
 */

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { mhChannelsToState, computeBeamDescriptor } from 'xllayoutcalcs';
import type { MhFixtureInfo } from 'xllayoutcalcs';

// Direction indicator — short fixed-length arrow, always visible when fixture is tracked
const INDICATOR_LENGTH = 40;
const INDICATOR_WIDTH = 4;

// Beam — wider, length derived from world-scaled beam.length each frame
const BEAM_WIDTH = 8;

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
    const beamMatRef = useRef<THREE.MeshBasicMaterial>(null);
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

        // --- Beam: world-projected length, only when shutter open and lit ---
        if (beamMesh) {
            const w = state.w;
            const isActive = beam.shutterOpen && beam.dimmer > 0;
            const totalColor = beam.r + beam.g + beam.b + w;
            if (isActive && totalColor > 0) {
                // beam.length is the world-scaled 3D beam length.
                // aLen is cos(angle from view plane), giving correct projected length.
                const projLength = beam.length * aLen;
                beamMesh.scale.set(1, projLength, 1);
                beamMesh.position.set(
                    originX + anx * projLength * 0.5,
                    originY + any * projLength * 0.5,
                    0.4, // slightly behind the indicator
                );
                beamMesh.rotation.z = angle;

                const mat = beamMatRef.current;
                if (mat) {
                    mat.color.setRGB(
                        Math.min(255, beam.r + w) / 255,
                        Math.min(255, beam.g + w) / 255,
                        Math.min(255, beam.b + w) / 255,
                    );
                    mat.opacity = Math.max(0.3, Math.min(0.85, beam.dimmer * 0.85));
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

            {/* Beam — wider colored rectangle, length = world beam length projected to plane */}
            <mesh ref={beamMeshRef} visible={false} frustumCulled={false}>
                <planeGeometry args={[BEAM_WIDTH, 1]} />
                <meshBasicMaterial
                    ref={beamMatRef}
                    color="white"
                    transparent={true}
                    opacity={0.6}
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
