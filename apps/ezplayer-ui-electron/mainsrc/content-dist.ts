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
    ContentRole,
    ControllerContentStatus,
    ContentUploadMethod,
    DiscoveredController,
    KnownController,
    PlaybackSettings,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import { contentRoleOf, findMatchingScheduleEntry, isPlayerOnlyRecord } from '@ezplayer/ezplayer-core';
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
    getConfigDriver,
    hostSpecificMediaCandidates,
    loadBundledCapabilities,
    readFseqIdentityFromFile,
} from '@ezplayer/epp-controllers';
import type { FSEQHeader, FseqRange } from '@ezplayer/epp';
import { FSEQReaderSync, parseChannelRanges, planFseqSlice, sliceFseqFile } from '@ezplayer/epp';
import { playableAudioPath } from './data/derived-audio.js';

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

/**
 * Whether a layout entry describes a box that holds its own copy, answered
 * from the controller's capability definition rather than from a scan.
 *
 * The vendor does not say: a Kulp cape and a Wally's board are both FPP boards
 * sold under their own names, and the only place that is written down is the
 * capability file's `Base="FPP:..."` chain, which is what `getConfigDriver`
 * resolves. Knowing this without a scan is what lets a show distribute to the
 * boxes its layout names before anything has been discovered.
 */
export function recordHoldsContent(k: KnownController): boolean {
    // The show's player plays from its own files by definition, whatever the
    // layout filled in for vendor and model.
    if (isPlayerOnlyRecord(k)) return true;
    if (!k.vendor || !k.model) return false;
    // Guarded and idempotent, so this costs a boolean after the first call --
    // and asking here means the answer does not depend on which other module
    // happened to load first.
    loadBundledCapabilities();
    return getConfigDriver(k.vendor, k.model, k.variant ?? '') === 'FPP';
}

/**
 * One box that holds content, as the show knows it: the record that puts it in
 * the show, the scanned device when a scan has found it, and the part it plays.
 *
 * The record is the spine. A scan is how we learn a device's firmware version
 * and which files it already has, but it is not what decides who is in the
 * show.
 */
export interface ContentHost {
    /** Key for progress, slicing, and the `ids` a command names. */
    id: string;
    /** Where to reach it: the record's address, or the device's ip. */
    address: string;
    record?: KnownController;
    device?: DiscoveredController;
    role: ContentRole;
    /** Why nothing can be sent here, when that is already known. */
    unsupportedReason?: string;
}

/** The id for a host no scan has found: the shape a scan produces, with a
 *  `via` of its own so it can never collide with a discovered device. */
function recordHostId(address: string): string {
    return `${address}|record`;
}

/** The scanned device at a layout address, matched on ip or hostname. */
function deviceForAddress(devices: DiscoveredController[], address: string): DiscoveredController | undefined {
    const a = address.trim().toLowerCase();
    return devices.find((d) => d.ip.toLowerCase() === a || d.hostname?.toLowerCase() === a);
}

/**
 * What an unregistered device gets, which is only ever asked of one the
 * operator named by hand. There is no record to state an intent, so the act of
 * naming it is the intent, and the whole show is the safe reading of it.
 */
function deviceContentRole(dev: DiscoveredController): ContentRole {
    return (dev.mode ?? '').toLowerCase() === 'remote' ? 'remote' : 'player';
}

/**
 * Every box this show expects to hold content, joined to whatever a scan has
 * found. `ids` narrows to the ones named; without it the whole show is
 * returned.
 *
 * Membership comes from the records, so this works before any scan. A box that
 * is out -- not a player or a remote, or not a kind that holds files at all --
 * is dropped silently unless it was named, because asking about one device
 * deserves a visible answer rather than an empty list.
 */
