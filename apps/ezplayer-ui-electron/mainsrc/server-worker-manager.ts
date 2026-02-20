/**
 * Server Worker Manager - manages the Koa server running in a worker thread
 */

import { Worker } from 'node:worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { app, BrowserWindow } from 'electron';
import type {
    ServerWorkerData,
    ServerWorkerToMainMessage,
    MainToServerWorkerMessage,
    ServerWorkerRPCAPI,
} from './workers/serverworkertypes.js';
import {
    getCurrentShowData,
    getSequenceThumbnail,
    updatePlaylistsHandler,
    updateScheduleHandler,
    getModelCoordinatesForAPI,
    curFrameBuffer,
} from './ipcezplayer.js';
import { applySettingsFromRenderer } from './data/SettingsStorage.js';
import { getCurrentShowFolder } from '../showfolder.js';
import type { EZPlayerCommand, PlaybackSettings } from '@ezplayer/ezplayer-core';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerWorkerConfig {
    port: number;
    portSource: string;
    playWorker: Worker | null;
    mainWindow: BrowserWindow | null;
    getMainWindow: () => BrowserWindow | null;
    distDir?: string; // Optional: base directory for workers (defaults to __dirname)
}

export interface ServerStatus {
    port: number;
    portSource: string;
    status: 'listening' | 'stopped' | 'error';
}

let serverWorker: Worker | null = null;
let currentServerStatus: ServerStatus | null = null;
let playWorkerRef: Worker | null = null;
let getMainWindowRef: (() => BrowserWindow | null) | null = null;

export function getServerStatus(): ServerStatus | null {
    return currentServerStatus;
}

// RPC handlers for server worker requests
const rpcHandlers: ServerWorkerRPCAPI = {
    getCurrentShowData: () => {
        return getCurrentShowData();
    },
    getSequenceThumbnail: (sequenceId: string) => {
        return getSequenceThumbnail(sequenceId);
    },
    updatePlaylistsHandler: async (playlists: unknown[]) => {
        return await updatePlaylistsHandler(playlists as any[]);
    },
    updateScheduleHandler: async (schedules: unknown[]) => {
        return await updateScheduleHandler(schedules as any[]);
    },
    getModelCoordinatesForAPI: async (is2D: boolean) => {
        return await getModelCoordinatesForAPI(is2D);
    },
    applySettingsFromRenderer: (settingsPath: string, settings: unknown) => {
        applySettingsFromRenderer(settingsPath, settings as PlaybackSettings);
    },
    getCurrentShowFolder: () => {
        return getCurrentShowFolder() ?? undefined;
    },
    sendPlayerCommand: (command: unknown) => {
        if (playWorkerRef) {
            playWorkerRef.postMessage({
                type: 'frontendcmd',
                cmd: command,
            });
        }
    },
    sendPlaybackSettings: (settings: unknown) => {
        if (playWorkerRef) {
            playWorkerRef.postMessage({
                type: 'settings',
                settings: settings as PlaybackSettings,
            });
        }
        const mainWindow = getMainWindowRef?.();
        mainWindow?.webContents?.send('update:playbacksettings', settings);
    },
    sendToMainWindow: (channel: string, ...args: unknown[]) => {
        const mainWindow = getMainWindowRef?.();
        mainWindow?.webContents?.send(channel, ...args);
    },
    getFrameBuffer: () => {
        return curFrameBuffer;
    },
};

/**
 * Sets up and starts the Koa server in a worker thread
 * @param config Server configuration
 */
export async function setUpServerWorker(config: ServerWorkerConfig): Promise<void> {
    const { port, portSource, playWorker, mainWindow, getMainWindow, distDir } = config;
    playWorkerRef = playWorker;
    getMainWindowRef = getMainWindow;

    console.log(`🌐 Starting Koa server worker on port ${port} (source: ${portSource})`);

    // Create worker thread - use the same pattern as playback worker in main.ts
    // Use distDir if provided (from main.ts's __dirname), otherwise use local __dirname
    const baseDir = distDir || __dirname;
    const workerPath = path.join(baseDir, 'workers', 'server-worker.js');
    console.log(`[server-worker-manager] Worker path: ${workerPath}`);
    console.log(`[server-worker-manager] Base dir: ${baseDir}`);
    
    // Check if file exists for better error messages
    if (!fs.existsSync(workerPath)) {
        console.error(`[server-worker-manager] ERROR: Worker file not found at ${workerPath}`);
        console.error(`[server-worker-manager] Please ensure server-worker.ts is compiled. Run: pnpm build:main`);
        throw new Error(`Server worker file not found: ${workerPath}`);
    }
    
    serverWorker = new Worker(workerPath);

    // Handle messages from server worker
    let readyReceived = false;
    serverWorker.on('message', (msg: ServerWorkerToMainMessage) => {
        switch (msg.type) {
            case 'ready':
                if (!readyReceived) {
                    // First ready message - worker is ready to receive init
                    readyReceived = true;
                    initializeServerWorker(port, portSource, mainWindow);
                }
                // Subsequent ready messages are ignored (they come after server starts)
                break;
            case 'status':
                currentServerStatus = {
                    port: msg.port,
                    portSource: msg.portSource,
                    status: msg.status,
                };
                console.log(`[server-worker-manager] Server status: ${msg.status} on port ${msg.port}`);
                break;
            case 'request':
                // Handle RPC request from server worker
                handleRPCRequest(msg.id, msg.method, msg.args);
                break;
            case 'broadcast':
                // Worker thread sent a broadcast message back to main thread
                // This shouldn't happen in normal operation since main thread initiates broadcasts
                // But we keep this handler in case we need it in the future
                // (removed logging to reduce noise)
                break;
            case 'error':
                console.error(`[server-worker-manager] Server worker error: ${msg.error}`);
                currentServerStatus = {
                    port,
                    portSource,
                    status: 'error',
                };
                break;
        }
    });

    serverWorker.on('error', (err) => {
        console.error('[server-worker-manager] Worker error:', err);
        currentServerStatus = {
            port,
            portSource,
            status: 'error',
        };
    });

    serverWorker.on('exit', (code) => {
        console.log(`[server-worker-manager] Server worker exited with code ${code}`);
        currentServerStatus = {
            port,
            portSource,
            status: 'stopped',
        };
        serverWorker = null;
    });

    // Wait for worker to send initial ready message
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            serverWorker!.off('message', onMessage);
            reject(new Error('Server worker initialization timeout - worker did not send ready message'));
        }, 10000);

        const onMessage = (msg: ServerWorkerToMainMessage) => {
            if (msg.type === 'ready') {
                clearTimeout(timeout);
                serverWorker!.off('message', onMessage);
                resolve();
            }
        };
        serverWorker!.on('message', onMessage);
    });
}

