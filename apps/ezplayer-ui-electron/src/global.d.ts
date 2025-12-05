/// <reference types="@ezplayer/ezplayer-core" />

import type { EZPElectronAPI } from '@ezplayer/ezplayer-core';

declare global {
    interface Window {
        electronAPI: EZPElectronAPI;
    }
}

export {};
