/**
 * Types for communication between main thread and server worker
 */

import { type ViewObject, type LayoutSettings, type MhFixtureInfo } from "./playbacktypes";

export interface ServerWorkerData {
    port: number;
    portSource: string;
    staticPath?: string;
    indexPath?: string;
    kioskPort?: number;
    kioskPortSource?: string;
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
    | { type: 'updateAudioBuffer'; buffer: SharedArrayBuffer }
    | { type: 'broadcast'; key: string; value: unknown }
    | {
          type: 'pushModelCoordinates';
          coords3D: unknown;
          coords2D: unknown;
          viewObjects?: Array<ViewObject>;
          layoutSettings?: LayoutSettings;
          movingHeads?: Array<MhFixtureInfo>;
      }
    | { type: 'clearShowData' }
    | { type: 'shutdown' };

/**
 * RPC methods that the server worker can call on the main thread
 */
export interface ServerWorkerRPCAPI {
    updatePlaylistsHandler(playlists: unknown[]): Promise<unknown[]>;
    updateScheduleHandler(schedules: unknown[]): Promise<unknown[]>;
    applySettingsFromRenderer(settingsPath: string, settings: unknown): void;
    sendPlayerCommand(command: unknown): void;
    sendPlaybackSettings(settings: unknown): void;
    sendToMainWindow(channel: string, ...args: unknown[]): void;
}
