/**
 * Port-map building for the controller visualizer: expand per-model intents
 * (multi-string spreads, smart-remote cascades) into per-string placements,
 * then pack them into renderable boxes in data-chain order. Pure and
 * dependency-free so the UI can run it client-side.
 */

import type {
    ControllerModelIntent,
    ControllerPort,
    ControllerPortIntent,
    ControllerSerialPort,
    ControllerSerialPortIntent,
} from '../types/ControllerOps';

/** Ports per smart-remote bank. */
export const PORTS_PER_SMARTREMOTE = 4;

/** One physical string placed on a port (possibly a smart-remote slot). */
export interface PortMapString {
    /** Base model name (no -str-N suffix). */
    model: string;
    /** 1-based string index within the model. */
    stringIndex: number;
    /** Total strings in the model (1 = single-string). */
    stringCount: number;
    /** Resolved 1-based physical port. */
    port: number;
    /** Resolved smart-remote slot: 0 = none, 1 = A, 2 = B, … */
    smartRemote: number;
    smartRemoteType?: string;
    /** Absolute 1-based start channel; undefined when only summary intent exists. */
    startChannel?: number;
    /** Pixels on this string; undefined when unknown (grouped summary intent). */
    nodeCount?: number;
    protocol?: string;
}

/** One renderable box: a model spanning `span` port rows starting at `firstPort`,
 *  placed at chain `column` (1-based, left→right in data-chain order). */
export interface PortMapBox {
    model: string;
    firstPort: number;
    /** Port rows spanned (multi-string spreads span >1). */
    span: number;
    column: number;
    /** Total pixels across the box's strings; undefined when unknown. */
    totalPixels?: number;
    protocol?: string;
    /** Distinct smart-remote slots in use (1 = A …), empty when none. */
    smartRemotes: number[];
    smartRemoteType?: string;
    /** Per-string breakdown, in string order. */
    strings: PortMapString[];
}

/** One port row of the map: the axis label plus the intent-vs-actual overlay. */
export interface PortMapRow {
    port: number;
    /** Sum of intended pixels on this port (from the expanded strings). */
    intendedPixels?: number;
    /** Pixels the device actually reports configured on this port. */
    actualPixels?: number;
    /** Model name the device reports, when it has one. */
    actualModel?: string;
    /** True when intended and actual pixel counts disagree. */
    drift: boolean;
}

/** One serial (DMX/…) port row: channels rather than pixels, no chain boxes. */
export interface PortMapSerialRow {
    port: number;
    /** Model names xLights puts on this port, in channel order. */
    models: string[];
    intendedChannels?: number;
    intendedProtocol?: string;
    actualChannels?: number;
    actualProtocol?: string;
    actualModel?: string;
    /** True when the device carries fewer channels than intended, or the
     *  intent/actual presence disagrees. */
    drift: boolean;
}

export interface PortMapOptions {
    /** Pixel ports the controller has; rows always run 1..this (else 1..max used). */
    pixelPortCount?: number;
    /** Serial ports the controller has; serial rows always run 1..this. */
    serialPortCount?: number;
    /** xLights serial-port intent. */
    serialIntent?: ControllerSerialPortIntent[];
    /** The device's serial ports as read. */
    serialActual?: ControllerSerialPort[];
}

export interface PortMap {
    rows: PortMapRow[];
    boxes: PortMapBox[];
    /** Highest chain column in use (0 when there are no boxes). */
    columns: number;
    /** Serial ports, listed after the pixel ports; empty when there are none. */
    serial: PortMapSerialRow[];
}

/**
 * Resolve which (port, smartRemote) string N of a model lands on: without a
 * smart remote, string k moves to port+k; with one, strings walk the SR
 * cascade across the 4-port bank (or stack on one port with SRCascadeOnPort).
 */
