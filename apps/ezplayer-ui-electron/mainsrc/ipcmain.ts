import { safeSend } from './safe-send.js';
import { app, BrowserWindow, OpenDialogOptions, shell, dialog, ipcMain } from 'electron';

import * as path from 'path';
import { fileURLToPath } from 'url';
import fsp from 'fs/promises';

import type { AudioDevice, FileSelectOptions } from '@ezplayer/ezplayer-core';
import { getMainWindow } from '../main';
import { ezpVersions } from '../versions';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Last directory accepted in a file/folder picker this session. Used so
 *  subsequent dialogs (especially GTK on Linux) open where the user left off
 *  instead of $HOME. */
let lastPickerDir: string | undefined;

async function existingDirectory(dir?: string | null): Promise<string | undefined> {
    if (!dir) return undefined;
    try {
        return (await fsp.stat(dir)).isDirectory() ? dir : undefined;
    } catch {
        return undefined;
    }
}

/** Caller `defaultPath` wins; else last accepted folder; else the show folder. */
async function resolveDialogDefaultPath(explicit?: string): Promise<string | undefined> {
    if (explicit) return explicit;
    const last = await existingDirectory(lastPickerDir);
    if (last) return last;
    // Lazy import: ipcmain <-> main <-> showfolder would otherwise cycle at load.
    const { getCurrentShowFolder } = await import('../showfolder.js');
    return existingDirectory(getCurrentShowFolder());
}

function rememberPickerDir(filePaths: string[], pickedDirectory: boolean) {
    const first = filePaths[0];
    if (!first) return;
    lastPickerDir = pickedDirectory ? first : path.dirname(first);
}

async function showNativeOpenDialog(props: OpenDialogOptions, pickedDirectory: boolean): Promise<string[]> {
    const w = getMainWindow();
    const result = w ? await dialog.showOpenDialog(w, props) : await dialog.showOpenDialog(props);
    if (result.canceled || result.filePaths.length === 0) return [];
    rememberPickerDir(result.filePaths, pickedDirectory);
    return result.filePaths;
}

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
            defaultPath: await resolveDialogDefaultPath(options.defaultPath),
        };
        if (options.multi) props.properties!.push('multiSelections');

        return showNativeOpenDialog(props, false);
    });

    ipcMain.handle('ipcSetZoomFactor', async (_event, factor: number) => {
        const w = getMainWindow();
        // Native page zoom — Chromium scales canvas/WebGL correctly, unlike CSS `zoom`.
        w?.webContents?.setZoomFactor(typeof factor === 'number' && factor > 0 ? factor : 1);
    });

    ipcMain.handle('dialog:openDirectory', async (_event, options: Omit<FileSelectOptions, 'types'>) => {
        const props: OpenDialogOptions = {
            properties: ['openDirectory'],
            buttonLabel: options.buttonLabel,
            title: options.title,
            defaultPath: await resolveDialogDefaultPath(options.defaultPath),
        };
        if (options.multi) props.properties!.push('multiSelections');

        return showNativeOpenDialog(props, true);
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

    ipcMain.handle('open-external-url', async (event, url: string) => {
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

        safeSend(mainWindow, ipcname, {
            reqid: ccn,
            req: arg,
        });
    });
}

export function getAudioOutputDevices(mainWindow: BrowserWindow): Promise<AudioDevice[]> {
    return invokeRenderIPC('audio:get-devices', mainWindow, 1);
}
