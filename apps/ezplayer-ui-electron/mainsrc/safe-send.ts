import type { BrowserWindow } from 'electron';

/** Send to a window's renderer unless it is gone (crashed or mid-shutdown).
 *  A bare webContents.send then triggers Electron's scary-looking internal
 *  "Render frame was disposed before WebFrameMain could be accessed" log;
 *  the update simply has no live frame to land in, so drop it quietly. */
export function safeSend(win: BrowserWindow | null | undefined, channel: string, ...args: unknown[]): void {
    try {
        const wc = win?.webContents;
        if (!wc || wc.isDestroyed()) return;
        // Touching mainFrame throws once the frame is disposed (crashed
        // renderer) while isDestroyed() can still be false.
        void wc.mainFrame;
        wc.send(channel, ...args);
    } catch {
        // Renderer gone — drop the update.
    }
}
