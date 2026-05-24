import type {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    CombinedPlayerStatus,
    CloudCommand,
    EZPlayerCommand,
    PlaybackSettings,
} from '@ezplayer/ezplayer-core';

import { AppDispatch } from '../..';

import { v4 as uuidv4 } from 'uuid';

export interface UserLoginBody {
    username: string;
    password: string;
    returnToken: boolean;
}
export interface UserRegisterBody {
    firstName: string;
    lastName: string;
    nickName: string;
    email: string;
    password: string;
    status?: string;
    message?: string;
}
export interface CloudFileUpload {
    fileId: string;
    fileTime: string;
    post: {
        url: string;
        fields: Record<string, string>;
    };
}

export interface CloudFileDownload {
    file_id: string;
    file_time: string;
}

export interface DownloadFileResponse {
    sequences: DownloadFile[];
}

export interface DownloadFile {
    id: string;
    user_id: string;
    vseq_id: string;
    title: string;
    artist: string;
    duration_ms?: number; // ms
    fseq: CloudFileDownload;
    audio?: CloudFileDownload;
    xsqz?: CloudFileDownload;
    pvid?: CloudFileDownload;
    srcseq?: CloudFileDownload;
    srcseq_policy?: 'never' | 'always' | 'conditional';
    thumb?: string; // URL
}

export interface CloudFileUploadResponse {
    rec: { file_id: string; file_time: string };
}

export interface CloudLayoutFileUpload {
    rgb_file_id: string;
    rgb_file_time: string;
    net_file_id: string;
    net_file_time: string;
}

export interface CloudFileDownloadResponse {
    fileName: string;
    url: string;
}

export function getOrInitializePlayerId(): string {
    const cpid = localStorage.getItem('playerId');
    if (cpid && cpid.length > 1) return cpid;
    const pid = uuidv4();
    localStorage.setItem('playerId', pid);
    return pid;
}

export function setOrGeneratePlayerIdToken(token?: string | null) {
    const newtoken = token || uuidv4();
    localStorage.setItem('playerId', newtoken);
    return newtoken;
}

/**
 * Player-side surface for the cloud/local backing store: connectivity, registration,
 * sequence/playlist/schedule sync, status, and player commands.
 */
export interface DataStorageAPI {
    // Set up for data connectivity
    connect(dispatch: AppDispatch): Promise<void>;
    disconnect(): Promise<void>;


    /** This fetches the master cloud storage list */
    getCloudSequences: () => Promise<SequenceRecord[]>;

    /** This stores the master cloud storage list (if available) */
    postCloudSequences: (data: SequenceRecord[]) => Promise<SequenceRecord[]>;

    getCloudPlaylists: () => Promise<PlaylistRecord[]>;

    postCloudPlaylists: (data: PlaylistRecord[]) => Promise<PlaylistRecord[]>;

    getCloudSchedule: () => Promise<ScheduledPlaylist[]>;

    postCloudSchedule: (data: ScheduledPlaylist[]) => Promise<ScheduledPlaylist[]>;

    getCloudStatus(): Promise<CombinedPlayerStatus>;

    // There is such thing as posting cloud status, but not from the UI...

    /** Single umbrella for player-cloud-worker commands. New verbs add a `CloudCommand`
     *  union variant + a case in main's `dispatchCloudCommand`; no per-verb plumbing. */
    issueCloudCommand: (cmd: CloudCommand) => Promise<void>;

    issuePlayerCommand: (req: EZPlayerCommand) => Promise<boolean>;
    setPlayerSettings: (req: PlaybackSettings) => Promise<boolean>;
}
