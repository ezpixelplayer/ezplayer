/**
 * EZPlayer viewer-control sync worker for the `'ezplayer'` backend
 * (`ViewerControlState.type === 'ezplayer'`).
 *
 * The cloud owns the mode/policy, so the worker is thin: it pushes state and
 * polls `GET /api/player/vc/next/:player_token`, and the cloud returns the
 * pick for whatever mode it's running. Auth is the player's own cloud
 * identity (player_token in the path + cloudUrl), the same identity the cloud
 * bridge/checkin uses — no user-supplied token.
 *
 * Endpoints:
 *   POST /api/player/vc/playlists/:player_token  { songs }
 *   POST /api/player/vc/playing/:player_token    VcPlayingUpdate
 *   POST /api/player/vc/enabled/:player_token    { enabled }
 *   POST /api/player/vc/schedule/:player_token   { schedule }
 *   GET  /api/player/vc/next/:player_token        -> { mode, songId }
 */

import { parentPort } from 'worker_threads';
import type { VcPlayingUpdate, VcScheduleEntry, VcSong } from '@ezplayer/ezplayer-core';

export interface EzvcConfig {
    /** The player's cloud base URL (same one the checkin/bridge uses). */
    cloudUrl?: string;
    /** The player's registration token (cloud `:player_token`). */
    playerToken?: string;
    defaultTimeoutMs?: number;
}

/** What the cloud returns from `/next`. `songId` is a sequence id the player
 *  can hand straight to `processCommand('playsong')` — no index lookup. */
export interface EzvcNextToPlay {
    mode: 'off' | 'request' | 'vote';
    songId: string | null;
}

// Parent -> Worker
export type EzvcWorkerInMessage =
    | { type: 'setConfig'; config: EzvcConfig }
    | { type: 'updatePlayback'; update: VcPlayingUpdate }
    | { type: 'setControlEnabled'; enabled: boolean }
    | { type: 'syncPlaylists'; songs: VcSong[] }
    | { type: 'syncSchedule'; schedule: VcScheduleEntry[] }
    | { type: 'requestNextSuggestion' };

// Worker -> Parent
export type EzvcWorkerOutMessage =
    | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string }
    | { type: 'configStatus'; ok: true }
    | { type: 'configStatus'; ok: false; error: string }
    | { type: 'playbackUpdated' }
    | { type: 'controlUpdated'; enabled: boolean }
    | { type: 'playlistsSynced' }
    | { type: 'scheduleSynced' }
    | { type: 'nextSuggestion'; suggestion: EzvcNextToPlay | null };

export class EzvcApiClient {
    private readonly baseUrl: string;
    private readonly playerToken: string;
    private readonly defaultTimeoutMs: number;

    constructor(config: EzvcConfig) {
        this.playerToken = config.playerToken ?? '';
        this.baseUrl = (config.cloudUrl ?? '').replace(/\/+$/, '');
        this.defaultTimeoutMs = config.defaultTimeoutMs ?? 10_000;

        if (!this.baseUrl) throw new Error('cloudUrl must be provided');
        if (!this.playerToken || this.playerToken.length <= 1) {
            throw new Error('playerToken must be provided');
        }
    }

    private path(segment: string): string {
        return `${this.baseUrl}/api/player/vc/${segment}/${encodeURIComponent(this.playerToken)}`;
    }

    private async request<T = unknown>(
        method: 'GET' | 'POST',
        url: string,
        body?: unknown,
        timeoutMs?: number,
    ): Promise<T | undefined> {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), timeoutMs ?? this.defaultTimeoutMs);
        try {
            const res = await fetch(url, {
                method,
                headers: {
                    Accept: 'application/json',
                    ...(method === 'POST' ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
                },
                ...(body !== undefined && method === 'POST' ? { body: JSON.stringify(body) } : {}),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`${method} ${url} failed: ${res.status} ${res.statusText}${text ? ` – ${text}` : ''}`);
            }
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) return (await res.json()) as T;
            return (await res.text()) as unknown as T;
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                throw new Error(`${method} ${url} timed out after ${timeoutMs ?? this.defaultTimeoutMs} ms`);
            }
            throw err;
        } finally {
            clearTimeout(to);
        }
    }

    syncPlaylists(songs: VcSong[]): Promise<unknown> {
        return this.request('POST', this.path('playlists'), { songs });
    }

    /** The cloud's `/playing` param is the whole body (`VcPlayingUpdate`). */
    updatePlaying(update: VcPlayingUpdate): Promise<unknown> {
        return this.request('POST', this.path('playing'), update);
    }

    setEnabled(enabled: boolean): Promise<unknown> {
        return this.request('POST', this.path('enabled'), { enabled });
    }

    syncSchedule(schedule: VcScheduleEntry[]): Promise<unknown> {
        return this.request('POST', this.path('schedule'), { schedule });
    }

    getNext(timeoutMs?: number): Promise<EzvcNextToPlay | undefined> {
        return this.request<EzvcNextToPlay>('GET', this.path('next'), undefined, timeoutMs);
    }
}

