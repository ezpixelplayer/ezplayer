import { parentPort } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { randomUUID } from 'crypto';
import {
    CLOUD_API_ENDPOINTS,
    type CloudFileEntry,
    type CloudFileKind,
    type CloudSeqManifestEntry,
    type CloudSequenceProgress,
    type PlayerCStatusContent,
    type SequenceRecord,
} from '@ezplayer/ezplayer-core';
import type {
    CloudPollInMessage,
    CloudPollOutMessage,
    CloudWorkerTuning,
} from './cloudpolltypes';

// Aggressive demo defaults; production callers should pass conservative values.
const DEFAULT_REGISTRATION_INTERVAL_MS = 30_000;
const DEFAULT_MANIFEST_INTERVAL_MS = 60_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_FAILURE_THRESHOLD = 5;

let cloudUrl = '';
let playerIdToken = '';
let showFolder = '';
let existingSequences: SequenceRecord[] = [];

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

const cStatus: PlayerCStatusContent = { files: {} };

/** file_id -> active absPath of files we've successfully landed this session.
 *  Survives partial-sequence failures so we don't re-fetch bytes that are already on disk. */
const installedFiles = new Map<string, string>();

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
    manifestTimer = setInterval(() => void pollManifest(), manifestIntervalMs);
    if (manifestTimer.unref) manifestTimer.unref();
}

