/**
 * Controller operations subsystem (main process). Owns the authoritative
 * `controllerops` state and the single dispatcher every entry point (LAN HTTP
 * route, LAN WebSocket message, cloud commands) funnels into. State changes
 * are broadcast to all clients over the WebSocket.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
    ControllerCommand,
    ControllerModelIntent,
    ControllerOp,
    ControllerOpOrigin,
    ControllerOpsState,
    ControllerPort,
    DiscoveredController,
    EzpControllerRecord,
    KnownController,
    NetworkPolicy,
} from '@ezplayer/ezplayer-core';
import { applyOverrides } from '@ezplayer/ezplayer-core';
import type {
    DiscoveryDevice,
    DiscoveryJob,
    DiscoveryRequest,
    DiscoveryResult,
    ModelPortIntent,
    OutputConfig,
    PixelPortInfo,
} from '@ezplayer/epp-controllers';
import { discover, probeController, reportToTree, deriveXlightsPortConfigs, expandModelStrings, getCapabilities, checkUpload } from '@ezplayer/epp-controllers';
import { hostNetworks } from '../cli/net.js';
import * as fsp from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hard cap on concurrent local discovery scans.
const MAX_CONCURRENT_SCANS = 2;
// Keep at most this many finished ops around for late-joining clients.
const MAX_RETAINED_OPS = 20;

let activeScans = 0;
let opCounter = 0;

// Live job handles for running scan ops, so `cancel` can reach the engine.
const scanJobs = new Map<string, DiscoveryJob>();

const state: ControllerOpsState = { interfaces: [], devices: {}, operations: {}, known: [], networkPolicies: [] };

// Injected by server-worker-manager, so this module needs no dependency on it.
let broadcast: ((state: ControllerOpsState) => void) | null = null;
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
    state.known = applyOverrides(xlightsKnown, records);
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
    });
}

// ---------------------------------------------------------------------------
// Network policies — persisted per-network allow/expect flags, one JSON file
// (`<showFolder>/.ezplayer/networks.json`), enforced by scan + device proxy.
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
            state.networkPolicies = parsed
                .map(parseNetworkPolicy)
                .filter((p): p is NetworkPolicy => p !== null);
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

/** Whether scanning/proxying into this network/IP is administratively allowed. */
export function isNetworkAllowed(cidrOrIp: string): boolean {
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
        if (next.driverType === undefined) next.driverType = prev.driverType;
        if (next.vendor === undefined) next.vendor = prev.vendor;
        if (next.model === undefined) next.model = prev.model;
        if (next.firmwareVersion === undefined) next.firmwareVersion = prev.firmwareVersion;
        if (next.mac === undefined) next.mac = prev.mac;
        if (next.oui === undefined) next.oui = prev.oui;
        if (next.hostname === undefined) next.hostname = prev.hostname;
    }
    state.devices[key] = next;
}

/** An already-running op of this kind for this target, if any (dedup/coalesce). */
function findRunningOp(kind: ControllerOp['kind'], target: string): ControllerOp | undefined {
    return Object.values(state.operations).find(
        (o) => o.status === 'running' && o.kind === kind && o.target === target,
    );
}

function pruneOps(): void {
    const done = Object.values(state.operations).filter((o) => o.status !== 'running');
    if (done.length <= MAX_RETAINED_OPS) return;
    done.sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''));
    for (const o of done.slice(0, done.length - MAX_RETAINED_OPS)) {
        delete state.operations[o.id];
    }
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
    }
}

/** Cancel a running scan op by op id. The job's cancel() resolves result()
 *  with what was found so far; runScan then marks the op `cancelled`. */