if (!parentPort) {
    throw new Error('ezvcsync must be run as a worker thread');
}

let client: EzvcApiClient | null = null;
let config: EzvcConfig | null = null;

// Last state we believe the cloud has, to suppress redundant calls.
let lastEnabled: boolean | null = null;
let lastPlaylistHash: string | null = null;
let lastScheduleHash: string | null = null;
let lastPlayingHash: string | null = null;

const inFlight: Record<string, boolean> = Object.create(null);

function send(msg: EzvcWorkerOutMessage) {
    parentPort!.postMessage(msg);
}

function ensureClient(): EzvcApiClient {
    if (!config) throw new Error('ezplayer viewer-control configuration not set');
    if (!client) client = new EzvcApiClient(config);
    return client;
}

async function runGuarded(key: string, fn: () => Promise<void>) {
    if (inFlight[key]) return;
    inFlight[key] = true;
    try {
        await fn();
    } catch (e) {
        send({ type: 'log', level: 'error', msg: (e as Error).message });
    } finally {
        inFlight[key] = false;
    }
}

function handleSetConfig(newConfig: EzvcConfig) {
    config = newConfig;
    client = null; // force recreation
    lastEnabled = null;
    lastPlaylistHash = null;
    lastScheduleHash = null;
    lastPlayingHash = null;
    try {
        ensureClient(); // validate eagerly so bad config surfaces now
        send({ type: 'configStatus', ok: true });
    } catch (e) {
        send({ type: 'configStatus', ok: false, error: (e as Error).message });
    }
}

async function handleUpdatePlayback(update: VcPlayingUpdate) {
    const c = ensureClient();
    await runGuarded('updatePlayback', async () => {
        const hash = JSON.stringify(update);
        if (hash === lastPlayingHash) return;
        await c.updatePlaying(update);
        lastPlayingHash = hash;
        send({ type: 'playbackUpdated' });
    });
}

async function handleSetControlEnabled(enabled: boolean) {
    const c = ensureClient();
    await runGuarded('setControlEnabled', async () => {
        if (lastEnabled === enabled) return;
        await c.setEnabled(enabled);
        lastEnabled = enabled;
        send({ type: 'controlUpdated', enabled });
    });
}

async function handleSyncPlaylists(songs: VcSong[]) {
    const c = ensureClient();
    await runGuarded('syncPlaylists', async () => {
        const hash = JSON.stringify(songs);
        if (hash === lastPlaylistHash) return;
        await c.syncPlaylists(songs);
        lastPlaylistHash = hash;
        send({ type: 'playlistsSynced' });
    });
}

async function handleSyncSchedule(schedule: VcScheduleEntry[]) {
    const c = ensureClient();
    await runGuarded('syncSchedule', async () => {
        const hash = JSON.stringify(schedule);
        if (hash === lastScheduleHash) return;
        await c.syncSchedule(schedule);
        lastScheduleHash = hash;
        send({ type: 'scheduleSynced' });
    });
}

async function handleRequestNextSuggestion() {
    await runGuarded('nextSuggestion', async () => {
        const c = ensureClient();
        const res = await c.getNext();
        if (!res) return;
        send({ type: 'nextSuggestion', suggestion: { mode: res.mode, songId: res.songId } });
    });
}

parentPort.on('message', async (msg: EzvcWorkerInMessage) => {
    try {
        switch (msg.type) {
            case 'setConfig':
                handleSetConfig(msg.config);
                break;
            case 'updatePlayback':
                await handleUpdatePlayback(msg.update);
                break;
            case 'setControlEnabled':
                await handleSetControlEnabled(msg.enabled);
                break;
            case 'syncPlaylists':
                await handleSyncPlaylists(msg.songs);
                break;
            case 'syncSchedule':
                await handleSyncSchedule(msg.schedule);
                break;
            case 'requestNextSuggestion':
                await handleRequestNextSuggestion();
                break;
            default:
                send({
                    type: 'log',
                    level: 'warn',
                    msg: `Unknown message type: ${(msg as { type: string }).type}`,
                });
        }
    } catch (e) {
        const err = e as Error;
        send({
            type: 'log',
            level: 'error',
            msg: `Error handling message ${msg.type}: ${err?.stack || err?.message || String(err)}`,
        });
    }
});
