import type {
    AudioChunk,
    AudioDevice,
    EZPElectronAPI,
} from '@ezplayer/ezplayer-core';

export interface M2RIPC<Payload> {
    reqid: number;
    req: Payload;
}

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    connect() {
        return ipcRenderer.invoke('ipcUIConnect');
    },
    disconnect() {
        return ipcRenderer.invoke('ipcUIDisconnect');
    },
    ipcRequestAudioDevices: (callback: () => Promise<AudioDevice[]>) => {
        ipcRenderer.on('audio:get-devices', async (_event: any, req: M2RIPC<void>) => {
            const devices = await callback();
            const respch = `audio:get-devices-response#${req.reqid}`;
            ipcRenderer.send(respch, devices);
        });
    },
    onAudioChunk: (callback: (data: AudioChunk) => void) => {
        ipcRenderer.on('audio:chunk', (_event: any, data: AudioChunk) => {
            callback(data);
        });
    },
} satisfies Partial<EZPElectronAPI>);
