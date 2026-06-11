import { parentPort } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { randomUUID } from 'crypto';
import {
    CLOUD_API_ENDPOINTS,
    findMatchingScheduleEntry,
    type CandidateServersResponse,
    type CloudConfig,
    type CloudPlayerSettings,
    type CloudFileEntry,
    type CloudFileKind,
    type CloudPollScheduleEntry,
    type CloudSeqManifestEntry,
    type CloudSequenceProgress,
    type ElectHomeServerRequest,
    type OutOfBandCommand,
    type PlayerCheckinRequest,
    type PlayerCheckinResponse,
    type PlayerCStatusContent,
    type PlaylistRecord,
    type ScheduledPlaylist,
    type SequenceRecord,
} from '@ezplayer/ezplayer-core';
import type { CloudPollInMessage, CloudPollOutMessage, CloudWorkerTuning } from './cloudpolltypes';
import { collectReferencedAssets } from '../data/layoutAssets.js';
import { FSEQReaderAsync } from '@ezplayer/epp';

// Aggressive demo defaults; production callers should pass conservative values.
// 5s registration keeps the cloud-bridge open signal (viewer-control + audio
// start) responsive — worst-case bridge/audio start ≈ one interval. Steady-state
// cost is a lightweight checkin every 5s per player (accepted for demo;
// override via cloud-config `cloudPollIntervals.registrationMs` in production).
// Note: the cloud treats ~2× this as the live-freshness cutoff.
const DEFAULT_REGISTRATION_INTERVAL_MS = 5_000;
const DEFAULT_MANIFEST_INTERVAL_MS = 60_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_FAILURE_THRESHOLD = 5;

let cloudUrl = '';
let playerIdToken = '';
let showFolder = '';
let existingSequences: SequenceRecord[] = [];
let layoutMeta: NonNullable<CloudConfig['layoutMeta']> = {};
let layoutSource: 'xlights' | 'cloud' = 'xlights';
let pollMode: 'always' | 'scheduled' = 'always';
let pollSchedule: CloudPollScheduleEntry[] = [];

/** Returns true when content polling (manifest + sequence files + layout) is
 *  permitted right now. Always-true when not in scheduled mode. Registration
 *  heartbeat polls run regardless of this gate. */
function isContentPollingAllowed(): boolean {
    if (pollMode !== 'scheduled') return true;
    if (pollSchedule.length === 0) return false;
    return findMatchingScheduleEntry(pollSchedule, new Date()) !== null;
}

let registrationIntervalMs = DEFAULT_REGISTRATION_INTERVAL_MS;
let manifestIntervalMs = DEFAULT_MANIFEST_INTERVAL_MS;
let downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS;
let failureThreshold = DEFAULT_FAILURE_THRESHOLD;

let regTimer: NodeJS.Timeout | null = null;
let manifestTimer: NodeJS.Timeout | null = null;
let regInFlight = false;
let manifestInFlight = false;
let stopped = false;

let consecutiveFailures = 0;
let halted = false;

/** Wall-clock time the player last confirmed it had the layout the cloud
 *  manifest advertised — either it downloaded the new layout successfully
 *  or its persisted layoutMeta already matched. Sent on every checkin so
 *  central / admin / extapi can show "synced through". `undefined` until
 *  the first successful fetchLayout in this process. */
let lastLayoutSyncAt: number | undefined;
/** Wall-clock time the player last confirmed it had every file the cloud
 *  manifest listed (a reconcileManifest pass with zero per-entry failures).
 *  Sent on every checkin alongside `lastLayoutSyncAt`. */
let lastContentSyncAt: number | undefined;

const cStatus: PlayerCStatusContent = { files: {} };

// Last serialized payloads we sent to the parent. We compare new fetches to these
// and skip postMessage when identical — the parent's update path is disruptive to
// playback even when nothing actually changed. Reset on setConfig (folder/user
// change ⇒ different store, always push).
let lastSentPlaylistsJson: string | undefined;
let lastSentScheduleJson: string | undefined;
let lastSentSettingsJson: string | undefined;

/** `${file_id}|${file_time}` -> active absPath of files we've successfully landed this
 *  session. Compound key so a re-used file_id with a fresh file_time is correctly
 *  treated as a different file (the cloud may reuse ids; file_time is the source of
 *  truth for "is this the bytes we already have"). */
const installedFiles = new Map<string, string>();
const fileKey = (file_id: string, file_time?: number) => `${file_id}|${file_time ?? 0}`;

function post(msg: CloudPollOutMessage) {
    parentPort?.postMessage(msg);
}

function log(level: 'info' | 'warn' | 'error', msg: string) {
    post({ type: 'log', level, msg });
}

function pushCStatus() {
    post({
        type: 'cStatus',
        status: {
            ...cStatus,
            files: { ...cStatus.files },
            halted,
        },
    });
}

function setFile(file_id: string, entry: CloudFileEntry) {
    if (!cStatus.files) cStatus.files = {};
    cStatus.files[file_id] = entry;
    pushCStatus();
}

function clearTimers() {
    if (regTimer) {
        clearInterval(regTimer);
        regTimer = null;
    }
    if (manifestTimer) {
        clearInterval(manifestTimer);
        manifestTimer = null;
    }
}

function canRun() {
    return !stopped && cloudUrl.length > 0 && playerIdToken.length > 0 && !halted;
}

function rescheduleTimers() {
    clearTimers();
    if (!canRun()) return;
    regTimer = setInterval(() => void pollRegistration(), registrationIntervalMs);
    if (regTimer.unref) regTimer.unref();
    // Manifest timer respects the schedule. Manual `manifestNow` and `fetchLayoutNow`
    // bypass it (user-initiated should always run). Outside-window ticks just no-op.
    manifestTimer = setInterval(() => {
        if (!isContentPollingAllowed()) return;
        void pollManifest();
    }, manifestIntervalMs);
    if (manifestTimer.unref) manifestTimer.unref();
}

/** Cooling-off period after the circuit breaker trips. After this much time
 *  the player tries again on its own — so an overnight transient (rate spike,
 *  cloud outage) heals without requiring a user click or app restart. */
const HALT_AUTO_CLEAR_MS = 60 * 60 * 1000;
let autoClearTimer: NodeJS.Timeout | undefined;

function cancelAutoClearTimer() {
    if (autoClearTimer) {
        clearTimeout(autoClearTimer);
        autoClearTimer = undefined;
    }
}

function recordFailure(reason: string) {
    consecutiveFailures += 1;
    cStatus.lastError = reason;
    if (consecutiveFailures >= failureThreshold) {
        halted = true;
        log('error', `circuit breaker tripped after ${consecutiveFailures} failures: ${reason}`);
        // Stop only the manifest/content poll loop (the one that's
        // failing). KEEP the registration heartbeat alive — it's what
        // refreshes the cloud-bridge TTL on the server side. Halting it
        // here means the bridge silently dies in 90s and the player drops
        // until a manual restart, regardless of how innocuous the failure.
        if (manifestTimer) { clearInterval(manifestTimer); manifestTimer = null; }
        // Schedule a one-shot auto-clear so the player self-recovers without
        // user intervention. User-initiated sync or setConfig cancels this.
        cancelAutoClearTimer();
        autoClearTimer = setTimeout(() => {
            autoClearTimer = undefined;
            if (halted) {
                log('info', 'circuit breaker auto-clearing after cooling-off period');
                consecutiveFailures = 0;
                halted = false;
                cStatus.lastError = undefined;
                pushCStatus();
                rescheduleTimers();
            }
        }, HALT_AUTO_CLEAR_MS);
        autoClearTimer.unref?.();
    }
    pushCStatus();
}

function recordSuccess() {
    if (consecutiveFailures !== 0) {
        consecutiveFailures = 0;
        cStatus.lastError = undefined;
        pushCStatus();
    }
}

/** A user-initiated sync (manifestNow / fetchLayoutNow) should override any
 *  prior auto-halt: the user is explicitly asking for another attempt. Clears
 *  the consecutive-failure counter, drops the halted flag, and re-arms the
 *  periodic timers that the breaker had cleared. Cheap when nothing was
 *  wrong (typical case). */
