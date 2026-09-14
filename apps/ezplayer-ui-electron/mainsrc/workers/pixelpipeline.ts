/*
 * Conductor-side pixel pipeline: the compiled layout, the frame pool, the
 * output maps, and the output worker that sends them. The playback loop only
 * composes frames into pool slots; everything downstream lives here.
 */

import dgram from 'node:dgram';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
    applyOutput,
    blendModeFromName,
    blendNodes,
    decodeDescriptorHeader,
    decodeOverlayPacket,
    decompressExtended,
    descriptorFromEmbeddedXlights,
    EZ_DESCRIPTOR_HEADER,
    OverlayManager,
    peekDescriptorPrefix,
    readExtendedHeader,
    XL_NETWORKS_HEADER,
    XL_RGBEFFECTS_HEADER,
    compileInputMap,
    compileLayout,
    compileOutputMap,
    descriptorFromFseqHeaders,
    descriptorFromSpecs,
    descriptorHash,
    FRAME_FLAG_BLACK,
    FRAME_FLAG_IDLE,
    FramePool,
    layoutManifest,
    layoutSpecsFromXlights,
    ParamsBlock,
    scaleNodes,
    sharedInputMapProgram,
    StatsBlock,
    type BlendMode,
    type ChannelDescriptor,
    type CompiledOutput,
    type ControllerState,
    type DisplayLayout,
    type FSEQHeader,
    type InputMapProgram,
    type LayoutModelSpec,
    type LayoutManifest,
    type OutputSpec,
} from '@ezplayer/epp';
import type { GetNodeResult, XlModelChannelInfo } from 'xllayoutcalcs';
import { OutputWorkerHandle, serializeOutput } from './outputparent';
import { OUTPUT_STATS_COUNTERS, OUTPUT_STATS_GAUGES } from './outputprotocol';

/** What FSeqPrefetchCache's canonicalizer hands us for a file's own layout. */
interface FileLayoutLike {
    isSparse: boolean;
    scatterPlan: { srcOffset: number; dstOffset: number; length: number }[];
}