export function getPortSR(
    stringIndex: number,
    port: number,
    smartRemote: number,
    srCascadeOnPort: boolean,
    srMaxCascade: number,
): { port: number; smartRemote: number } {
    const string = stringIndex - 1; // 0-based
    const sr = smartRemote;
    if (port === 0 || string <= 0) return { port, smartRemote: sr };
    if (sr === 0) return { port: port + string, smartRemote: 0 };

    const max = Math.max(1, srMaxCascade);
    if (srCascadeOnPort) {
        return { port: port + Math.floor(string / max), smartRemote: sr + (string % max) };
    }
    let currp = port;
    let currsr = sr;
    for (let p = 0; p < string; ++p) {
        const newp = currp + 1;
        if (Math.floor((newp - 1) / PORTS_PER_SMARTREMOTE) !== Math.floor((currp - 1) / PORTS_PER_SMARTREMOTE)) {
            const newsr = currsr + 1;
            if (newsr - sr >= max) {
                currsr = sr;
                currp = newp;
            } else {
                currsr = newsr;
                currp = Math.floor((currp - 1) / PORTS_PER_SMARTREMOTE) * PORTS_PER_SMARTREMOTE + 1;
            }
        } else {
            currp = newp;
        }
    }
    return { port: currp, smartRemote: currsr };
}

/** Expand model intents into per-string placements (multi-string models get one
 *  entry per physical string, on the port/SR slot the cascade rules assign). */
export function expandIntentStrings(intents: ControllerModelIntent[]): PortMapString[] {
    const out: PortMapString[] = [];
    for (const mi of intents) {
        const starts = mi.stringStartChannels;
        const counts = mi.stringNodeCounts;
        const n = starts && counts && starts.length === counts.length && starts.length > 1 ? starts.length : 1;
        for (let i = 0; i < n; i++) {
            const { port, smartRemote } = getPortSR(
                i + 1,
                mi.controllerPort,
                mi.smartRemote ?? 0,
                mi.srCascadeOnPort ?? false,
                mi.srMaxCascade ?? 1,
            );
            out.push({
                model: mi.name,
                stringIndex: i + 1,
                stringCount: n,
                port,
                smartRemote,
                smartRemoteType: mi.smartRemoteType,
                startChannel: n === 1 ? mi.startChannel : starts![i],
                nodeCount: n === 1 ? mi.nodeCount : counts![i],
                protocol: mi.protocol,
            });
        }
    }
    return out;
}

/** Smart-remote slot number → xLights letter (1 = A, 2 = B, …). */
const srLetter = (n: number): string => String.fromCharCode(64 + n);

/** Label for one model's strings on one port: bare name plus a
 *  `[segments SRletters]` annotation when partial/SR — e.g. `"Tree [2/4]"`,
 *  `"Matrix [1,2/4 AB]"`, `"Arch [A]"`. */
function portModelLabel(model: string, strings: PortMapString[]): string {
    const seg = strings.some((s) => s.stringCount > 1)
        ? `${strings.map((s) => s.stringIndex).join(',')}/${strings[0].stringCount}`
        : '';
    const srs = [...new Set(strings.map((s) => s.smartRemote).filter((r) => r > 0))].sort((a, b) => a - b);
    const sr = srs.map(srLetter).join('');
    const note = [seg, sr].filter(Boolean).join(' ');
    return note ? `${model} [${note}]` : model;
}

/**
 * Aggregate rich per-model intents into per-PHYSICAL-port summary intent,
 * spreading each model's strings by the cascade rules. `pixels` is the port's
 * share (landing strings only); `models` stays bare names, `modelLabels` the
 * annotated display form.
 */
