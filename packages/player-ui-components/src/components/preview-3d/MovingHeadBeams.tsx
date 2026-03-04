/**
 * MovingHeadBeams — renders DMX moving head fixture bodies and light beams
 * in the 3D preview scene.
 *
 * Each fixture is a separate component that reads from the live frame buffer
 * in useFrame (zero React state churn) and imperatively updates Three.js
 * objects: a small sphere for the fixture body and an additive-blended cone
 * for the light beam.
 *
 * Beam cone geometry:
 *   - Unit ConeGeometry(1,1,N): tip at +Y, base at -Y.
 *   - mesh.scale.set(baseRadius, length, baseRadius) sizes it per frame.
 *   - Quaternion aligns +Y with -beamDirection so the tip stays at the
 *     emission origin and the base opens in the beam direction.
 *   - mesh.position = beamOrigin + beamDirection * (length/2).
 */

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LatestFrameRingBuffer } from '@ezplayer/ezplayer-core';
import { mhChannelsToState, computeBeamDescriptor } from 'xllayoutcalcs';
import type { MhFixtureInfo } from 'xllayoutcalcs';

const DEG_TO_RAD = Math.PI / 180;

// Pre-allocated scratch objects — shared across all beam update calls within
// a single frame to avoid per-frame heap allocations.
const _yAxis = new THREE.Vector3(0, 1, 0);
const _negDir = new THREE.Vector3();
const _midPt = new THREE.Vector3();
const _quat = new THREE.Quaternion();

// ============================================================================
// Single fixture renderer
// ============================================================================

interface MovingHeadFixtureProps {
    fixture: MhFixtureInfo;
    liveData?: LatestFrameRingBuffer;
}

function MovingHeadFixture({ fixture, liveData }: MovingHeadFixtureProps) {
    const beamMeshRef = useRef<THREE.Mesh>(null);
    const beamMatRef = useRef<THREE.MeshBasicMaterial>(null);
    const lastSeqRef = useRef<number>(0);

    const { worldPosX, worldPosY, worldPosZ } = fixture.worldTransform;

    useFrame(() => {
        const mesh = beamMeshRef.current;
        if (!mesh) return;

        if (!liveData) {
            mesh.visible = false;
            return;
        }

        // Skip if no new frame has arrived since last check
        const latest = liveData.tryReadLatest(lastSeqRef.current);
        if (!latest) return;
        lastSeqRef.current = latest.seq;

        // Extract this fixture's DMX channels from the full frame buffer
        const { channelOffset, numChannels, definition, beamParams, worldTransform } = fixture;
        const channelData = latest.bytes.slice(channelOffset, channelOffset + numChannels);

        // Compute physical state (pan, tilt, color, dimmer, shutter)
        const state = mhChannelsToState(definition, channelData);

        // Compute world-space beam descriptor
        const beam = computeBeamDescriptor(state, beamParams, worldTransform);

        if (!beam || !beam.shutterOpen || beam.dimmer <= 0 || beam.length <= 0) {
            mesh.visible = false;
            return;
        }

        // Beam cone dimensions
        const { origin, direction, length, coneHalfAngle, r, g, b, dimmer } = beam;
        const baseRadius = length * Math.tan(coneHalfAngle * DEG_TO_RAD);
        if (baseRadius <= 0) {
            mesh.visible = false;
            return;
        }

        // Validate direction
        const dirLenSq = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
        if (dirLenSq < 1e-12) {
            mesh.visible = false;
            return;
        }
        const dirLen = Math.sqrt(dirLenSq);
        const dx = direction[0] / dirLen;
        const dy = direction[1] / dirLen;
        const dz = direction[2] / dirLen;

        // Scale cone to beam dimensions
        mesh.scale.set(baseRadius, length, baseRadius);

        // Position cone center at midpoint between emission origin and beam tip
        _midPt.set(
            origin[0] + dx * length * 0.5,
            origin[1] + dy * length * 0.5,
            origin[2] + dz * length * 0.5,
        );
        mesh.position.copy(_midPt);

        // Orient: align cone +Y axis with -direction so the tip stays at origin
        _negDir.set(-dx, -dy, -dz);
        if (Math.abs(_negDir.y - 1) < 1e-6) {
            // Already aligned with +Y
            _quat.identity();
        } else if (Math.abs(_negDir.y + 1) < 1e-6) {
            // Exactly anti-parallel to +Y — rotate 180° around X
            _quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
        } else {
            _quat.setFromUnitVectors(_yAxis, _negDir);
        }
        mesh.quaternion.copy(_quat);

        // Update beam color and opacity
        const mat = beamMatRef.current;
        if (mat) {
            mat.color.setRGB(r / 255, g / 255, b / 255);
            // Opacity scales with dimmer; keep a minimum so the beam is visible
            mat.opacity = Math.max(0.15, Math.min(0.85, dimmer * 0.8));
        }

        mesh.visible = true;
    });

    return (
        <group>
            {/* Fixture body marker — small sphere at world position */}
            <mesh position={[worldPosX, worldPosY, worldPosZ]}>
                <sphereGeometry args={[8, 12, 8]} />
                <meshStandardMaterial color="#aaaaaa" metalness={0.4} roughness={0.6} />
            </mesh>

            {/* Beam cone — unit geometry, sized/positioned/oriented each frame */}
            <mesh ref={beamMeshRef} visible={false}>
                <coneGeometry args={[1, 1, 24]} />
                <meshBasicMaterial
                    ref={beamMatRef}
                    color="white"
                    transparent={true}
                    opacity={0.6}
                    side={THREE.DoubleSide}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
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
