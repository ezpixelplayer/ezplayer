import { app, ipcMain } from 'electron';

/** Electron login items are available on Windows and macOS (not Linux). */
export function isLoginItemPlatformSupported(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin';
}

/** Login items are only valid for the installed app on Windows/macOS — dev runs use the raw Electron binary. */
export function isLoginItemSupported(): boolean {
    return app.isPackaged && isLoginItemPlatformSupported();
}

/** Options shared by get/set so the OS reports the same openAtLogin state. */
function getLoginItemOptions(): { path: string; args: string[] } | null {
    if (!isLoginItemSupported()) {
        return null;
    }
    return { path: process.execPath, args: [] };
}

export function registerLoginItemHandlers() {
    ipcMain.handle('login-item:isPlatformSupported', () => isLoginItemPlatformSupported());
    ipcMain.handle('login-item:isSupported', () => isLoginItemSupported());

    ipcMain.handle('login-item:get', () => {
        const opts = getLoginItemOptions();
        if (!opts) return false;
        return app.getLoginItemSettings(opts).openAtLogin;
    });

    ipcMain.handle('login-item:set', (_event, openAtLogin: boolean) => {
        const opts = getLoginItemOptions();
        if (!opts) {
            if (!isLoginItemPlatformSupported()) {
                throw new Error('Start at sign-in is only available on Windows and macOS.');
            }
            throw new Error(
                'Start at sign-in is only available in the installed EZPlayer application, not in development mode.',
            );
        }
        app.setLoginItemSettings({ ...opts, openAtLogin: !!openAtLogin });
        return app.getLoginItemSettings(opts).openAtLogin;
    });
}
