import type { AudioChunk, AudioDevice, AudioOutputTarget, EZPElectronAPI } from '@ezplayer/ezplayer-core';
import type { IpcRendererEvent } from 'electron';

export interface M2RIPC<Payload> {
    reqid: number;
    payload: Payload;
}

const { contextBridge, ipcRenderer } = require('electron');

/** Output identity passed from main via webPreferences.additionalArguments. */
function outputFromArgv(): AudioOutputTarget {
    const prefix = '--ezp-audio-output=';
    const raw = process.argv.find((a: string) => a.startsWith(prefix));
    if (!raw) return { deviceId: '', label: '' };
    try {
        return JSON.parse(decodeURIComponent(raw.slice(prefix.length))) as AudioOutputTarget;
    } catch {
        return { deviceId: '', label: '' };
    }
}

const configuredOutput = outputFromArgv();

export interface AudioWindowAPI {
    getAudioOutput(): AudioOutputTarget;
    onAudioChunk(callback: (data: AudioChunk) => void): void;
    /** Linear amplitude 0..1 for this window's GainNode. */
    onAudioGain(callback: (gain: number) => void): void;
}

contextBridge.exposeInMainWorld('electronAPI', {
    connect() {
        return ipcRenderer.invoke('ipcUIConnect');
    },
    disconnect() {
        return ipcRenderer.invoke('ipcUIDisconnect');
    },
    getAudioOutput(): AudioOutputTarget {
        return configuredOutput;
    },
    ipcRequestAudioDevices: (callback: () => Promise<AudioDevice[]>) => {
        ipcRenderer.on('audio:get-devices', async (_event: IpcRendererEvent, req: M2RIPC<void>) => {
            const devices = await callback();
            const respch = `audio:get-devices-response#${req.reqid}`;
            ipcRenderer.send(respch, devices);
        });
    },
    onAudioChunk: (callback: (data: AudioChunk) => void) => {
        ipcRenderer.on('audio:chunk', (_event: IpcRendererEvent, data: AudioChunk) => {
            callback(data);
        });
    },
    onAudioGain: (callback: (gain: number) => void) => {
        ipcRenderer.on('audio:gain', (_event: IpcRendererEvent, gain: number) => {
            callback(gain);
        });
    },
} satisfies Partial<EZPElectronAPI> & AudioWindowAPI);
