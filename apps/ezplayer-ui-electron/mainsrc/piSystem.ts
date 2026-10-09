import { app, ipcMain } from 'electron';
import { requestPi } from './pi-client.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMainWindow } from '../main';

export function registerPiSystemHandlers(): void {
    ipcMain.handle('pi:available', () => process.platform === 'linux' && process.env.EZPLAYER_PI_APPLIANCE === '1');
    ipcMain.handle('pi:request', (event, request: Record<string, unknown>) => {
        const window = getMainWindow();
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
            throw new Error('Pi settings are only available from the local player window.');
        }
        const frameUrl = new URL(event.senderFrame.url);
        const trusted = app.isPackaged
            ? frameUrl.protocol === 'file:' &&
              fileURLToPath(frameUrl).split('#')[0] === path.join(app.getAppPath(), 'dist', 'index.html')
            : frameUrl.origin === 'http://localhost:5173';
        if (!trusted) throw new Error('Pi settings require the local EZPlayer page.');
        if (process.platform !== 'linux') throw new Error('Pi settings require Linux.');
        if (request?.action === 'restartPlayer') {
            if (!process.env.EZPLAYER_PI_APPLIANCE) throw new Error('Restart requires the Pi startup service.');
            setTimeout(() => app.quit(), 500);
            return { ok: true };
        }
        return requestPi(request);
    });
}
