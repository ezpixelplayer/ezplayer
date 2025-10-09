import { EZPElectronAPI } from '../sharedsrc/EZPElectronAPI';

export {}; // Ensure this file is treated as a module

declare global {
    interface Window {
        electronAPI: EZPElectronAPI;
    }
}