function clearAutoHaltOnUserSync() {
    const wasHalted = halted;
    cancelAutoClearTimer();
    if (consecutiveFailures !== 0 || halted) {
        consecutiveFailures = 0;
        halted = false;
        cStatus.lastError = undefined;
        pushCStatus();
    }
    if (wasHalted) {
        log('info', 'user-initiated sync; clearing auto-halt');
        rescheduleTimers();
    }
}

/** Build the cloud-bridge WebSocket URL from our own configured cloudUrl.
 *  Uses URL parsing so we get scheme + host + any path prefix correctly,
 *  then swaps http→ws / https→wss. */
function buildBridgeWsUrl(cloudUrlIn: string, token: string, sessionId: string): string {
    return buildWsUrlAt(cloudUrlIn, '/api/player/wsBridge', token, sessionId);
}

/** Parallel WS for HTTP-over-WS proxy traffic. Same auth boundary, different
 *  path so big payloads don't share head-of-line with status snapshots. */
function buildProxyWsUrl(cloudUrlIn: string, token: string, sessionId: string): string {
    return buildWsUrlAt(cloudUrlIn, '/api/player/proxyBridge', token, sessionId);
}

/** Parallel WS for live-audio push. Player pushes binary chunk frames as
 *  they're produced; the cloud server fans out to attached listeners. */
function buildAudioWsUrl(cloudUrlIn: string, token: string, sessionId: string): string {
    return buildWsUrlAt(cloudUrlIn, '/api/player/audioBridge', token, sessionId);
}

function buildWsUrlAt(cloudUrlIn: string, path: string, token: string, sessionId: string): string {
    const u = new URL(cloudUrlIn);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = u.toString().replace(/\/+$/, '');
    return `${base}${path}?player_token=${encodeURIComponent(token)}&session=${encodeURIComponent(sessionId)}`;
}

// -- home-server election ------------------------------------------------------
// Startup-only — the elected host holds in-RAM vc state; mid-session moves
// would discard votes/queue.

const ELECTION_PROBE_TIMEOUT_MS = 2_000;
/** Soft cutoff: when every candidate exceeds it, fall through to the full
 *  set so the player still has somewhere to go. */
const ELECTION_LOAD_CUTOFF = 0.95;

