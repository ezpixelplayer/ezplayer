/**
 * Controller operations subsystem (main process). Owns the authoritative
 * `controllerops` state and the single dispatcher every entry point (LAN HTTP
 * route, LAN WebSocket message, cloud commands) funnels into. State changes
 * are broadcast to all clients over the WebSocket.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
    ContentDistTrigger,
    ControllerCommand,
    ControllerModelIntent,
    ControllerOp,
    ControllerOpOrigin,
    ControllerOpsState,
    ControllerPanelMatrix,
    ControllerPort,
    ControllerSerialPort,
    ControllerVirtualMatrix,
    DiscoveredController,
    EzpControllerRecord,
    KnownController,
    NetworkPolicy,
    PlaybackSettings,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import { applyOverrides, ipInCidr } from '@ezplayer/ezplayer-core';
import type {
    DiscoveryDevice,
    DiscoveryJob,
    DiscoveryRequest,
    DiscoveryResult,
    ModelPortIntent,
    OutputConfig,
    PanelMatrixConfig,
    PanelMatrixInfo,
    PixelPortInfo,
    SerialPortConfig,
    SerialPortInfo,
    SetOutputsOptions,
    VirtualMatrixConfig,
    VirtualMatrixInfo,
} from '@ezplayer/epp-controllers';
import { ContentSyncRun } from '@ezplayer/epp-controllers';
import {
    buildContentPlan,
    contentAutoDecision,
    contentStatusFor,
    contentTargetsFor,
    isContentTarget,
    toContentDistReport,
    toContentDistRun,
} from './content-dist.js';
import {
    discover,
    probeController,
    reportToTree,
    deriveXlightsPortConfigs,
    expandModelStrings,
    getCapabilities,
    loadBundledCapabilities,
    checkUpload,
} from '@ezplayer/epp-controllers';
import { hostNetworks } from '../cli/net.js';
import * as fsp from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The capability registry (xLights .xcontroller definitions, bundled in the
// lib) is empty until loaded; every getCapabilities() below depends on it.
loadBundledCapabilities();

// Hard cap on concurrent local discovery scans.
const MAX_CONCURRENT_SCANS = 2;

let activeScans = 0;
let opCounter = 0;

// Live job handles for running scan ops, so `cancel` can reach the engine.
const scanJobs = new Map<string, DiscoveryJob>();

// Bumped by resetControllerOps; a scan started before a reset must not merge
// what it finds into the cleared state.
let resetGeneration = 0;

const state: ControllerOpsState = { interfaces: [], devices: {}, operations: {}, known: [], networkPolicies: [] };

// Injected by server-worker-manager, so this module needs no dependency on it.
let broadcast: ((state: ControllerOpsState) => void) | null = null;

/**
 * Asks whoever is sending show data to hold off on one controller, returning
 * the release.  Several models will not answer a read or accept an upload while
 * they are being streamed to.  Undefined when nothing is being sent.
 */
let holdData: ((address: string) => (() => void) | undefined) | null = null;
export function setControllerDataHold(fn: (address: string) => (() => void) | undefined): void {
    holdData = fn;
}
export function setControllerOpsBroadcaster(fn: (s: ControllerOpsState) => void): void {
    broadcast = fn;
}

/** The current snapshot — used to seed a freshly-connected client. */
export function getControllerOpsState(): ControllerOpsState {
    return state;
}

// ---------------------------------------------------------------------------
// Record store — persisted overrides/records for the reconcile grid, one JSON
// file per controller under `<showFolder>/.ezplayer/controllers/`. The
// broadcast `known` is xLights ∪ our records, re-derived when either updates.
// ---------------------------------------------------------------------------

let xlightsKnown: KnownController[] = [];
let records: EzpControllerRecord[] = [];
let recordsShowFolder: string | null = null;

function recordsDir(showFolder: string): string {
    return path.join(showFolder, '.ezplayer', 'controllers');
}

/** The name is url-encoded so any characters are safe/reversible; the
 *  canonical name lives in the file's `name` field. */
function recordFile(showFolder: string, name: string): string {
    return path.join(recordsDir(showFolder), `${encodeURIComponent(name)}.json`);
}

function deriveKnown(): void {
    state.known = applyOverrides(xlightsKnown, records).map(withPortCounts);
}

/** Stamp the pixel/serial port counts from the controller's capability
 *  definition (vendor/model/variant), so the port map can draw every port the
 *  controller has rather than only the ones in use. */
function withPortCounts(k: KnownController): KnownController {
    if ((k.pixelPortCount !== undefined && k.serialPortCount !== undefined) || !k.vendor || !k.model) return k;
    const caps = getCapabilities(k.vendor, k.model, k.variant ?? '');
    if (!caps) return k;
    return {
        ...k,
        pixelPortCount: k.pixelPortCount ?? caps.maxPixelPort,
        serialPortCount: k.serialPortCount ?? caps.maxSerialPort,
    };
}

function parseRecord(data: unknown): EzpControllerRecord | null {
    if (!data || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name) return null;
    const r: EzpControllerRecord = { name: o.name };
    if (typeof o.address === 'string') r.address = o.address;
    if (typeof o.active === 'boolean') r.active = o.active;
    if (typeof o.deleted === 'boolean') r.deleted = o.deleted;
    if (typeof o.own === 'boolean') r.own = o.own;
    if (typeof o.vendor === 'string') r.vendor = o.vendor;
    if (typeof o.model === 'string') r.model = o.model;
    if (typeof o.variant === 'string') r.variant = o.variant;
    if (typeof o.fpsOverride === 'number') r.fpsOverride = o.fpsOverride;
    if (typeof o.notes === 'string') r.notes = o.notes;
    return r;
}

/** Set the xLights-derived "known" controllers, fed from the playback worker's
 *  layout load. Merged with our persisted records before broadcast. */
export function setKnownControllers(known: KnownController[]): void {
    xlightsKnown = known;
    deriveKnown();
    publish();
}

/** Load persisted controller records at folder open (missing dir ⇒ none). */
export async function loadControllerRecords(showFolder: string): Promise<void> {
    recordsShowFolder = showFolder;
    records = [];
    try {
        const dir = recordsDir(showFolder);
        let files: string[] = [];
        try {
            files = await fsp.readdir(dir);
        } catch (e) {
            if ((e as { code?: string }).code !== 'ENOENT') throw e;
        }
        for (const f of files) {
            if (!f.endsWith('.json')) continue;
            try {
                const raw = await fsp.readFile(path.join(dir, f), 'utf-8');
                const parsed = parseRecord(JSON.parse(raw));
                if (parsed) records.push(parsed);
                else console.warn(`[controller-ops] ignoring malformed record ${f}`);
            } catch (e) {
                console.warn(`[controller-ops] bad record file ${f}:`, e);
            }
        }
        if (records.length) console.log(`[controller-ops] loaded ${records.length} controller records`);
    } catch (e) {
        console.warn('[controller-ops] record load failed:', e);
    }
    deriveKnown();
    publish();
}