export function portIntentFromModelIntents(intents: ControllerModelIntent[]): ControllerPortIntent[] {
    const byPort = new Map<number, PortMapString[]>();
    for (const s of expandIntentStrings(intents)) {
        const list = byPort.get(s.port);
        if (list) list.push(s);
        else byPort.set(s.port, [s]);
    }
    const out: ControllerPortIntent[] = [];
    for (const [port, ss] of byPort) {
        ss.sort((a, b) => chainKey(a) - chainKey(b));
        // One models/labels entry per model, in chain order of first appearance.
        const perModel = new Map<string, PortMapString[]>();
        for (const s of ss) {
            const g = perModel.get(s.model);
            if (g) g.push(s);
            else perModel.set(s.model, [s]);
        }
        const models = [...perModel.keys()];
        out.push({
            port,
            models,
            modelLabels: models.map((m) => portModelLabel(m, perModel.get(m)!)),
            pixels: ss.reduce((sum, s) => sum + (s.nodeCount ?? 0), 0),
            protocol: ss.find((s) => s.protocol)?.protocol,
        });
    }
    return out.sort((a, b) => a.port - b.port);
}

/** Fallback expansion from the summary per-port intent (no channels/spreads):
 *  each model named on a port becomes one string there; the port's pixel total
 *  is attributed only when the port has a single model (else unknown). */
function expandSummaryIntent(intent: ControllerPortIntent[]): PortMapString[] {
    const out: PortMapString[] = [];
    for (const pi of intent) {
        pi.models.forEach((m) => {
            out.push({
                model: m,
                stringIndex: 1,
                stringCount: 1,
                port: pi.port,
                smartRemote: 0,
                startChannel: undefined,
                nodeCount: pi.models.length === 1 ? pi.pixels : undefined,
                protocol: pi.protocol,
            });
        });
    }
    return out;
}

/** Chain-order sort key within a port: SR slot first, then start channel. */
function chainKey(s: PortMapString): number {
    return s.smartRemote * 1e9 + (s.startChannel ?? 0);
}

/**
 * Build the renderable port map.
 *  - `modelIntents` (rich) is preferred; `intent` (summary) is the fallback.
 *  - `actual` overlays the device's reported per-port config onto the rows.
 * Boxes pack left→right per port; a multi-row box takes the first column free
 * across ALL its rows, and later boxes on those rows start after it.
 */
