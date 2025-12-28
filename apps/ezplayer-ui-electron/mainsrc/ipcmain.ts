import { app, BrowserWindow, OpenDialogOptions, shell, dialog, ipcMain } from 'electron';

import * as path from 'path';
import { fileURLToPath } from 'url';
import fsp from 'fs/promises';

import type { AudioDevice, AudioTimeSyncM2R, FileSelectOptions } from '@ezplayer/ezplayer-core';
import { getMainWindow } from '../main';
import { ezpVersions } from '../versions';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//// IPC Main
export function registerFileListHandlers() {
    ipcMain.handle('dialog:openFile', async (_event, options: FileSelectOptions) => {
        const filters =
            options.types?.map((f) => {
                return {
                    name: f.name,
                    extensions: f.extensions.map((ext) => ext.replace(/^\./, '')), // remove dot if needed
                };
            }) ?? [];

        const props: OpenDialogOptions = {
            properties: ['openFile'],
            filters,
            buttonLabel: options.buttonLabel,
            title: options.title,
            defaultPath: options.defaultPath,
        };
        if (options.multi) props.properties!.push('multiSelections');

        const w = getMainWindow();
        if (w) {
            const result = await dialog.showOpenDialog(w, props);
            return result.canceled ? [] : result.filePaths;
        } else {
            const result = await dialog.showOpenDialog(props);
            return result.canceled ? [] : result.filePaths;
        }
    });

    ipcMain.handle('dialog:openDirectory', async (_event, options: Omit<FileSelectOptions, 'types'>) => {
        const props: OpenDialogOptions = {
            properties: ['openDirectory'],
            buttonLabel: options.buttonLabel,
            title: options.title,
            defaultPath: options.defaultPath,
        };
        if (options.multi) props.properties!.push('multiSelections');

        const w = getMainWindow();
        if (w) {
            const result = await dialog.showOpenDialog(w, props);
            return result.canceled ? [] : result.filePaths;
        } else {
            const result = await dialog.showOpenDialog(props);
            return result.canceled ? [] : result.filePaths;
        }
    });

    ipcMain.handle('write-file', async (_, filename: string, content: string): Promise<string> => {
        try {
            const filePath = path.join(app.getPath('documents'), filename);
            await fsp.writeFile(filePath, content, 'utf8');
            return filePath; // Return the file path on success
        } catch (error) {
            console.error('Error writing file:', error);
            throw new Error('Failed to write file');
        }
    });

    ipcMain.handle('read-file', async (_, filename: string): Promise<string> => {
        try {
            const filePath = path.join(app.getPath('documents'), filename);
            const content = await fsp.readFile(filePath, 'utf8');
            return content; // Return the file path on success
        } catch (error) {
            console.error('Error reading file:', error);
            throw new Error('Failed to read file');
        }
    });

    ipcMain.handle('open-external-url', async (event: any, url: string) => {
        shell.openExternal(url);
    });

    ipcMain.handle('getVersions', () => {
        return ezpVersions;
    });
}

// Helper function to ask renderer for stuff, in absence of real IPC
let curCallNum: number = 1;
export async function invokeRenderIPC<Return, Arg>(
    ipcname: string,
    mainWindow: BrowserWindow,
    arg: Arg,
    timeoutMs: number = 3000,
): Promise<Return> {
    const ccn = curCallNum++;
    const responseChannel = `${ipcname}-response#${ccn}`;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            ipcMain.removeAllListeners(responseChannel);
            reject(new Error(`Timeout waiting for response on ${responseChannel}`));
        }, timeoutMs);

        ipcMain.once(responseChannel, (_event, data) => {
            clearTimeout(timeout);
            resolve(data as Return);
        });

        mainWindow.webContents.send(ipcname, {
            reqid: ccn,
            req: arg,
        });
    });
}

export function getAudioOutputDevices(mainWindow: BrowserWindow): Promise<AudioDevice[]> {
    return invokeRenderIPC('audio:get-devices', mainWindow, 1);
}

export function getAudioSyncTime(mainWindow: BrowserWindow): Promise<AudioTimeSyncM2R> {
    return invokeRenderIPC('audio:syncm2r', mainWindow, {
        perfNowTime: performance.now(),
        realTime: Date.now(),
    } satisfies AudioTimeSyncM2R);
}