function publish(): void {
    // Shallow clone so the broadcaster/versioning sees a fresh value each tick.
    broadcast?.({
        interfaces: [...state.interfaces],
        devices: { ...state.devices },
        operations: { ...state.operations },
        known: [...(state.known ?? [])],
        networkPolicies: [...(state.networkPolicies ?? [])],
        ...(state.contentDist ? { contentDist: { ...state.contentDist } } : {}),
    });
}

// ---------------------------------------------------------------------------
// Network policies — persisted per-network allow/expect flags, one JSON file
// (`<showFolder>/.ezplayer/networks.json`). `allow` gates the device proxy
// only; `expectControllers` marks the networks a show's controllers live on.
// ---------------------------------------------------------------------------

function networksFile(showFolder: string): string {
    return path.join(showFolder, '.ezplayer', 'networks.json');
}

function parseNetworkPolicy(data: unknown): NetworkPolicy | null {
    if (!data || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    if (typeof o.cidr !== 'string' || !o.cidr) return null;
    const p: NetworkPolicy = { cidr: o.cidr };
    if (typeof o.allow === 'boolean') p.allow = o.allow;
    if (typeof o.expectControllers === 'boolean') p.expectControllers = o.expectControllers;
    if (typeof o.note === 'string') p.note = o.note;
    return p;
}

/** Load persisted network policies for a show folder (missing file ⇒ none). */
export async function loadNetworkPolicies(showFolder: string): Promise<void> {
    state.networkPolicies = [];
    try {
        const raw = await fsp.readFile(networksFile(showFolder), 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            state.networkPolicies = parsed.map(parseNetworkPolicy).filter((p): p is NetworkPolicy => p !== null);
        }
    } catch (e) {
        if ((e as { code?: string }).code !== 'ENOENT') {
            console.warn('[controller-ops] network policy load failed:', e);
        }
    }
    publish();
}

async function saveNetworkPolicies(): Promise<void> {
    if (!recordsShowFolder) throw new Error('no show folder open to store network policies');
    const file = networksFile(recordsShowFolder);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(state.networkPolicies ?? [], null, 2), 'utf-8');
}

/** The policy for the network containing `ip` (longest-prefix CIDR match). */
function policyForIp(ip: string): NetworkPolicy | undefined {
    const ipNum = ip.split('.').reduce((a, o) => (a << 8) + (Number(o) & 0xff), 0) >>> 0;
    let best: NetworkPolicy | undefined;
    let bestBits = -1;
    for (const p of state.networkPolicies ?? []) {
        const m = p.cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
        if (!m) continue;
        const bits = Number(m[2]);
        const net = m[1].split('.').reduce((a, o) => (a << 8) + (Number(o) & 0xff), 0) >>> 0;
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if ((ipNum & mask) === (net & mask) && bits > bestBits) {
            best = p;
            bestBits = bits;
        }
    }
    return best;
}

/**
 * Whether this network/IP may be reached *through us* by a remote client — the
 * device-proxy gate, enforced in the server worker. Scanning and discovery are
 * deliberately not gated by it: a network we will not proxy into is still one
 * we look at, and still one that can have controllers on it.
 */
export function isNetworkProxyAllowed(cidrOrIp: string): boolean {
    const ip = cidrOrIp.includes('/') ? cidrOrIp.split('/')[0] : cidrOrIp;
    const exact = (state.networkPolicies ?? []).find((p) => p.cidr === cidrOrIp);
    const p = exact ?? policyForIp(ip);
    return p?.allow !== false;
}

async function runNetwork(command: Extract<ControllerCommand, { cmd: 'network' }>): Promise<void> {
    const list = state.networkPolicies ?? (state.networkPolicies = []);
    const existing = list.find((p) => p.cidr === command.cidr);
    if (existing) Object.assign(existing, command.patch);
    else list.push({ cidr: command.cidr, ...command.patch });
    await saveNetworkPolicies();
    publish();
}

export function refreshInterfaces(): void {
    state.interfaces = hostNetworks();
    publish();
}

const nowIso = (): string => new Date().toISOString();
const deviceKey = (d: { ip: string; source: DiscoveredController['source'] }): string => {
    if (d.source.via === 'fpp-proxy') return `${d.ip}|via:${d.source.proxy}`;
    if (d.source.via === 'ezp') return `${d.ip}|ezp:${d.source.host}`;
    return `${d.ip}|${d.source.via}`;
};

/** Driver per-port report -> ControllerPort (the "actual" side).
 *  Per-model names: a structural `models` array if the lib provides one,
 *  else split the driver's " + "-joined `model` string. */
function toControllerPort(p: PixelPortInfo): ControllerPort {
    const libModels = (p as { models?: unknown }).models;
    const models =
        Array.isArray(libModels) && libModels.every((m): m is string => typeof m === 'string')
            ? libModels
            : p.model
                  ?.split(' + ')
                  .map((s: string) => s.trim())
                  .filter(Boolean);
    return {
        port: p.port,
        model: p.model,
        models: models?.length ? models : undefined,
        pixels: p.pixels,
        protocol: p.protocol,
        colorOrder: p.colorOrder,
        startChannel: p.startChannel,
        endChannel: p.endChannel,
        universe: p.universe,
    };
}

/** Driver serial-port report -> ControllerSerialPort (the "actual" side). */
function toControllerSerialPort(p: SerialPortInfo): ControllerSerialPort {
    return {
        port: p.port,
        protocol: p.protocol,
        startChannel: p.startChannel,
        channels: p.channels,
        universe: p.universe,
        device: p.device,
        model: p.model,
    };
}

/** Driver panel matrix report -> ControllerPanelMatrix. */
function toControllerPanelMatrix(m: PanelMatrixInfo): ControllerPanelMatrix {
    return {
        port: m.port,
        driver: m.driver,
        enabled: m.enabled,
        startChannel: m.startChannel,
        channels: m.channelCount,
        width: m.width,
        height: m.height,
        panelCount: m.panelCount,
        name: m.name,
    };
}

/** Driver virtual matrix report -> ControllerVirtualMatrix. */
function toControllerVirtualMatrix(m: VirtualMatrixInfo): ControllerVirtualMatrix {
    return {
        name: m.name,
        port: m.port,
        enabled: m.enabled,
        startChannel: m.startChannel,
        channels: m.channelCount,
        width: m.width,
        height: m.height,
        device: m.device,
    };
}

