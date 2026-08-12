import { app, ipcMain } from 'electron';
import { execSync } from 'node:child_process';

/** Login items are only valid for the installed app — dev runs use the raw Electron binary. */
export function isLoginItemSupported(): boolean {
    return app.isPackaged;
}

/** Options shared by get/set so Windows reports the same openAtLogin state. */
function getLoginItemOptions(): { path: string; args: string[] } | null {
    if (!isLoginItemSupported()) {
        return null;
    }
    return { path: process.execPath, args: [] };
}

/** Dev runs can accidentally register the bare Electron binary; clear that on startup. */
function clearDevLoginItemIfNeeded() {
    if (isLoginItemSupported() || process.platform !== 'win32') {
        return;
    }
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [] });
}

/** Remove a mistaken dev-mode startup entry left in the Windows Run key. */
function clearMistakenDevElectronStartupEntry() {
    if (process.platform !== 'win32') {
        return;
    }
    try {
        const out = execSync(
            'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.Electron"',
            { encoding: 'utf8' },
        );
        const match = out.match(/REG_SZ\s+(.+)/);
        if (!match) return;
        const exePath = match[1].trim().replace(/^"|"$/g, '');
        if (!exePath.includes('node_modules') || !exePath.toLowerCase().includes('electron')) {
            return;
        }
        app.setLoginItemSettings({ openAtLogin: false, path: exePath, args: [] });
    } catch {
        // Key missing or already removed.
    }
}

export function registerLoginItemHandlers() {
    clearDevLoginItemIfNeeded();
    clearMistakenDevElectronStartupEntry();

    ipcMain.handle('login-item:isSupported', () => isLoginItemSupported());

    ipcMain.handle('login-item:get', () => {
        const opts = getLoginItemOptions();
        if (!opts) return false;
        return app.getLoginItemSettings(opts).openAtLogin;
    });

    ipcMain.handle('login-item:set', (_event, openAtLogin: boolean) => {
        const opts = getLoginItemOptions();
        if (!opts) {
            throw new Error(
                'Start at sign-in is only available in the installed EZPlayer application, not in development mode.',
            );
        }
        app.setLoginItemSettings({ ...opts, openAtLogin: !!openAtLogin });
        return app.getLoginItemSettings(opts).openAtLogin;
    });
}
