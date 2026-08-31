/**
 * Types for communication between main thread and server worker
 */

import { type ViewObject, type LayoutSettings, type MhFixtureInfo } from './playbacktypes';
import type { CloudCommand, RemoteAccessAvailability, UpdateCommand } from '@ezplayer/ezplayer-core';

export type { RemoteAccessAvailability };
import type { DiscoveryResult } from '@ezplayer/epp-controllers';
import type { ControllerCommand, ControllerOpOrigin } from '@ezplayer/ezplayer-core';

export interface ServerWorkerData {
    port: number;
    portSource: string;
    staticPath?: string;
    indexPath?: string;
    kioskPort?: number;
    kioskPortSource?: string;
    appVersion?: string;
}

export type ServerWorkerToMainMessage =
    | { type: 'ready' }
    | { type: 'error'; error: string }
    | {
          type: 'status';
          status: 'listening' | 'stopped' | 'error';
          port: number;
          portSource: string;
          /** Actual bound kiosk port + its source, present once the kiosk server is up
           *  (omitted when kiosk mode is disabled). Both `port` and `kioskPort` are the
           *  ports actually bound, including any EADDRINUSE upward fallback. */
          kioskPort?: number;
          kioskPortSource?: string;
      }
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
    | {
          /** Output (or lifecycle news) from the remote-shell pty, which runs
           *  in main. The worker forwards these to the one authenticated
           *  `/terminal` socket that owns `sessionId`. */
          type: 'shellEvent';
          event: ShellEvent;
      }
    | { type: 'shutdown' };

/** pty → viewer events. `superseded` is what the displaced viewer sees when
 *  someone else opens a terminal, since only one session exists at a time. */
export type ShellEvent =
    | { type: 'data'; sessionId: string; data: string }
    | { type: 'exit'; sessionId: string; code: number }
    | { type: 'superseded'; sessionId: string };

/**
 * RPC methods that the server worker can call on the main thread
 */
export interface ServerWorkerRPCAPI {
    updatePlaylistsHandler(playlists: unknown[]): Promise<unknown[]>;
    updateScheduleHandler(schedules: unknown[]): Promise<unknown[]>;
    putSequences(recs: unknown[]): Promise<unknown[]>;
    applySettingsFromRenderer(settingsPath: string, settings: unknown): void;
    sendPlayerCommand(command: unknown): void;
    sendPlaybackSettings(settings: unknown): void;
    getAudioOutputDevices(): Promise<import('@ezplayer/ezplayer-core').AudioDevice[]>;
    sendToMainWindow(channel: string, ...args: unknown[]): void;
    cloudCommand(cmd: CloudCommand): Promise<void>;
    /** Software-update verb from a LAN/cloud viewer. */
    updateCommand(cmd: UpdateCommand): Promise<void>;
    /** Resolves with the DiscoveryResult for a `scan`; other kinds resolve
     *  undefined and report through the broadcast state. */
    controllerCommand(command: ControllerCommand, origin: ControllerOpOrigin): Promise<DiscoveryResult | undefined>;
    /** Start the remote-shell pty, superseding any existing session. Resolves
     *  to an error string the viewer can read, or undefined on success. The
     *  worker has already checked the password before calling this, and passes
     *  the show folder it checked against so main reads the same config. */
    shellStart(
        sessionId: string,
        cols: number,
        rows: number,
        showFolder: string | undefined,
    ): Promise<string | undefined>;
    shellInput(sessionId: string, data: string): void;
    shellResize(sessionId: string, cols: number, rows: number): void;
    shellKill(sessionId: string): void;
    /** Re-read the remote-access config after the CLI changed it, and
     *  re-broadcast availability. Resolves to the new per-feature state. */
    remoteAccessReloadConfig(): Promise<RemoteAccessAvailability>;
}