function runCancel(command: Extract<ControllerCommand, { cmd: 'cancel' }>): void {
    const op = state.operations[command.opId];
    if (!op) throw new Error(`unknown operation: ${command.opId}`);
    if (op.status !== 'running') return; // already finished — nothing to do
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
    if (findRunningOp('status', command.id)) return;

    const op: ControllerOp = {
        id: `op_${Date.now()}_${++opCounter}`,
        kind: 'status',
        target: command.id,
        label: `Read ${dev.model || dev.driverType || dev.ip}`,
        status: 'running',
        origin,
        startedAt: nowIso(),
    };
    state.operations[op.id] = op;
    publish();

    try {
        const probe = await probeController(dev.ip, proxyFor(dev), { detail: true, preferDriver: dev.driverType });
        if (!probe.success || !probe.report) {
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
            actions: probe.driver?.getActions(),
            error: undefined,
            seenAt: nowIso(),
        };
        op.status = 'done';
        op.finishedAt = nowIso();
    } catch (err) {
        op.status = 'error';
        op.error = (err as Error).message;
        op.finishedAt = nowIso();
        throw err;
    } finally {
        publish();
        pruneOps();
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
    if (findRunningOp('action', command.id)) return;

    const op: ControllerOp = {
        id: `op_${Date.now()}_${++opCounter}`,
        kind: 'action',
        target: command.id,
        label: `${command.action} ${dev.model || dev.driverType || dev.ip}`,
        status: 'running',
        origin,
        startedAt: nowIso(),
    };
    state.operations[op.id] = op;
    publish();

    try {
        const probe = await probeController(dev.ip, proxyFor(dev), { preferDriver: dev.driverType });
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
        publish();
        pruneOps();
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
                    stringChannels:
                        mi.stringChannels ??
                        mi.stringNodeCounts.map((n) => n * (mi.channelsPerPixel ?? 3)),
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
    if (findRunningOp('upload', command.id)) return;

    const rec = (state.known ?? []).find(
        (k) => k.address === dev.ip || (dev.hostname && k.address === dev.hostname),
    );
    if (!rec) throw new Error(`no known controller record matches ${dev.ip} — upload needs xLights intent`);
    const wantStrings = command.scope !== 'inputs';
    const wantInputs = command.scope !== 'strings';
    if (wantStrings && !rec.modelIntents?.length) {
        throw new Error(`"${rec.name}" has no model/port intent from xLights to upload`);
    }
    if (wantInputs && !rec.outputs?.length) {
        throw new Error(`"${rec.name}" has no outputs (universes) from xLights to upload`);
    }

    const op: ControllerOp = {
        id: `op_${Date.now()}_${++opCounter}`,
        kind: 'upload',
        target: command.id,
        label: `Upload ${command.scope} → ${rec.name}`,
        status: 'running',
        origin,
        startedAt: nowIso(),
    };
    state.operations[op.id] = op;
    publish();

    try {
        const probe = await probeController(dev.ip, proxyFor(dev), { preferDriver: dev.driverType });
        if (!probe.success || !probe.driver) {
            throw new Error(probe.error ?? 'no controller responded');
        }
        const warnings: string[] = [];
        // Pre-upload capability gate: errors abort before anything is written;
        // warnings ride along.
        const caps = rec.vendor && rec.model
            ? getCapabilities(rec.vendor, rec.model, rec.variant ?? '')
            : undefined;
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
            }));
            capCheck({ inputUniverses: cfg });
            const r = await probe.driver.setInputUniverses(cfg);
            if (!r.success) throw new Error(`input upload failed: ${r.message ?? r.errors?.join('; ') ?? 'unknown error'}`);
            if (r.warnings) warnings.push(...r.warnings);
        }
        if (wantStrings) {
            const outputs = (rec.outputs ?? []).map(
                (o): OutputConfig => ({
                    type: o.type,
                    universe: o.universe,
                    startChannel: o.startChannel,
                    channels: o.channels,
                }),
            );
            const derived = deriveXlightsPortConfigs(toLibIntents(rec.modelIntents ?? []), {
                outputs: outputs.length ? outputs : undefined,
                controllerStartChannel: rec.startChannel,
            });
            if (command.fullControl) {
                // Full control: unset per-string settings become the defaults
                // instead of "keep whatever the device has".
                const defBrightness = rec.defaultBrightness ?? 100;
                const defGamma = rec.defaultGamma ?? 1.0;
                const stamp = <T extends { brightness?: number; gamma?: number; colorOrder?: string;
                    nullPixels?: number; endNullPixels?: number; groupCount?: number;
                    zigZag?: number; reverse?: boolean }>(s: T): void => {
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
            if (derived.ports.length === 0) throw new Error('derivation produced no uploadable ports');
            capCheck({ pixelPorts: derived.ports, serialPorts: [] });
            const r = await probe.driver.setOutputs(derived.ports, []);
            if (!r.success) throw new Error(`string upload failed: ${r.message ?? r.errors?.join('; ') ?? 'unknown error'}`);
            if (r.warnings) warnings.push(...r.warnings);
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
            const verify = await probeController(dev.ip, proxyFor(dev), { detail: true, preferDriver: dev.driverType });
            if (verify.success && verify.report) {
                state.devices[command.id] = {
                    ...dev,
                    detail: reportToTree(verify.report) as DiscoveredController['detail'],
                    pixelPorts: verify.report.pixelPorts?.map(toControllerPort),
                    error: undefined,
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
        publish();
        pruneOps();
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
    if (findRunningOp('scan', scanTarget(command))) {
        throw new Error('an identical scan is already running');
    }
    // Refuse scans into policy-disallowed networks outright.
    const denied = (command.networks ?? []).filter((n) => !isNetworkAllowed(n.cidr));
    if (denied.length > 0) {
        throw new Error(`network(s) disallowed by policy: ${denied.map((n) => n.cidr).join(', ')}`);
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
        const job = startScanJob(request, (ev) => {
            if (ev.ev === 'progress') {
                op.progress = ev.progress;
                publish();
            } else if (ev.ev === 'device') {
                mergeDevice(ev.device);
                publish();
            }
        });
        scanJobs.set(op.id, job);
        const result = await job.result();
        for (const d of result.devices) mergeDevice(d);
        // A cancelled job still resolves result(); the final progress phase
        // says how the run actually ended.
        op.status = op.progress?.phase === 'cancelled' ? 'cancelled' : 'done';
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
        pruneOps();
    }
}

// ---------------------------------------------------------------------------
// Execution seam — in-process discovery.
// ---------------------------------------------------------------------------

type ScanEvent =
    | { ev: 'progress'; progress: NonNullable<ControllerOp['progress']> }
    | { ev: 'device'; device: DiscoveryDevice };

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
