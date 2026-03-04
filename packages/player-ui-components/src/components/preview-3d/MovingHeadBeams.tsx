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

import React, { useRef } from 'react';
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
    const dirMeshRef = useRef<THREE.Mesh>(null);
    const lastSeqRef = useRef<number>(0);
    const hasLoggedRef = useRef<boolean>(false);
    const hasLoggedLitRef = useRef<boolean>(false);

    const { worldPosX, worldPosY, worldPosZ } = fixture.worldTransform;

    useFrame(() => {
        const mesh = beamMeshRef.current;
        const dirMesh = dirMeshRef.current;
        if (!mesh) return;

        // Default: hide beam cone (direction arrow handled below)
        mesh.visible = false;

        if (!liveData) {
            if (dirMesh) dirMesh.visible = false;
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

        // Debug: log on first frame received
        if (!hasLoggedRef.current) {
            const bufLen = latest.bytes.length;
            const sliceEnd = channelOffset + numChannels;
            const inRange = sliceEnd <= bufLen;
            console.log(
                `[MH ${fixture.name}] seq=${latest.seq}`,
                `buf=${bufLen} chOffset=${channelOffset} need=${sliceEnd}`,
                inRange ? 'IN-RANGE' : `OUT-OF-RANGE (buf too short by ${sliceEnd - bufLen})`,
                'channelData=', Array.from(channelData),
                'state=', state,
                'beam=', beam,
            );
            hasLoggedRef.current = true;
        }

        // Debug: log on first frame where the beam has non-zero color
        if (!hasLoggedLitRef.current && beam) {
            const w = state.w;
            if (beam.shutterOpen && beam.dimmer > 0 && (beam.r + beam.g + beam.b + w) > 0) {
                console.log(
                    `[MH ${fixture.name}] FIRST LIT FRAME seq=${latest.seq}`,
                    'beam=', beam, 'state.w=', w,
                    'length=', beam.length, 'coneHalfAngle=', beam.coneHalfAngle,
                );
                hasLoggedLitRef.current = true;
            }
        }

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
            mat.color.setRGB(
                Math.min(255, r + w) / 255,
                Math.min(255, g + w) / 255,
                Math.min(255, b + w) / 255,
            );
            mat.opacity = Math.max(0.15, Math.min(0.85, dimmer * 0.8));
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
            <mesh ref={dirMeshRef} visible={false}>
                <coneGeometry args={[ARROW_RADIUS, ARROW_LENGTH, 8]} />
                <meshBasicMaterial
                    color="#ffee44"
                    transparent={true}
                    opacity={0.75}
                    side={THREE.DoubleSide}
                    depthWrite={false}
                />
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
