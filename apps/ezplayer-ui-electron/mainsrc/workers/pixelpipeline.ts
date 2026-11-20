/*
 * Conductor-side pixel pipeline: the compiled layout, the frame pool, the
 * output maps, and the output worker that sends them. The playback loop only
 * composes frames into pool slots; everything downstream lives here.
 */

import dgram from 'node:dgram';
import {
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
    descriptorFromSpecs,
    descriptorHash,
    FRAME_FLAG_BLACK,
    FRAME_FLAG_IDLE,
    FramePool,
    layoutManifest,
    layoutSpecsFromXlights,
    ParamsBlock,
    scaleNodesRgb,
    colorTemperatureScale,
    COLOR_TEMP_NEUTRAL_K,
    patternAnimates,
    patternTargetsForModels,
    SpatialPatternRenderer,
    sharedInputMapProgram,
    StatsBlock,
    type BlendMode,
    type ChannelDescriptor,
    type ControllerState,
    type DisplayLayout,
    type FSEQHeader,
    type InputMapProgram,
    type LayoutModelSpec,
    type LayoutManifest,
    type OpenControllerReport,
    type OutputModelAdjust,
    type OutputSpec,
    type SpatialPatternParams,
    type SenderStats,
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
    openOpts: { ddpPort?: number; fpsOverrides?: Record<string, number>; forceLocalIPs?: Record<string, string> };
    settings: { outputEnabled: boolean; blackFramesEnabled: boolean; maxSlotFraction: number };
    /** Existing channel-space ring for preview readers. */
    /** Channel-space export ring for the existing previews; absent when there are no channels. */
    legacyRing?: SharedArrayBuffer;
    slotCount?: number;
    /** UDP port for overlay lease payloads; 0 disables the receiver. */
    overlayPort?: number;
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

export interface ComposeArgs {
    fg?: Uint8Array;
    bg?: Uint8Array;
    bgMode?: BlendMode;
    /** 0..1 global brightness applied to every pixel node. */
    brightness?: number;
    /** Kelvin; a tint that only dims (warm dims blue and green, cool dims red). 6500 is neutral. */
    colorTemperature?: number;
    timeMs: number;
    frameIntervalMs: number;
    frameNumber: number;
    idle?: boolean;
}

/** A run of a model's nodes sent to a controller at channels other than the model's own. */
export interface WiredRun {
    model: string;
    nodeStart: number;
    nodeCount: number;
    /** Controller name. */
    controller: string;
    /** Absolute 1-based channel of the first node. */
    channel: number;
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
    /** Descriptors seen this session: by fingerprint, and by a hash of the embedded xLights files they came from. */
    private readonly descriptors = new Map<string, ChannelDescriptor>();
    /** Latest per-controller sender stats reported by the output worker, by controller name. */
    private latestSenderStats: Record<string, SenderStats> = {};
    private readonly log: PixelPipelineOptions['log'];
    private closed = false;
    /** Controller outputs as compiled at open, so the tweak layer can be recompiled over them. */
    private outputSpecs: OutputSpec[] = [];
    private adjust: Record<string, OutputModelAdjust> = {};
    /** Rewired model runs, at the absolute 1-based channels the wiring plan gave them. */
    private wired: WiredRun[] = [];
    private skipModels: string[] = [];
    /** What the output worker currently runs, so an unchanged configuration is not resent. */
    private pushedKey = JSON.stringify([{}, [], []]);
    /** The running test pattern, painted over its models after everything else. */
    private test?: { renderer: SpatialPatternRenderer; models: string[]; startMs: number; expiresAt?: number; bypass: boolean; animates: boolean };

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
        this.output.onSenderStats = (stats) => (this.latestSenderStats = stats);
        this.pinnedDescriptor = descriptorFromSpecs(specs, Math.max(opts.nChannels, layout.totalChannels));
        this.pinnedDescriptor.fingerprint = descriptorHash(this.pinnedDescriptor);
        this.overlays = new OverlayManager(layout);
    }

    /**
     * The descriptor for a sequence file, in precedence order: the file's own
     * EZ header, the xLights show files it embeds, else the current layout
     * (the file is assumed to match it). Results are cached for the session.
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
                        this.descriptors.set(String(prefix.fingerprint), d);
                        return d;
                    }
                }
                this.log('warn', `[pipeline] ${fseqfile}: EZ header present but unreadable; falling back`);
            } catch (e) {
                this.log('warn', `[pipeline] ${fseqfile}: EZ header read failed (${(e as Error).message}); falling back`);
            }
        }
        const xr = header.extendedHeaders[XL_RGBEFFECTS_HEADER];
        const xn = header.extendedHeaders[XL_NETWORKS_HEADER];
        if (xr && xn) {
            try {
                const xrb = await readExtendedHeader(fseqfile, xr);
                const xnb = await readExtendedHeader(fseqfile, xn);
                const key = `xl-${fnv1aBytes(xrb).toString(16)}-${fnv1aBytes(xnb).toString(16)}`;
                const cached = this.descriptors.get(key);
                if (cached) return cached;
                const dec = new TextDecoder('utf-8');
                const d = descriptorFromEmbeddedXlights(dec.decode(decompressExtended(xrb)), dec.decode(decompressExtended(xnb)), {
                    logger: (m) => this.log('warn', `[pipeline] ${fseqfile}: ${m}`),
                });
                this.log('info', `[pipeline] ${fseqfile}: descriptor derived from embedded xLights files, ${d.models.length} models, fingerprint ${d.fingerprint}`);
                this.descriptors.set(key, d);
                if (d.fingerprint !== undefined) this.descriptors.set(String(d.fingerprint), d);
                return d;
            } catch (e) {
                this.log('warn', `[pipeline] ${fseqfile}: embedded xLights files unusable (${(e as Error).message}); falling back`);
            }
        }

        // No descriptor: assume the file was rendered against the current layout.
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

    /** Idle frames can go slower unless an overlay or a test pattern is running. */
    idleIntervalMs(fallback: number): number {
        return this.overlays.size > 0 || this.test ? Math.min(fallback, 50) : fallback;
    }

    /**
     * Set the per-model output trims (the tweak layer) and the rewired model
     * runs, and recompile the controller outputs over them. The preview
     * export is left as renderer intent in xLights channel space. Takes
     * effect on the next frame.
     */
    configureOutputs(cfg: { adjust: Record<string, OutputModelAdjust>; strings: WiredRun[]; skipModels: string[] }) {
        this.adjust = cfg.adjust;
        this.wired = cfg.strings;
        this.skipModels = cfg.skipModels;
        this.pushOutputs();
    }

    private pushOutputs() {
        if (this.closed || !this.outputSpecs.length) return;
        let adjust = this.adjust;
        if (this.test?.bypass) {
            adjust = { ...adjust };
            for (const m of this.test.models) delete adjust[m];
        }
        const key = JSON.stringify([adjust, this.wired, this.skipModels]);
        if (key === this.pushedKey) return;
        this.pushedKey = key;
        const has = Object.keys(adjust).length > 0;
        const specs = this.outputSpecs.map((s): OutputSpec => {
            const place = this.wired
                .filter((w) => w.controller === s.id)
                .map((w) => ({ model: w.model, nodeStart: w.nodeStart, nodeCount: w.nodeCount, dstOffset: w.channel - 1 - s.channelStart }))
                .filter((seg) => seg.dstOffset >= 0);
            return {
                ...s,
                ...(has ? { adjust } : {}),
                ...(place.length ? { place } : {}),
                ...(this.skipModels.length ? { skipModels: this.skipModels } : {}),
            };
        });
        this.output.outputs(compileOutputMap(this.layout, specs).outputs.map(serializeOutput));
    }

    /** Pixel models a test may target. */
    testableModels(): string[] {
        return this.layout.models.filter((m) => m.nodeStart >= 0 && m.nodeCount > 0).map((m) => m.name);
    }

    /**
     * Start (or replace) the test pattern on these models. Returns the models
     * actually painted; names the layout does not have as pixel models are dropped.
     */
    startTest(models: string[], pattern: SpatialPatternParams, opts: { ttlMs?: number; bypassTweaks?: boolean } = {}): string[] {
        const targets = patternTargetsForModels(this.layout, models);
        const names = targets.map((m) => m.name);
        const prev = this.test;
        // Keep the clock when only the pattern changed, so dragging a slider does not restart the motion.
        const sameTargets = !!prev && prev.models.length === names.length && prev.models.every((n, i) => n === names[i]);
        const now = Date.now();
        const bypass = !!opts.bypassTweaks;
        const bypassChanged = (prev?.bypass ?? false) !== bypass || (bypass && !sameTargets);
        this.test = targets.length
            ? {
                  renderer: new SpatialPatternRenderer(this.layout, targets, pattern),
                  models: names,
                  startMs: sameTargets ? prev!.startMs : now,
                  expiresAt: opts.ttlMs ? now + opts.ttlMs : undefined,
                  bypass,
                  animates: patternAnimates(pattern),
              }
            : undefined;
        if (bypassChanged) this.pushOutputs();
        return names;
    }

    stopTest(): boolean {
        if (!this.test) return false;
        const bypass = this.test.bypass;
        this.test = undefined;
        if (bypass) this.pushOutputs();
        return true;
    }

    testModels(): string[] | undefined {
        return this.test?.models;
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
        p.outputSpecs = outputSpecs;
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
            legacy: opts.legacyRing ? { ring: opts.legacyRing, output: serializeOutput(legacyOutput) } : undefined,
            settings: opts.settings,
        });
        // Reports come back by controller index; the worker's clones are its own.
        opts.controllers.forEach((c, i) => {
            if (res.reports[i]) c.report = res.reports[i];
        });
        p.startOverlayReceiver(opts.overlayPort ?? 0);
        return p;
    }

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
        if (!black) {
            const b = a.brightness ?? 1;
            const [kr, kg, kb] = this.tintFor(a.colorTemperature ?? COLOR_TEMP_NEUTRAL_K);
            if (b < 1 || kr < 1 || kg < 1 || kb < 1) {
                // The white channel takes the brightness but not the tint.
                scaleNodesRgb(bytes, stride, 0, L.nodeCount, kr * b, kg * b, kb * b, L.xMeaning === 2 ? b : 1);
            }
        }
        // A test pattern replaces whatever its models were showing, and is not dimmed with the show.
        if (this.test) {
            if (this.test.expiresAt !== undefined && now >= this.test.expiresAt) {
                this.log('info', '[test] test pattern timed out');
                this.stopTest();
            } else {
                this.test.renderer.render(bytes, stride, Math.max(0, now - this.test.startMs));
                black = false;
                flags &= ~FRAME_FLAG_IDLE;
            }
        }
        if (black) flags |= FRAME_FLAG_BLACK;
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

    private tintKelvin = COLOR_TEMP_NEUTRAL_K;
    private tint: [number, number, number] = [1, 1, 1];
    /** Per-channel factors for a color temperature, cached for the last value asked. */
    private tintFor(kelvin: number): [number, number, number] {
        if (kelvin !== this.tintKelvin) {
            this.tintKelvin = kelvin;
            this.tint = colorTemperatureScale(kelvin);
        }
        return this.tint;
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

    /** Ask the output worker to open or replace these controllers' senders; reports by controller index. */
    reopenControllers(indices: number[]): Promise<Map<number, OpenControllerReport | undefined>> {
        if (this.closed) return Promise.resolve(new Map());
        return this.output.reopen(indices);
    }

    senderStats(controllerName: string): SenderStats | undefined {
        return this.latestSenderStats[controllerName];
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
}

export function blendModeFromSettings(name: string | undefined): BlendMode {
    return blendModeFromName(name);
}
