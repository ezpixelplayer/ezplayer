import { describe, it, expect } from 'vitest';
import { isPhysicalAudioOutput, resolveAudioOutputDevice } from '../src/util/audioOutputs';
import type { AudioDevice } from '../src/types/EZPElectronAPI';

const dev = (deviceId: string, label: string, groupId = `g-${deviceId}`, kind = 'audiooutput'): AudioDevice => ({
    deviceId,
    label,
    groupId,
    kind,
});

const devices: AudioDevice[] = [
    dev('default', 'Default - Speakers', 'g-spk'),
    dev('communications', 'Communications - Speakers', 'g-spk'),
    dev('spk', 'Speakers (Realtek)', 'g-spk'),
    dev('sb1', 'Speakers (Sound Blaster)', 'g-sb1'),
    dev('sb2', 'Speakers (Sound Blaster)', 'g-sb2'),
    dev('mic', 'Microphone', 'g-mic', 'audioinput'),
];

describe('isPhysicalAudioOutput', () => {
    it('rejects synthetic sinks, inputs and empty ids', () => {
        expect(isPhysicalAudioOutput(dev('spk', 'x'))).toBe(true);
        expect(isPhysicalAudioOutput(dev('default', 'x'))).toBe(false);
        expect(isPhysicalAudioOutput(dev('communications', 'x'))).toBe(false);
        expect(isPhysicalAudioOutput(dev('', 'x'))).toBe(false);
        expect(isPhysicalAudioOutput(dev('mic', 'x', 'g', 'audioinput'))).toBe(false);
    });
});

describe('resolveAudioOutputDevice', () => {
    it('matches by deviceId first', () => {
        expect(resolveAudioOutputDevice({ deviceId: 'sb2', label: 'wrong' }, devices)?.deviceId).toBe('sb2');
    });

    it('falls back to a unique groupId, then a unique label', () => {
        expect(resolveAudioOutputDevice({ deviceId: 'old', label: 'wrong', groupId: 'g-sb1' }, devices)?.deviceId).toBe(
            'sb1',
        );
        expect(resolveAudioOutputDevice({ deviceId: 'old', label: 'Speakers (Realtek)' }, devices)?.deviceId).toBe(
            'spk',
        );
    });

    it('refuses ambiguous label matches', () => {
        expect(
            resolveAudioOutputDevice({ deviceId: 'old', label: 'Speakers (Sound Blaster)' }, devices),
        ).toBeUndefined();
    });

    it('never resolves to a synthetic sink', () => {
        expect(resolveAudioOutputDevice({ deviceId: 'default', label: 'Default - Speakers' }, devices)).toBeUndefined();
    });

    it('skips excluded devices so two stored outputs cannot claim one device', () => {
        const taken = new Set(['sb1']);
        expect(
            resolveAudioOutputDevice({ deviceId: 'old', label: 'Speakers (Sound Blaster)' }, devices, taken)?.deviceId,
        ).toBe('sb2');
    });
});
