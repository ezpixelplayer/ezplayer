import type { AudioChunk, AudioDevice, EZPElectronAPI } from '@ezplayer/ezplayer-core';
import type { IpcRendererEvent } from 'electron';

export interface M2RIPC<Payload> {
    reqid: number;
    req: Payload;
}

const { contextBridge, ipcRenderer } = require('electron');

/** Sink id passed from main via webPreferences.additionalArguments. */
function sinkIdFromArgv(): string {
    const raw = process.argv.find((a: string) => a.startsWith('--ezp-audio-sink='));
    if (!raw) return '';
    try {
        return decodeURIComponent(raw.slice('--ezp-audio-sink='.length));
    } catch {
        return raw.slice('--ezp-audio-sink='.length);
    }
}

const configuredSinkId = sinkIdFromArgv();

contextBridge.exposeInMainWorld('electronAPI', {
    connect() {
        return ipcRenderer.invoke('ipcUIConnect');
    },
    disconnect() {
        return ipcRenderer.invoke('ipcUIDisconnect');
    },
    /** Device id this audio window should bind to ('' = system default). */
    getAudioSinkId(): string {
        return configuredSinkId;
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
    /** Linear amplitude 0–1 for this window's GainNode (per-sink volume). */
    onAudioGain: (callback: (gain: number) => void) => {
        ipcRenderer.on('audio:gain', (_event: IpcRendererEvent, gain: number) => {
            callback(gain);
        });
    },
} satisfies Partial<EZPElectronAPI> & {
    getAudioSinkId: () => string;
    onAudioGain: (callback: (gain: number) => void) => void;
});