export function buildPortMap(
    modelIntents: ControllerModelIntent[] | undefined,
    intent: ControllerPortIntent[] | undefined,
    actual: ControllerPort[] | undefined,
    opts: PortMapOptions = {},
): PortMap {
    const strings = modelIntents?.length ? expandIntentStrings(modelIntents) : expandSummaryIntent(intent ?? []);

    // Group strings into per-model boxes (model names are unique in xLights).
    const byModel = new Map<string, PortMapString[]>();
    for (const s of strings) {
        const list = byModel.get(s.model);
        if (list) list.push(s);
        else byModel.set(s.model, [s]);
    }

    const boxes: PortMapBox[] = [];
    for (const [model, ss] of byModel) {
        const ports = ss.map((s) => s.port);
        const firstPort = Math.min(...ports);
        const span = Math.max(...ports) - firstPort + 1;
        const pixels = ss.map((s) => s.nodeCount);
        const totalPixels = pixels.every((p) => p !== undefined)
            ? (pixels as number[]).reduce((a, b) => a + b, 0)
            : undefined;
        const smartRemotes = [...new Set(ss.map((s) => s.smartRemote).filter((r) => r > 0))].sort((a, b) => a - b);
        boxes.push({
            model,
            firstPort,
            span,
            column: 0, // assigned below
            totalPixels,
            protocol: ss[0]?.protocol,
            smartRemotes,
            smartRemoteType: ss.find((s) => s.smartRemoteType)?.smartRemoteType,
            strings: [...ss].sort((a, b) => a.stringIndex - b.stringIndex),
        });
    }

    // Chain order: first port, then the chain position of the box's earliest string.
    boxes.sort((a, b) => {
        if (a.firstPort !== b.firstPort) return a.firstPort - b.firstPort;
        const ak = Math.min(...a.strings.filter((s) => s.port === a.firstPort).map(chainKey));
        const bk = Math.min(...b.strings.filter((s) => s.port === b.firstPort).map(chainKey));
        return ak - bk;
    });

    // Staircase column packing across spanned rows.
    const nextCol = new Map<number, number>();
    let columns = 0;
    for (const box of boxes) {
        let col = 1;
        for (let p = box.firstPort; p < box.firstPort + box.span; p++) col = Math.max(col, nextCol.get(p) ?? 1);
        box.column = col;
        for (let p = box.firstPort; p < box.firstPort + box.span; p++) nextCol.set(p, col + 1);
        columns = Math.max(columns, col);
    }

    // Rows run contiguously from 1 to the max port either side touches.
    const intendedByPort = new Map<number, number>();
    if (modelIntents?.length) {
        for (const s of strings) {
            intendedByPort.set(s.port, (intendedByPort.get(s.port) ?? 0) + (s.nodeCount ?? 0));
        }
    } else {
        for (const pi of intent ?? []) {
            if (pi.models.length || pi.pixels) intendedByPort.set(pi.port, pi.pixels);
        }
    }
    const actualByPort = new Map<number, ControllerPort>();
    for (const a of actual ?? []) actualByPort.set(a.port, a);

    // Every fitted port gets a row, so empty ports past the last used one
    // still show (and a box can never land beyond the visible rows).
    let maxPort = opts.pixelPortCount ?? 0;
    for (const p of intendedByPort.keys()) maxPort = Math.max(maxPort, p);
    for (const a of actual ?? []) if ((a.pixels ?? 0) > 0) maxPort = Math.max(maxPort, a.port);
    for (const b of boxes) maxPort = Math.max(maxPort, b.firstPort + b.span - 1);

    // Drift only flags when BOTH device data and intent data exist.
    const haveActual = (actual?.length ?? 0) > 0;
    const haveIntent = strings.length > 0;
    const rows: PortMapRow[] = [];
    for (let p = 1; p <= maxPort; p++) {
        const intended = intendedByPort.get(p);
        const act = actualByPort.get(p);
        const actualPixels = act?.pixels;
        rows.push({
            port: p,
            intendedPixels: intended,
            actualPixels,
            actualModel: act?.model,
            drift: haveActual && haveIntent && (intended ?? 0) !== (actualPixels ?? 0),
        });
    }

    return { rows, boxes, columns, serial: buildSerialRows(opts) };
}

/** Serial rows: 1..serialPortCount plus any port either side mentions. */
function buildSerialRows(opts: PortMapOptions): PortMapSerialRow[] {
    const intentByPort = new Map<number, ControllerSerialPortIntent>();
    for (const i of opts.serialIntent ?? []) if (i.models.length || i.channels) intentByPort.set(i.port, i);
    const actualByPort = new Map<number, ControllerSerialPort>();
    for (const a of opts.serialActual ?? []) actualByPort.set(a.port, a);
    let maxPort = opts.serialPortCount ?? 0;
    for (const p of intentByPort.keys()) maxPort = Math.max(maxPort, p);
    for (const a of actualByPort.values()) if ((a.channels ?? 0) > 0) maxPort = Math.max(maxPort, a.port);
    const haveActual = opts.serialActual !== undefined;
    const haveIntent = intentByPort.size > 0;
    const rows: PortMapSerialRow[] = [];
    for (let p = 1; p <= maxPort; p++) {
        const i = intentByPort.get(p);
        const a = actualByPort.get(p);
        const intendedChannels = i?.channels;
        const actualChannels = a?.channels;
        // Drift only flags when BOTH sides exist; more device channels than
        // intended is fine (controllers pad short DMX streams), fewer is not.
        let drift = false;
        if (haveActual && haveIntent) {
            const wantOn = (intendedChannels ?? 0) > 0;
            const isOn = (actualChannels ?? 0) > 0;
            drift = wantOn !== isOn || (wantOn && (actualChannels ?? 0) < (intendedChannels ?? 0));
        }
        rows.push({
            port: p,
            models: i?.models ?? [],
            intendedChannels,
            intendedProtocol: i?.protocol,
            actualChannels,
            actualProtocol: a?.protocol,
            actualModel: a?.model,
            drift,
        });
    }
    return rows;
}
