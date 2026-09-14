/*
 * Conductor-side pixel pipeline: the compiled layout, the frame pool, the
 * output maps, and the output worker that sends them. The playback loop only
 * composes frames into pool slots; everything downstream lives here.
 */

import dgram from 'node:dgram';
import {
    applyOutput,
    blendModeFromName,
    blendNodes,
    decodeOverlayPacket,
    OverlayManager,
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
    log: (level: 'info' | 'warn' | 'error', msg: string) => void;
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
        this.composeScratch = new Uint8Array(0);
        this.overlays = new OverlayManager(layout);
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

    /** The Input Map for a sequence file: its own descriptor when it carries one, else the pinned one. */
    canonicalizer = (fseqfile: string, header: FSEQHeader, fileLayout: FileLayoutLike): InputMapProgram | undefined => {
        if (this.closed) return undefined;
        let desc = descriptorFromFseqHeaders(header.headers);
        if (desc) {
            this.log('info', `[pipeline] ${fseqfile}: using channel descriptor from the file header (${desc.models.length} models)`);
        } else {
            desc = this.pinnedDescriptor;
            if (header.channels !== desc.totalChannels && header.channels !== Math.max(...desc.models.map((m) => m.startChannel + m.nodeCount * m.channelsPerNode))) {
                this.log('warn', `[pipeline] ${fseqfile}: file has ${header.channels} channels, layout expects ${desc.totalChannels}; mapping by channel number`);
            }
        }
        const sparse = fileLayout.isSparse
            ? fileLayout.scatterPlan.map((r) => ({ srcOffset: r.srcOffset, channelStart: r.dstOffset, length: r.length }))
            : undefined;
        const key = `${descriptorHash(desc)}:${sparse ? JSON.stringify(sparse) : 'dense'}`;
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
