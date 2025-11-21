// remoteFalconWorker.ts
import { parentPort } from "worker_threads";

export interface TypicalRFSettings {
    remotePlaylist: string; // Not processed here ... this is pulled and contents sent
    interruptSchedule: boolean; // Depends on what is playing (if it is interrupt immediate or not)
    requestFetchTimeSec: number; // How long before end of the seq when we pull this down
    additionalWaitTime: number; // Some sort of debouncing
}

export interface RFApiClientConfig {
    remoteToken: string;
    pluginsApiPath: string; // no trailing slash needed
    defaultTimeoutMs?: number;
}

export type PlaylistSyncItemType = "SEQUENCE" | "MEDIA" | "COMMAND";

export interface PlaylistSyncItem {
    playlistName: string;
    playlistDuration: number;
    playlistIndex: number;
    playlistType?: PlaylistSyncItemType; // optional for backward compat, likely required in practice
}

/** Response shape inferred from /remotePreferences usage. */
export interface RemotePreferences {
    viewerControlMode?: string;
    [key: string]: unknown;
}

/** Response from /highestVotedPlaylist. */
export interface HighestVotedPlaylistResponse {
    winningPlaylist: string | null;
    playlistIndex: number | null;
    [key: string]: unknown;
}

/** Response from /nextPlaylistInQueue. */
export interface NextPlaylistInQueueResponse {
    nextPlaylist: string | null;
    playlistIndex: number | null;
    [key: string]: unknown;
}

export interface NextToPlay {
    nextPlaylist: string | null;
    playlistIndex: number | null;
    [key: string]: unknown;
}

// Parent to Worker
export type RFWorkerInMessage =
    | { type: "setConfig"; config: RFApiClientConfig }
    | {
        type: "updatePlayback";
        nowPlaying?: string | null;
        nextScheduled?: string | null;
    }
    | { type: "setControlEnabled"; enabled: boolean }
    | { type: "syncPlaylists"; playlists: PlaylistSyncItem[] }
    | { type: "requestNextSuggestion" }
    | { type: "sendHeartbeat" };

// Worker to Parent
export type RFWorkerOutMessage =
    | { type: "log"; level: "info" | "warn" | "error"; msg: string }
    | { type: "configStatus"; ok: true }
    | { type: "configStatus"; ok: false; error: string }
    | { type: "playbackUpdated"; nowPlaying?: string; nextScheduled?: string }
    | { type: "controlUpdated"; enabled: boolean }
    | { type: "playlistsSynced" }
    | { type: "nextSuggestion"; viewerMode: string; suggestion: NextToPlay | null }
    | {
        type: "heartbeatSent";
        error?: string;
    };

export class RFApiClient {
    private readonly baseUrl: string;
    private readonly remoteToken: string;
    private readonly defaultTimeoutMs: number;

    constructor(config: RFApiClientConfig) {
        this.remoteToken = config.remoteToken;
        this.baseUrl = config.pluginsApiPath.replace(/\/+$/, "");
        this.defaultTimeoutMs = config.defaultTimeoutMs ?? 10_000; // default 10s

        if (!this.remoteToken || this.remoteToken.length <= 1) {
            throw new Error("remoteToken must be provided");
        }
    }

