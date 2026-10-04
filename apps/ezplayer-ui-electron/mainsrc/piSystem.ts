import { app, ipcMain } from 'electron';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMainWindow } from '../main';

export function registerPiSystemHandlers(): void {
    ipcMain.handle(
        'pi:available',
        () => process.platform === 'linux' && fs.existsSync('/run/ezplayer-pi/control.sock'),
    );
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
        const payload = JSON.stringify(request);
        if (Buffer.byteLength(payload) > 16384) throw new Error('Request too large.');
        return new Promise<unknown>((resolve, reject) => {
            const socket = net.createConnection('/run/ezplayer-pi/control.sock');
            let response = '';
            const fail = (error: Error) => {
                socket.destroy();
                reject(error);
            };
            socket.setTimeout(60000, () => fail(new Error('Pi settings service timed out.')));
            socket.on('error', () => fail(new Error('Pi service unavailable. Check installation and restart the Pi.')));
            socket.on('connect', () => socket.write(payload + '\n'));
            socket.on('data', (chunk) => {
                response += chunk.toString();
                if (Buffer.byteLength(response) > 262144) return fail(new Error('Pi service response too large.'));
                if (!response.includes('\n')) return;
                try {
                    const result = JSON.parse(response.split('\n')[0]);
                    socket.destroy();
                    if (result.ok) resolve(result.data);
                    else reject(new Error(result.error || 'Pi operation failed.'));
                } catch {
                    fail(new Error('Invalid Pi service response.'));
                }
            });
            socket.on('end', () => {
                if (!response.includes('\n')) fail(new Error('Pi service closed unexpectedly.'));
            });
        });
    });
}