export interface PixelPipelineOptions {
    models: XlModelChannelInfo[];
    coords?: Map<string, GetNodeResult>;
    controllers: ControllerState[];
    /** Channel-space extent the legacy export and controllers cover. */
    nChannels: number;
    openOpts: { ddpPort?: number; fpsOverrides?: Record<string, number> };
    settings: { outputEnabled: boolean; blackFramesEnabled: boolean; maxSlotFraction: number };
    /** Existing channel-space ring for preview readers. */
    legacyRing: SharedArrayBuffer;
    slotCount?: number;
    /** UDP port for overlay lease payloads; 0 disables the receiver. */
    overlayPort?: number;
    /** Show folder; descriptors and pins persist under its .ezplayer/layouts. */
    showFolder?: string;
    log: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

/** Hash bytes the way fnv1a hashes strings. */
function fnv1aBytes(b: Uint8Array): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < b.length; ++i) {
        h ^= b[i];
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** A file's identity for pinning: cheap fields the header already has. */
function fileIdentityKey(fseqfile: string, header: FSEQHeader): string {
    return `${fseqfile}|${header.channels}|${header.frames}|${header.uuid1}|${header.uuid2}`;
}

export interface ComposeArgs {
    fg?: Uint8Array;
    bg?: Uint8Array;
    bgMode?: BlendMode;
    /** 0..1 global brightness applied to every pixel node. */
    brightness?: number;
    timeMs: number;
    frameIntervalMs: number;
    frameNumber: number;
    idle?: boolean;
}

let nextPipelineId = 1;

export class PixelPipeline {
    readonly id = nextPipelineId++;
    readonly layout: DisplayLayout;
    readonly manifest: LayoutManifest;
    readonly specs: LayoutModelSpec[];
    readonly pool: FramePool;
    readonly params: ParamsBlock;
    readonly stats: StatsBlock;
    readonly output: OutputWorkerHandle;
    readonly nChannels: number;
    /** Descriptor the current layout implies; files without their own get pinned to it. */
    readonly pinnedDescriptor: ChannelDescriptor;
    /** Externally produced layers blended into every frame. */
    readonly overlays: OverlayManager;
    overlayPort = 0;
    private overlaySocket?: dgram.Socket;
    private overlayPackets = 0;
    private overlayBadPackets = 0;
    private lastExpire = 0;
    private readonly inputMaps = new Map<string, InputMapProgram>();
    /** Descriptors seen this session, by fingerprint (and 'xl:<hash>' for ones derived from embedded xLights files). */
    private readonly descriptors = new Map<string, ChannelDescriptor>();
    private readonly layoutsDir?: string;
    private pins: Record<string, { fingerprint: number; layoutVersion: number; at: number }> = {};
    private pinsLoaded: Promise<void>;
    private pinsDirty = false;
    private readonly log: PixelPipelineOptions['log'];
    private composeScratch: Uint8Array;
    private lastWasBlack = false;
    private closed = false;

    private constructor(opts: PixelPipelineOptions, layout: DisplayLayout, specs: LayoutModelSpec[]) {
        this.layout = layout;
        this.specs = specs;
        this.manifest = layoutManifest(layout);
        this.nChannels = opts.nChannels;
        this.log = opts.log;
        this.pool = FramePool.allocate({
            frameBytes: layout.frameBytes,
            slotCount: opts.slotCount ?? 8,
            layoutVersion: layout.layoutVersion,
            pixelStride: layout.pixelStride,
            xMeaning: layout.xMeaning,
        });
        this.params = ParamsBlock.allocate(16);
        this.params.define('brightness', 0, 1);
        this.stats = StatsBlock.allocate(OUTPUT_STATS_COUNTERS, OUTPUT_STATS_GAUGES);
        this.output = new OutputWorkerHandle();
        this.output.onLog = opts.log;
        this.pinnedDescriptor = descriptorFromSpecs(specs, Math.max(opts.nChannels, layout.totalChannels));
        this.pinnedDescriptor.fingerprint = descriptorHash(this.pinnedDescriptor);
        this.composeScratch = new Uint8Array(0);
        this.overlays = new OverlayManager(layout);
        this.layoutsDir = opts.showFolder ? path.join(opts.showFolder, '.ezplayer', 'layouts') : undefined;
        this.pinsLoaded = this.loadPins();
    }

    // ----- descriptor registry: derived cache of descriptors and per-file pins under .ezplayer/layouts -----

    private async loadPins(): Promise<void> {
        if (!this.layoutsDir) return;
        try {
            const raw = await fsp.readFile(path.join(this.layoutsDir, 'pins.json'), 'utf8');
            const parsed = JSON.parse(raw) as { pins?: Record<string, { fingerprint: number; layoutVersion: number; at: number }> };
            if (parsed && typeof parsed === 'object' && parsed.pins) this.pins = parsed.pins;
        } catch {
            /* no pins yet */
        }
    }

    private async savePins(): Promise<void> {
        if (!this.layoutsDir || !this.pinsDirty) return;
        this.pinsDirty = false;
        try {
            await fsp.mkdir(this.layoutsDir, { recursive: true });
            await fsp.writeFile(path.join(this.layoutsDir, 'pins.json'), JSON.stringify({ version: 1, pins: this.pins }, null, 1));
        } catch (e) {
            this.log('warn', `[pipeline] could not save layout pins: ${(e as Error).message}`);
        }
    }

    private async readRegistry(key: string): Promise<ChannelDescriptor | undefined> {
        const mem = this.descriptors.get(key);
        if (mem) return mem;
        if (!this.layoutsDir) return undefined;
        try {
            const raw = await fsp.readFile(path.join(this.layoutsDir, `${key}.json`), 'utf8');
            const d = JSON.parse(raw) as ChannelDescriptor;
            if (!d || !Array.isArray(d.models) || typeof d.totalChannels !== 'number') return undefined;
            this.descriptors.set(key, d);
            return d;
        } catch {
            return undefined;
        }
    }

    private async writeRegistry(key: string, d: ChannelDescriptor): Promise<void> {
        this.descriptors.set(key, d);
        if (!this.layoutsDir) return;
        try {
            await fsp.mkdir(this.layoutsDir, { recursive: true });
            await fsp.writeFile(path.join(this.layoutsDir, `${key}.json`), JSON.stringify(d));
        } catch (e) {
            this.log('warn', `[pipeline] could not save layout descriptor ${key}: ${(e as Error).message}`);
        }
    }

    /**
     * The descriptor for a sequence file, in precedence order: the file's own
     * EZ header, the xLights show files it embeds, then the pin recorded for
     * it, then the current layout (which pins it).
     */
    async descriptorFor(fseqfile: string, header: FSEQHeader): Promise<ChannelDescriptor> {
        const ez = header.extendedHeaders[EZ_DESCRIPTOR_HEADER];
        if (ez) {
            try {
                const bytes = await readExtendedHeader(fseqfile, ez);
                const prefix = peekDescriptorPrefix(bytes);
                if (prefix) {
                    const cached = this.descriptors.get(String(prefix.fingerprint));
                    if (cached) return cached;
                    const d = decodeDescriptorHeader(bytes);
                    if (d) {
                        this.log('info', `[pipeline] ${fseqfile}: EZ descriptor, ${d.models.length} models, fingerprint ${prefix.fingerprint}`);
                        void this.writeRegistry(String(prefix.fingerprint), d);
                        return d;
                    }
                }
                this.log('warn', `[pipeline] ${fseqfile}: EZ header present but unreadable; falling back`);
            } catch (e) {
                this.log('warn', `[pipeline] ${fseqfile}: EZ header read failed (${(e as Error).message}); falling back`);
            }
        }
        const inline = descriptorFromFseqHeaders(header.headers);
        if (inline) return inline;

        const xr = header.extendedHeaders[XL_RGBEFFECTS_HEADER];
        const xn = header.extendedHeaders[XL_NETWORKS_HEADER];
        if (xr && xn) {
            try {
                const xrb = await readExtendedHeader(fseqfile, xr);
                const xnb = await readExtendedHeader(fseqfile, xn);
                const key = `xl-${fnv1aBytes(xrb).toString(16)}-${fnv1aBytes(xnb).toString(16)}`;
                const cached = await this.readRegistry(key);
                if (cached) return cached;
                const dec = new TextDecoder('utf-8');
                const d = descriptorFromEmbeddedXlights(dec.decode(decompressExtended(xrb)), dec.decode(decompressExtended(xnb)), {
                    logger: (m) => this.log('warn', `[pipeline] ${fseqfile}: ${m}`),
                });
                this.log('info', `[pipeline] ${fseqfile}: descriptor derived from embedded xLights files, ${d.models.length} models, fingerprint ${d.fingerprint}`);
                void this.writeRegistry(key, d);
                if (d.fingerprint !== undefined) void this.writeRegistry(String(d.fingerprint), d);
                return d;
            } catch (e) {
                this.log('warn', `[pipeline] ${fseqfile}: embedded xLights files unusable (${(e as Error).message}); falling back`);
            }
        }

        await this.pinsLoaded;
        const idKey = fileIdentityKey(fseqfile, header);
        const pin = this.pins[idKey];
        if (pin) {
            const d = await this.readRegistry(String(pin.fingerprint));
            if (d) {
                if (pin.fingerprint !== this.pinnedDescriptor.fingerprint) {
                    this.log('info', `[pipeline] ${fseqfile}: using pinned layout ${pin.fingerprint} (current is ${this.pinnedDescriptor.fingerprint})`);
                }
                return d;
            }
        }
        // Pin on first sight: the current layout, remembered so a later layout change does not drift.
        const fp = this.pinnedDescriptor.fingerprint!;
        this.pins[idKey] = { fingerprint: fp, layoutVersion: this.layout.layoutVersion, at: Date.now() };
        this.pinsDirty = true;
        void this.writeRegistry(String(fp), this.pinnedDescriptor).then(() => this.savePins());
        return this.pinnedDescriptor;
    }

    /** Listen for overlay payload packets. Failure to bind is logged, not fatal. */
    private startOverlayReceiver(port: number) {
        if (!port || port <= 0) return;
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sock.on('error', (e) => {
            this.log('warn', `[overlay] UDP receiver on port ${port} failed: ${e.message}`);
            try {
                sock.close();
            } catch {
                /* already closed */
            }
            if (this.overlaySocket === sock) this.overlaySocket = undefined;
        });
        sock.on('message', (buf) => {
            const p = decodeOverlayPacket(buf);
            if (!p) {
                ++this.overlayBadPackets;
                return;
            }
            ++this.overlayPackets;
            this.overlays.write(p.id, p.token, p.seq, p.offset, p.data, p.last, Date.now());
        });
        sock.bind(port, () => {
            this.overlayPort = port;
            this.log('info', `[overlay] receiving lease payloads on UDP ${port}`);
        });
        this.overlaySocket = sock;
    }

    /** Idle frames can go slower unless an overlay is animating. */
    idleIntervalMs(fallback: number): number {
        return this.overlays.size > 0 ? Math.min(fallback, 50) : fallback;
    }

    overlayStats() {
        return { leases: this.overlays.size, packets: this.overlayPackets, badPackets: this.overlayBadPackets, port: this.overlayPort };
    }

    static async create(opts: PixelPipelineOptions): Promise<PixelPipeline> {
        const specs = layoutSpecsFromXlights(opts.models, opts.coords);
        const layout = compileLayout(specs, { channelCeiling: opts.nChannels, keepWorld: true });
        const p = new PixelPipeline(opts, layout, specs);
        const rawModels = layout.models.filter((m) => m.nodeStart < 0);
        opts.log(
            'info',
            `[pipeline ${p.id}] layout v${layout.layoutVersion}: ${layout.models.length} models, ` +
                `${layout.nodeCount} nodes x${layout.pixelStride}, raw ${layout.rawCount} ch in ${layout.rawSpans.length} spans, ` +
                `frame ${layout.frameBytes} B, channel space ${layout.totalChannels}` +
                (rawModels.length ? `; raw models: ${rawModels.map((m) => `${m.name} (${m.rawReason})`).join(', ')}` : ''),
        );

        // One output per usable controller, carrying its channel range; plus the legacy export.
        const outputSpecs: OutputSpec[] = [];
        // Indexed by controller position, so a controller that fails to open cannot shift the rest.
        const senderOutput: number[] = opts.controllers.map(() => -1);
        opts.controllers.forEach((c, i) => {
            if (!c.setup.usable || !c.setup.proto || !c.xlRecord) return;
            senderOutput[i] = outputSpecs.length;
            outputSpecs.push({ id: c.setup.name, channelStart: c.setup.startCh - 1, channelCount: c.setup.nCh, policy: 'controller' });
        });
        const legacySpec: OutputSpec = { id: '<preview>', channelStart: 0, channelCount: opts.nChannels, policy: 'controller' };
        const omap = compileOutputMap(layout, [...outputSpecs, legacySpec]);
        const legacyOutput = omap.outputs[omap.outputs.length - 1];
        const outputs = omap.outputs.slice(0, -1);

        const res = await p.output.open({
            controllers: opts.controllers,
            opts: opts.openOpts,
            pool: p.pool.buffer,
            stats: p.stats.buffer,
            outputs: outputs.map(serializeOutput),
            senderOutput,
            legacy: { ring: opts.legacyRing, output: serializeOutput(legacyOutput) },
            settings: opts.settings,
        });
        // Reports come back by controller index; the worker's clones are its own.
        opts.controllers.forEach((c, i) => {
            if (res.reports[i]) c.report = res.reports[i];
        });
        p.minFrameTimes = res.minFrameTimes;
        p.startOverlayReceiver(opts.overlayPort ?? 0);
        return p;
    }

    minFrameTimes: number[] = [];

    /** The Input Map for a sequence file, from whichever descriptor it resolves to. */
    canonicalizer = async (fseqfile: string, header: FSEQHeader, fileLayout: FileLayoutLike): Promise<InputMapProgram | undefined> => {
        if (this.closed) return undefined;
        const desc = await this.descriptorFor(fseqfile, header);
        if (desc.source === 'pinned' || !desc.source) {
            const modelEnd = Math.max(0, ...desc.models.map((m) => m.startChannel + m.nodeCount * m.channelsPerNode));
            if (header.channels !== desc.totalChannels && header.channels !== modelEnd) {
                this.log('warn', `[pipeline] ${fseqfile}: file has ${header.channels} channels, layout expects ${desc.totalChannels}; mapping by channel number`);
            }
        }
        const sparse = fileLayout.isSparse
            ? fileLayout.scatterPlan.map((r) => ({ srcOffset: r.srcOffset, channelStart: r.dstOffset, length: r.length }))
            : undefined;
        const flags = `${desc.curvesApplied === false ? '' : 'c'}${desc.colorOrderApplied === false ? '' : 'o'}${desc.nodeOrder === 'canonical' ? 'n' : ''}`;
        const key = `${desc.fingerprint ?? descriptorHash(desc)}:${flags}:${sparse ? JSON.stringify(sparse) : 'dense'}`;
        let program = this.inputMaps.get(key);
        if (!program) {
            const map = compileInputMap(desc, this.layout, sparse);
            if (map.missing.length || map.resized.length || map.inverted.length) {
                this.log(
                    'warn',
                    `[pipeline] ${fseqfile}: ` +
                        (map.missing.length ? `${map.missing.length} layout models absent from file (${map.missing.slice(0, 5).join(', ')}); ` : '') +
                        (map.resized.length ? `${map.resized.length} models resized; ` : '') +
                        (map.inverted.length ? `${map.inverted.length} models with baked gamma inverted (lossy)` : ''),
                );
            }
            program = sharedInputMapProgram(map);
            this.inputMaps.set(key, program);
        }
        return program;
    };

    /**
     * Compose one frame into a pool slot and publish it. Returns false when the
     * pool is exhausted (the previous frame stays current).
     */
    compose(a: ComposeArgs): boolean {
        if (this.closed) return false;
        const slot = this.pool.acquire();
        if (slot < 0) return false;
        const bytes = this.pool.slotBytes(slot);
        const L = this.layout;
        const stride = L.pixelStride;
        let flags = a.idle ? FRAME_FLAG_IDLE : 0;
        let black = false;
        if (a.fg) {
            bytes.set(a.fg.subarray(0, L.frameBytes));
            if (a.bg) {
                const mode = a.bgMode ?? 0;
                blendNodes(mode, bytes, a.bg, stride, 0, L.nodeCount, 255, L.xMeaning === 2);
                // Raw channels have no blend semantics: the background fills what the foreground leaves at zero.
                if (L.rawCount) {
                    for (let i = L.rawOffset, e = L.rawOffset + L.rawCount; i < e; ++i) if (bytes[i] === 0) bytes[i] = a.bg[i];
                }
            }
        } else if (a.bg) {
            bytes.set(a.bg.subarray(0, L.frameBytes));
        } else {
            bytes.fill(0);
            black = true;
        }
        // Overlays draw on top of whatever is there, black included.
        const now = Date.now();
        if (now - this.lastExpire > 1000) {
            this.lastExpire = now;
            for (const id of this.overlays.expire(now)) this.log('info', `[overlay] lease ${id} expired`);
        }
        if (this.overlays.size > 0) {
            this.overlays.composite(bytes, stride);
            black = false;
            flags &= ~FRAME_FLAG_IDLE;
        }
        if (black) flags |= FRAME_FLAG_BLACK;
        if (!black && a.brightness !== undefined && a.brightness < 1) {
            scaleNodes(bytes, stride, 0, L.nodeCount, a.brightness, L.xMeaning === 2);
        }
        this.lastWasBlack = black;
        this.pool.publish(slot, {
            frameNumber: a.frameNumber,
            pipelineId: this.id,
            paramsSlot: this.params.commit(),
            timeMs: a.timeMs,
            sourceStamp: 0,
            frameIntervalMs: a.frameIntervalMs,
            flags,
        });
        return true;
    }

    /** Snapshot of the output worker's counters and gauges. */
    outputStats() {
        return this.stats.snapshot();
    }

    resetPeriodGauges() {
        this.stats.setGauge(this.stats.gauge('maxSendMs'), 0);
        this.stats.setGauge(this.stats.gauge('sendOverrunMs'), 0);
    }

    settings(s: { outputEnabled?: boolean; blackFramesEnabled?: boolean; maxSlotFraction?: number }) {
        this.output.settings(s);
    }

    async close() {
        if (this.closed) return;
        this.closed = true;
        if (this.overlaySocket) {
            try {
                this.overlaySocket.close();
            } catch {
                /* already closed */
            }
            this.overlaySocket = undefined;
        }
        await this.output.close();
    }

    /** Encode the latest frame into channel space on this thread (diagnostics / tests). */
    encodeLegacy(frame: Uint8Array, out: Uint8Array, legacy: CompiledOutput) {
        applyOutput(legacy, this.layout.pixelStride, frame, 0, out);
    }
}

export function blendModeFromSettings(name: string | undefined): BlendMode {
    return blendModeFromName(name);
}