    private async request<T = unknown>(
        method: "GET" | "POST" | "DELETE",
        path: string,
        body?: unknown,
        timeoutMs?: number
    ): Promise<T> {
        const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), timeoutMs ?? this.defaultTimeoutMs);

        try {
            const res = await fetch(url, {
                method,
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json; charset=UTF-8",
                    "remotetoken": this.remoteToken,
                },
                ...(body !== undefined && method !== "GET"
                    ? { body: JSON.stringify(body) }
                    : {}),
                signal: controller.signal,
            });

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new Error(
                    `${method} ${url} failed: ${res.status} ${res.statusText}${text ? ` – ${text}` : ""}`
                );
            }

            // Try JSON, fall back to text if not JSON
            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                return (await res.json()) as T;
            }

            return (await res.text()) as unknown as T;
        } catch (err) {
            // Surface AbortError more nicely if desired
            if (err instanceof Error && err.name === "AbortError") {
                throw new Error(`${method} ${url} timed out after ${timeoutMs ?? this.defaultTimeoutMs} ms`);
            }
            throw err;
        } finally {
            clearTimeout(to);
        }
    }

    private get<T = unknown>(path: string, timeoutMs?: number): Promise<T> {
        return this.request<T>("GET", path, undefined, timeoutMs);
    }

    private post<T = unknown>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
        return this.request<T>("POST", path, body, timeoutMs);
    }

    private delete<T = unknown>(path: string, timeoutMs?: number): Promise<T> {
        return this.request<T>("DELETE", path, undefined, timeoutMs);
    }

    // -----------------------
    // Managed PSA
    // -----------------------

    disableManagedPsa(): Promise<unknown> {
        return this.post("/updateManagedPsa", { managedPsaEnabled: "N" });
    }

    enableManagedPsa(): Promise<unknown> {
        return this.post("/updateManagedPsa", { managedPsaEnabled: "Y" });
    }

    setManagedPsaEnabled(enabled: boolean): Promise<unknown> {
        return this.post("/updateManagedPsa", {
            managedPsaEnabled: enabled ? "Y" : "N",
        });
    }

    // -----------------------
    // Viewer control
    // -----------------------

    disableViewerControl(): Promise<unknown> {
        return this.post("/updateViewerControl", { viewerControlEnabled: "N" });
    }

    enableViewerControl(): Promise<unknown> {
        return this.post("/updateViewerControl", { viewerControlEnabled: "Y" });
    }

    setViewerControlEnabled(enabled: boolean): Promise<unknown> {
        return this.post("/updateViewerControl", {
            viewerControlEnabled: enabled ? "Y" : "N",
        });
    }

    // -----------------------
    // Queue / playlists
    // -----------------------

    purgeQueue(): Promise<unknown> {
        return this.delete("/purgeQueue");
    }

    syncPlaylists(playlists: PlaylistSyncItem[]): Promise<unknown> {
        return this.post("/syncPlaylists", { playlists });
    }

    // -----------------------
    // Remote preferences
    // -----------------------

    /**
     * GET /remotePreferences
     * Fetch viewer control mode and other remote preferences for this token.
     */
    getRemotePreferences(timeoutMs?: number): Promise<RemotePreferences> {
        return this.get<RemotePreferences>("/remotePreferences", timeoutMs);
    }

    // -----------------------
    // Now playing / next scheduled
    // -----------------------

    /**
     * POST /updateWhatsPlaying
     * Update what is currently playing (sequence/media name).
     */
    updateWhatsPlaying(playlist: string, timeoutMs?: number): Promise<unknown> {
        return this.post(
            "/updateWhatsPlaying",
            { playlist: playlist.trim() },
            timeoutMs
        );
    }

    /**
     * POST /updateNextScheduledSequence
     * Inform RF which sequence will play next.
     */
    updateNextScheduledSequence(sequence: string, timeoutMs?: number): Promise<unknown> {
        return this.post(
            "/updateNextScheduledSequence",
            { sequence: sequence.trim() },
            timeoutMs
        );
    }

    // -----------------------
    // Voting / request queue
    // -----------------------

    /**
     * GET /highestVotedPlaylist
     * Used in "voting" viewer control mode to get the winning playlist.
     */
    getHighestVotedPlaylist(timeoutMs?: number): Promise<HighestVotedPlaylistResponse> {
        return this.get<HighestVotedPlaylistResponse>(
            "/highestVotedPlaylist",
            timeoutMs
        );
    }

    /**
     * GET /nextPlaylistInQueue?updateQueue=true|false
     * Used in "request queue" mode to get the next playlist.
     * By default, updateQueue=true (consumes the item as in original PHP).
     */
    getNextPlaylistInQueue(
        options: { updateQueue?: boolean } = {},
        timeoutMs?: number
    ): Promise<NextPlaylistInQueueResponse> {
        const update = options.updateQueue ?? true;
        const path = `/nextPlaylistInQueue?updateQueue=${update ? "true" : "false"}`;
        return this.get<NextPlaylistInQueueResponse>(path, timeoutMs);
    }

    // -----------------------
    // Heartbeat
    // -----------------------

    /**
     * POST /fppHeartbeat
     * Send a heartbeat to keep the remote listener marked as alive.
     */
    sendHeartbeat(timeoutMs?: number): Promise<unknown> {
        // In PHP this is an empty JSON object: (object)[]
        return this.post("/fppHeartbeat", {}, timeoutMs);
    }
}


if (!parentPort) {
    throw new Error("remoteFalconWorker must be run as a worker thread");
}

// -------------------------
// Internal state
// -------------------------

let client: RFApiClient | null = null;
let config: RFApiClientConfig | null = null;

// Last state we *believe* RF has
let lastNowPlaying: string | null = null;
let lastNextScheduled: string | null = null;
let lastControlEnabled: boolean | null = null;
let lastPlaylistHash: string | null = null;

// In-flight flags to avoid concurrent same-type calls
const inFlight: Record<string, boolean> = Object.create(null);

// -------------------------
// Helper: send to parent
// -------------------------

function send(msg: RFWorkerOutMessage) {
    parentPort!.postMessage(msg);
}

// -------------------------
// Helper: ensure client
// -------------------------

function ensureClient(): RFApiClient {
    if (!config) {
        throw new Error("Remote Falcon configuration not set");
    }
    if (!client) {
        client = new RFApiClient(config);
    }
    return client;
}

// -------------------------
// Helper: simple “run once per key” guard
// -------------------------

async function runGuarded(key: string, fn: () => Promise<void>) {
    if (inFlight[key]) {
        // Already running this action; silently ignore
        return;
    }
    inFlight[key] = true;
    try {
        await fn();
    } finally {
        inFlight[key] = false;
    }
}

// -------------------------
// Debounced action handlers
// -------------------------

async function handleSetConfig(newConfig: RFApiClientConfig) {
    config = newConfig;
    client = null; // force recreation with new settings

    // Reset RF view since we don't know what it's at anymore
    lastNowPlaying = null;
    lastNextScheduled = null;
    lastControlEnabled = null;
    lastPlaylistHash = null;

    send({ type: "configStatus", ok: true });
}

