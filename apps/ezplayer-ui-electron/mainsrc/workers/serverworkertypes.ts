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
    | {
          /** Open an outbound WebSocket to the cloud bridge so a remote viewer
           *  can subscribe to this player's live state. cloudpollparent owns
           *  session lifecycle (TTL refresh, supersede); the server worker
           *  just dials and registers the WS as a Conn against the
           *  WebSocketBroadcaster so existing state-fanout works unchanged. */
          type: 'cloudBridgeOpen';
          wsUrl: string;
          sessionId: string;
      }
    | {
          /** Tear down the cloud bridge for this sessionId, if it matches the
           *  currently-open one. No-op when nothing is open or sessionId is
           *  stale (the parent already moved on). */
          type: 'cloudBridgeClose';
          sessionId: string;
      }
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
    cloudCommand(cmd: import('@ezplayer/ezplayer-core').CloudCommand): Promise<void>;
}
