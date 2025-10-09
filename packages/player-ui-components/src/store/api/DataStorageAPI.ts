import type {
    SequenceRecord,
    PlaylistRecord,
    ScheduledPlaylist,
    CombinedPlayerStatus,
    EndUserShowSettings,
    EndUser,
    UserPlayer,
} from '@ezplayer/ezplayer-core';

import { AppDispatch } from '../..';

import { v4 as uuidv4 } from 'uuid';
import { JSONEditSheet, JSONEditState } from '../../components/layout-edit/types';

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

export interface DataStorageAPI {
    // Set up for data connectivity
    connect(dispatch: AppDispatch): Promise<void>;
    disconnect(): Promise<void>;

    requestChangeServerUrl: (data: { cloudURL: string }) => Promise<void>;

    requestLoginToken: (data: UserLoginBody) => Promise<string>;
    requestLogout: () => Promise<void>;

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

    getCloudShowProfile: () => Promise<EndUserShowSettings>;

    postCloudShowProfile: (data: EndUserShowSettings) => Promise<EndUserShowSettings>;

    getCloudUserProfile: () => Promise<EndUser>;

    postCloudUserProfile: (data: Partial<EndUser>) => Promise<EndUser>;

    postCloudRegister: (data: UserRegisterBody) => Promise<UserRegisterBody>;

    postRequestPasswordReset: (data: { email: string }) => Promise<{ message: string }>;

    postChangePassword: (data: { oldPassword: string; newPassword: string }) => Promise<{ message: string }>;

    requestSetPlayerIdToken: (data: { playerIdToken?: string }) => Promise<{ message: string }>;

    postRegisterPlayer: (data: { playerId: string }) => Promise<{ message: string }>;

    getUserPlayers: () => Promise<UserPlayer[]>;

    // EZSeq integration
    postCloudRgbUpload: () => Promise<CloudFileUpload>;
    postCloudNetworksUpload: () => Promise<CloudFileUpload>;
    postCloudZipUpload: () => Promise<CloudFileUpload>;
    postCloudDoneUploadLayoutFiles: (data: CloudLayoutFileUpload) => Promise<CloudFileUploadResponse>;
    postCloudDoneUploadZip: (fileId: string, fileTime: string) => Promise<CloudFileUploadResponse>;

    getCloudUploadedFiles: () => Promise<DownloadFileResponse>;

    getCloudSeqFile: (fileId: string) => Promise<CloudFileDownloadResponse>;
    getCloudMediaFile: (fileId: string) => Promise<CloudFileDownloadResponse>;
    getCloudXsqzFile: (fileId: string) => Promise<CloudFileDownloadResponse>;
    getCloudPreviewVideo: (fileId: string) => Promise<CloudFileDownloadResponse>;

    // Player immediate
    requestImmediatePlay: (req: { id: string }) => Promise<boolean>;

    /** This fetches the layout options JSON */
    getLayoutOptions: () => Promise<JSONEditSheet | null>;

    /** This uploads layout hints to the server */
    uploadLayoutHints: (data: unknown) => Promise<void>;

    /** This fetches the saved layout hints from the server */
    getLayoutHints: () => Promise<{ modelEditState: JSONEditState } | null>;
}