export function contentHostsForShow(
    known: KnownController[],
    devices: Record<string, DiscoveredController>,
    ids?: string[],
): ContentHost[] {
    const wanted = ids?.length ? new Set(ids) : undefined;
    const all = Object.values(devices);
    const hosts: ContentHost[] = [];
    const claimed = new Set<string>();

    for (const rec of known) {
        const address = rec.address?.trim();
        if (!address) continue;
        const dev = deviceForAddress(all, address);
        if (dev) claimed.add(dev.id);
        const id = dev?.id ?? recordHostId(address);
        const role = contentRoleOf(rec);
        const holds = dev ? isContentTarget(dev) : recordHoldsContent(rec);
        const why = !holds
            ? `${dev?.driverType ?? rec.vendor ?? 'this controller'} holds no content`
            : role === 'none'
              ? 'neither the show player nor a remote, so it is sent pixels rather than files'
              : undefined;
        if (why && !wanted?.has(id)) continue;
        hosts.push({
            id,
            address,
            record: rec,
            ...(dev ? { device: dev } : {}),
            role,
            ...(why ? { unsupportedReason: why } : {}),
        });
    }

    // A scanned box with no record of its own is in the show only when the
    // operator picks it out of the grid.
    for (const dev of all) {
        if (claimed.has(dev.id) || !wanted?.has(dev.id)) continue;
        hosts.push({
            id: dev.id,
            address: dev.ip,
            device: dev,
            role: deviceContentRole(dev),
            ...(isContentTarget(dev) ? {} : { unsupportedReason: `${dev.driverType ?? 'device'} holds no content` }),
        });
    }

    return wanted ? hosts.filter((h) => wanted.has(h.id)) : hosts;
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
 * same way a status read reaches it -- so `known` is wanted whenever the
 * layout, rather than discovery, is what knows about the proxy.
 */
export function contentTargetsFor(
    devices: DiscoveredController[],
    ids?: string[],
    known: KnownController[] = [],
): ContentSyncTargetSpec[] {
    const wanted = ids?.length ? new Set(ids) : undefined;
    const hosts: ContentHost[] = [];
    for (const dev of devices) {
        if (wanted ? !wanted.has(dev.id) : !isContentTarget(dev)) continue;
        // An explicitly named device that is not a content target is reported
        // rather than silently dropped, so asking has a visible answer.
        const rec = recordFor(dev, known);
        hosts.push({
            id: dev.id,
            address: dev.ip,
            device: dev,
            ...(rec ? { record: rec } : {}),
            role: rec ? contentRoleOf(rec) : deviceContentRole(dev),
            ...(isContentTarget(dev) ? {} : { unsupportedReason: `${dev.driverType ?? 'device'} holds no content` }),
        });
    }
    return contentTargetsForHosts(hosts, known);
}

/**
 * The transfer spec for each host, in the order given.
 *
 * A host no scan has found still gets a spec: its address is enough to reach
 * it, and an attempt that fails says so plainly, which is more use than
 * leaving it out of the run. What is missing is its firmware version, so it
 * takes the FPP 6 upload route — the one every version answers — and the
 * engine moves to the chunked route if the device turns out to want it.
 */
export function contentTargetsForHosts(hosts: ContentHost[], known: KnownController[] = []): ContentSyncTargetSpec[] {
    const out: ContentSyncTargetSpec[] = [];
    for (const host of hosts) {
        const { device: dev, record: rec } = host;
        const ip = dev?.ip ?? host.address;
        const proxy = dev ? proxyForDevice(dev, known) : rec?.proxy && rec.proxy !== ip ? rec.proxy : undefined;
        const baseUrl = proxy ? `http://${proxy}/proxy/${ip}` : `http://${ip}`;
        const hostName = dev?.hostname ?? ip;
        const [major, minor, patch] = versionParts(dev?.firmwareVersion);
        // A box that serves normally but will not answer a ping reads as
        // unreachable. Skipping it then is the whole reason the record carries
        // "presume up", so the skip has to honour it.
        const presumed = !!rec?.presumeUp;
        const label = dev?.hostname
            ? `${dev.hostname} (${ip})`
            : rec && rec.name.toLowerCase() !== ip.toLowerCase()
              ? `${rec.name} (${ip})`
              : ip;
        out.push({
            id: host.id,
            label,
            hostName,
            endpoint: createFppContentEndpoint({
                baseUrl,
                ip,
                hostName,
                majorVersion: major,
                minorVersion: minor,
                patchVersion: patch,
            }),
            ...(dev?.firmwareVersion ? { version: dev.firmwareVersion } : {}),
            ...((dev?.model ?? rec?.model) ? { platform: dev?.model ?? rec?.model } : {}),
            ...(host.unsupportedReason ? { supported: false, unsupportedReason: host.unsupportedReason } : {}),
            ...(dev?.unreachable && !presumed ? { supported: false, unsupportedReason: 'not responding' } : {}),
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
    source: 'device' | 'xlights' | 'remainder';
}

/** The layout record for a scanned device, matched on address or hostname. */
export function recordFor(dev: DiscoveredController, known: KnownController[]): KnownController | undefined {
    const host = dev.hostname?.toLowerCase();
    return known.find((k) => !!k.address && (k.address === dev.ip || (!!host && k.address.toLowerCase() === host)));
}

/**
 * How to reach a device: through the FPP discovery found it behind, or through
 * the one its layout record names. A device we learned by address carries no
 * proxy of its own, so the record is the only place that knows -- which is
 * what makes a controller on a network only the player can see reachable at
 * all. A record naming the device itself is ignored rather than proxied into a
 * loop.
 */
export function proxyForDevice(dev: DiscoveredController, known: KnownController[]): string | undefined {
    if (dev.source.via === 'fpp-proxy') return dev.source.proxy;
    const viaLayout = recordFor(dev, known)?.proxy;
    if (!viaLayout || viaLayout === dev.ip) return undefined;
    return viaLayout.toLowerCase() === dev.hostname?.toLowerCase() ? undefined : viaLayout;
}

/**
 * Whether this device should get a cut-down copy of each sequence, and of
 * what. Only a remote is sliced for: a player drives the show and needs it
 * whole. This is the rule xLights follows too.
 *
 * Where the layout has an opinion it decides, not the device's reported mode:
 * the layout is the intent, and a device still carrying the last show's role
 * would otherwise get the wrong cut (the disagreement is reported as drift and
 * set right during config upload or distribution). A device the layout has
 * never heard of is taken at its own word instead — there is no intent to go
 * on, and the alternative is sending a remote the whole show.
 *
 * The device's own `channelRanges` is preferred over the xLights layout, since
 * it is the device describing what it actually drives; the layout is the
 * fallback for a build too old to report it.
 */
export function slicingFor(dev: DiscoveredController, known: KnownController[] = []): ContentSlicing | null {
    if (!isContentTarget(dev)) return null;
    const record = recordFor(dev, known);
    const role = record ? contentRoleOf(record) : deviceContentRole(dev);
    if (role !== 'remote') return null;
    return remoteSlicing({ id: dev.id, address: dev.ip, device: dev, ...(record ? { record } : {}), role });
}

/** The channels one remote drives: its own report where we have it, else the
 *  span its layout record claims. */
function remoteSlicing(host: ContentHost): ContentSlicing | null {
    const reported = parseChannelRanges(host.device?.channelRanges);
    if (reported.length) return { ranges: reported, source: 'device' };

    const rec = host.record;
    if (rec?.startChannel && rec.channelCount) {
        // xLights counts channels from 1; a sequence's ranges count from 0.
        return {
            ranges: [{ startch: rec.startChannel - 1, chcount: rec.channelCount }],
            source: 'xlights',
        };
    }
    return null;
}

/** Ranges sorted and merged, so a complement of them has no false gaps. */
function normalizeRanges(ranges: FseqRange[]): FseqRange[] {
    const sorted = [...ranges].filter((r) => r.chcount > 0).sort((a, b) => a.startch - b.startch);
    const out: FseqRange[] = [];
    for (const r of sorted) {
        const last = out[out.length - 1];
        if (last && r.startch <= last.startch + last.chcount) {
            last.chcount = Math.max(last.chcount, r.startch + r.chcount - last.startch);
        } else {
            out.push({ startch: r.startch, chcount: r.chcount });
        }
    }
    return out;
}

/** What is left of `0..span` once `taken` is removed. */
function complementRanges(taken: FseqRange[], span: number): FseqRange[] {
    const out: FseqRange[] = [];
    let at = 0;
    for (const r of normalizeRanges(taken)) {
        if (r.startch > at) out.push({ startch: at, chcount: Math.min(r.startch, span) - at });
        at = Math.max(at, r.startch + r.chcount);
        if (at >= span) break;
    }
    if (at < span) out.push({ startch: at, chcount: span - at });
    return out.filter((r) => r.chcount > 0);
}

/**
 * The channels every remote in the show is taking, in the same form each will
 * actually be sent.
 *
 * Read from the records -- the layout and our own overrides are what say who
 * is a remote -- but each remote's extent is the device's own `channelRanges`
 * when we have it, exactly as {@link slicingFor} would send it. Using the same
 * source for both is what makes the remotes and the player's remainder add up
 * to the whole show with no gap and no overlap.
 */
function remoteRangesOfShow(devices: DiscoveredController[], known: KnownController[]): FseqRange[] {
    const taken: FseqRange[] = [];
    for (const rec of known) {
        if (contentRoleOf(rec) !== 'remote') continue;
        const addr = rec.address?.trim();
        const dev = addr ? deviceForAddress(devices, addr) : undefined;
        const reported = parseChannelRanges(dev?.channelRanges);
        if (reported.length) {
            taken.push(...reported);
            continue;
        }
        if (rec.startChannel && rec.channelCount) {
            taken.push({ startch: rec.startChannel - 1, chcount: rec.channelCount });
        }
    }
    return normalizeRanges(taken);
}

/** The highest channel any record in the show claims, counting from zero. */
function showChannelSpan(known: KnownController[]): number {
    let span = 0;
    for (const rec of known) {
        if (!rec.startChannel || !rec.channelCount) continue;
        span = Math.max(span, rec.startChannel - 1 + rec.channelCount);
    }
    return span;
}

/**
 * Per-target slicing for a whole run: a remote takes its own channels, and the
 * player takes what is left rather than the whole show.
 *
 * A player needs its own ports plus every channel it forwards to the
 * controllers in its send list -- and a remote is already inactive in that
 * list, so "the show minus the remotes" is exactly its need. With no remotes
 * there is nothing to subtract and the player is sent the show unsliced, which
 * is both correct and one less file to build.
 */
export function slicingPlanForHosts(
    hosts: ContentHost[],
    devices: Record<string, DiscoveredController>,
    known: KnownController[],
): Map<string, ContentSlicing> {
    const plan = new Map<string, ContentSlicing>();
    // Every remote in the show, not just the ones in this run and not just the
    // ones that hold content: a Falcon marked "xLights Only" takes its channels
    // out of the player's share just the same.
    const taken = remoteRangesOfShow(Object.values(devices), known);
    const span = showChannelSpan(known);
    const remainder = taken.length && span > 0 ? complementRanges(taken, span) : [];

    for (const host of hosts) {
        if (host.unsupportedReason) continue;
        if (host.role === 'remote') {
            const own = remoteSlicing(host);
            if (own) plan.set(host.id, own);
            continue;
        }
        if (host.role === 'player' && remainder.length) {
            plan.set(host.id, { ranges: remainder, source: 'remainder' });
        }
    }
    return plan;
}

/** {@link slicingPlanForHosts} for a run named by device id. */
export function slicingPlanFor(
    targets: { id: string }[],
    devices: Record<string, DiscoveredController>,
    known: KnownController[],
): Map<string, ContentSlicing> {
    const hosts: ContentHost[] = [];
    for (const target of targets) {
        const dev = devices[target.id];
        if (!dev || !isContentTarget(dev)) continue;
        const rec = recordFor(dev, known);
        hosts.push({
            // The caller's id, which is the key the run reports under.
            id: target.id,
            address: dev.ip,
            device: dev,
            ...(rec ? { record: rec } : {}),
            role: rec ? contentRoleOf(rec) : deviceContentRole(dev),
        });
    }
    return slicingPlanForHosts(hosts, devices, known);
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
 * The media to send with a sequence: the bytes EZPlayer itself would play, so
 * a device playing on its own sounds like the show does here. A normalized or
 * non-mp3 song plays from its derived mp3, not from the source file.
 *
 * The name keeps the song's own file name — the fseq's `mf` name when it has
 * one — with the extension of what is actually sent. FPP pairs media with a
 * sequence from the playlist entry and never reads the fseq header, so the
 * name is chosen to read well in its own media list.
 */
async function mediaFor(
    record: SequenceRecord,
    headerName: string | undefined,
    showFolder: string | undefined,
): Promise<{ media: ContentMediaSource; localDir: string } | null> {
    const local = record.files?.audio;
    if (!local) return null;
    if (!AUDIO_EXTENSIONS.has(path.extname(local).toLowerCase())) return null;

    // Before the derived file has been built the source is all there is: send
    // it rather than no audio at all, and say so in the log.
    let shipped = local;
    if (showFolder) {
        try {
            shipped = await playableAudioPath(local, showFolder, { normalize: !!record.settings?.normalize });
        } catch (e) {
            console.warn(`[content-dist] sending source audio for ${path.basename(local)}: ${(e as Error).message}`);
        }
    }
    const size = await fileSize(shipped);
    if (size === null) return null;

    const named = headerName && AUDIO_EXTENSIONS.has(path.extname(headerName).toLowerCase()) ? headerName : local;
    const name = path.basename(named, path.extname(named)) + path.extname(shipped).toLowerCase();
    // The source's folder, not the derived one: a host-specific variant of this
    // media is something the user put beside their own file.
    return { media: { name, size, blob: blobFromFile(shipped, size) }, localDir: path.dirname(local) };
}

export interface ContentPlanResult {
    plan: ContentPlan;
    /** Sequences left out, with the reason, for the report to explain itself. */
    skipped: { name: string; reason: string }[];
}

export interface ContentPlanOptions {
    /** Only these fseq file names (what the automatic queue holds). */
    only?: string[];
    /** The show's folder, which is where derived (playable) audio lives. */
    showFolder?: string;
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
        const found = await mediaFor(record, identity.mediaName, opts.showFolder);
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
    // When a device took nothing at all, the first failure becomes the row's
    // reason: it is the device that is wrong, not one file.
    const firstFailure = target.items.find((i) => i.action === 'failed')?.reason;
    const error = target.note ?? (current === 0 && failed > 0 ? firstFailure : undefined);

    return {
        checkedAt: target.finishedAt,
        current,
        missing,
        missingBytes,
        failed,
        ...(error ? { error } : {}),
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
