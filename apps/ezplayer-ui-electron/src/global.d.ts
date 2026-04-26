import type { EZPElectronAPI } from '@ezplayer/ezplayer-core';

export {}; // Ensure this file is treated as a module

declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}
