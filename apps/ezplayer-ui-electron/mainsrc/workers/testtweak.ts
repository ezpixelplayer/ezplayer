/*
 * Test + Tweak, playback-worker side: owns the show's tweak document
 * (<showFolder>/.ezplayer/testtweak.json), turns it into output trims and
 * wiring for the pixel pipeline and into upload intents for the controllers,
 * and runs the test pattern.
 */

import fsp from 'fs/promises';
import * as path from 'path';
import {
    effectiveTweak,
    emptyTestTweakDoc,
    isNeutralTweak,
    NEUTRAL_COLOR_TEMP_K,
    normalizeActiveTest,
    normalizeTestTweakDoc,
    planChunkWiring,
    resolveTestTargets,
    tweakedModelNames,
    type ActiveTest,
    type ControllerModelIntent,
    type TestTweakDoc,
    type TestTweakSnapshot,
    type TestTweakStatus,
    type TweakControllerInfo,
    type TweakModelInfo,
    type WiringModel,
    type WiringPlan,
    type XlModelGroup,
} from '@ezplayer/ezplayer-core';
import { colorTemperatureScale, type OutputModelAdjust } from '@ezplayer/epp';
import type { XlControllerInfo, XlModelChannelInfo } from 'xllayoutcalcs';
import type { PixelPipeline } from './pixelpipeline';

export type TestTweakCommand =
    /** `xlGroups` adds the show's xLights model groups to the answer. */
    | { op: 'get'; xlGroups?: boolean }
    /** Replace the whole document. */
    | { op: 'setDoc'; doc: unknown }
    /** Start, or replace, the running test. */
    | { op: 'start'; test: unknown }
    | { op: 'stop' };

export type TestTweakResult = ({ ok: true } & TestTweakSnapshot) | { ok: false; error: string };

export const TEST_TWEAK_FILE = 'testtweak.json';

const EMPTY_PLAN: WiringPlan = { overridden: [], strings: [], problems: [] };

function channelsPerNode(m: XlModelChannelInfo): number {
    return m.nodeCount > 0 ? Math.max(1, Math.round(m.channelCount / m.nodeCount)) : 3;
}

/** The output trims a document asks for, by model, leaving out the ones that change nothing. */
export function adjustFromDoc(doc: TestTweakDoc): Record<string, OutputModelAdjust> {
    const out: Record<string, OutputModelAdjust> = {};
    for (const name of tweakedModelNames(doc)) {
        const e = effectiveTweak(doc, name);
        if (isNeutralTweak(e)) continue;
        const a: OutputModelAdjust = {};
        if (e.colorOrder) a.colorOrder = e.colorOrder;
        if (e.gamma !== undefined && e.gamma !== 1) a.gamma = e.gamma;
        if (e.brightness !== 1) a.brightness = e.brightness;
        if (e.colorTempK !== undefined && e.colorTempK !== NEUTRAL_COLOR_TEMP_K)
            a.gain = colorTemperatureScale(e.colorTempK);
        out[name] = a;
    }
    return out;
}

/** Where each model sits in channel space, for the wiring planner. */
export function wiringModelsFrom(models: XlModelChannelInfo[], controllers: XlControllerInfo[]): WiringModel[] {
    return models
        .filter((m) => m.nodeCount > 0 && m.channelCount > 0)
        .map((m) => {
            const cpn = channelsPerNode(m);
            // The controller that carries the model's channels, whatever the model says it is plugged into.
            const carrier = controllers.find(
                (c) => m.startChannel >= c.startChannel && m.startChannel < c.startChannel + c.maxChannels,
            );
            const perString =
                m.stringStartChannels.length > 1 && m.stringStartChannels.length === m.stringNodeCounts.length
                    ? m.stringNodeCounts.reduce((a, n) => a + n, 0) === m.nodeCount
                    : false;
            let node = 0;
            const spans = perString
                ? m.stringNodeCounts.map((n, i) => {
                      const s = { nodeStart: node, nodeCount: n, channel: m.stringStartChannels[i] };
                      node += n;
                      return s;
                  })
                : [{ nodeStart: 0, nodeCount: m.nodeCount, channel: m.startChannel }];
            return {
                name: m.name,
                controller: carrier?.name ?? m.controllerName ?? '',
                nodeCount: m.nodeCount,
                channelsPerNode: cpn,
                spans,
            };
        });
}

/**
 * Rewrite per-controller upload intents for the models a wiring plan
 * overrides: their xLights intent goes, and each planned string becomes an
 * intent of its own on its port, at the channels the plan gave it.
 */
