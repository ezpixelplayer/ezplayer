/**
 * Types for communication between main thread and server worker
 */

export interface ServerWorkerData {
    port: number;
    portSource: string;
    staticPath?: string;
    indexPath?: string;
}

export type ServerWorkerToMainMessage =
    | { type: 'ready' }
    | { type: 'error'; error: string }
    | { type: 'status'; status: 'listening' | 'stopped' | 'error'; port: number; portSource: string }
    | { type: 'request'; id: string; method: string; args: unknown[] }
    | { type: 'broadcast'; key: string; value: unknown };

export type MainToServerWorkerMessage =
    | { type: 'init'; data: ServerWorkerData }
    | { type: 'response'; id: string; result?: unknown; error?: string }
    | { type: 'updateFrameBuffer'; buffer: SharedArrayBuffer }
    | { type: 'shutdown' };

/**
 * RPC methods that the server worker can call on the main thread
 */
export interface ServerWorkerRPCAPI {
    getCurrentShowData(): unknown;
    getSequenceThumbnail(sequenceId: string): string | undefined;
    updatePlaylistsHandler(playlists: unknown[]): Promise<unknown[]>;
    updateScheduleHandler(schedules: unknown[]): Promise<unknown[]>;
    getModelCoordinatesForAPI(is2D: boolean): Promise<unknown>;
    applySettingsFromRenderer(settingsPath: string, settings: unknown): void;
    getCurrentShowFolder(): string | undefined;
    sendPlayerCommand(command: unknown): void;
    sendPlaybackSettings(settings: unknown): void;
    sendToMainWindow(channel: string, ...args: unknown[]): void;
    getFrameBuffer(): SharedArrayBuffer | undefined;
}

