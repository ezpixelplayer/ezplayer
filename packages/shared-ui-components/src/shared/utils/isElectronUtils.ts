/**
 * Checks if the app is running in Electron environment
 */
export const isElectron = (): boolean => {
    // Check if window.electronAPI exists (which is exposed by your preload script)
    return window && 'electronAPI' in window;
};
