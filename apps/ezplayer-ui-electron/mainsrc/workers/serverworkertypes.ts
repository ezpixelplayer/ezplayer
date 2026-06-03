/**
 * Types for communication between main thread and server worker
 */

import { type ViewObject, type LayoutSettings, type MhFixtureInfo } from './playbacktypes';
import type { CloudCommand } from '@ezplayer/ezplayer-core';

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
           *  can subscribe to this player's live state. The server worker owns
           *  session lifecycle (TTL, redial after drop, supersede); the parent
           *  is a thin forwarder. Same sessionId with a live socket is
           *  idempotent (refreshes TTL); same sessionId with a closed socket
           *  redials; different sessionId supersedes. */
          type: 'cloudBridgeOpen';
          wsUrl: string;
          /** Parallel WS for HTTP-over-WS proxy traffic. May be omitted if
           *  the cloud doesn't (yet) advertise one — proxy stays disabled. */
          proxyWsUrl?: string;
          /** Parallel WS for live-audio push. May be omitted (audio stays
           *  disabled) without affecting status / proxy. */
          audioWsUrl?: string;
          sessionId: string;
          ttlSeconds: number;
      }
    | {
          /** Close the cloud bridge. `sessionId` is optional — when omitted
           *  (e.g. a config change), close anything currently open. When
           *  provided, only close if it matches the active session. */
          type: 'cloudBridgeClose';
          sessionId?: string;
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
    cloudCommand(cmd: CloudCommand): Promise<void>;
}