/** epp-controllers DiscoveryDevice → lean core DiscoveredController. */
function toController(d: DiscoveryDevice): DiscoveredController {
    return {
        id: deviceKey(d),
        ip: d.ip,
        source: d.source,
        mac: d.mac,
        oui: d.oui,
        hostname: d.hostname,
        protocols: d.protocols,
        driverType: d.driverType,
        vendor: d.vendor,
        model: d.model,
        firmwareVersion: d.firmwareVersion,
        // DiscoveryNode[] and ControllerDetailNode[] are structurally identical.
        detail: d.detail as DiscoveredController['detail'],
        // Structured per-port config (full depth only) — reconcile's "actual" side.
        pixelPorts: d.report?.pixelPorts?.map(toControllerPort),
        pixelPortCount: d.report?.pixelPortCount,
        serialPorts: d.report?.serialPorts?.map(toControllerSerialPort),
        serialPortCount: d.report?.serialPortCount,
        panelMatrices: d.report?.panelMatrices?.map(toControllerPanelMatrix),
        virtualMatrices: d.report?.virtualMatrices?.map(toControllerVirtualMatrix),
        inputs: d.report?.inputs,
        error: d.error,
        seenAt: nowIso(),
    };
}

function mergeDevice(d: DiscoveryDevice): void {
    const key = deviceKey(d);
    const next = toController(d);
    const prev = state.devices[key];
    if (prev) {
        // A shallower pass must not wipe what a deeper read already learned:
        // an identify-depth scan carries no detail/pixelPorts, and a sweep
        // carries no driver identity — keep the previous values in that case.
        if (next.detail === undefined) next.detail = prev.detail;
        if (next.pixelPorts === undefined) next.pixelPorts = prev.pixelPorts;
        if (next.pixelPortCount === undefined) next.pixelPortCount = prev.pixelPortCount;
        if (next.serialPorts === undefined) next.serialPorts = prev.serialPorts;
        if (next.serialPortCount === undefined) next.serialPortCount = prev.serialPortCount;
        if (next.panelMatrices === undefined) next.panelMatrices = prev.panelMatrices;
        if (next.virtualMatrices === undefined) next.virtualMatrices = prev.virtualMatrices;
        if (next.inputs === undefined) next.inputs = prev.inputs;
        if (next.driverType === undefined) next.driverType = prev.driverType;
        if (next.vendor === undefined) next.vendor = prev.vendor;
        if (next.model === undefined) next.model = prev.model;
        if (next.firmwareVersion === undefined) next.firmwareVersion = prev.firmwareVersion;
        if (next.mac === undefined) next.mac = prev.mac;
        if (next.oui === undefined) next.oui = prev.oui;
        if (next.hostname === undefined) next.hostname = prev.hostname;
    }
    // Seen by a scan again, keep whatever an earlier refresh found.
    next.unreachable = false;
    state.devices[key] = next;
}

/** An already-running op of this kind for this target, if any (dedup/coalesce). */
/** An op of this kind against this target that has not finished (queued or running). */
function findActiveOp(kind: ControllerOp['kind'], target: string): ControllerOp | undefined {
    return Object.values(state.operations).find(
        (o) => (o.status === 'running' || o.status === 'queued') && o.kind === kind && o.target === target,
    );
}

// ---------------------------------------------------------------------------
// Per-kind concurrency. Each controller is independent, so a bulk run is just
// every command issued at once; the player runs a few of each kind at a time
// and the rest wait as `queued`, which every client sees.
// ---------------------------------------------------------------------------

type SlotKind = Exclude<ControllerOp['kind'], 'scan'>;
// One distribution at a time: a run already covers every target it was given,
// and two runs would race to write the same inventory playlist.
const OP_CONCURRENCY: Record<SlotKind, number> = { status: 8, action: 8, upload: 6, distribute: 1 };
const slotsInUse: Record<SlotKind, number> = { status: 0, action: 0, upload: 0, distribute: 0 };
const slotWaiters: Record<SlotKind, (() => void)[]> = { status: [], action: [], upload: [], distribute: [] };

/** A new op, `running` if a slot of its kind is free now, else `queued`. */
function newOp(kind: SlotKind, target: string, label: string, origin: ControllerOpOrigin): ControllerOp {
    return {
        id: `op_${Date.now()}_${++opCounter}`,
        kind,
        target,
        label,
        status: slotsInUse[kind] < OP_CONCURRENCY[kind] ? 'running' : 'queued',
        origin,
        startedAt: nowIso(),
    };
}

/**
 * Take a slot for `op`, waiting while its kind is at the limit. Resolves false
 * when the op was cancelled while it waited (it then holds no slot). Must be
 * called straight after `newOp`, so a free slot is taken before anything else
 * can claim it.
 */
async function waitForSlot(op: ControllerOp): Promise<boolean> {
    const kind = op.kind as SlotKind;
    if (slotsInUse[kind] < OP_CONCURRENCY[kind]) {
        slotsInUse[kind]++;
    } else {
        // releaseSlot hands its slot straight to the next waiter.
        await new Promise<void>((resolve) => slotWaiters[kind].push(resolve));
    }
    if (op.status === 'cancelled') {
        releaseSlot(kind);
        return false;
    }
    if (op.status === 'queued') {
        op.status = 'running';
        op.startedAt = nowIso();
        publish();
    }
    return true;
}

function releaseSlot(kind: SlotKind): void {
    const next = slotWaiters[kind].shift();
    if (next) next();
    else slotsInUse[kind]--;
}

/**
 * History is kept per target: once an op finishes, older finished ops of the
 * same kind against the same controller (or scan target) are dropped, so each
 * keeps only its latest result per kind. A failure stays until it is dismissed
 * or a newer op of that kind replaces it.
 */
function retireOlderOps(finished: ControllerOp): void {
    if (finished.status === 'error') {
        console.warn(`[controller-ops] ${finished.label} failed: ${finished.error ?? 'unknown error'}`);
    }
    for (const [id, o] of Object.entries(state.operations)) {
        if (id === finished.id || o.status === 'running' || o.status === 'queued') continue;
        if (o.kind === finished.kind && o.target === finished.target) delete state.operations[id];
    }
}

/**
 * Whether there is reason to believe a controller answers at this device: a
 * driver identified it before, or xLights or a record gives a controller type
 * for its address.
 */
