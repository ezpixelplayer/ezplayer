/**
 * Show-content distribution (main process): putting this show's sequences and
 * the media they name onto the devices that need their own copy, and keeping an
 * inventory playlist of what we left there.
 *
 * The transfer engine is `@ezplayer/epp-controllers`; this module is the
 * player's side of it — which devices, which files, when, and the mapping from
 * the engine's own types to the serializable ones every UI reads. The run
 * itself lives in controller-ops.ts with the other operations, so a
 * distribution queues, cancels, and reports like a scan or an upload.
 */

import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import type {
    ContentDistItem,
    ContentDistPhase,
    ContentDistReport,
    ContentDistRun,
    ContentDistTargetProgress,
    ContentDistTargetReport,
    ContentDistTrigger,
    ContentDistributionSettings,
    ControllerContentStatus,
    ContentUploadMethod,
    DiscoveredController,
    KnownController,
    PlaybackSettings,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import { findMatchingScheduleEntry } from '@ezplayer/ezplayer-core';
import type {
    ContentMediaSource,
    ContentPlan,
    ContentSequenceSource,
    ContentSyncReport,
    ContentSyncSnapshot,
    ContentSyncTargetReport,
    ContentSyncTargetSpec,
    FseqIdentity,
    ResolvedSequence,
} from '@ezplayer/epp-controllers';
import {
    FSEQ_COMPRESSION,
    blobFromFile,
    createFppContentEndpoint,
    hostSpecificMediaCandidates,
    readFseqIdentityFromFile,
} from '@ezplayer/epp-controllers';
import type { FSEQHeader, FseqRange } from '@ezplayer/epp';
import { FSEQReaderSync, parseChannelRanges, planFseqSlice, sliceFseqFile } from '@ezplayer/epp';

/** Inventory playlist name when the setting does not say. */
export const DEFAULT_CONTENT_PLAYLIST = 'EZPlayer Content';

/** Default gap between automatic looks for work. */
export const DEFAULT_CONTENT_POLL_MINUTES = 60;

/** Media we send in phase one. Video is a project of its own — the files are
 *  far larger and matrix players want a per-host copy. */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

/** Devices that hold their own copy of a show. Only FPP today. */
export function isContentTarget(dev: DiscoveredController): boolean {
    return dev.driverType === 'FPP';
}

/** FPP's `Version` as the three numbers the upload path is chosen by. A
 *  version we cannot read leaves them 0, which picks FPP 6's path; a wrong
 *  guess costs one rejected request, since the engine then falls back. */
function versionParts(version: string | undefined): [number, number, number] {
    // The FPP driver reports 'pre-7' when it could only reach the old status
    // API. Stripping non-digits would read that as 7 and pick the chunked
    // upload the device does not have, so it is answered first.
    if (!version || version === 'pre-7') return [0, 0, 0];
    const parts = version.replace(/^[^0-9]*/, '').split(/[.\-+]/);
    const n = (i: number) => {
        const v = parseInt(parts[i] ?? '', 10);
        return Number.isFinite(v) ? v : 0;
    };
    return [n(0), n(1), n(2)];
}

/**
 * One transfer target per device, in the order the devices were given.
 * `ids` selects devices by id; without it every content target is included.
 * A device reached through an FPP proxy is addressed through that proxy, the
 * same way a status read reaches it.
 */
export function contentTargetsFor(devices: DiscoveredController[], ids?: string[]): ContentSyncTargetSpec[] {
    const wanted = ids?.length ? new Set(ids) : undefined;
    const out: ContentSyncTargetSpec[] = [];
    for (const dev of devices) {
        if (wanted ? !wanted.has(dev.id) : !isContentTarget(dev)) continue;
        // An explicitly named device that is not a content target is reported
        // rather than silently dropped, so asking has a visible answer.
        const supported = isContentTarget(dev);
        const proxy = dev.source.via === 'fpp-proxy' ? dev.source.proxy : undefined;
        const baseUrl = proxy ? `http://${proxy}/proxy/${dev.ip}` : `http://${dev.ip}`;
        const hostName = dev.hostname ?? dev.ip;
        const [major, minor, patch] = versionParts(dev.firmwareVersion);
        out.push({
            id: dev.id,
            label: dev.hostname ? `${dev.hostname} (${dev.ip})` : dev.ip,
            hostName,
            endpoint: createFppContentEndpoint({
                baseUrl,
                ip: dev.ip,
                hostName,
                majorVersion: major,
                minorVersion: minor,
                patchVersion: patch,
            }),
            ...(dev.firmwareVersion ? { version: dev.firmwareVersion } : {}),
            ...(dev.model ? { platform: dev.model } : {}),
            ...(supported
                ? {}
                : { supported: false, unsupportedReason: `${dev.driverType ?? 'device'} holds no content` }),
            ...(dev.unreachable ? { supported: false, unsupportedReason: 'not responding' } : {}),
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Slicing — a remote only needs its own channels
// ---------------------------------------------------------------------------

/** The channels one target drives, and where we learned them. */
export interface ContentSlicing {
    ranges: FseqRange[];
    source: 'device' | 'xlights';
}

/**
 * Whether this device should get a cut-down copy of each sequence, and of
 * what. Only an FPP running as a remote is sliced for: a player drives the
 * show and needs it whole. This is the rule xLights follows too.
 *
 * The device's own `channelRanges` is preferred over the xLights layout, since
 * it is the device describing what it actually drives; the layout is the
 * fallback for a build too old to report it.
 */
export function slicingFor(dev: DiscoveredController, known: KnownController[] = []): ContentSlicing | null {
    if (!isContentTarget(dev)) return null;
    if ((dev.mode ?? '').toLowerCase() !== 'remote') return null;

    const reported = parseChannelRanges(dev.channelRanges);
    if (reported.length) return { ranges: reported, source: 'device' };

    const host = dev.hostname?.toLowerCase();
    const record = known.find(
        (k) => !!k.address && (k.address === dev.ip || (!!host && k.address.toLowerCase() === host)),
    );
    if (record?.startChannel && record.channelCount) {
        // xLights counts channels from 1; a sequence's ranges count from 0.
        return {
            ranges: [{ startch: record.startChannel - 1, chcount: record.channelCount }],
            source: 'xlights',
        };
    }
    return null;
}

/** A place for the slices of one run, removed when the run is done. */
export interface SliceWorkspace {
    dir: string;
    dispose(): Promise<void>;
}

export async function createSliceWorkspace(): Promise<SliceWorkspace> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezplayer-slice-'));
    return {
        dir,
        async dispose() {
            await fsp.rm(dir, { recursive: true, force: true });
        },
    };
}

/** A file name that cannot collide between targets or sequences. */
function sliceName(targetId: string, sequenceName: string): string {
    return `${targetId.replace(/[^A-Za-z0-9._-]/g, '_')}__${sequenceName}`;
}

/** The identity a slice will have, built from the plan rather than the file. */
function slicedIdentity(source: FseqIdentity, plan: NonNullable<ReturnType<typeof planFseqSlice>>): FseqIdentity {
    const ranges = plan.ranges.map((r) => ({ start: r.startch, length: r.chcount }));
    let maxChannel = plan.stride;
    for (const r of ranges) maxChannel = Math.max(maxChannel, r.start + r.length);
    return {
        magic: source.magic,
        versionMajor: 2,
        versionMinor: 2,
        channelCount: plan.stride,
        maxChannel,
        numFrames: plan.numFrames,
        stepTimeMs: plan.stepTimeMs,
        // The writer compresses with zstd, which is what FPP will report back.
        compressionType: FSEQ_COMPRESSION.zstd,
        uniqueId: plan.uniqueId.toString(),
        ranges,
        extendedRanges: false,
        ...(plan.mediaName ? { mediaName: plan.mediaName } : {}),
    };
}

// ---------------------------------------------------------------------------
// The plan — what this show consists of
// ---------------------------------------------------------------------------

async function fileSize(file: string): Promise<number | null> {
    try {
        const st = await fsp.stat(file);
        return st.isFile() ? st.size : null;
    } catch {
        return null;
    }
}

/**
 * The media to send with a sequence. The name on the device comes from the
 * fseq's own `mf` header when it has one, so a device playing the sequence by
 * itself asks for a file that is there; the bytes come from whatever the song
 * record points at.
 */
async function mediaFor(
    record: SequenceRecord,
    headerName: string | undefined,
): Promise<{ media: ContentMediaSource; localDir: string } | null> {
    const local = record.files?.audio;
    if (!local) return null;
    if (!AUDIO_EXTENSIONS.has(path.extname(local).toLowerCase())) return null;
    const size = await fileSize(local);
    if (size === null) return null;
    const name =
        headerName && AUDIO_EXTENSIONS.has(path.extname(headerName).toLowerCase())
            ? path.basename(headerName)
            : path.basename(local);
    return { media: { name, size, blob: blobFromFile(local, size) }, localDir: path.dirname(local) };
}

export interface ContentPlanResult {
    plan: ContentPlan;
    /** Sequences left out, with the reason, for the report to explain itself. */
    skipped: { name: string; reason: string }[];
}

export interface ContentPlanOptions {
    /** Only these fseq file names (what the automatic queue holds). */
    only?: string[];
    /** Per-target channels, keyed by device id; targets absent get the show whole. */
    slicing?: Map<string, ContentSlicing>;
    /** Where slices are written. Required for slicing to happen at all. */
    workspace?: SliceWorkspace;
}

/**
 * Turn the registered songs into a transfer plan. `only` limits it to those
 * fseq file names (what the automatic queue holds).
 *
 * A sequence with no fseq on disk is skipped rather than failing the run: a
 * show folder in mid-import routinely has records ahead of their files.
 */
export async function buildContentPlan(
    sequences: SequenceRecord[],
    settings: PlaybackSettings | undefined,
    opts: ContentPlanOptions = {},
): Promise<ContentPlanResult> {
    const wanted = opts.only?.length ? new Set(opts.only.map((n) => n.toLowerCase())) : undefined;
    const out: ContentSequenceSource[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const seen = new Set<string>();
    // Where each sequence's media was read from, so a per-host variant can be
    // looked for beside it. A blob carries bytes, not a path.
    const mediaDirs = new Map<string, string>();
    /** The show's own file for each sequence, which slicing reads. */
    const sourceFiles = new Map<string, string>();

    for (const record of sequences) {
        if (record.deleted || record.render_enabled === false) continue;
        const file = record.files?.fseq;
        if (!file) continue;
        const name = path.basename(file);
        if (wanted && !wanted.has(name.toLowerCase())) continue;
        // One copy per file name: the device has one namespace, and two
        // records can legitimately point at the same sequence.
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());

        const size = await fileSize(file);
        if (size === null) {
            skipped.push({ name, reason: 'file not on disk' });
            continue;
        }
        let identity;
        try {
            identity = await readFseqIdentityFromFile(file);
        } catch (e) {
            skipped.push({ name, reason: `unreadable: ${(e as Error).message}` });
            continue;
        }
        const found = await mediaFor(record, identity.mediaName);
        if (found) mediaDirs.set(name, found.localDir);
        sourceFiles.set(name, file);
        out.push({
            name,
            identity,
            size,
            blob: blobFromFile(file, size),
            ...(found ? { media: found.media } : {}),
        });
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    const playlistName = settings?.contentDistribution?.playlistName ?? DEFAULT_CONTENT_PLAYLIST;

    // One header read per source file, however many targets ask about it.
    const headers = new Map<string, FSEQHeader | null>();
    const headerFor = async (file: string): Promise<FSEQHeader | null> => {
        const held = headers.get(file);
        if (held !== undefined) return held;
        const reader = new FSEQReaderSync(file);
        let header: FSEQHeader | null = null;
        try {
            await reader.open();
            await reader.readHeader();
            header = reader.header ?? null;
        } catch (e) {
            console.warn(`[content-dist] cannot read ${path.basename(file)} for slicing:`, (e as Error).message);
        } finally {
            await reader.close().catch(() => undefined);
        }
        headers.set(file, header);
        return header;
    };

    const plan: ContentPlan = {
        sequences: out,
        ...(playlistName ? { playlistName } : {}),
        // A matrix player wants its own cut of the media; xLights names those
        // `Song-<host>.<ext>` beside the original, so look there first.
        async resolveMedia(sequence, hostName) {
            if (!sequence.media) return undefined;
            const dir = mediaDirs.get(sequence.name);
            if (!dir) return undefined;
            for (const candidate of hostSpecificMediaCandidates(sequence.media.name, hostName)) {
                const file = path.join(dir, candidate);
                const size = await fileSize(file);
                if (size !== null) return { name: candidate, size, blob: blobFromFile(file, size) };
            }
            return undefined;
        },
        // A remote gets only its own channels. The identity is worked out from
        // the plan, so a device that already holds the right slice costs one
        // header read and no slicing at all.
        async resolveSequence(sequence, target): Promise<ResolvedSequence | undefined> {
            const slicing = opts.slicing?.get(target.id);
            const workspace = opts.workspace;
            if (!slicing?.ranges.length || !workspace) return undefined;
            const file = sourceFiles.get(sequence.name);
            if (!file) return undefined;
            const header = await headerFor(file);
            if (!header) return undefined;

            const slice = planFseqSlice(header, slicing.ranges);
            // Nothing to cut, or it cannot be cut safely: send the show's file.
            if (!slice || slice.stride >= sequence.identity.channelCount) return undefined;

            const note =
                `sliced to ${slice.stride.toLocaleString()} of ` +
                `${sequence.identity.channelCount.toLocaleString()} channels` +
                (slicing.source === 'xlights' ? ', from the xLights layout' : '') +
                (slice.droppedChannels > 0 ? `, ${slice.droppedChannels.toLocaleString()} not in the show` : '');

            return {
                identity: slicedIdentity(sequence.identity, slice),
                note,
                async open() {
                    const dest = path.join(workspace.dir, sliceName(target.id, sequence.name));
                    const written = await sliceFseqFile(file, dest, slicing.ranges);
                    if (!written) throw new Error(`could not slice ${sequence.name} for ${target.label}`);
                    return { blob: blobFromFile(dest, written.bytes), size: written.bytes };
                },
            };
        },
    };
    return { plan, skipped };
}

// ---------------------------------------------------------------------------
// Engine types → the shapes every UI reads
// ---------------------------------------------------------------------------

const iso = (ms: number): string => new Date(ms || Date.now()).toISOString();

export function toContentDistRun(
    snapshot: ContentSyncSnapshot,
    meta: { opId: string; checkOnly: boolean; trigger: ContentDistTrigger },
): ContentDistRun {
    const targets: ContentDistTargetProgress[] = snapshot.targets.map((t) => ({
        id: t.id,
        label: t.label,
        phase: t.phase as ContentDistPhase,
        ...(t.item ? { item: t.item } : {}),
        fraction: t.fraction,
        bytesSent: t.bytesSent,
        bytesTotal: t.bytesTotal,
        itemsDone: t.itemsDone,
        itemsTotal: t.itemsTotal,
        failures: t.failures,
        ...(t.message ? { message: t.message } : {}),
    }));
    return {
        opId: meta.opId,
        startedAt: iso(snapshot.startedAtMs),
        checkOnly: meta.checkOnly,
        trigger: meta.trigger,
        fraction: snapshot.fraction,
        bytesSent: targets.reduce((n, t) => n + t.bytesSent, 0),
        bytesTotal: targets.reduce((n, t) => n + t.bytesTotal, 0),
        targets,
    };
}

function toItem(item: ContentSyncTargetReport['items'][number]): ContentDistItem {
    return {
        kind: item.kind,
        name: item.name,
        action: item.action,
        reason: item.reason,
        bytes: item.bytes,
        ms: item.ms,
        ...(item.method ? { method: item.method as ContentUploadMethod } : {}),
    };
}

function toTargetReport(t: ContentSyncTargetReport): ContentDistTargetReport {
    return {
        id: t.id,
        label: t.label,
        hostName: t.hostName,
        ...(t.version ? { version: t.version } : {}),
        ...(t.platform ? { platform: t.platform } : {}),
        supported: t.supported,
        ...(t.uploadMethod ? { uploadMethod: t.uploadMethod as ContentUploadMethod } : {}),
        items: t.items.map(toItem),
        bytesUploaded: t.bytesUploaded,
        startedAt: iso(t.startedAtMs),
        finishedAt: iso(t.finishedAtMs),
        ...(t.note ? { note: t.note } : {}),
    };
}

export function toContentDistReport(
    report: ContentSyncReport,
    meta: { checkOnly: boolean; trigger: ContentDistTrigger },
): ContentDistReport {
    return {
        startedAt: iso(report.startedAtMs),
        finishedAt: iso(report.finishedAtMs),
        checkOnly: meta.checkOnly,
        cancelled: report.cancelled,
        trigger: meta.trigger,
        targets: report.targets.map(toTargetReport),
        totals: { ...report.totals },
    };
}

/**
 * What one device now holds, for its row's badge and detail. A check and a
 * real run both produce this: after a check the missing items are what a run
 * would send, after a run they are what it could not.
 */
export function contentStatusFor(target: ContentDistTargetReport): ControllerContentStatus {
    let current = 0;
    let missing = 0;
    let missingBytes = 0;
    let failed = 0;
    for (const item of target.items) {
        if (item.kind === 'playlist') continue;
        switch (item.action) {
            case 'skipped':
                current++;
                break;
            case 'uploaded':
                current++;
                break;
            case 'planned':
                missing++;
                missingBytes += item.bytes;
                break;
            case 'failed':
                failed++;
                missingBytes += item.bytes;
                break;
        }
    }
    return {
        checkedAt: target.finishedAt,
        current,
        missing,
        missingBytes,
        failed,
        ...(target.note ? { error: target.note } : {}),
        ...(target.uploadMethod ? { uploadMethod: target.uploadMethod } : {}),
    };
}

// ---------------------------------------------------------------------------
// When to act by ourselves
// ---------------------------------------------------------------------------

export type ContentAutoDecision =
    { act: true; trigger: ContentDistTrigger } | { act: false; hold: 'off' | 'outside-window' | 'idle' };

/**
 * Whether automatic distribution may act now. `off` is the default: sending a
 * show to a device by itself is a bigger step than reading one, so it is asked
 * for. Inside a window we act on queued content at once and otherwise look for
 * work on the poll cadence.
 */
export function contentAutoDecision(
    settings: ContentDistributionSettings | undefined,
    now: Date,
    opts: { queued: number; lastRunMs: number | undefined; nowMs: number },
): ContentAutoDecision {
    const mode = settings?.mode ?? 'off';
    if (mode === 'off') return { act: false, hold: 'off' };
    if (mode === 'scheduled') {
        const windows = settings?.schedule ?? [];
        // No windows means never, the reading cloud polling already gives it.
        if (!windows.length || findMatchingScheduleEntry(windows, now) === null) {
            return { act: false, hold: 'outside-window' };
        }
    }
    if (opts.queued > 0 && settings?.followSongAdds !== false) return { act: true, trigger: 'songs' };

    const minutes = settings?.pollMinutes ?? DEFAULT_CONTENT_POLL_MINUTES;
    if (!(minutes > 0)) return { act: false, hold: 'idle' };
    const due = opts.lastRunMs === undefined || opts.nowMs - opts.lastRunMs >= minutes * 60_000;
    return due ? { act: true, trigger: 'schedule' } : { act: false, hold: 'idle' };
}
