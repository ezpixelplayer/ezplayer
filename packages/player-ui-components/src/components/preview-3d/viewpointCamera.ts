import * as THREE from 'three';
import type { ViewpointInfo } from 'xllayoutcalcs';
import type { CameraState3D } from './Viewer3D';

/**
 * Convert an xLights `<Camera>` viewpoint entry to a Three.js-compatible `CameraState3D`.
 *
 * The math is derived directly from `xLights/src-core/render/ViewpointMgr.cpp:76-88`, where the
 * view matrix is composed as:
 *
 *     V = T(1, 1, distance × zoom)          // line 80: NB — hardcoded 1, 1 in X/Y
 *         × R_x(angleX)                       // line 81
 *         × R_y(angleY)                       // line 82
 *         × R_z(angleZ)                       // line 83
 *         × T(posX + panX, posY + panY, posZ + panZ)   // line 79
 *
 * V maps world → eye (standard OpenGL view matrix). For Three.js we need the camera's
 * world transform, which is `V⁻¹`. Reading off its translation and rotation:
 *
 *     cameraWorldPos = R⁻¹ · (−1, −1, −(distance × zoom)) − (pos + pan)
 *     cameraRotation = R⁻¹
 *
 * where `R = R_x · R_y · R_z`.
 *
 * `zoom_corrx` / `zoom_corry` are stored in the XML but never consumed by xLights' own matrix
 * construction (confirmed — ViewpointMgr.cpp only reads them for persistence). Ignored here.
 *
 * `zoom` is folded into the distance translate as xLights does; it therefore affects camera
 * distance but not the Three.js camera's `zoom` property.
 */
export function viewpointToCameraState(vp: ViewpointInfo): CameraState3D {
    // Scene rotation R = R_x · R_y · R_z (applied to vertices: Z first, then Y, then X).
    const qX = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        THREE.MathUtils.degToRad(vp.angleX),
    );
    const qY = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(vp.angleY),
    );
    const qZ = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        THREE.MathUtils.degToRad(vp.angleZ),
    );
    const sceneRotation = new THREE.Quaternion().multiplyQuaternions(qX, qY).multiply(qZ);
    const cameraRotation = sceneRotation.clone().invert();

    // Translation portion of V⁻¹ applied to the origin:
    //   camera = R⁻¹ · (−1, −1, −distance·zoom) − (pos + pan)
    const distOffset = new THREE.Vector3(-1, -1, -(vp.distance * vp.zoom)).applyQuaternion(cameraRotation);
    const pan = new THREE.Vector3(vp.posX + vp.panX, vp.posY + vp.panY, vp.posZ + vp.panZ);
    const position = distOffset.sub(pan);

    // `target` is cosmetic for CameraState3D consumers — Viewer3D derives its OrbitControls
    // target from the restored camera direction. Point it back at the pan pivot so that
    // "look at scene origin / layout centre" reads sensibly when anyone inspects the state.
    const target = pan.clone().negate();

    return {
        position: [position.x, position.y, position.z],
        target: [target.x, target.y, target.z],
        quaternion: [cameraRotation.x, cameraRotation.y, cameraRotation.z, cameraRotation.w],
    };
}
