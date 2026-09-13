import type { AudioDevice } from '../types/EZPElectronAPI';

/** Chromium's synthetic `default` / `communications` sinks track the OS
 *  default; a named output must be a physical device. */
export function isPhysicalAudioOutput(d: Pick<AudioDevice, 'deviceId' | 'kind'>): boolean {
    return d.kind === 'audiooutput' && d.deviceId !== '' && d.deviceId !== 'default' && d.deviceId !== 'communications';
}

/** What an audio window is asked to play to; empty deviceId = system default. */
export interface AudioOutputTarget {
    deviceId: string;
    label: string;
    groupId?: string;
}

/** Find the connected device for a stored output: by deviceId, else by
 *  groupId, else by label. Fallback matches must be unique among candidates. */
export function resolveAudioOutputDevice(
    target: AudioOutputTarget,
    devices: AudioDevice[],
    exclude: ReadonlySet<string> = new Set(),
): AudioDevice | undefined {
    const candidates = devices.filter((d) => isPhysicalAudioOutput(d) && !exclude.has(d.deviceId));
    const byId = candidates.find((d) => d.deviceId === target.deviceId);
    if (byId) return byId;
    if (target.groupId) {
        const byGroup = candidates.filter((d) => d.groupId === target.groupId);
        if (byGroup.length === 1) return byGroup[0];
    }
    if (target.label) {
        const byLabel = candidates.filter((d) => d.label === target.label);
        if (byLabel.length === 1) return byLabel[0];
    }
    return undefined;
}
