import type { ControllerState } from '@ezplayer/epp';

/** Apply only to the playback copy; preserve the imported xLights document. */
export function applyDirectPiControllerOutput(controllers: ControllerState[], appliance: boolean): number {
    if (!appliance) return 0;
    let ignored = 0;
    for (const controller of controllers) {
        if (!controller.xlRecord?.fppProxy) continue;
        controller.xlRecord = { ...controller.xlRecord, fppProxy: undefined };
        ignored++;
    }
    return ignored;
}