async function probeHealthzRttMs(serverUrl: string): Promise<number | undefined> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ELECTION_PROBE_TIMEOUT_MS);
    const t0 = performance.now();
    try {
        const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/healthz`, { signal: ac.signal });
        if (!res.ok) return undefined;
        // Drain so RTT covers a full round-trip, not just headers.
        await res.text();
        return performance.now() - t0;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

async function electHomeServerOnce(): Promise<void> {
    if (!cloudUrl || !playerIdToken) return;
    try {
        const candUrl = `${cloudUrl}api/${CLOUD_API_ENDPOINTS.CANDIDATE_SERVERS}${playerIdToken}`;
        const res = await fetch(candUrl);
        if (!res.ok) {
            log('warn', `electHomeServer: candidateServers ${res.status}`);
            return;
        }
        const body = (await res.json()) as CandidateServersResponse;
        if (!body.candidates?.length) {
            log('info', 'electHomeServer: no candidates available');
            return;
        }
        const probed = await Promise.all(
            body.candidates.map(async (c) => ({ ...c, rtt_ms: await probeHealthzRttMs(c.url) })),
        );
        const reachable = probed.filter(
            (p): p is typeof p & { rtt_ms: number } => typeof p.rtt_ms === 'number',
        );
        if (reachable.length === 0) {
            log('warn', 'electHomeServer: no candidates reachable');
            return;
        }
        const underCutoff = reachable.filter((p) => p.load_hint < ELECTION_LOAD_CUTOFF);
        const pool = underCutoff.length > 0 ? underCutoff : reachable;
        pool.sort((a, b) => a.rtt_ms - b.rtt_ms);
        const winner = pool[0]!;
        // Announce on every election (including "kept current") so ezvc
        // re-targets after a worker restart.
        post({ type: 'homeServerUrl', url: winner.url });

        if (winner.key === body.current_key) {
            log(
                'info',
                `electHomeServer: keeping key=${winner.key} rtt=${winner.rtt_ms.toFixed(0)}ms load=${winner.load_hint.toFixed(2)}`,
            );
            return;
        }
        const electUrl = `${cloudUrl}api/${CLOUD_API_ENDPOINTS.ELECT_HOME_SERVER}${playerIdToken}`;
        const electRes = await fetch(electUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: winner.key } satisfies ElectHomeServerRequest),
        });
        if (!electRes.ok) {
            log('warn', `electHomeServer: elect ${electRes.status}`);
            return;
        }
        log(
            'info',
            `electHomeServer: chose key=${winner.key} rtt=${winner.rtt_ms.toFixed(0)}ms load=${winner.load_hint.toFixed(2)} (was ${body.current_key ?? 'unbound'})`,
        );
    } catch (e) {
        log('warn', `electHomeServer: ${(e as Error).message}`);
    }
}

// -- registration heartbeat ----------------------------------------------------

async function pollRegistration() {
    if (regInFlight || !canRun()) return;
    regInFlight = true;
    // POST /api/player/checkin/<token> — lightweight heartbeat that doubles as
    // a command-poll for out-of-band cloud-bridge controls (openCloudWS, etc.).
    // Body fields are best-effort hints surfaced by the cloud operator UI;
    // empty body would be valid too.
    const url = `${cloudUrl}api/${CLOUD_API_ENDPOINTS.CHECKIN}${playerIdToken}`;
    const body: PlayerCheckinRequest = {
        now: Date.now(),
        pollIntervalMs: registrationIntervalMs,
        ...(halted ? { halted: true } : {}),
        ...(cStatus.lastError ? { lastError: cStatus.lastError } : {}),
        ...(lastLayoutSyncAt !== undefined ? { lastLayoutSync: lastLayoutSyncAt } : {}),
        ...(lastContentSyncAt !== undefined ? { lastContentSync: lastContentSyncAt } : {}),
    };
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            post({
                type: 'cloudStatus',
                status: {
                    playerIdIsRegistered: false,
                    lastCheckedAt: Date.now(),
                    lastError: `HTTP ${res.status}`,
                },
            });
            return;
        }
        const reply = (await res.json()) as PlayerCheckinResponse;
        post({
            type: 'cloudStatus',
            status: {
                playerIdIsRegistered: !!reply.registered,
                lastCheckedAt: Date.now(),
                lastError: undefined,
            },
        });
        if (reply.commands && reply.commands.length > 0) {
            // Synthesize the bridge WS URL on our side from the cloud URL we
            // just polled — `cloudUrl` is the authoritative answer for "where
            // is the cloud". The cloud server's own view of its public URL is
            // unreliable behind ingress/load-balancers (it reports the internal
            // upstream address, which ETIMEDOUTs from outside).
            const commands = reply.commands.map<OutOfBandCommand>((cmd) =>
                cmd.type === 'openCloudWS'
                    ? {
                          ...cmd,
                          // Honor a server-provided URL when present (the cloud
                          // routes us to a chosen edge host). Fall back to
                          // synthesizing against our own cloudUrl when omitted
                          // (legacy path; cloud serves the bridge itself).
                          wsUrl: cmd.wsUrl ?? buildBridgeWsUrl(cloudUrl, playerIdToken, cmd.sessionId),
                          proxyWsUrl: cmd.proxyWsUrl ?? buildProxyWsUrl(cloudUrl, playerIdToken, cmd.sessionId),
                          audioWsUrl: cmd.audioWsUrl ?? buildAudioWsUrl(cloudUrl, playerIdToken, cmd.sessionId),
                      }
                    : cmd,
            );
            post({ type: 'outOfBandCommands', commands });
        }
    } catch (e) {
        const err = e as Error;
        log('warn', `checkin error: ${err.message}`);
        post({
            type: 'cloudStatus',
            status: {
                playerIdIsRegistered: false,
                lastCheckedAt: Date.now(),
                lastError: err.message,
            },
        });
    } finally {
        regInFlight = false;
    }
}

// -- manifest poll + download orchestration -----------------------------------

interface PendingFile {
    kind: CloudFileKind;
    file_id: string;
    file_time?: number;
    /** For fseq/audio: the URL endpoint to ask for a presigned URL.
     *  For thumb: the manifest's direct presigned URL. */
    fetchVia: 'seqfile' | 'mediafile' | 'directUrl';
    directUrl?: string;
}

async function pollManifest() {
    if (manifestInFlight || !canRun()) return;
    if (!showFolder) {
        log('warn', 'manifest poll skipped: no showFolder');
        return;
    }
    manifestInFlight = true;
    // In cloud-managed mode, layout comes first on every tick. The layoutMeta
    // staleness check makes this cheap when nothing has changed (the call
    // returns after the manifest comparison without downloading anything).
    if (layoutSource === 'cloud') {
        try {
            await fetchLayout();
        } catch (e) {
            // fetchLayout already logs and writes to cStatus; don't fail the manifest tick.
            log('warn', `pre-manifest layout fetch error: ${(e as Error).message}`);
        }
    } else {
        // Local-master mode: the player IS the layout source of truth, so
        // there's nothing to fetch and nothing to fail. By definition the
        // layout is "synced through" right now — stamp accordingly so the
        // sync-time check on central / admin doesn't show this player as
        // stale just because fetchLayout was never called.
        lastLayoutSyncAt = Date.now();
    }
    const url = `${cloudUrl}${CLOUD_API_ENDPOINTS.EZP_GET_SEQ_LIST}${playerIdToken}`;
    log('info', `manifest poll ${url}`);
    try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            recordFailure(`manifest HTTP ${res.status}`);
            return;
        }
        const body = (await res.json()) as { sequences?: CloudSeqManifestEntry[] };
        const sequences = body.sequences ?? [];
        cStatus.lastManifestAt = Date.now();
        recordSuccess();
        log('info', `manifest: ${sequences.length} sequences`);
        await reconcileManifest(sequences);
    } catch (e) {
        const err = e as Error;
        log('warn', `manifest poll error: ${err.message}`);
        recordFailure(err.message);
    } finally {
        manifestInFlight = false;
    }
    // Playlists + schedule are metadata-only; cheap, errors are non-fatal.
    void fetchPlaylistsAndSchedule();
    // Cloud-managed player settings — same cadence, same non-fatal handling.
    void fetchPlayerSettings();
}

async function fetchPlaylistsAndSchedule() {
    if (!cloudUrl || !playerIdToken) return;
    const plUrl = `${cloudUrl}${CLOUD_API_ENDPOINTS.EZP_GET_PLAYLISTS}${playerIdToken}`;
    try {
        const res = await fetch(plUrl, { method: 'GET' });
        if (res.ok) {
            const body = (await res.json()) as { playlists?: PlaylistRecord[] };
            const playlists = body.playlists ?? [];
            const json = JSON.stringify(playlists);
            if (json !== lastSentPlaylistsJson) {
                log('info', `cloud playlists: ${playlists.length} (changed)`);
                lastSentPlaylistsJson = json;
                parentPort?.postMessage({ type: 'cloudPlaylists', playlists } satisfies CloudPollOutMessage);
            }
        } else {
            log('warn', `playlists HTTP ${res.status}`);
        }
    } catch (e) {
        log('warn', `playlists fetch error: ${(e as Error).message}`);
    }

    const schUrl = `${cloudUrl}${CLOUD_API_ENDPOINTS.EZP_GET_SCHEDULE}${playerIdToken}`;
    try {
        const res = await fetch(schUrl, { method: 'GET' });
        if (res.ok) {
            const body = (await res.json()) as { schedule?: ScheduledPlaylist[] };
            const schedule = body.schedule ?? [];
            const json = JSON.stringify(schedule);
            if (json !== lastSentScheduleJson) {
                log('info', `cloud schedule: ${schedule.length} (changed)`);
                lastSentScheduleJson = json;
                parentPort?.postMessage({ type: 'cloudSchedule', schedule } satisfies CloudPollOutMessage);
            }
        } else {
            log('warn', `schedule HTTP ${res.status}`);
        }
    } catch (e) {
        log('warn', `schedule fetch error: ${(e as Error).message}`);
    }
}

/** Cloud-managed player settings — three groups + their `*_updated` stamps.
 *  Polled on the manifest tick alongside playlists/schedule; the parent does
 *  the per-group last-write-wins. Change-detected so an unchanged poll is
 *  silent. Errors are non-fatal (mirrors fetchPlaylistsAndSchedule). */
async function fetchPlayerSettings() {
    if (!cloudUrl || !playerIdToken) return;
    const url = `${cloudUrl}${CLOUD_API_ENDPOINTS.EZP_GET_SETTINGS}${playerIdToken}`;
    try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            log('warn', `settings HTTP ${res.status}`);
            return;
        }
        const settings = (await res.json()) as CloudPlayerSettings;
        const json = JSON.stringify(settings);
        if (json !== lastSentSettingsJson) {
            log('info', `cloud settings (changed) show_name=${settings.show_name ?? '(missing)'}`);
            lastSentSettingsJson = json;
            parentPort?.postMessage({ type: 'cloudSettings', settings } satisfies CloudPollOutMessage);
        }
    } catch (e) {
        log('warn', `settings fetch error: ${(e as Error).message}`);
    }
}

function findExisting(id: string): SequenceRecord | undefined {
    return existingSequences.find((s) => s.id === id);
}

function needsDownload(
    existing: SequenceRecord | undefined,
    kind: CloudFileKind,
    file_id?: string,
    file_time?: number,
): boolean {
    if (!file_id) return false;
    // In-session map covers the partial-install case where some files of a sequence
    // landed but the sequence as a whole hasn't been emitted yet. Compound key forces
    // a fresh download when file_time has bumped even if the id is unchanged.
    const knownPath = installedFiles.get(fileKey(file_id, file_time));
    if (knownPath && fs.existsSync(knownPath)) return false;
    const cur = existing?.cloud?.[kind];
    if (!cur) return true;
    return cur.file_id !== file_id || cur.file_time !== file_time;
}

function seedInstalledFiles() {
    installedFiles.clear();
    for (const s of existingSequences) {
        if (s.cloud?.fseq?.file_id && s.files?.fseq) {
            installedFiles.set(fileKey(s.cloud.fseq.file_id, s.cloud.fseq.file_time), s.files.fseq);
        }
        if (s.cloud?.audio?.file_id && s.files?.audio) {
            installedFiles.set(fileKey(s.cloud.audio.file_id, s.cloud.audio.file_time), s.files.audio);
        }
        if (s.cloud?.thumb?.file_id && s.files?.thumb) {
            installedFiles.set(fileKey(s.cloud.thumb.file_id, s.cloud.thumb.file_time), s.files.thumb);
        }
    }
}

/** Record that a single file landed successfully so a sibling failure in the same
 *  sequence won't cause us to re-fetch this one on the next manifest tick. */
function recordPartialInstall(
    entry: CloudSeqManifestEntry,
    kind: CloudFileKind,
    file_id: string,
    file_time: number | undefined,
    absPath: string,
) {
    installedFiles.set(fileKey(file_id, file_time), absPath);
    let rec = existingSequences.find((s) => s.id === entry.id);
    if (!rec) {
        rec = {
            instanceId: randomUUID(),
            id: entry.id,
            work: {
                title: entry.title || '',
                artist: entry.artist || '',
                length: entry.duration_ms ? entry.duration_ms / 1000 : 0,
            },
            files: {},
            cloud: {},
        };
        existingSequences.push(rec);
    }
    if (!rec.cloud) rec.cloud = {};
    if (!rec.files) rec.files = {};
    rec.cloud[kind] = { file_id, file_time: file_time ?? 0 };
    rec.files[kind] = absPath;
}

/** Strip URL-encoding then replace Windows-illegal path chars. Used for any string
 *  that becomes a filename or directory component on disk. */
function sanitizePathComponent(s: string): string {
    let v = s;
    try {
        v = decodeURIComponent(v);
    } catch {
        /* fall through with raw */
    }
    // Windows-illegal: < > : " | ? * \ /  plus control chars
    v = v.replace(/[<>:"|?*\\/\x00-\x1f]/g, '_');
    if (v.length > 180) v = v.slice(0, 180);
    return v || 'file';
}

/** Sniff a few magic-byte signatures so we can correct extensions when the cloud
 *  hands back a misleading filename (e.g. an mp3 served as `.zip`). Returns the
 *  detected extension or undefined when nothing matched. */
function sniffExt(buf: Buffer): string | undefined {
    if (buf.length < 4) return undefined;
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return '.mp3'; // ID3
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return '.mp3'; // mp3 frame sync
    if (
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf.length >= 12 &&
        buf[8] === 0x57 &&
        buf[9] === 0x41 &&
        buf[10] === 0x56 &&
        buf[11] === 0x45
    ) {
        return '.wav';
    }
    if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return '.ogg';
    if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
        return '.m4a';
    }
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return '.zip';
    return undefined;
}

function replaceExt(name: string, newExt: string): string {
    const i = name.lastIndexOf('.');
    if (i <= 0) return name + newExt;
    return name.slice(0, i) + newExt;
}

async function reconcileManifest(manifest: CloudSeqManifestEntry[]) {
    // -------- Skeleton phase: publish the full job up front so the UI lands
    // on the final shape immediately and only state transitions during work. --------
    const newSequences: Record<string, CloudSequenceProgress> = {};
    const newFiles: Record<string, CloudFileEntry> = {};
    const perEntryPending = new Map<string, PendingFile[]>();

    for (const entry of manifest) {
        const existing = findExisting(entry.id);
        const fileIds: string[] = [];
        const pending: PendingFile[] = [];

        if (entry.status === 'disabled') {
            const record = buildDisabledSequenceRecord(entry, existing);
            post({ type: 'installSequence', record });
            const idx = existingSequences.findIndex((s) => s.id === record.id);
            if (idx >= 0) existingSequences[idx] = record;
            else existingSequences.push(record);
            newSequences[entry.vseq_id] = {
                vseq_id: entry.vseq_id,
                title: entry.title || '',
                artist: entry.artist || '',
                vendor: entry.vendor,
                fileIds: [],
                disabled: true,
            };
            perEntryPending.set(entry.id, []);
            continue;
        }

        const seedFile = (
            kind: CloudFileKind,
            file_id: string,
            file_time: number | undefined,
            pf: PendingFile | undefined,
        ) => {
            fileIds.push(file_id);
            // installedFiles is keyed by `${file_id}|${file_time}` — a bare-id lookup
            // would never hit, leaving previously-installed files reported as 'known'
            // every cold start.
            const key = fileKey(file_id, file_time);
            const knownPath = installedFiles.get(key);
            const alreadyInstalled = !!knownPath && fs.existsSync(knownPath);
            const filename = knownPath ? path.basename(knownPath) : undefined;
            newFiles[file_id] = {
                vseq_id: entry.vseq_id,
                kind,
                file_id,
                file_time,
                filename,
                status: alreadyInstalled ? 'installed' : 'known',
            };
            if (!alreadyInstalled && pf) pending.push(pf);
        };

        if (entry.fseq) {
            const need = needsDownload(existing, 'fseq', entry.fseq.file_id, entry.fseq.file_time);
            seedFile(
                'fseq',
                entry.fseq.file_id,
                entry.fseq.file_time,
                need
                    ? {
                          kind: 'fseq',
                          file_id: entry.fseq.file_id,
                          file_time: entry.fseq.file_time,
                          fetchVia: 'seqfile',
                      }
                    : undefined,
            );
        }
        if (entry.audio) {
            const need = needsDownload(existing, 'audio', entry.audio.file_id, entry.audio.file_time);
            seedFile(
                'audio',
                entry.audio.file_id,
                entry.audio.file_time,
                need
                    ? {
                          kind: 'audio',
                          file_id: entry.audio.file_id,
                          file_time: entry.audio.file_time,
                          fetchVia: 'mediafile',
                      }
                    : undefined,
            );
        }
        if (entry.thumb) {
            const cur = existing?.cloud?.thumb?.file_id;
            const need = cur !== entry.thumb;
            seedFile(
                'thumb',
                entry.thumb,
                undefined,
                need
                    ? {
                          kind: 'thumb',
                          file_id: entry.thumb,
                          fetchVia: 'directUrl',
                          directUrl: entry.thumb,
                      }
                    : undefined,
            );
        }

        newSequences[entry.vseq_id] = {
            vseq_id: entry.vseq_id,
            title: entry.title || '',
            artist: entry.artist || '',
            vendor: entry.vendor,
            fileIds,
        };
        perEntryPending.set(entry.id, pending);
    }

    // Replace the published views in one shot (drops sequences the cloud removed).
    cStatus.sequences = newSequences;
    cStatus.files = newFiles;
    pushCStatus();

    // -------- Work phase: download what's needed, sequence by sequence. --------
    let allOk = true;
    for (const entry of manifest) {
        if (!canRun()) return;
        const existing = findExisting(entry.id);
        const pending = perEntryPending.get(entry.id) ?? [];
        if (pending.length === 0) continue;

        const result = await downloadSet(entry, pending);
        if (!result.ok) { allOk = false; continue; }

        const record = await buildSequenceRecord(entry, existing, result.installed);
        post({ type: 'installSequence', record });

        const idx = existingSequences.findIndex((s) => s.id === record.id);
        if (idx >= 0) {
            existingSequences[idx] = record;
        } else {
            existingSequences.push(record);
        }

        for (const kind of ['fseq', 'audio', 'thumb'] as const) {
            const ins = result.installed[kind];
            if (ins) {
                setFile(ins.file_id, {
                    vseq_id: entry.vseq_id,
                    kind,
                    file_id: ins.file_id,
                    file_time: ins.file_time,
                    status: 'installed',
                    filename: path.basename(ins.absPath),
                });
            }
        }
    }
    // We're "synced through" only when every entry the manifest listed is
    // installed locally — either there was nothing pending (already on disk)
    // or every pending download succeeded this pass. A single failure leaves
    // lastContentSyncAt unchanged; the next manifest tick gets another shot.
    if (allOk) lastContentSyncAt = Date.now();
}

interface DownloadResult {
    ok: boolean;
    installed: Partial<Record<CloudFileKind, { absPath: string; file_id: string; file_time?: number }>>;
}

async function downloadSet(entry: CloudSeqManifestEntry, pending: PendingFile[]): Promise<DownloadResult> {
    const installed: DownloadResult['installed'] = {};
    for (const pf of pending) {
        if (!canRun()) return { ok: false, installed };
        try {
            const absPath = await downloadOne(entry, pf);
            installed[pf.kind] = { absPath, file_id: pf.file_id, file_time: pf.file_time };
        } catch (e) {
            const err = e as Error;
            log('warn', `download ${pf.kind} ${pf.file_id} failed: ${err.message}`);
            setFile(pf.file_id, {
                vseq_id: entry.vseq_id,
                kind: pf.kind,
                file_id: pf.file_id,
                file_time: pf.file_time,
                status: 'error',
                error: err.message,
            });
            // Thumbs are decorative — don't let stale URLs trip the
            // breaker before fseq/audio get a chance.
            if (pf.kind !== 'thumb') {
                recordFailure(`download ${pf.kind}: ${err.message}`);
            }
            return { ok: false, installed };
        }
    }
    return { ok: true, installed };
}

async function downloadOne(entry: CloudSeqManifestEntry, pf: PendingFile): Promise<string> {
    setFile(pf.file_id, {
        vseq_id: entry.vseq_id,
        kind: pf.kind,
        file_id: pf.file_id,
        file_time: pf.file_time,
        status: 'downloading',
    });

    let downloadUrl: string;
    let suggestedFilename: string | undefined;

    if (pf.fetchVia === 'directUrl') {
        downloadUrl = pf.directUrl!;
    } else {
        const endpoint =
            pf.fetchVia === 'seqfile' ? CLOUD_API_ENDPOINTS.EZP_GET_SEQ_FILE : CLOUD_API_ENDPOINTS.EZP_GET_MEDIA_FILE;
        const ticketUrl = `${cloudUrl}${endpoint}${playerIdToken}/${pf.file_id}`;
        const res = await fetchWithTimeout(ticketUrl, downloadTimeoutMs);
        if (!res.ok) throw new Error(`ticket HTTP ${res.status}`);
        const body = (await res.json()) as { url?: string; filename?: string };
        if (!body.url) throw new Error('ticket missing url');
        downloadUrl = body.url;
        suggestedFilename = body.filename;
    }

    // Stage under .ezplayer/cloud/<vseq_id>/, then promote to show folder root. Every
    // path component runs through sanitizePathComponent so URL-encoded characters and
    // Windows-illegal chars (`:` etc.) don't escape into directory traversal or rename
    // failures.
    const safeVseq = sanitizePathComponent(entry.vseq_id);
    const stageDir = path.join(showFolder, '.ezplayer', 'cloud', safeVseq);
    await fsp.mkdir(stageDir, { recursive: true });

    const rawFilename = suggestedFilename ?? deriveFilenameFromUrl(downloadUrl, pf.kind, entry);
    const safeFid = sanitizePathComponent(pf.file_id);
    const safeName = sanitizePathComponent(rawFilename);
    const stagePart = path.join(stageDir, `${safeFid}__${safeName}.part`);
    const stageFinal = path.join(stageDir, `${safeFid}__${safeName}`);

    const dlRes = await fetchWithTimeout(downloadUrl, downloadTimeoutMs);
    if (!dlRes.ok || !dlRes.body) throw new Error(`download HTTP ${dlRes.status}`);

    const totalBytes = Number(dlRes.headers.get('content-length') ?? 0) || undefined;
    setFile(pf.file_id, {
        vseq_id: entry.vseq_id,
        kind: pf.kind,
        file_id: pf.file_id,
        file_time: pf.file_time,
        status: 'downloading',
        totalBytes,
        bytes: 0,
    });

    // Live progress: count bytes through a Transform so the UI can show a percentage.
    // Three gates control IPC traffic — the first satisfied wins:
    //   * MIN 250 ms since last emit  (never more than 4 updates/sec — debounce)
    //   * 1 MB of new bytes           (steady-state size gate on fast links)
    //   * 1 s since last emit         (heartbeat so slow links still tick)
    // The 250 ms floor is a hard ceiling on update rate; the other two gates only
    // *raise* it.
    const PROGRESS_MIN_INTERVAL_MS = 250;
    const PROGRESS_MAX_INTERVAL_MS = 1000;
    const PROGRESS_BYTE_TRIGGER = 1024 * 1024;

    let bytes = 0;
    let lastEmit = 0;
    let lastEmitBytes = 0;
    const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
            bytes += chunk.length;
            const now = Date.now();
            const sinceLast = now - lastEmit;
            if (sinceLast < PROGRESS_MIN_INTERVAL_MS) {
                return cb(null, chunk);
            }
            const bytesGate = bytes - lastEmitBytes >= PROGRESS_BYTE_TRIGGER;
            const heartbeat = sinceLast >= PROGRESS_MAX_INTERVAL_MS;
            if (bytesGate || heartbeat) {
                lastEmit = now;
                lastEmitBytes = bytes;
                setFile(pf.file_id, {
                    vseq_id: entry.vseq_id,
                    kind: pf.kind,
                    file_id: pf.file_id,
                    file_time: pf.file_time,
                    status: 'downloading',
                    totalBytes,
                    bytes,
                });
            }
            cb(null, chunk);
        },
    });

    await pipeline(Readable.fromWeb(dlRes.body as never), counter, fs.createWriteStream(stagePart));
    await fsp.rename(stagePart, stageFinal);

    // Sniff the staged file's magic bytes. If the cloud handed back a wrong extension
    // (we've seen mp3 audio served as `.zip`), correct the active filename's extension.
    let correctedName = safeName;
    if (pf.kind === 'audio') {
        try {
            const fd = await fsp.open(stageFinal, 'r');
            try {
                const head = Buffer.alloc(16);
                await fd.read(head, 0, 16, 0);
                const detected = sniffExt(head);
                if (detected && detected !== '.zip') {
                    const curExt = path.extname(safeName).toLowerCase();
                    if (curExt !== detected) {
                        log(
                            'warn',
                            `audio header sniff: cloud said ${curExt || '(none)'} but bytes look like ${detected} — correcting`,
                        );
                        correctedName = replaceExt(safeName, detected);
                    }
                }
            } finally {
                await fd.close();
            }
        } catch (e) {
            log('warn', `audio header sniff failed: ${(e as Error).message}`);
        }
    }

    // Promote: copy/move into show folder root with a stable filename.
    const activeName = activeFilenameForKind(pf.kind, entry, correctedName, pf.file_time);
    const activePath = path.join(showFolder, activeName);
    try {
        await fsp.rename(stageFinal, activePath);
    } catch {
        await fsp.copyFile(stageFinal, activePath);
        await fsp.unlink(stageFinal).catch(() => {});
    }

    setFile(pf.file_id, {
        vseq_id: entry.vseq_id,
        kind: pf.kind,
        file_id: pf.file_id,
        file_time: pf.file_time,
        status: 'staged',
        filename: activeName,
        totalBytes: totalBytes ?? bytes,
        bytes,
    });

    recordSuccess();
    recordPartialInstall(entry, pf.kind, pf.file_id, pf.file_time, activePath);
    return activePath;
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    // Chain the global abort so a pause/setConfig kills in-flight requests and streams.
    const onGlobalAbort = () => ac.abort();
    globalAbort.signal.addEventListener('abort', onGlobalAbort, { once: true });
    try {
        return await fetch(url, { ...(init ?? {}), signal: ac.signal });
    } finally {
        clearTimeout(t);
        globalAbort.signal.removeEventListener('abort', onGlobalAbort);
    }
}

/** Wrap an error-checked HTTP response so failures include the body for debug. */
async function expectOk(res: Response, label: string): Promise<Response> {
    if (res.ok) return res;
    const body = await res.text().catch(() => '');
    throw new Error(`${label} HTTP ${res.status}${body ? ': ' + body.slice(0, 300) : ''}`);
}

function deriveFilenameFromUrl(url: string, kind: CloudFileKind, entry: CloudSeqManifestEntry): string {
    try {
        const u = new URL(url);
        const last = u.pathname.split('/').pop() ?? '';
        if (last) return last;
    } catch {
        /* fall through */
    }
    const safeTitle = (entry.title || entry.vseq_id).replace(/[^a-z0-9._-]/gi, '_');
    const ext = kind === 'fseq' ? '.fseq' : kind === 'audio' ? '.mp3' : '.png';
    return `${safeTitle}${ext}`;
}

function activeFilenameForKind(
    kind: CloudFileKind,
    entry: CloudSeqManifestEntry,
    fallback: string,
    file_time?: number,
): string {
    // Active file lives in show folder root with a name keyed by vseq_id PLUS file_time.
    // The version suffix means a new install never overwrites a file that's currently
    // being read by playback — it lands at a new path; the old file is orphaned and
    // cleaned up later by the gc sweep when the player is idle.
    // Thumbs aren't streamed by playback, so they keep an unversioned filename for
    // simpler URL stability on the renderer side.
    const ext = inferExt(fallback) ?? defaultExt(kind);
    const base = sanitize(`${entry.title || entry.vseq_id}__${entry.vseq_id}`);
    const versionSuffix = kind !== 'thumb' && file_time ? `__${file_time}` : '';
    return `${base}${versionSuffix}${ext}`;
}

function inferExt(filename: string): string | undefined {
    const i = filename.lastIndexOf('.');
    if (i <= 0) return undefined;
    return filename.slice(i);
}

function defaultExt(kind: CloudFileKind): string {
    if (kind === 'fseq') return '.fseq';
    if (kind === 'audio') return '.mp3';
    return '.png';
}

function sanitize(s: string): string {
    return s.replace(/[^a-z0-9._-]/gi, '_');
}

/** Cleared `cloud` so a future re-enable doesn't short-circuit `needsDownload`
 *  when the file has since been reaped. */
function buildDisabledSequenceRecord(
    entry: CloudSeqManifestEntry,
    existing: SequenceRecord | undefined,
): SequenceRecord {
    return {
        ...(existing ?? { instanceId: randomUUID(), id: entry.id, work: { title: '', artist: '', length: 0 } }),
        id: entry.id,
        work: {
            ...(existing?.work ?? { title: '', artist: '', length: 0 }),
            title: entry.title ?? existing?.work?.title ?? '',
            artist: entry.artist ?? existing?.work?.artist ?? '',
        },
        files: {},
        cloud: undefined,
        render_enabled: false,
        updatedAt: Date.now(),
    };
}

async function buildSequenceRecord(
    entry: CloudSeqManifestEntry,
    existing: SequenceRecord | undefined,
    installed: DownloadResult['installed'],
): Promise<SequenceRecord> {
    let length = existing?.work?.length ?? (entry.duration_ms ? entry.duration_ms / 1000 : 0);
    // The cloud sometimes hasn't computed the song length yet (duration_ms 0/missing),
    // and the sequence manager can bypass setting it entirely. A length of 0 makes the
    // schedule end the slot almost immediately — the song plays ~1s then stops until a
    // restart (where FileStorage recomputes length from the fseq header). Derive it from
    // the freshly-downloaded fseq here so the very first play is correct too.
    if (!length || length <= 0) {
        const fseqPath = installed.fseq?.absPath ?? existing?.files?.fseq;
        if (fseqPath) {
            try {
                const fhdr = await FSEQReaderAsync.readFSEQHeaderAsync(fseqPath);
                length = (fhdr.frames * fhdr.msperframe) / 1000;
            } catch (e) {
                log('warn', `fseq length compute failed for ${fseqPath}: ${(e as Error).message}`);
            }
        }
    }
    const next: SequenceRecord = {
        ...(existing ?? { instanceId: randomUUID(), id: entry.id, work: { title: '', artist: '', length: 0 } }),
        id: entry.id,
        work: {
            ...(existing?.work ?? { title: '', artist: '', length: 0 }),
            title: entry.title ?? existing?.work?.title ?? '',
            artist: entry.artist ?? existing?.work?.artist ?? '',
            length,
        },
        files: {
            ...(existing?.files ?? {}),
            ...(installed.fseq ? { fseq: installed.fseq.absPath } : {}),
            ...(installed.audio ? { audio: installed.audio.absPath } : {}),
            ...(installed.thumb ? { thumb: installed.thumb.absPath } : {}),
        },
        cloud: {
            ...(existing?.cloud ?? {}),
            ...(installed.fseq
                ? { fseq: { file_id: installed.fseq.file_id, file_time: installed.fseq.file_time ?? 0 } }
                : entry.fseq
                  ? { fseq: { file_id: entry.fseq.file_id, file_time: entry.fseq.file_time } }
                  : {}),
            ...(installed.audio
                ? { audio: { file_id: installed.audio.file_id, file_time: installed.audio.file_time ?? 0 } }
                : entry.audio
                  ? { audio: { file_id: entry.audio.file_id, file_time: entry.audio.file_time } }
                  : {}),
            ...(installed.thumb
                ? { thumb: { file_id: installed.thumb.file_id, file_time: 0 } }
                : entry.thumb
                  ? { thumb: { file_id: entry.thumb, file_time: 0 } }
                  : {}),
        },
        updatedAt: Date.now(),
    };
    return next;
}

// -- layout fetch -------------------------------------------------------------

function setLayout(info: Partial<import('@ezplayer/ezplayer-core').CloudLayoutInfo>) {
    cStatus.layout = { status: 'idle', ...(cStatus.layout ?? {}), ...info };
    pushCStatus();
}

interface LayoutEntry {
    url: string;
    filename: string;
    file_id: string;
    file_time: number;
}
interface LayoutManifest {
    zip?: LayoutEntry;
    rgbeffects?: LayoutEntry;
    networks?: LayoutEntry;
}

let layoutInFlight = false;
let layoutUploadInFlight = false;

/** Global abort, fired when the worker transitions to disabled (cloud paused / config
 *  cleared). Live transfers using fetchWithTimeout abort their streams immediately
 *  rather than running to completion after a Pause click. */
let globalAbort = new AbortController();
function abortAllAndReset() {
    try {
        globalAbort.abort();
    } catch {
        /* ignore */
    }
    globalAbort = new AbortController();
}

/** Manual / on-demand layout fetch. Hits getlatestlayout, downloads zip if present
 *  (and unpacks it into the show folder root), then writes rgbeffects and networks
 *  XMLs on top when their file_time is newer than the zip's. */
async function fetchLayout(): Promise<void> {
    if (layoutInFlight) {
        log('info', 'fetchLayout skipped: already in flight');
        return;
    }
    if (!showFolder) {
        log('warn', 'fetchLayout skipped: no showFolder');
        return;
    }
    if (!cloudUrl || !playerIdToken) {
        log('warn', 'fetchLayout skipped: cloudUrl or playerIdToken empty');
        return;
    }
    layoutInFlight = true;
    setLayout({ status: 'fetching', error: undefined, bytes: undefined, totalBytes: undefined });
    try {
        const url = `${cloudUrl}${CLOUD_API_ENDPOINTS.EZP_GET_LATEST_LAYOUT}${playerIdToken}`;
        log('info', `layout manifest ${url}`);
        const res = await fetchWithTimeout(url, downloadTimeoutMs);
        if (!res.ok) {
            setLayout({ status: 'error', error: `HTTP ${res.status}` });
            return;
        }
        const body = (await res.json()) as LayoutManifest;
        if (!body.zip && !body.rgbeffects && !body.networks) {
            log('info', 'layout manifest empty');
            setLayout({ status: 'noLayout' });
            return;
        }

        // Staleness check: skip downloads when our persisted layoutMeta already
        // matches the manifest. Match on BOTH file_id and file_time (the cloud may
        // reuse an id with a fresh file_time when content updates).
        const matches = (
            cur: { file_id: string; file_time: number } | undefined,
            cloud: { file_id: string; file_time: number } | undefined,
        ): boolean => {
            if (!cur && !cloud) return true;
            if (!cur || !cloud) return false;
            return cur.file_id === cloud.file_id && cur.file_time === cloud.file_time;
        };
        if (
            matches(layoutMeta.zip, body.zip) &&
            matches(layoutMeta.rgbeffects, body.rgbeffects) &&
            matches(layoutMeta.networks, body.networks)
        ) {
            log('info', 'layout already up to date');
            setLayout({
                status: 'done',
                direction: 'download',
                lastFetchedAt: layoutMeta.lastFetchedAt,
                error: undefined,
            });
            lastLayoutSyncAt = Date.now();
            return;
        }

        // 1) zip first (if present and changed): download + unpack into show folder root.
        // A malformed zip (no folder with both xLights XMLs) is treated as "no zip
        // extracted" — we keep zipFileTime at -Infinity so the XML overlay step
        // unconditionally writes whatever the cloud sent.
        let zipFileTime = -Infinity;
        let zipExtracted = false;
        if (body.zip && !matches(layoutMeta.zip, body.zip)) {
            try {
                await downloadAndUnpackZip(body.zip);
                zipFileTime = body.zip.file_time;
                zipExtracted = true;
            } catch (e) {
                log('warn', `layout zip skipped: ${(e as Error).message}`);
            }
        } else if (body.zip) {
            // zip up to date but its time gates the XML overlay decision
            zipFileTime = body.zip.file_time;
        }

        // 2) overlay rgbeffects if newer than zip (or no zip), and only if changed.
        if (
            body.rgbeffects &&
            body.rgbeffects.file_time > zipFileTime &&
            !matches(layoutMeta.rgbeffects, body.rgbeffects)
        ) {
            await downloadXmlOverlay(body.rgbeffects, 'xlights_rgbeffects.xml');
        }
        if (body.networks && body.networks.file_time > zipFileTime && !matches(layoutMeta.networks, body.networks)) {
            await downloadXmlOverlay(body.networks, 'xlights_networks.xml');
        }

        const newMeta: NonNullable<CloudConfig['layoutMeta']> = {
            zip: body.zip ?? layoutMeta.zip,
            rgbeffects: body.rgbeffects ?? layoutMeta.rgbeffects,
            networks: body.networks ?? layoutMeta.networks,
            lastFetchedAt: Date.now(),
        };
        layoutMeta = newMeta;

        setLayout({
            status: 'done',
            direction: 'download',
            lastFetchedAt: newMeta.lastFetchedAt,
            error: undefined,
        });
        lastLayoutSyncAt = Date.now();
        log('info', `layout fetch complete (zipExtracted=${zipExtracted})`);
        post({ type: 'layoutInstalled', layoutMeta: newMeta });
    } catch (e) {
        const err = e as Error;
        log('warn', `layout fetch error: ${err.message}`);
        setLayout({ status: 'error', error: err.message });
    } finally {
        layoutInFlight = false;
    }
}

async function downloadAndUnpackZip(entry: LayoutEntry): Promise<void> {
    const stageDir = path.join(showFolder, '.ezplayer', 'cloud', 'layout');
    await fsp.mkdir(stageDir, { recursive: true });
    const stagePart = path.join(stageDir, `${entry.file_id}.zip.part`);
    const stageFinal = path.join(stageDir, `${entry.file_id}.zip`);

    setLayout({ status: 'fetching' });
    const dl = await fetchWithTimeout(entry.url, downloadTimeoutMs);
    if (!dl.ok || !dl.body) throw new Error(`zip download HTTP ${dl.status}`);
    const totalBytes = Number(dl.headers.get('content-length') ?? 0) || undefined;
    setLayout({ status: 'fetching', bytes: 0, totalBytes });

    let bytes = 0;
    let lastEmit = 0;
    let lastEmitBytes = 0;
    const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
            bytes += chunk.length;
            const now = Date.now();
            if (now - lastEmit >= 250 && (bytes - lastEmitBytes >= 1024 * 1024 || now - lastEmit >= 1000)) {
                lastEmit = now;
                lastEmitBytes = bytes;
                setLayout({ status: 'fetching', bytes, totalBytes });
            }
            cb(null, chunk);
        },
    });
    await pipeline(Readable.fromWeb(dl.body as never), counter, fs.createWriteStream(stagePart));
    await fsp.rename(stagePart, stageFinal);

    setLayout({ status: 'unpacking' });
    // Lazy-load JSZip so the worker startup cost is avoided when no layout fetch runs.
    const JSZip = (await import('jszip')).default;
    const zipBuf = await fsp.readFile(stageFinal);
    const z = await JSZip.loadAsync(zipBuf);
    const entries = Object.values(z.files);

    // Layout zips often have a wrapping folder (or two). Find the directory inside the
    // zip that holds BOTH xlights_rgbeffects.xml and xlights_networks.xml as immediate
    // children — that's the show-folder root. Pick the shallowest match. Anything
    // outside that subtree is dropped; everything inside is written into the show
    // folder root with the prefix stripped. If no directory qualifies, the zip is
    // considered malformed and we throw — the caller treats that as "no zip extracted"
    // and proceeds to the XML overlay step.
    const root = findLayoutRoot(entries);
    if (root === undefined) {
        throw new Error('zip lacks a folder containing xlights_rgbeffects.xml + xlights_networks.xml');
    }
    log('info', `unpacking layout zip from root "${root || '(top level)'}" (${entries.length} entries)`);
    let written = 0;
    for (const f of entries) {
        if (f.dir) continue;
        const name = f.name.replace(/\\/g, '/');
        if (!name.startsWith(root)) continue;
        const rel = name.slice(root.length);
        if (!rel) continue;
        if (rel.includes('..') || path.isAbsolute(rel)) {
            log('warn', `skipping unsafe zip entry: ${name}`);
            continue;
        }
        const out = path.join(showFolder, rel);
        await fsp.mkdir(path.dirname(out), { recursive: true });
        const content = await f.async('nodebuffer');
        await fsp.writeFile(out, content);
        written += 1;
    }
    log('info', `wrote ${written} entries from layout zip`);
}

/** Find the shallowest directory inside the zip whose immediate children include
 *  both `xlights_rgbeffects.xml` and `xlights_networks.xml`. Returns the directory's
 *  path WITH a trailing slash (or `''` for the zip's top level), or `undefined` if
 *  no qualifying directory exists. */
function findLayoutRoot(entries: { name: string; dir: boolean }[]): string | undefined {
    const childrenByDir = new Map<string, Set<string>>();
    for (const f of entries) {
        if (f.dir) continue;
        const name = f.name.replace(/\\/g, '/');
        const slash = name.lastIndexOf('/');
        const dir = slash >= 0 ? name.slice(0, slash + 1) : '';
        const file = slash >= 0 ? name.slice(slash + 1) : name;
        let s = childrenByDir.get(dir);
        if (!s) {
            s = new Set();
            childrenByDir.set(dir, s);
        }
        s.add(file);
    }
    const candidates: string[] = [];
    for (const [dir, files] of childrenByDir) {
        if (files.has('xlights_rgbeffects.xml') && files.has('xlights_networks.xml')) {
            candidates.push(dir);
        }
    }
    if (candidates.length === 0) return undefined;
    // Shallowest first (fewest path segments → outermost directory).
    candidates.sort((a, b) => a.split('/').length - b.split('/').length);
    return candidates[0];
}

async function downloadXmlOverlay(entry: LayoutEntry, targetName: string): Promise<void> {
    setLayout({ status: 'fetching' });
    const dl = await fetchWithTimeout(entry.url, downloadTimeoutMs);
    if (!dl.ok || !dl.body) throw new Error(`${targetName} download HTTP ${dl.status}`);
    const totalBytes = Number(dl.headers.get('content-length') ?? 0) || undefined;
    setLayout({ status: 'fetching', bytes: 0, totalBytes });

    const stageDir = path.join(showFolder, '.ezplayer', 'cloud', 'layout');
    await fsp.mkdir(stageDir, { recursive: true });
    const stagePart = path.join(stageDir, `${entry.file_id}__${targetName}.part`);
    await pipeline(Readable.fromWeb(dl.body as never), fs.createWriteStream(stagePart));
    const target = path.join(showFolder, targetName);
    try {
        await fsp.rename(stagePart, target);
    } catch {
        await fsp.copyFile(stagePart, target);
        await fsp.unlink(stagePart).catch(() => {});
    }
    log('info', `wrote ${targetName} (file_id=${entry.file_id})`);
}

// -- layout upload ------------------------------------------------------------

interface PresignedPost {
    /** Presigned PUT URL the client uploads the file body to. */
    url: string;
    /** Always empty in current responses; reserved for future use. */
    fields?: Record<string, string>;
}

interface StartUploadResponse {
    post: PresignedPost;
    rec: { file_id: string; file_time: string | number };
}

/** Layout upload. Reads xlights_rgbeffects.xml + xlights_networks.xml from the
 *  show folder root, bundles any referenced assets that live inside the show
 *  folder, zips the lot, and uploads via the cloud's start → presigned PUT →
 *  done handshake. */
async function uploadLayout(): Promise<void> {
    if (layoutUploadInFlight) {
        log('info', 'uploadLayout skipped: already in flight');
        return;
    }
    if (layoutInFlight) {
        log('warn', 'uploadLayout skipped: layout download in progress');
        return;
    }
    if (!showFolder) {
        log('warn', 'uploadLayout skipped: no showFolder');
        return;
    }
    if (!cloudUrl || !playerIdToken) {
        log('warn', 'uploadLayout skipped: cloudUrl or playerIdToken empty');
        return;
    }
    layoutUploadInFlight = true;
    setLayout({
        status: 'uploading',
        direction: 'upload',
        error: undefined,
        bytes: 0,
        totalBytes: undefined,
    });
    try {
        // 1) Build the zip in memory: the two xLights XMLs plus any assets they
        //    reference (mesh OBJs, textures, preview backgrounds). The collector
        //    only includes refs that exist on disk inside the show folder; out-of-
        //    folder absolute paths and URLs are skipped so the zip stays portable.
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const xmlNames = ['xlights_rgbeffects.xml', 'xlights_networks.xml'];
        for (const name of xmlNames) {
            const p = path.join(showFolder, name);
            try {
                const buf = await fsp.readFile(p);
                zip.file(name, buf);
            } catch (e) {
                throw new Error(`missing ${name}: ${(e as Error).message}`);
            }
        }
        const assetRels = await collectReferencedAssets(
            showFolder,
            xmlNames.map((n) => path.join(showFolder, n)),
        );
        log('info', `bundling ${assetRels.length} referenced asset(s)`);
        for (const rel of assetRels) {
            try {
                const buf = await fsp.readFile(path.join(showFolder, rel));
                zip.file(rel, buf);
            } catch (e) {
                log('warn', `skipping asset ${rel}: ${(e as Error).message}`);
            }
        }
        const zipAb = await zip.generateAsync({ type: 'arraybuffer' });
        log('info', `built layout zip: ${zipAb.byteLength} bytes (${assetRels.length} assets + 2 xml)`);
        setLayout({
            status: 'uploading',
            direction: 'upload',
            bytes: 0,
            totalBytes: zipAb.byteLength,
        });

        // 2) Ask the cloud for a presigned upload URL.
        const startUrl = `${cloudUrl}ezpapi/player/startuploadlayoutzip/${playerIdToken}`;
        log('info', `layout upload startupload POST ${startUrl}`);
        const startRes = await expectOk(
            await fetchWithTimeout(startUrl, downloadTimeoutMs, { method: 'POST' }),
            'startupload',
        );
        const { post, rec } = (await startRes.json()) as StartUploadResponse;
        log('info', `layout upload got presigned put (file_id=${rec.file_id}, file_time=${rec.file_time})`);

        // 3) Upload the zip body via the presigned PUT URL.
        const uploadRes = await fetch(post.url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/zip' },
            body: new Blob([zipAb]),
            signal: globalAbort.signal,
        });
        await expectOk(uploadRes, 'presigned PUT upload');
        setLayout({
            status: 'uploading',
            direction: 'upload',
            bytes: zipAb.byteLength,
            totalBytes: zipAb.byteLength,
        });

        // 4) Tell the cloud the upload finished so it can finalize + run conversion.
        // The server's contract types both file_id and file_time as `string`;
        // JSON.parse on the start response turns numeric file_time into a number,
        // which the type check then rejects. Coerce both to strings here to match.
        const doneUrl = `${cloudUrl}ezpapi/player/doneuploadlayoutzip/${playerIdToken}`;
        const donePayload = { file_id: String(rec.file_id), file_time: String(rec.file_time) };
        log('info', `layout upload doneupload POST ${doneUrl} body=${JSON.stringify(donePayload)}`);
        const doneRes = await fetchWithTimeout(doneUrl, downloadTimeoutMs, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(donePayload),
        });
        await expectOk(doneRes, 'doneupload');

        log('info', 'layout upload complete');
        setLayout({
            status: 'done',
            direction: 'upload',
            lastUploadedAt: Date.now(),
            error: undefined,
        });
    } catch (e) {
        const err = e as Error;
        log('warn', `layout upload error: ${err.message}`);
        setLayout({ status: 'error', direction: 'upload', error: err.message });
    } finally {
        layoutUploadInFlight = false;
    }
}

// -- message handling ---------------------------------------------------------

parentPort?.on('message', (msg: CloudPollInMessage) => {
    switch (msg.type) {
        case 'setConfig': {
            cloudUrl = msg.cloudUrl ?? '';
            playerIdToken = msg.playerIdToken ?? '';
            showFolder = msg.showFolder ?? '';
            existingSequences = msg.existingSequences ?? [];
            layoutMeta = msg.layoutMeta ?? {};
            layoutSource = msg.layoutSource === 'cloud' ? 'cloud' : 'xlights';
            pollMode = msg.pollMode === 'scheduled' ? 'scheduled' : 'always';
            pollSchedule = msg.pollSchedule ?? [];
            seedInstalledFiles();
            applyTuning(msg.tuning);

            // Every reconfigure is a session change (folder switch, token rotation,
            // pause/resume). Without this, the worker would keep the previous
            // session's cStatus (sequences, layout, files, lastManifestAt) in
            // its module-level singleton and the next pushCStatus would resurrect
            // the stale snapshot in the parent — even though the parent already
            // cleared its mirror. Abort in-flight transfers from the previous
            // session for the same reason: a download that started before a
            // folder switch should not silently land in the new folder.
            abortAllAndReset();
            for (const k of Object.keys(cStatus)) {
                delete (cStatus as Record<string, unknown>)[k];
            }
            cStatus.files = {};
            lastSentPlaylistsJson = undefined;
            lastSentScheduleJson = undefined;
            lastSentSettingsJson = undefined;

            cancelAutoClearTimer();
            stopped = false;
            halted = false;
            consecutiveFailures = 0;
            log(
                'info',
                `setConfig cloudUrl=${cloudUrl ? '"' + cloudUrl + '"' : '(empty)'} ` +
                    `playerIdToken=${playerIdToken ? playerIdToken.slice(0, 8) + '…' : '(empty)'} ` +
                    `showFolder="${showFolder}" reg=${registrationIntervalMs}ms manifest=${manifestIntervalMs}ms`,
            );
            // Push the now-empty cStatus so the parent (and renderer) see a
            // clean slate immediately, not on the next manifest tick.
            pushCStatus();
            rescheduleTimers();
            void electHomeServerOnce();
            void pollRegistration();
            void pollManifest();
            break;
        }
        case 'updateSequences': {
            existingSequences = msg.existingSequences ?? [];
            seedInstalledFiles();
            log('info', `updateSequences: ${existingSequences.length} records cached`);
            break;
        }
        case 'pollNow': {
            void pollRegistration();
            break;
        }
        case 'manifestNow': {
            // User-initiated sync overrides any prior auto-halt and resets the
            // failure counter — the user is explicitly asking us to try again.
            clearAutoHaltOnUserSync();
            void pollManifest();
            break;
        }
        case 'fetchLayoutNow': {
            // Same rationale as manifestNow — the user is asking; honor it.
            clearAutoHaltOnUserSync();
            void fetchLayout();
            break;
        }
        case 'uploadLayoutNow': {
            void uploadLayout();
            break;
        }
        case 'stop': {
            log('info', 'stop requested');
            stopped = true;
            clearTimers();
            break;
        }
    }
});

function applyTuning(t: CloudWorkerTuning | undefined) {
    if (!t) return;
    if (t.registrationIntervalMs && t.registrationIntervalMs > 0) {
        registrationIntervalMs = t.registrationIntervalMs;
    }
    if (t.manifestIntervalMs && t.manifestIntervalMs > 0) {
        manifestIntervalMs = t.manifestIntervalMs;
    }
    if (t.downloadTimeoutMs && t.downloadTimeoutMs > 0) {
        downloadTimeoutMs = t.downloadTimeoutMs;
    }
    if (t.failureThreshold && t.failureThreshold > 0) {
        failureThreshold = t.failureThreshold;
    }
}

log('info', 'cloud worker started');