export function rewriteIntentsForPlan(
    byController: Map<string, ControllerModelIntent[]>,
    plan: WiringPlan,
    models: XlModelChannelInfo[],
    baseIntentOf: (m: XlModelChannelInfo) => ControllerModelIntent,
): void {
    if (!plan.overridden.length) return;
    const overridden = new Set(plan.overridden);
    for (const [name, intents] of byController) {
        byController.set(
            name,
            intents.filter((i) => !overridden.has(i.name)),
        );
    }
    const byName = new Map(models.map((m) => [m.name, m]));
    for (const s of plan.strings) {
        const m = byName.get(s.model);
        if (!m) continue;
        const cpn = channelsPerNode(m);
        const base = baseIntentOf(m);
        const intent: ControllerModelIntent = {
            ...base,
            controllerPort: s.port,
            protocol: base.protocol || 'ws2811',
            startChannel: s.channel,
            nodeCount: s.nodeCount,
            channels: s.nodeCount * cpn,
            channelsPerPixel: cpn,
        };
        // The chunk is one string on one port: the model's own spread and cascade no longer apply.
        delete intent.stringStartChannels;
        delete intent.stringNodeCounts;
        delete intent.stringChannels;
        delete intent.srCascadeOnPort;
        delete intent.srMaxCascade;
        delete intent.nullPixels;
        delete intent.endNullPixels;
        delete intent.reverse;
        delete intent.smartRemote;
        if (s.smartRemote > 0) intent.smartRemote = s.smartRemote;
        if (s.nullBefore) intent.nullPixels = s.nullBefore;
        if (s.nullAfter) intent.endNullPixels = s.nullAfter;
        if (s.reverse) intent.reverse = true;
        const arr = byController.get(s.controller) ?? [];
        arr.push(intent);
        byController.set(s.controller, arr);
    }
}

export interface TestTweakHooks {
    log: (level: 'info' | 'warn' | 'error', msg: string) => void;
    /** The wiring plan changed: upload intents need rebuilding and republishing. */
    onWiringChanged: () => void;
}

export class TestTweakService {
    doc: TestTweakDoc = emptyTestTweakDoc();
    plan: WiringPlan = EMPTY_PLAN;
    private revision = 0;
    private showFolder?: string;
    private models: XlModelChannelInfo[] = [];
    private controllers: XlControllerInfo[] = [];
    private xlGroups: XlModelGroup[] = [];
    private pipeline?: PixelPipeline;
    private active?: ActiveTest;

    constructor(private readonly hooks: TestTweakHooks) {}

    private file(): string | undefined {
        return this.showFolder ? path.join(this.showFolder, '.ezplayer', TEST_TWEAK_FILE) : undefined;
    }