/**
 * Initialize the server worker with configuration
 */
function initializeServerWorker(port: number, portSource: string, mainWindow: BrowserWindow | null) {
    if (!serverWorker) return;

    // Determine static path for React web app
    let staticPath: string;
    if (app.isPackaged) {
        staticPath = path.join(process.resourcesPath, 'webapp');
    } else {
        const possiblePaths = [
            path.join(process.cwd(), 'apps/ezplayer-ui-embedded/dist'),
            path.join(__dirname, '../../ezplayer-ui-embedded/dist'),
            path.join(__dirname, '../ezplayer-ui-embedded/dist'),
        ];

        staticPath = '';
        for (const possiblePath of possiblePaths) {
            try {
                if (fs.existsSync(possiblePath)) {
                    staticPath = possiblePath;
                    break;
                }
            } catch {
                // Ignore
            }
        }

        if (!staticPath) {
            console.warn(`⚠️ React build not found! Please run: pnpm --filter @ezplayer/ui-embedded build:web`);
            staticPath = possiblePaths[0];
        }
    }

    const indexPath = path.join(staticPath, 'index.html');

    const initMessage: MainToServerWorkerMessage = {
        type: 'init',
        data: {
            port,
            portSource,
            staticPath,
            indexPath,
        },
    };

    serverWorker.postMessage(initMessage);

    // Send initial frame buffer if available
    if (curFrameBuffer) {
        updateFrameBuffer(curFrameBuffer);
    }
}

/**
 * Handle RPC request from server worker
 */
async function handleRPCRequest(id: string, method: string, args: unknown[]) {
    if (!serverWorker) return;

    try {
        const handler = rpcHandlers[method as keyof ServerWorkerRPCAPI];
        if (!handler) {
            throw new Error(`Unknown RPC method: ${method}`);
        }

        const result = await (handler as any)(...args);
        const response: MainToServerWorkerMessage = {
            type: 'response',
            id,
            result,
        };
        serverWorker.postMessage(response);
    } catch (error: any) {
        const response: MainToServerWorkerMessage = {
            type: 'response',
            id,
            error: error?.message || 'Unknown error',
        };
        serverWorker.postMessage(response);
    }
}

/**
 * Update frame buffer in server worker
 */
export function updateFrameBuffer(buffer: SharedArrayBuffer) {
    if (!serverWorker) return;

    const message: MainToServerWorkerMessage = {
        type: 'updateFrameBuffer',
        buffer,
    };
    // SharedArrayBuffer can be transferred, but TypeScript doesn't recognize it as Transferable
    // Cast to any[] to work around this limitation
    serverWorker.postMessage(message, [buffer as any]);
}

/**
 * Forward WebSocket broadcast to server worker
 * This allows the main process to broadcast updates to WebSocket clients in the worker thread
 */
export function broadcastToWebSocket(key: string, value: unknown) {
    if (!serverWorker) return;

    const message: MainToServerWorkerMessage = {
        type: 'broadcast',
        key,
        value,
    };
    serverWorker.postMessage(message);
}

/**
 * Shutdown the server worker
 */
export async function shutdownServerWorker(): Promise<void> {
    if (!serverWorker) return;

    const shutdownMessage: MainToServerWorkerMessage = {
        type: 'shutdown',
    };
    serverWorker.postMessage(shutdownMessage);

    // Wait for worker to exit gracefully
    await new Promise<void>((resolve) => {
        if (!serverWorker) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            if (serverWorker) {
                serverWorker.terminate();
            }
            resolve();
        }, 5000);

        serverWorker.on('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });

    serverWorker = null;
    currentServerStatus = null;
}