async function handleUpdatePlayback(nowPlaying?: string | null, nextScheduled?: string | null) {
    const c = ensureClient();

    await runGuarded("updatePlayback", async () => {
        let changed = false;

        // Update "now playing" if changed and non-empty
        if (typeof nowPlaying === "string") {
            const trimmed = nowPlaying.trim();
            if (trimmed && trimmed !== lastNowPlaying) {
                await c.updateWhatsPlaying(trimmed);
                lastNowPlaying = trimmed;
                changed = true;
            }
        }

        // Update "next scheduled" if changed and non-empty
        if (typeof nextScheduled === "string") {
            const trimmedNext = nextScheduled.trim();
            if (trimmedNext && trimmedNext !== lastNextScheduled) {
                await c.updateNextScheduledSequence(trimmedNext);
                lastNextScheduled = trimmedNext;
                changed = true;
            }
        }

        if (changed) {
            send({
                type: "playbackUpdated",
                nowPlaying: lastNowPlaying ?? undefined,
                nextScheduled: lastNextScheduled ?? undefined,
            });
        }
    });
}

async function handleSetControlEnabled(enabled: boolean) {
    const c = ensureClient();

    await runGuarded("setControlEnabled", async () => {
        if (lastControlEnabled === enabled) {
            // No-op, already at desired state
            return;
        }

        await c.setViewerControlEnabled(enabled);
        lastControlEnabled = enabled;

        send({ type: "controlUpdated", enabled });
    });
}

async function handleSyncPlaylists(playlists: PlaylistSyncItem[]) {
    const c = ensureClient();

    await runGuarded("syncPlaylists", async () => {
        // Simple content hash via JSON string. Good enough for modest lists.
        const hash = JSON.stringify(playlists);
        if (hash === lastPlaylistHash) {
            return; // no change
        }

        await c.syncPlaylists(playlists);
        lastPlaylistHash = hash;

        send({ type: "playlistsSynced" });
    });
}

// -------------------------
// “Check now” handlers
// -------------------------

type ViewerModeChoice = "voting" | "request" | "jukebox" | undefined;
let viewerMode: ViewerModeChoice;
let viewerModeExpiresAt: number = 0;
async function handleRequestNextSuggestion() {
    await runGuarded("nextSuggestion", async () => {
        const c = ensureClient();

        // Ensure mode is known
        if (!viewerMode || Date.now() > viewerModeExpiresAt) {
            try {
                const prefs = await c.getRemotePreferences();
                viewerMode = (prefs.viewerControlMode as ViewerModeChoice) ?? "jukebox";
                viewerModeExpiresAt = Date.now() + 300_000; // 5 min TTL
            } catch {
                // fallback
                viewerMode = "jukebox";
            }
        }

        let response: NextPlaylistInQueueResponse | HighestVotedPlaylistResponse | null = null;
        let suggestion: NextToPlay | null = null;
        let type: "vote" | "queue";

        if (viewerMode === "voting") {
            type = "vote";
            try {
                response = await c.getHighestVotedPlaylist();
                suggestion = { nextPlaylist: response.winningPlaylist, playlistIndex: response.playlistIndex };
            } catch {
                response = null;
            }
        } else {
            type = "queue";
            try {
                response = await c.getNextPlaylistInQueue({ updateQueue: true });
                suggestion = { nextPlaylist: response.nextPlaylist, playlistIndex: response.playlistIndex };
            } catch {
                response = null;
            }
        }

        send({
            type: "nextSuggestion",
            viewerMode,
            suggestion: suggestion,
        });
    });
}

async function handleSendHeartbeat() {
    const c = ensureClient();

    await runGuarded("heartbeat", async () => {
        try {
            await c.sendHeartbeat();
            send({ type: "heartbeatSent" });
        } catch (e) {
            const err = e as Error;
            send({
                type: "heartbeatSent",
                error: err?.message ?? String(err),
            });
        }
    });
}

// -------------------------
// Message dispatch
// -------------------------

parentPort.on("message", async (msg: RFWorkerInMessage) => {
    try {
        switch (msg.type) {
            case "setConfig":
                await handleSetConfig(msg.config);
                break;
            case "updatePlayback":
                await handleUpdatePlayback(msg.nowPlaying, msg.nextScheduled);
                break;
            case "setControlEnabled":
                await handleSetControlEnabled(msg.enabled);
                break;
            case "syncPlaylists":
                await handleSyncPlaylists(msg.playlists);
                break;
            case "requestNextSuggestion":
                await handleRequestNextSuggestion();
                break;
            case "sendHeartbeat":
                await handleSendHeartbeat();
                break;
            default:
                send({
                    type: "log",
                    level: "warn",
                    msg: `Unknown message type: ${(msg as {type: string}).type}`,
                });
        }
    } catch (e) {
        const err = e as Error;
        send({
            type: "log",
            level: "error",
            msg: `Error handling message ${msg.type}: ${err?.stack || err?.message || String(err)}`,
        });
    }
});