    /** Read the show's document. A missing file is an empty document; an unreadable one is reported and left on disk. */
    async load(showFolder: string): Promise<void> {
        if (showFolder !== this.showFolder) {
            this.active = undefined;
            this.showFolder = showFolder;
        }
        this.doc = emptyTestTweakDoc();
        const file = this.file()!;
        try {
            this.doc = normalizeTestTweakDoc(JSON.parse(await fsp.readFile(file, 'utf8')));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.hooks.log(
                    'warn',
                    `[testtweak] ${file} could not be read (${(e as Error).message}); starting with no tweaks`,
                );
            }
        }
        ++this.revision;
    }

    private async save(): Promise<void> {
        const file = this.file();
        if (!file) throw new Error('no show folder');
        await fsp.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(this.doc, null, 2), 'utf8');
        await fsp.rename(tmp, file);
    }

    /** The show as just parsed from the xLights files. */
    setShow(models: XlModelChannelInfo[], controllers: XlControllerInfo[], xlGroups: XlModelGroup[] = []): void {
        this.models = models;
        this.controllers = controllers;
        this.xlGroups = xlGroups;
        this.replan();
    }

    /** Model types and xLights groups, for other listings of the show's models (the overlay targets). */
    showModels(): { types: Map<string, string>; groups: XlModelGroup[] } {
        return { types: new Map(this.models.map((m) => [m.name, m.displayAs])), groups: this.xlGroups };
    }

    private replan(): boolean {
        const before = JSON.stringify([this.plan.overridden, this.plan.strings]);
        this.plan = this.models.length
            ? planChunkWiring(this.doc, wiringModelsFrom(this.models, this.controllers))
            : EMPTY_PLAN;
        return before !== JSON.stringify([this.plan.overridden, this.plan.strings]);
    }

    /** Hook for the intent builders: apply the current plan to a controller-name map of intents. */
    rewriteIntents(
        byController: Map<string, ControllerModelIntent[]>,
        baseIntentOf: (m: XlModelChannelInfo) => ControllerModelIntent,
    ): void {
        rewriteIntentsForPlan(byController, this.plan, this.models, baseIntentOf);
    }

    /** A pipeline was built (or torn down): give it the trims, the wiring and any running test. */
    attach(pipeline: PixelPipeline | undefined): void {
        this.pipeline = pipeline;
        if (!pipeline) return;
        this.applyOutputs();
        if (this.active) this.runActive();
    }

    private applyOutputs(): void {
        this.pipeline?.configureOutputs({
            adjust: adjustFromDoc(this.doc),
            strings: this.plan.strings,
            skipModels: this.plan.overridden,
        });
    }

    /** (Re)start the active test on the current pipeline; clears it when nothing can be painted. */
    private runActive(): string[] {
        const p = this.pipeline;
        const t = this.active;
        if (!p || !t) return [];
        const names = resolveTestTargets(this.doc, t.targets, p.testableModels());
        const painted = p.startTest(names, t.pattern, { ttlMs: t.ttlMs });
        if (!painted.length) this.active = undefined;
        return painted;
    }

    private status(): TestTweakStatus {
        const running = this.pipeline?.testModels();
        // The pipeline ends a test by itself when its time is up. With no pipeline (a restart) the test is kept to resume.
        if (this.pipeline && !running) this.active = undefined;
        const known = new Set(this.models.map((m) => m.name));
        const named = new Set<string>(tweakedModelNames(this.doc));
        for (const g of this.doc.groups) for (const m of g.models) named.add(m);
        const unknown = this.models.length ? [...named].filter((n) => !known.has(n)).sort() : [];
        return {
            ...(this.active && running ? { active: this.active, activeModels: running } : {}),
            ...(unknown.length ? { unknownModels: unknown } : {}),
        };
    }

    private modelInfo(): TweakModelInfo[] {
        const testable = this.pipeline ? new Set(this.pipeline.testableModels()) : undefined;
        return this.models
            .filter((m) => m.nodeCount > 0)
            .map((m) => {
                const cc = m.controllerConnection;
                const info: TweakModelInfo = {
                    name: m.name,
                    type: m.displayAs,
                    nodeCount: m.nodeCount,
                    channelsPerNode: channelsPerNode(m),
                    startChannel: m.startChannel,
                    pixel: testable ? testable.has(m.name) : channelsPerNode(m) >= 3,
                    stringNodeCounts: m.stringNodeCounts?.length ? m.stringNodeCounts : [m.nodeCount],
                    controller: m.controllerName ?? '',
                    port: m.controllerPort ?? 0,
                };
                const subs = this.pipeline?.subModelCount(m.name);
                if (subs) info.subModels = subs;
                if (cc?.smartRemote) info.smartRemote = cc.smartRemote;
                if (m.controllerProtocol) info.protocol = m.controllerProtocol;
                if (cc?.colorOrder) info.xlColorOrder = cc.colorOrder;
                if (cc?.brightness !== undefined) info.xlBrightness = cc.brightness;
                if (cc?.gamma !== undefined) info.xlGamma = cc.gamma;
                return info;
            })
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }

    private controllerInfo(): TweakControllerInfo[] {
        return this.controllers.map((c) => ({
            name: c.name,
            ...(c.address ? { address: c.address } : {}),
            startChannel: c.startChannel,
            channels: c.maxChannels,
        }));
    }

    snapshot(): TestTweakSnapshot {
        return {
            doc: this.doc,
            status: this.status(),
            models: this.modelInfo(),
            controllers: this.controllerInfo(),
            problems: this.plan.problems,
            rewired: this.plan.overridden,
            revision: this.revision,
        };
    }

    async command(cmd: TestTweakCommand): Promise<TestTweakResult> {
        try {
            switch (cmd.op) {
                case 'get':
                    if (cmd.xlGroups) return { ok: true, ...this.snapshot(), xlGroups: this.xlGroups };
                    break;
                case 'setDoc': {
                    if (!this.showFolder) return { ok: false, error: 'no show folder' };
                    this.doc = normalizeTestTweakDoc(cmd.doc);
                    ++this.revision;
                    await this.save();
                    const rewired = this.replan();
                    this.applyOutputs();
                    if (rewired) {
                        this.hooks.log(
                            'info',
                            `[testtweak] wiring overrides now cover ${this.plan.overridden.length} model(s)`,
                        );
                        this.hooks.onWiringChanged();
                    }
                    // Group membership may have changed under a running test.
                    if (this.active) this.runActive();
                    break;
                }
                case 'start': {
                    const test = normalizeActiveTest(cmd.test);
                    if (!test) return { ok: false, error: 'bad test: a pattern with a known kind is required' };
                    if (!this.pipeline) return { ok: false, error: 'player not running' };
                    const wasRunning = !!this.active;
                    this.active = test;
                    const painted = this.runActive();
                    if (!painted.length) {
                        this.pipeline.stopTest();
                        return { ok: false, error: 'the targets contain no pixel models of this show' };
                    }
                    if (!wasRunning)
                        this.hooks.log('info', `[testtweak] test ${test.pattern.kind} on ${painted.length} model(s)`);
                    break;
                }
                case 'stop': {
                    this.active = undefined;
                    if (this.pipeline?.stopTest()) this.hooks.log('info', '[testtweak] test stopped');
                    break;
                }
                default:
                    return { ok: false, error: 'unknown op' };
            }
            return { ok: true, ...this.snapshot() };
        } catch (e) {
            return { ok: false, error: (e as Error).message };
        }
    }
}