function recordFailure(reason: string) {
    consecutiveFailures += 1;
    cStatus.lastError = reason;
    if (consecutiveFailures >= failureThreshold) {
        halted = true;
        log('error', `circuit breaker tripped after ${consecutiveFailures} failures: ${reason}`);
        clearTimers();
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

// -- registration heartbeat ----------------------------------------------------

async function pollRegistration() {
    if (regInFlight || !canRun()) return;
    regInFlight = true;
    const url = `${cloudUrl}api/${CLOUD_API_ENDPOINTS.IS_PLAYER_REGISTERED}${playerIdToken}`;
    try {
        const res = await fetch(url, { method: 'GET' });
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
        const body = (await res.json()) as { registered?: boolean; version?: string };
        post({
            type: 'cloudStatus',
            status: {
                playerIdIsRegistered: !!body.registered,
                cloudVersion: body.version,
                lastCheckedAt: Date.now(),
                lastError: undefined,
            },
        });
    } catch (e) {
        const err = e as Error;
        log('warn', `registration poll error: ${err.message}`);
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
}

function findExisting(id: string): SequenceRecord | undefined {
    return existingSequences.find((s) => s.id === id);
}

function needsDownload(
    existing: SequenceRecord | undefined,
    kind: CloudFileKind,
    file_id?: string,
): boolean {
    if (!file_id) return false;
    // First check the in-session map — covers the partial-install case where some
    // files of a sequence landed but the sequence as a whole hasn't been emitted yet.
    const knownPath = installedFiles.get(file_id);
    if (knownPath && fs.existsSync(knownPath)) return false;
    const cur = existing?.cloud?.[kind];
    if (!cur) return true;
    return cur.file_id !== file_id;
}

function seedInstalledFiles() {
    installedFiles.clear();
    for (const s of existingSequences) {
        if (s.cloud?.fseq?.file_id && s.files?.fseq) {
            installedFiles.set(s.cloud.fseq.file_id, s.files.fseq);
        }
        if (s.cloud?.audio?.file_id && s.files?.audio) {
            installedFiles.set(s.cloud.audio.file_id, s.files.audio);
        }
        if (s.cloud?.thumb?.file_id && s.files?.thumb) {
            installedFiles.set(s.cloud.thumb.file_id, s.files.thumb);
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
    installedFiles.set(file_id, absPath);
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
    if (
        buf.length >= 8 &&
        buf[4] === 0x66 &&
        buf[5] === 0x74 &&
        buf[6] === 0x79 &&
        buf[7] === 0x70
    ) {
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

        const seedFile = (
            kind: CloudFileKind,
            file_id: string,
            file_time: number | undefined,
            pf: PendingFile | undefined,
        ) => {
            fileIds.push(file_id);
            const alreadyInstalled =
                installedFiles.has(file_id) && fs.existsSync(installedFiles.get(file_id)!);
            const filename = installedFiles.has(file_id)
                ? path.basename(installedFiles.get(file_id)!)
                : undefined;
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
            const need = needsDownload(existing, 'fseq', entry.fseq.file_id);
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
            const need = needsDownload(existing, 'audio', entry.audio.file_id);
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
    for (const entry of manifest) {
        if (!canRun()) return;
        const existing = findExisting(entry.id);
        const pending = perEntryPending.get(entry.id) ?? [];
        if (pending.length === 0) continue;

        const result = await downloadSet(entry, pending);
        if (!result.ok) continue;

        const record = buildSequenceRecord(entry, existing, result.installed);
        const superseded = collectSupersededPaths(existing, result.installed);
        post({ type: 'installSequence', record, superseded });

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
}

interface DownloadResult {
    ok: boolean;
    installed: Partial<Record<CloudFileKind, { absPath: string; file_id: string; file_time?: number }>>;
}

async function downloadSet(
    entry: CloudSeqManifestEntry,
    pending: PendingFile[],
): Promise<DownloadResult> {
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
            recordFailure(`download ${pf.kind}: ${err.message}`);
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
            pf.fetchVia === 'seqfile'
                ? CLOUD_API_ENDPOINTS.EZP_GET_SEQ_FILE
                : CLOUD_API_ENDPOINTS.EZP_GET_MEDIA_FILE;
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

    await pipeline(
        Readable.fromWeb(dlRes.body as never),
        counter,
        fs.createWriteStream(stagePart),
    );
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
    const activeName = activeFilenameForKind(pf.kind, entry, correctedName);
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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
        return await fetch(url, { method: 'GET', signal: ac.signal });
    } finally {
        clearTimeout(t);
    }
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
): string {
    // Active file lives in show folder root with a content-stable name keyed by vseq_id.
    // This lets the player and other tools (xLights, etc.) find files without knowing
    // about the cloud subsystem.
    const ext = inferExt(fallback) ?? defaultExt(kind);
    const base = sanitize(`${entry.title || entry.vseq_id}__${entry.vseq_id}`);
    return `${base}${ext}`;
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

function buildSequenceRecord(
    entry: CloudSeqManifestEntry,
    existing: SequenceRecord | undefined,
    installed: DownloadResult['installed'],
): SequenceRecord {
    const length =
        existing?.work?.length ?? (entry.duration_ms ? entry.duration_ms / 1000 : 0);
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

function collectSupersededPaths(
    existing: SequenceRecord | undefined,
    installed: DownloadResult['installed'],
): string[] {
    if (!existing?.files) return [];
    const out: string[] = [];
    if (installed.fseq && existing.files.fseq && existing.files.fseq !== installed.fseq.absPath) {
        out.push(existing.files.fseq);
    }
    if (
        installed.audio &&
        existing.files.audio &&
        existing.files.audio !== installed.audio.absPath
    ) {
        out.push(existing.files.audio);
    }
    if (
        installed.thumb &&
        existing.files.thumb &&
        existing.files.thumb !== installed.thumb.absPath
    ) {
        out.push(existing.files.thumb);
    }
    return out;
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

        // 1) zip first (if present): download + unpack into show folder root.
        // A malformed zip (no folder with both xLights XMLs) is treated as "no zip
        // extracted" — we keep zipFileTime at -Infinity so the XML overlay step
        // unconditionally writes whatever the cloud sent.
        let zipFileTime = -Infinity;
        if (body.zip) {
            try {
                await downloadAndUnpackZip(body.zip);
                zipFileTime = body.zip.file_time;
            } catch (e) {
                log('warn', `layout zip skipped: ${(e as Error).message}`);
            }
        }

        // 2) overlay rgbeffects if newer than zip (or no zip).
        if (body.rgbeffects && body.rgbeffects.file_time > zipFileTime) {
            await downloadXmlOverlay(body.rgbeffects, 'xlights_rgbeffects.xml');
        }
        if (body.networks && body.networks.file_time > zipFileTime) {
            await downloadXmlOverlay(body.networks, 'xlights_networks.xml');
        }

        setLayout({ status: 'done', lastFetchedAt: Date.now(), error: undefined });
        log('info', 'layout fetch complete');
        post({ type: 'layoutInstalled' });
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

// -- message handling ---------------------------------------------------------

parentPort?.on('message', (msg: CloudPollInMessage) => {
    switch (msg.type) {
        case 'setConfig': {
            cloudUrl = msg.cloudUrl ?? '';
            playerIdToken = msg.playerIdToken ?? '';
            showFolder = msg.showFolder ?? '';
            existingSequences = msg.existingSequences ?? [];
            seedInstalledFiles();
            applyTuning(msg.tuning);
            stopped = false;
            halted = false;
            consecutiveFailures = 0;
            log(
                'info',
                `setConfig cloudUrl=${cloudUrl ? '"' + cloudUrl + '"' : '(empty)'} ` +
                    `playerIdToken=${playerIdToken ? playerIdToken.slice(0, 8) + '…' : '(empty)'} ` +
                    `showFolder="${showFolder}" reg=${registrationIntervalMs}ms manifest=${manifestIntervalMs}ms`,
            );
            rescheduleTimers();
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
            void pollManifest();
            break;
        }
        case 'fetchLayoutNow': {
            void fetchLayout();
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