function expectsController(dev: DiscoveredController): boolean {
    if (dev.driverType) return true;
    const host = dev.hostname?.toLowerCase();
    return (state.known ?? []).some(
        (k) =>
            !!(k.vendor || k.model) &&
            !!k.address &&
            (k.address === dev.ip || (!!host && k.address.toLowerCase() === host)),
    );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function dispatchControllerCommand(
    command: ControllerCommand,
    origin: ControllerOpOrigin,
): Promise<DiscoveryResult | undefined> {
    switch (command.cmd) {
        case 'scan':
            return runScan(command, origin);
        case 'status':
            await runStatus(command, origin);
            return undefined;
        case 'action':
            await runAction(command, origin);
            return undefined;
        case 'upload':
            await runUpload(command, origin);
            return undefined;
        case 'distribute':
            await runDistribute(command, origin);
            return undefined;
        case 'record':
            await runRecord(command);
            return undefined;
        case 'network':
            await runNetwork(command);
            return undefined;
        case 'refreshInterfaces':
            refreshInterfaces();
            return undefined;
        case 'cancel':
            runCancel(command);
            return undefined;
        case 'dismiss':
            runDismiss(command);
            return undefined;
    }
}

/** True while any controller operation (scan, read, action, upload) runs or waits to. */
/**
 * The id of the known device at this address, if any.  Device ids are not
 * addresses, and a status command addresses a device by id.
 */
export function deviceIdForAddress(address: string): string | undefined {
    const want = address.toLowerCase();
    for (const [id, dev] of Object.entries(state.devices)) {
        if (dev.ip?.toLowerCase() === want) return id;
    }
    return undefined;
}

/**
 * Drop automatic reads that have not started yet, and report how many.  A read
 * already in flight cannot be recalled — the controller is answering it — so
 * playback starting only stops the queue behind it.
 */
export function cancelQueuedAutomaticReads(): number {
    let dropped = 0;
    for (const op of Object.values(state.operations)) {
        if (op.origin !== 'auto' || op.kind !== 'status' || op.status !== 'queued') continue;
        op.status = 'cancelled';
        op.finishedAt = nowIso();
        dropped += 1;
    }
    if (dropped) publish();
    return dropped;
}

/**
 * Whether any controller operation is under way.  `ignoreAutomatic` leaves out
 * the reads the player starts itself, which must not block what the user asked for.
 */
export function hasRunningControllerOps(opts?: { ignoreAutomatic?: boolean }): boolean {
    return Object.values(state.operations).some((o) => {
        if (o.status !== 'running' && o.status !== 'queued') return false;
        if (opts?.ignoreAutomatic && o.origin === 'auto' && o.kind === 'status') return false;
        return true;
    });
}

/**
 * Forget everything learned from the network: scan results, device details
 * and finished operations. Part of reloading the show, alongside re-reading the
 * persisted records. Running scans are cancelled; other running operations are
 * left to finish, since stopping an upload part-way could leave a controller
 * half-configured.
 */
export function resetControllerOps(): void {
    resetGeneration++;
    for (const job of scanJobs.values()) job.cancel();
    contentRun?.cancel();
    // A new show means a new set of content; what the old one needed no
    // longer means anything.
    contentQueue.clear();
    lastContentRunMs = undefined;
    delete state.contentDist;
    state.devices = {};
    for (const [id, op] of Object.entries(state.operations)) {
        // A queued op never starts: it would act on state just cleared.
        if (op.status === 'queued') {
            op.status = 'cancelled';
            op.finishedAt = nowIso();
        }
        if (op.status !== 'running') delete state.operations[id];
    }
    state.interfaces = hostNetworks();
    publish();
}

/** Drop a finished op for every client. Already gone is fine: another client
 *  may have dismissed it first. */
function runDismiss(command: Extract<ControllerCommand, { cmd: 'dismiss' }>): void {
    const op = state.operations[command.opId];
    if (!op) return;
    if (op.status === 'running' || op.status === 'queued') {
        throw new Error(`operation ${command.opId} has not finished`);
    }
    delete state.operations[command.opId];
    publish();
}

/** Cancel an op by id. A queued op is dropped before it starts. A running
 *  scan's cancel() resolves result() with what was found so far; runScan then
 *  marks the op `cancelled`. */
function runCancel(command: Extract<ControllerCommand, { cmd: 'cancel' }>): void {
    const op = state.operations[command.opId];
    if (!op) throw new Error(`unknown operation: ${command.opId}`);
    if (op.status === 'queued') {
        op.status = 'cancelled';
        op.finishedAt = nowIso();
        retireOlderOps(op);
        publish();
        return;
    }
    if (op.status !== 'running') return; // already finished — nothing to do
    if (op.kind === 'distribute') {
        if (!contentRun) throw new Error(`operation ${command.opId} is not cancelable`);
        contentRun.cancel();
        return;
    }
    const job = scanJobs.get(command.opId);
    if (!job) throw new Error(`operation ${command.opId} (${op.kind}) is not cancelable`);
    job.cancel();
}

/** Merge `patch` into the record named `name` (created if absent), persist it,
 *  then re-derive and broadcast `known`. */
async function runRecord(command: Extract<ControllerCommand, { cmd: 'record' }>): Promise<void> {
    if (!recordsShowFolder) throw new Error('no show folder open to store controller records');
    const { name, patch } = command;
    const existing = records.find((r) => r.name === name);
    const merged: EzpControllerRecord = { ...(existing ?? { name }), ...patch, name };
    // A patch is a merge, so "clear the override" arrives as an explicit 0
    if (merged.fpsOverride !== undefined && !(merged.fpsOverride > 0)) delete merged.fpsOverride;

    const dir = recordsDir(recordsShowFolder);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(recordFile(recordsShowFolder, name), JSON.stringify(merged, null, 2), 'utf-8');

    if (existing) Object.assign(existing, merged);
    else records.push(merged);
    deriveKnown();
    publish();
}

function proxyFor(dev: DiscoveredController): string | undefined {
    return dev.source.via === 'fpp-proxy' ? dev.source.proxy : undefined;
}

/** Single-controller deep read: re-probe one known device at full depth and
 *  refresh its detail tree + identity in the shared state. */
async function runStatus(
    command: Extract<ControllerCommand, { cmd: 'status' }>,
    origin: ControllerOpOrigin,
): Promise<void> {
    let dev = state.devices[command.id];
    if (!dev && command.address) {
        // Never-scanned target: materialize the device entry from the address.
        dev = {
            id: command.id,
            ip: command.address,
            source: { via: 'direct' },
            seenAt: nowIso(),
        };
    }
    if (!dev) throw new Error(`unknown controller: ${command.id}`);
    // Same-target ops are coalesced.
    if (findActiveOp('status', command.id)) return;

    const op = newOp('status', command.id, `Read ${dev.model || dev.driverType || dev.ip}`, origin);
    state.operations[op.id] = op;
    const started = waitForSlot(op);
    publish();

    let slot = false;
    let release: (() => void) | undefined;
    let checkContentAfter = false;
    try {
        slot = await started;
        if (!slot) return;
        release = holdData?.(dev.ip);
        const probe = await probeController(dev.ip, proxyFor(dev), {
            detail: true,
            preferDriver: dev.driverType,
            expectController: expectsController(dev),
        });
        if (!probe.success && probe.noWebService) {
            // An ordinary host with no web service: note it, but it is not a
            // failed read, since nothing said a controller was there.
            state.devices[command.id] = { ...dev, error: probe.error, unreachable: false, seenAt: nowIso() };
            op.status = 'done';
            op.finishedAt = nowIso();
            return;
        }
        if (!probe.success || !probe.report) {
            if (probe.unreachable && state.devices[command.id]) {
                // Seen before, gone now.
                state.devices[command.id] = {
                    ...dev,
                    unreachable: true,
                    error: 'not responding — powered off or unreachable',
                };
                throw new Error(
                    `${dev.model || dev.driverType || dev.ip} is not responding (powered off or unreachable)`,
                );
            }
            throw new Error(probe.error ?? 'no controller responded');
        }
        state.devices[command.id] = {
            ...dev,
            driverType: probe.report.driverType ?? dev.driverType,
            vendor: probe.report.vendor ?? dev.vendor,
            model: probe.report.model ?? dev.model,
            hostname: probe.report.hostname ?? dev.hostname,
            firmwareVersion: probe.report.firmwareVersion ?? dev.firmwareVersion,
            detail: reportToTree(probe.report) as DiscoveredController['detail'],
            pixelPorts: probe.report.pixelPorts?.map(toControllerPort),
            pixelPortCount: probe.report.pixelPortCount ?? dev.pixelPortCount,
            serialPorts: probe.report.serialPorts?.map(toControllerSerialPort),
            serialPortCount: probe.report.serialPortCount ?? dev.serialPortCount,
            panelMatrices: probe.report.panelMatrices?.map(toControllerPanelMatrix),
            virtualMatrices: probe.report.virtualMatrices?.map(toControllerVirtualMatrix),
            inputs: probe.report.inputs,
            actions: probe.driver?.getActions(),
            error: undefined,
            unreachable: false,
            seenAt: nowIso(),
        };
        op.status = 'done';
        op.finishedAt = nowIso();
        checkContentAfter = true;
    } catch (err) {
        op.status = 'error';
        op.error = (err as Error).message;
        op.finishedAt = nowIso();
        throw err;
    } finally {
        release?.();
        if (slot) releaseSlot('status');
        publish();
        retireOlderOps(op);
        // What this device holds is part of its detail, but reading it is many
        // small requests — so it runs after the data hold is released and
        // outside the op, and a failure is not a failed read.
        if (checkContentAfter) {
            void refreshContentStatus(command.id).catch((e) =>
                console.warn(`[controller-ops] content check for ${dev.ip} failed:`, (e as Error).message),
            );
        }
    }
}

/** Run a driver action (e.g. reboot) against one known controller. */
async function runAction(
    command: Extract<ControllerCommand, { cmd: 'action' }>,
    origin: ControllerOpOrigin,
): Promise<void> {
    const dev = state.devices[command.id];
    if (!dev) throw new Error(`unknown controller: ${command.id}`);
    // Same-target ops are coalesced.
    if (findActiveOp('action', command.id)) return;

    const op = newOp('action', command.id, `${command.action} ${dev.model || dev.driverType || dev.ip}`, origin);
    state.operations[op.id] = op;
    const started = waitForSlot(op);
    publish();

    let slot = false;
    try {
        slot = await started;
        if (!slot) return;
        const probe = await probeController(dev.ip, proxyFor(dev), {
            preferDriver: dev.driverType,
            expectController: expectsController(dev),
        });
        if (!probe.success || !probe.driver) {
            throw new Error(probe.error ?? 'no controller responded');
        }
        const result = await probe.driver.runAction(command.action);
        if (!result.success) throw new Error(result.message || `${command.action} failed`);
        op.status = 'done';
        op.finishedAt = nowIso();
    } catch (err) {
        op.status = 'error';
        op.error = (err as Error).message;
        op.finishedAt = nowIso();
        throw err;
    } finally {
        if (slot) releaseSlot('action');
        publish();
        retireOlderOps(op);
    }
}

/** Core ControllerModelIntent[] → the library's per-(model,string)
 *  ModelPortIntent[], expanding multi-string models across ports. */
function toLibIntents(mis: ControllerModelIntent[]): ModelPortIntent[] {
    const out: ModelPortIntent[] = [];
    for (const mi of mis) {
        const settings = {
            channelsPerPixel: mi.channelsPerPixel,
            colorOrder: mi.colorOrder,
            nullPixels: mi.nullPixels,
            endNullPixels: mi.endNullPixels,
            brightness: mi.brightness,
            gamma: mi.gamma,
            groupCount: mi.groupCount,
            reverse: mi.reverse,
            zigZag: mi.zigZag,
            smartRemoteType: mi.smartRemoteType,
            ts: mi.ts,
        };
        if (mi.stringStartChannels && mi.stringNodeCounts && mi.stringStartChannels.length > 1) {
            out.push(
                ...expandModelStrings({
                    name: mi.name,
                    port: mi.controllerPort,
                    protocol: mi.protocol,
                    stringStartChannels: mi.stringStartChannels,
                    stringNodeCounts: mi.stringNodeCounts,
                    stringChannels: mi.stringChannels ?? mi.stringNodeCounts.map((n) => n * (mi.channelsPerPixel ?? 3)),
                    smartRemote: mi.smartRemote,
                    srCascadeOnPort: mi.srCascadeOnPort,
                    srMaxCascade: mi.srMaxCascade,
                    ...settings,
                }),
            );
        } else {
            out.push({
                name: mi.name,
                controllerPort: mi.controllerPort,
                protocol: mi.protocol,
                startChannel: mi.startChannel,
                nodeCount: mi.nodeCount,
                channels: mi.channels,
                smartRemote: mi.smartRemote,
                ...settings,
            });
        }
    }
    return out;
}

/** Push the xLights-derived config to one controller (inputs and/or string
 *  outputs), then re-read it so the grid reflects the device's new truth.
 *  The intent comes from the known record joined by address. */
async function runUpload(
    command: Extract<ControllerCommand, { cmd: 'upload' }>,
    origin: ControllerOpOrigin,
): Promise<void> {
    const dev = state.devices[command.id];
    if (!dev) throw new Error(`unknown controller: ${command.id}`);
    if (findActiveOp('upload', command.id)) return;

    const rec = (state.known ?? []).find((k) => k.address === dev.ip || (dev.hostname && k.address === dev.hostname));
    if (!rec) throw new Error(`no known controller record matches ${dev.ip} — upload needs xLights intent`);
    const wantStrings = command.scope !== 'inputs';
    const wantInputs = command.scope !== 'strings';
    const hasIntent =
        !!rec.modelIntents?.length ||
        !!rec.serialPorts?.length ||
        !!rec.panelMatrices?.length ||
        !!rec.virtualMatrices?.length;
    // A controller in the xLights layout with no models on it is intent too:
    // uploading clears its ports. Only a record of our own has nothing to say.
    if (wantStrings && !hasIntent && rec.source === 'ezp') {
        throw new Error(`"${rec.name}" has no model/port intent from xLights to upload`);
    }
    if (wantInputs && !rec.outputs?.length) {
        throw new Error(`"${rec.name}" has no outputs (universes) from xLights to upload`);
    }

    const op = newOp('upload', command.id, `Upload ${command.scope} → ${rec.name}`, origin);
    state.operations[op.id] = op;
    const started = waitForSlot(op);
    publish();

    let slot = false;
    let release: (() => void) | undefined;
    try {
        slot = await started;
        if (!slot) return;
        // A controller needing an upload is not outputting correctly anyway,
        // and an interrupted upload leaves it worse off, so its data stays held
        // for the whole operation.
        release = holdData?.(dev.ip);
        // Upload needs xLights intent, so a controller is expected here.
        const probe = await probeController(dev.ip, proxyFor(dev), {
            preferDriver: dev.driverType,
            expectController: true,
        });
        if (!probe.success || !probe.driver) {
            throw new Error(probe.error ?? 'no controller responded');
        }
        const warnings: string[] = [];
        // Pre-upload capability gate: errors abort before anything is written;
        // warnings ride along.
        const caps = rec.vendor && rec.model ? getCapabilities(rec.vendor, rec.model, rec.variant ?? '') : undefined;
        const capCheck = (input: Parameters<typeof checkUpload>[1]): void => {
            if (!caps) return;
            const res = checkUpload(caps, input);
            warnings.push(...res.warnings);
            if (!res.ok) {
                throw new Error(`capability check failed: ${res.errors.join('; ')}`);
            }
        };
        if (wantInputs) {
            const cfg = (rec.outputs ?? []).map((o) => ({
                universe: o.universe ?? 0,
                startChannel: o.startChannel,
                channels: o.channels,
                protocol: o.type,
                keepChannelNumbers: o.keepChannelNumbers,
            }));
            capCheck({ inputUniverses: cfg });
            const r = await probe.driver.setInputUniverses(cfg, { boardMode: caps?.v4BoardMode });
            if (!r.success)
                throw new Error(`input upload failed: ${r.message ?? r.errors?.join('; ') ?? 'unknown error'}`);
            if (r.warnings) warnings.push(...r.warnings);
        }
        if (wantStrings) {
            const outputs = (rec.outputs ?? []).map((o): OutputConfig => ({
                type: o.type,
                universe: o.universe,
                startChannel: o.startChannel,
                channels: o.channels,
            }));
            const derived = deriveXlightsPortConfigs(toLibIntents(rec.modelIntents ?? []), {
                outputs: outputs.length ? outputs : undefined,
                controllerStartChannel: rec.startChannel,
            });
            if (command.fullControl) {
                // Full control: unset per-string settings become the defaults
                // instead of "keep whatever the device has".
                const defBrightness = rec.defaultBrightness ?? 100;
                const defGamma = rec.defaultGamma ?? 1.0;
                const stamp = <
                    T extends {
                        brightness?: number;
                        gamma?: number;
                        colorOrder?: string;
                        nullPixels?: number;
                        endNullPixels?: number;
                        groupCount?: number;
                        zigZag?: number;
                        reverse?: boolean;
                    },
                >(
                    s: T,
                ): void => {
                    s.brightness ??= defBrightness;
                    s.gamma ??= defGamma;
                    s.colorOrder ??= 'RGB';
                    s.nullPixels ??= 0;
                    s.endNullPixels ??= 0;
                    s.groupCount ??= 1;
                    s.zigZag ??= 0;
                    s.reverse ??= false;
                };
                for (const p of derived.ports) {
                    stamp(p);
                    for (const vs of p.virtualStrings ?? []) if (!vs.isDummy) stamp(vs);
                }
            }
            for (const s of derived.skipped) warnings.push(`port ${s.port} skipped: ${s.detail}`);
            // Serial (DMX/Renard/LOR) ports ride alongside, never as pixels.
            const serialPorts: SerialPortConfig[] = (rec.serialPorts ?? [])
                .filter((sp) => sp.channels > 0 && sp.startChannel !== undefined)
                .map((sp) => ({
                    port: sp.port - 1, // 1-based xLights port → 0-based config index
                    protocol: sp.protocol ?? 'dmx',
                    startChannel: sp.startChannel!,
                    channels: sp.channels,
                }));
            const panelMatrices: PanelMatrixConfig[] = (rec.panelMatrices ?? []).map((pm) => ({
                port: pm.port,
                startChannel: pm.startChannel,
                protocol: pm.protocol,
            }));
            const virtualMatrices: VirtualMatrixConfig[] = (rec.virtualMatrices ?? []).map((vm) => ({
                name: vm.model,
                port: vm.port,
                startChannel: vm.startChannel,
                channelCount: vm.channels,
                width: vm.width,
                height: vm.height,
            }));
            const hasMatrices = panelMatrices.length > 0 || virtualMatrices.length > 0;
            capCheck({ pixelPorts: derived.ports, serialPorts, panelMatrices, virtualMatrices });
            const setOpts: SetOutputsOptions = {
                inputMode: rec.protocol?.toUpperCase(),
                // Falcon V4/V5: the layout's variant fixes the board mode.
                boardMode: caps?.v4BoardMode,
                // Whether the stream keeps absolute channel numbers, which some
                // drivers need to put port start channels in the same frame.
                keepChannelNumbers: (rec.outputs ?? [])[0]?.keepChannelNumbers,
                outputs: outputs.length
                    ? outputs.map((o) => ({
                          universe: o.universe ?? 0,
                          startChannel: o.startChannel,
                          channels: o.channels,
                      }))
                    : undefined,
            };
            // A controller driving only matrices has no string configuration to
            // write. Otherwise an empty one is sent on purpose: the layout puts
            // nothing on those ports, so they are cleared.
            if (derived.ports.length > 0 || serialPorts.length > 0 || !hasMatrices) {
                const r = await probe.driver.setOutputs(derived.ports, serialPorts, setOpts);
                if (!r.success)
                    throw new Error(`string upload failed: ${r.message ?? r.errors?.join('; ') ?? 'unknown error'}`);
                if (r.warnings) warnings.push(...r.warnings);
            }
            // LED panel matrices are bound to channels, never created: their
            // panel geometry lives on the controller.
            if (panelMatrices.length) {
                const r = await probe.driver.setPanelMatrices(panelMatrices);
                if (r.warnings) warnings.push(...r.warnings);
                if (!r.success) throw new Error(`panel matrix upload failed: ${r.message ?? 'unknown error'}`);
            }
            if (virtualMatrices.length) {
                const r = await probe.driver.setVirtualMatrices(virtualMatrices);
                if (r.warnings) warnings.push(...r.warnings);
                if (!r.success) throw new Error(`virtual matrix upload failed: ${r.message ?? 'unknown error'}`);
            }
        }
        try {
            const applied = await probe.driver.applyConfig();
            if (!applied.success) warnings.push(`apply step failed: ${applied.message ?? 'unknown error'}`);
        } catch (e) {
            warnings.push(`apply step failed: ${(e as Error).message}`);
        }
        if (warnings.length) {
            console.warn(`[controller-ops] upload warnings for ${rec.name}:`, warnings);
            op.label += ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''}: ${warnings.join('; ')})`;
        }
        // Read back so the reconcile grid reflects the device's new truth.
        try {
            const verify = await probeController(dev.ip, proxyFor(dev), {
                detail: true,
                preferDriver: dev.driverType,
                expectController: true,
            });
            if (verify.success && verify.report) {
                state.devices[command.id] = {
                    ...dev,
                    detail: reportToTree(verify.report) as DiscoveredController['detail'],
                    pixelPorts: verify.report.pixelPorts?.map(toControllerPort),
                    pixelPortCount: verify.report.pixelPortCount ?? dev.pixelPortCount,
                    serialPorts: verify.report.serialPorts?.map(toControllerSerialPort),
                    serialPortCount: verify.report.serialPortCount ?? dev.serialPortCount,
                    panelMatrices: verify.report.panelMatrices?.map(toControllerPanelMatrix),
                    virtualMatrices: verify.report.virtualMatrices?.map(toControllerVirtualMatrix),
                    inputs: verify.report.inputs,
                    error: undefined,
                    unreachable: false,
                    seenAt: nowIso(),
                };
            }
        } catch (e) {
            console.warn('[controller-ops] post-upload read-back failed:', e);
        }
        op.status = 'done';
        op.finishedAt = nowIso();
    } catch (err) {
        op.status = 'error';
        op.error = (err as Error).message;
        op.finishedAt = nowIso();
        throw err;
    } finally {
        release?.();
        if (slot) releaseSlot('upload');
        publish();
        retireOlderOps(op);
    }
}

// ---------------------------------------------------------------------------
// Content distribution — this show's sequences and media onto the devices that
// hold their own copy. One run covers every target; see content-dist.ts for
// target selection, the plan, and the mapping to the broadcast shapes.
// ---------------------------------------------------------------------------

/** What the player is currently showing, supplied by the owner of that state. */
export interface ContentSourceInfo {
    sequences: SequenceRecord[];
    settings?: PlaybackSettings;
    /** False while a show is playing; automatic runs wait for a stopped player. */
    idle: boolean;
}

let contentSource: (() => ContentSourceInfo) | undefined;
/** Injected by the show owner (ipcezplayer), which holds songs and settings. */
export function setContentSource(fn: () => ContentSourceInfo): void {
    contentSource = fn;
}

/** The run in flight, for cancel and for progress. */
let contentRun: ContentSyncRun | undefined;
/** Sequences waiting for the next automatic run, by fseq file name. */
const contentQueue = new Set<string>();
let lastContentRunMs: number | undefined;

/** Progress is published on a timer: a chunk-by-chunk publish would broadcast
 *  the whole controller state hundreds of times for one file. */
const CONTENT_PUBLISH_MS = 400;

function contentDistState(): NonNullable<ControllerOpsState['contentDist']> {
    state.contentDist ??= {};
    return state.contentDist;
}

function publishQueue(): void {
    const cd = contentDistState();
    if (contentQueue.size) cd.queued = [...contentQueue].sort();
    else delete cd.queued;
}

/**
 * Queue content for the next automatic run — a song the user just added, or one
 * the cloud poller installed. Nothing is sent here: whether to act, and when,
 * is `contentAutoDecision`'s call.
 */
export function queueContentForDistribution(fseqNames: string[]): void {
    let added = false;
    for (const name of fseqNames) {
        if (!name) continue;
        const base = path.basename(name);
        if (!contentQueue.has(base)) {
            contentQueue.add(base);
            added = true;
        }
    }
    if (!added) return;
    publishQueue();
    publish();
}

/**
 * One tick of automatic distribution. Called on a timer by the show owner;
 * does nothing unless the settings allow it, the player is idle, and there is
 * either queued content or a poll due.
 */
export async function maybeDistributeAutomatically(): Promise<void> {
    if (!contentSource) return;
    if (state.contentDist?.run) return;
    const info = contentSource();
    const settings = info.settings?.contentDistribution;
    const now = new Date();
    const decision = contentAutoDecision(settings, now, {
        queued: contentQueue.size,
        lastRunMs: lastContentRunMs,
        nowMs: now.getTime(),
    });
    if (!decision.act) {
        const cd = contentDistState();
        if (cd.autoHold !== decision.hold) {
            cd.autoHold = decision.hold;
            publish();
        }
        return;
    }
    // Sending a show competes with playing one for disk and network.
    if (!info.idle) return;
    const queued = [...contentQueue];
    contentQueue.clear();
    publishQueue();
    try {
        await runDistribute(
            { cmd: 'distribute', ...(decision.trigger === 'songs' && queued.length ? { sequences: queued } : {}) },
            'auto',
            decision.trigger,
        );
    } catch (e) {
        // The op carries its own failure; put the queue back so the next tick
        // tries again rather than losing what was asked for.
        for (const name of queued) contentQueue.add(name);
        publishQueue();
        console.warn('[controller-ops] automatic distribution failed:', (e as Error).message);
    }
}

/**
 * A content check costs two metadata reads per sequence, so a refresh only
 * re-checks a device whose answer has gone stale. A "refresh all" right after
 * a distribution therefore adds nothing.
 */
const CONTENT_CHECK_FRESH_MS = 10 * 60_000;

/**
 * Fill in one device's `contentStatus` after a deep read, so its row and
 * detail show what it holds without waiting for a distribution. Quiet and
 * best-effort: this is a detail of a status read, not the point of it, and it
 * leaves the last run's report alone.
 */
async function refreshContentStatus(id: string): Promise<void> {
    if (!contentSource) return;
    if (state.contentDist?.run) return; // a run is already reading these
    const dev = state.devices[id];
    if (!dev || !isContentTarget(dev) || dev.unreachable) return;
    const checkedAt = dev.contentStatus?.checkedAt;
    if (checkedAt && Date.now() - Date.parse(checkedAt) < CONTENT_CHECK_FRESH_MS) return;

    const { sequences, settings } = contentSource();
    const { plan } = await buildContentPlan(sequences, settings);
    if (!plan.sequences.length) return;
    const targets = contentTargetsFor([dev], [dev.id]);
    if (!targets.length) return;

    // Check only: this reads the device's own file list and sends nothing.
    const report = toContentDistReport(await new ContentSyncRun(plan, targets, { dryRun: true }).run(), {
        checkOnly: true,
        trigger: 'manual',
    });
    const target = report.targets[0];
    const current = state.devices[id];
    if (target && current) {
        state.devices[id] = { ...current, contentStatus: contentStatusFor(target) };
        publish();
    }
}

/** Send show content to the chosen targets, or work out what is missing. */
async function runDistribute(
    command: Extract<ControllerCommand, { cmd: 'distribute' }>,
    origin: ControllerOpOrigin,
    trigger: ContentDistTrigger = 'manual',
): Promise<void> {
    if (!contentSource) throw new Error('no show is open to distribute');
    if (state.contentDist?.run) return; // one at a time; the running op is the answer
    const checkOnly = !!command.checkOnly;
    const { sequences, settings } = contentSource();

    const targets = contentTargetsFor(Object.values(state.devices), command.ids);
    if (!targets.length) {
        throw new Error('no FPP targets known — scan for controllers first');
    }
    const { plan, skipped } = await buildContentPlan(sequences, settings, command.sequences);
    if (!plan.sequences.length) {
        throw new Error(
            command.sequences?.length ? 'none of those sequences have a file on disk' : 'this show has no sequences',
        );
    }
    for (const s of skipped) console.warn(`[controller-ops] not distributing ${s.name}: ${s.reason}`);

    const label = `${checkOnly ? 'Check' : 'Distribute'} ${plan.sequences.length} sequence${
        plan.sequences.length === 1 ? '' : 's'
    } to ${targets.length} device${targets.length === 1 ? '' : 's'}`;
    const op = newOp('distribute', `distribute:${targets.map((t) => t.id).join(',')}`, label, origin);
    state.operations[op.id] = op;
    const started = waitForSlot(op);
    publish();

    let slot = false;
    let timer: NodeJS.Timeout | undefined;
    try {
        slot = await started;
        if (!slot) return;

        const run = new ContentSyncRun(plan, targets, { dryRun: checkOnly });
        contentRun = run;
        const pushProgress = () => {
            contentDistState().run = toContentDistRun(run.snapshot, { opId: op.id, checkOnly, trigger });
            publish();
        };
        pushProgress();
        timer = setInterval(pushProgress, CONTENT_PUBLISH_MS);

        const report = await run.run();
        lastContentRunMs = Date.now();

        const cd = contentDistState();
        delete cd.run;
        cd.lastReport = toContentDistReport(report, { checkOnly, trigger });
        delete cd.autoHold;

        // Each device's row learns what it now holds.
        for (const target of cd.lastReport.targets) {
            const dev = state.devices[target.id];
            if (dev) state.devices[target.id] = { ...dev, contentStatus: contentStatusFor(target) };
        }

        op.status = report.cancelled ? 'cancelled' : 'done';
        op.finishedAt = nowIso();
        if (report.totals.targetsFailed > 0) {
            op.status = 'error';
            op.error = `${report.totals.targetsFailed} of ${report.totals.targets} device(s) failed`;
        }
    } catch (err) {
        delete contentDistState().run;
        op.status = 'error';
        op.error = (err as Error).message;
        op.finishedAt = nowIso();
        throw err;
    } finally {
        if (timer) clearInterval(timer);
        contentRun = undefined;
        if (slot) releaseSlot('distribute');
        publish();
        retireOlderOps(op);
    }
}

function scanTarget(command: Extract<ControllerCommand, { cmd: 'scan' }>): string {
    const nets = command.networks?.length ? command.networks.map((n) => n.cidr).join(',') : 'self';
    return `scan:${nets}@${command.depth}`;
}

async function runScan(
    command: Extract<ControllerCommand, { cmd: 'scan' }>,
    origin: ControllerOpOrigin,
): Promise<DiscoveryResult> {
    if (activeScans >= MAX_CONCURRENT_SCANS) {
        throw new Error(`too many concurrent discovery scans (max ${MAX_CONCURRENT_SCANS})`);
    }
    if (findActiveOp('scan', scanTarget(command))) {
        throw new Error('an identical scan is already running');
    }

    const op: ControllerOp = {
        id: `op_${Date.now()}_${++opCounter}`,
        kind: 'scan',
        target: scanTarget(command),
        label: `Discover ${command.networks?.length ? command.networks.map((n) => n.cidr).join(', ') : 'host networks'} (${command.depth})`,
        status: 'running',
        origin,
        startedAt: nowIso(),
    };
    state.operations[op.id] = op;
    publish();

    activeScans++;
    try {
        const request: DiscoveryRequest = {
            networks: command.networks ?? [],
            depth: command.depth,
            recurseFppProxies: command.recurseFppProxies,
            // recurseEzpProxies intentionally not forwarded: a run must not
            // chain federation onward.
        };
        const generation = resetGeneration;
        const job = startScanJob(request, (ev) => {
            if (ev.ev === 'progress') {
                op.progress = ev.progress;
                publish();
            } else if (ev.ev === 'device' && generation === resetGeneration) {
                mergeDevice(ev.device);
                publish();
            }
        });
        scanJobs.set(op.id, job);
        const result = await job.result();
        if (generation === resetGeneration) for (const d of result.devices) mergeDevice(d);
        // A cancelled job still resolves result(); the final progress phase
        // says how the run actually ended.
        op.status = op.progress?.phase === 'cancelled' ? 'cancelled' : 'done';
        if (op.status === 'done' && generation === resetGeneration) {
            markUnseenUnreachable(request.networks, result.devices);
        }
        op.finishedAt = nowIso();
        publish();
        return result;
    } catch (err) {
        op.status = 'error';
        op.error = (err as Error).message;
        op.finishedAt = nowIso();
        publish();
        throw err;
    } finally {
        scanJobs.delete(op.id);
        activeScans--;
        retireOlderOps(op);
    }
}

/**
 * After a completed scan, flag directly-reached devices that the scan did
 *  NOT find as unreachable so the grid shows its record absent.
 */
function markUnseenUnreachable(networks: { cidr: string }[], found: DiscoveryDevice[]): void {
    if (networks.length === 0) return;
    const seen = new Set(found.map(deviceKey));
    for (const dev of Object.values(state.devices)) {
        if (dev.source.via !== 'direct' || seen.has(dev.id)) continue;
        if (!networks.some((n) => ipInCidr(dev.ip, n.cidr))) continue;
        if (!dev.unreachable) {
            dev.unreachable = true;
            dev.error = 'not found by the last scan of its network';
        }
    }
}

// ---------------------------------------------------------------------------
// Execution seam — in-process discovery.
// ---------------------------------------------------------------------------

type ScanEvent =
    { ev: 'progress'; progress: NonNullable<ControllerOp['progress']> } | { ev: 'device'; device: DiscoveryDevice };

/** Start a discovery in-process, streaming events to `onEvent`. */
function startScanJob(request: DiscoveryRequest, onEvent: (ev: ScanEvent) => void): DiscoveryJob {
    // The build bundles the lib's scanner worker as dist/workers/scanner-worker.js;
    // __dirname is dist/ for the bundled main.
    const workerPath = path.join(__dirname, 'workers', 'scanner-worker.js');
    const job = discover(request, { workerPath });
    job.onProgress((p) =>
        onEvent({
            ev: 'progress',
            progress: {
                phase: p.phase,
                scanned: p.scanned,
                total: p.total,
                alive: p.alive,
                identified: p.identified,
            },
        }),
    );
    job.onDevice((d) => onEvent({ ev: 'device', device: d }));
    return job;
}
