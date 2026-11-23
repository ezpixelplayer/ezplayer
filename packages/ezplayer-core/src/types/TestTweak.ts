/*
 * Test + Tweak: output profiles (color order, brightness, gamma, color
 * temperature) that models are assigned to, the split of models into port
 * chunks, flat groups of models and submodels to aim tests at, and saved
 * test patterns.  One JSON document per show; the active test itself
 * is runtime state and is never saved.
 */

// ---------------------------------------------------------------------------
// Test patterns
// ---------------------------------------------------------------------------

/** Mirrors SpatialPatternKind in @ezplayer/epp, which renders these. */
export type TestPatternKind =
    | 'solid'
    | 'bars'
    | 'rainbow'
    | 'chase'
    | 'strobe'
    | 'colorCycle'
    | 'markers'
    /** Each strand (string) in its own color. */
    | 'strands'
    /** Evenly spaced planes across x, y and z in a color each: are level lines level? */
    | 'grid';

/**
 * What a pattern runs along: 'world' lays it across all targets as one
 * picture, 'local' gives each target the whole pattern in its own
 * coordinates, 'node' follows each target's wiring and 'strand' restarts on
 * every strand.
 */
export type TestPatternSpace = 'world' | 'local' | 'node' | 'strand';

export const TEST_PATTERN_SPACES: TestPatternSpace[] = ['world', 'local', 'node', 'strand'];

/** Mirrors SpatialPatternParams in @ezplayer/epp. */
export interface TestPatternSpec {
    kind: TestPatternKind;
    /** Palette as '#rrggbb'. */
    colors?: string[];
    /** Direction of travel in the XY plane, degrees; 0 is +X, 90 is +Y. */
    angleDeg?: number;
    /** Tilt of the direction toward +Z, degrees. */
    elevationDeg?: number;
    /** Band width (bars, chase) or one full period (rainbow), as a fraction of the extent. */
    width?: number;
    /** Lit fraction of each band for bars, 0..1. */
    duty?: number;
    /** Periods (bars, rainbow) or extents (chase) per second. */
    speed?: number;
    /** Step time for strobe and colorCycle. */
    periodMs?: number;
    /** Node spacing for markers. */
    every?: number;
    space?: TestPatternSpace;
    /** 0..1 */
    intensity?: number;
    /** Grid: distance between planes, as a fraction of the largest extent of the targets. */
    spacing?: number;
    /** Grid: thickness of a plane, as a fraction of the spacing. */
    thickness?: number;
    /** Grid: slide the planes along each axis, in spacings (0..1 is one full step). */
    offsetX?: number;
    offsetY?: number;
    offsetZ?: number;
}

export const TEST_PATTERN_KINDS: TestPatternKind[] = [
    'solid',
    'bars',
    'rainbow',
    'chase',
    'strobe',
    'colorCycle',
    'markers',
    'strands',
    'grid',
];

/** A saved pattern: "my favorite test pattern", and later the thing an API call names. */
export interface TestPatternPreset {
    id: string;
    name: string;
    pattern: TestPatternSpec;
}

/** What a test runs on: models, submodels and groups, by name and id. */
export interface TestTargets {
    models?: string[];
    /** Submodels as "Model/Submodel". Test only: tweaks and wiring belong to whole models. */
    subModels?: string[];
    groups?: string[];
    /** Every pixel model in the show. */
    all?: boolean;
}

/** A running test. Runtime only. */
export interface ActiveTest {
    targets: TestTargets;
    pattern: TestPatternSpec;
    /** The test stops by itself after this long; absent means until stopped. */
    ttlMs?: number;
}

export interface TestTweakStatus {
    /** The running test, if any. */
    active?: ActiveTest;
    /** Names of the models and submodels the running test paints. */
    activeModels?: string[];
    /** Models the document names that the current layout does not have. */
    unknownModels?: string[];
}

// ---------------------------------------------------------------------------
// Tweaks
// ---------------------------------------------------------------------------

/** Output trims. Every field is optional; absent means "leave it alone". */
export interface OutputTweak {
    /** Wire order of the color channels, e.g. 'GRB'. */
    colorOrder?: string;
    /** Percent, 0..100. Group and model brightness multiply. */
    brightness?: number;
    gamma?: number;
    /** White point in kelvin; 6500 is neutral. */
    colorTempK?: number;
}

export const COLOR_ORDERS = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'] as const;
export const NEUTRAL_COLOR_TEMP_K = 6500;
export const MIN_COLOR_TEMP_K = 2000;
export const MAX_COLOR_TEMP_K = 12000;

/**
 * A run of a model's nodes on a controller port.  Chunks that share a port
 * go out in ascending `order`; the numbers need not be consecutive.
 */
export interface ModelPortChunk {
    /** First node of the model in this chunk (xLights node order, 0-based). */
    nodeStart: number;
    nodeCount: number;
    /** Controller name as in xlights_networks.xml; empty when unassigned. */
    controller: string;
    /** 1-based port; 0 when unassigned. */
    port: number;
    order: number;
    /** Smart remote / receiver on the port, 0 for none. */
    smartRemote?: number;
    /** Black pixels before / after the chunk on the wire. */
    nullBefore?: number;
    nullAfter?: number;
    reverse?: boolean;
}

/**
 * A named set of output settings that models are assigned to: in practice a
 * pixel type ("12V bullets", "SK6812 strip").  A setting the profile leaves
 * out is left alone on its members.
 */
export interface OutputProfile extends OutputTweak {
    id: string;
    name: string;
}

export interface ModelTweak extends OutputTweak {
    /** Id of the one profile the model is assigned to. The model's own settings override the profile's. */
    profile?: string;
    /** Present when the model's wiring is overridden here rather than taken from the xLights layout. */
    chunks?: ModelPortChunk[];
}

/**
 * Models and submodels to aim tests and effects at together.  Flat: a group
 * never holds another group.  Carries no settings, and membership is free to
 * overlap.  Not an xLights group, though one can be copied from there.
 */
export interface TestGroup {
    id: string;
    name: string;
    models: string[];
    /** As "Model/Submodel". */
    subModels?: string[];
}

export const TEST_TWEAK_DOC_VERSION = 2;

export interface TestTweakDoc {
    version: number;
    /** By model name. */
    models: Record<string, ModelTweak>;
    profiles: OutputProfile[];
    groups: TestGroup[];
    presets: TestPatternPreset[];
}

export function emptyTestTweakDoc(): TestTweakDoc {
    return { version: TEST_TWEAK_DOC_VERSION, models: {}, profiles: [], groups: [], presets: [] };
}

// ---------------------------------------------------------------------------
// Sanitizing (the document comes from disk and from HTTP)
// ---------------------------------------------------------------------------

function num(v: unknown, lo: number, hi: number): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    return Math.min(hi, Math.max(lo, v));
}

function int(v: unknown, lo: number, hi: number): number | undefined {
    const n = num(v, lo, hi);
    return n === undefined ? undefined : Math.round(n);
}

function str(v: unknown, max = 200): string | undefined {
    return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function isValidColorOrder(v: unknown): v is string {
    if (typeof v !== 'string') return false;
    const u = v.toUpperCase();
    return u.length === 3 && u.includes('R') && u.includes('G') && u.includes('B');
}

export function normalizeOutputTweak(v: unknown): OutputTweak {
    const out: OutputTweak = {};
    if (!isRecord(v)) return out;
    if (isValidColorOrder(v.colorOrder)) out.colorOrder = v.colorOrder.toUpperCase();
    const b = num(v.brightness, 0, 100);
    if (b !== undefined) out.brightness = b;
    const g = num(v.gamma, 0.1, 5);
    if (g !== undefined) out.gamma = g;
    const k = num(v.colorTempK, MIN_COLOR_TEMP_K, MAX_COLOR_TEMP_K);
    if (k !== undefined) out.colorTempK = k;
    return out;
}

function normalizeChunk(v: unknown): ModelPortChunk | undefined {
    if (!isRecord(v)) return undefined;
    const nodeStart = int(v.nodeStart, 0, 1e8);
    const nodeCount = int(v.nodeCount, 1, 1e8);
    if (nodeStart === undefined || nodeCount === undefined) return undefined;
    const c: ModelPortChunk = {
        nodeStart,
        nodeCount,
        controller: typeof v.controller === 'string' ? v.controller.slice(0, 200) : '',
        port: int(v.port, 0, 4096) ?? 0,
        order: int(v.order, 0, 1e6) ?? 0,
    };
    const sr = int(v.smartRemote, 0, 64);
    if (sr) c.smartRemote = sr;
    const nb = int(v.nullBefore, 0, 10000);
    if (nb) c.nullBefore = nb;
    const na = int(v.nullAfter, 0, 10000);
    if (na) c.nullAfter = na;
    if (v.reverse === true) c.reverse = true;
    return c;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function normalizeTestPattern(v: unknown): TestPatternSpec | undefined {
    if (!isRecord(v)) return undefined;
    if (!TEST_PATTERN_KINDS.includes(v.kind as TestPatternKind)) return undefined;
    const p: TestPatternSpec = { kind: v.kind as TestPatternKind };
    if (Array.isArray(v.colors)) {
        const colors = v.colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 16);
        if (colors.length) p.colors = colors.map((c) => c.toLowerCase());
    }
    const set = <K extends keyof TestPatternSpec>(k: K, val: TestPatternSpec[K] | undefined) => {
        if (val !== undefined) p[k] = val;
    };
    set('angleDeg', num(v.angleDeg, -3600, 3600));
    set('elevationDeg', num(v.elevationDeg, -90, 90));
    set('width', num(v.width, 0.001, 10));
    set('duty', num(v.duty, 0, 1));
    set('speed', num(v.speed, -100, 100));
    set('periodMs', num(v.periodMs, 20, 600000));
    set('every', int(v.every, 1, 100000));
    set('intensity', num(v.intensity, 0, 1));
    set('spacing', num(v.spacing, 0.005, 10));
    set('thickness', num(v.thickness, 0.005, 1));
    set('offsetX', num(v.offsetX, -1, 1));
    set('offsetY', num(v.offsetY, -1, 1));
    set('offsetZ', num(v.offsetZ, -1, 1));
    if (TEST_PATTERN_SPACES.includes(v.space as TestPatternSpace)) p.space = v.space as TestPatternSpace;
    return p;
}

export function normalizeTestTargets(v: unknown): TestTargets {
    const out: TestTargets = {};
    if (!isRecord(v)) return out;
    const names = (a: unknown) =>
        Array.isArray(a) ? [...new Set(a.filter((s): s is string => typeof s === 'string' && s.length > 0))] : [];
    const models = names(v.models);
    const groups = names(v.groups);
    const subModels = names(v.subModels).filter((s) => s.includes('/'));
    if (models.length) out.models = models;
    if (subModels.length) out.subModels = subModels;
    if (groups.length) out.groups = groups;
    if (v.all === true) out.all = true;
    return out;
}

export function normalizeActiveTest(v: unknown): ActiveTest | undefined {
    if (!isRecord(v)) return undefined;
    const pattern = normalizeTestPattern(v.pattern);
    if (!pattern) return undefined;
    const t: ActiveTest = { targets: normalizeTestTargets(v.targets), pattern };
    const ttl = num(v.ttlMs, 100, 24 * 3600 * 1000);
    if (ttl !== undefined) t.ttlMs = ttl;
    return t;
}

/** Coerce anything into a well-formed document, dropping what does not parse. */
export function normalizeTestTweakDoc(v: unknown): TestTweakDoc {
    const doc = emptyTestTweakDoc();
    if (!isRecord(v)) return doc;
    const names = (a: unknown) =>
        Array.isArray(a) ? [...new Set(a.filter((s): s is string => typeof s === 'string' && s.length > 0))] : [];
    const ids = new Set<string>();
    if (Array.isArray(v.profiles)) {
        for (const raw of v.profiles) {
            if (!isRecord(raw)) continue;
            const id = str(raw.id);
            const name = str(raw.name);
            if (!id || !name || ids.has(id)) continue;
            ids.add(id);
            doc.profiles.push({ id, name, ...normalizeOutputTweak(raw) });
        }
    }
    if (isRecord(v.models)) {
        for (const [name, raw] of Object.entries(v.models)) {
            if (!name || !isRecord(raw)) continue;
            const m: ModelTweak = normalizeOutputTweak(raw);
            // A profile that is gone leaves the model unassigned.
            if (typeof raw.profile === 'string' && ids.has(raw.profile)) m.profile = raw.profile;
            if (Array.isArray(raw.chunks)) {
                const chunks = raw.chunks.map(normalizeChunk).filter((c): c is ModelPortChunk => !!c);
                if (chunks.length) m.chunks = chunks.sort((a, b) => a.nodeStart - b.nodeStart);
            }
            if (Object.keys(m).length) doc.models[name] = m;
        }
    }
    ids.clear();
    if (Array.isArray(v.groups)) {
        for (const raw of v.groups) {
            if (!isRecord(raw)) continue;
            const id = str(raw.id);
            const name = str(raw.name);
            if (!id || !name || ids.has(id)) continue;
            ids.add(id);
            const g: TestGroup = { id, name, models: names(raw.models) };
            const subModels = names(raw.subModels).filter((s) => s.includes('/'));
            if (subModels.length) g.subModels = subModels;
            doc.groups.push(g);
        }
    }
    ids.clear();
    if (Array.isArray(v.presets)) {
        for (const raw of v.presets) {
            if (!isRecord(raw)) continue;
            const id = str(raw.id);
            const name = str(raw.name);
            const pattern = normalizeTestPattern(raw.pattern);
            if (!id || !name || !pattern || ids.has(id)) continue;
            ids.add(id);
            doc.presets.push({ id, name, pattern });
        }
    }
    return doc;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface EffectiveTweak {
    colorOrder?: string;
    /** 0..1 */
    brightness: number;
    gamma?: number;
    colorTempK?: number;
    /** Id of the profile the model is assigned to, when it has one. */
    profile?: string;
}

const TWEAK_KEYS = ['colorOrder', 'brightness', 'gamma', 'colorTempK'] as const;
export type TweakKey = (typeof TWEAK_KEYS)[number];
export const OUTPUT_TWEAK_KEYS: readonly TweakKey[] = TWEAK_KEYS;

/**
 * What actually applies to a model: for each setting the model's own value,
 * else its profile's, else nothing.  Every setting works the same way; a
 * model's own value replaces the profile's rather than combining with it.
 */
export function effectiveTweak(doc: TestTweakDoc, model: string): EffectiveTweak {
    const own = doc.models[model];
    const profile = own?.profile ? doc.profiles.find((p) => p.id === own.profile) : undefined;
    const pick = <K extends TweakKey>(k: K): OutputTweak[K] => own?.[k] ?? profile?.[k];
    const eff: EffectiveTweak = { brightness: Math.min(1, Math.max(0, (pick('brightness') ?? 100) / 100)) };
    const colorOrder = pick('colorOrder');
    const gamma = pick('gamma');
    const colorTempK = pick('colorTempK');
    if (colorOrder !== undefined) eff.colorOrder = colorOrder;
    if (gamma !== undefined) eff.gamma = gamma;
    if (colorTempK !== undefined) eff.colorTempK = colorTempK;
    if (profile) eff.profile = profile.id;
    return eff;
}

/** True when the effective tweak changes nothing on the wire. */
export function isNeutralTweak(e: EffectiveTweak): boolean {
    return (
        e.colorOrder === undefined &&
        e.brightness === 1 &&
        (e.gamma === undefined || e.gamma === 1) &&
        (e.colorTempK === undefined || e.colorTempK === NEUTRAL_COLOR_TEMP_K)
    );
}

/** Every model the document says anything about, tweak-wise. */
export function tweakedModelNames(doc: TestTweakDoc): string[] {
    return Object.keys(doc.models);
}

/** Names of the models assigned to a profile, sorted. */
export function profileMembers(doc: TestTweakDoc, profileId: string): string[] {
    return Object.keys(doc.models)
        .filter((m) => doc.models[m].profile === profileId)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** The settings a model sets for itself, over whatever its profile says. */
export function ownTweakKeys(t: ModelTweak | undefined): TweakKey[] {
    return t ? TWEAK_KEYS.filter((k) => t[k] !== undefined) : [];
}

function withModel(doc: TestTweakDoc, model: string, change: (t: ModelTweak) => ModelTweak): TestTweakDoc {
    const next = change({ ...(doc.models[model] ?? {}) });
    const models = { ...doc.models };
    if (Object.keys(next).length) models[model] = next;
    else delete models[model];
    return { ...doc, models };
}

/** Assign models to a profile (taking them out of any other), or to none with `undefined`. */
export function assignProfile(
    doc: TestTweakDoc,
    models: Iterable<string>,
    profileId: string | undefined,
): TestTweakDoc {
    let out = doc;
    for (const m of models) {
        if ((out.models[m]?.profile ?? undefined) === profileId) continue;
        out = withModel(out, m, (t) => {
            if (profileId) t.profile = profileId;
            else delete t.profile;
            return t;
        });
    }
    return out;
}

/** Set, or with `undefined` clear, one of a model's own settings. */
export function setModelTweak<K extends TweakKey>(
    doc: TestTweakDoc,
    model: string,
    key: K,
    value: OutputTweak[K] | undefined,
): TestTweakDoc {
    return withModel(doc, model, (t) => {
        if (value === undefined) delete t[key];
        else t[key] = value;
        return t;
    });
}

/** Remove a profile; its members become unassigned and keep their own settings. */
export function deleteProfile(doc: TestTweakDoc, profileId: string): TestTweakDoc {
    const out = assignProfile(doc, profileMembers(doc, profileId), undefined);
    return { ...out, profiles: out.profiles.filter((p) => p.id !== profileId) };
}

/** Model and submodel names a set of targets covers, in first-seen order. `allModels` backs the `all` flag. */
export function resolveTestTargets(doc: TestTweakDoc, targets: TestTargets, allModels: string[] = []): string[] {
    const out = new Set<string>();
    if (targets.all) for (const m of allModels) out.add(m);
    for (const m of targets.models ?? []) out.add(m);
    for (const id of targets.groups ?? []) {
        const g = doc.groups.find((x) => x.id === id);
        if (!g) continue;
        for (const m of g.models) out.add(m);
        for (const s of g.subModels ?? []) out.add(s);
    }
    for (const s of targets.subModels ?? []) out.add(s);
    return [...out];
}

// ---------------------------------------------------------------------------
// Port chunks
// ---------------------------------------------------------------------------

/** One chunk per string, each inheriting the placement of whatever covered its first node before. */
export function splitIntoStrings(stringNodeCounts: number[], existing?: ModelPortChunk[]): ModelPortChunk[] {
    const out: ModelPortChunk[] = [];
    let node = 0;
    stringNodeCounts.forEach((count, i) => {
        if (count <= 0) return;
        const prev = existing?.find((c) => node >= c.nodeStart && node < c.nodeStart + c.nodeCount);
        out.push({
            nodeStart: node,
            nodeCount: count,
            controller: prev?.controller ?? '',
            port: prev?.port ?? 0,
            order: (prev?.order ?? 0) + (prev ? i : 0),
            ...(prev?.smartRemote ? { smartRemote: prev.smartRemote } : {}),
        });
        node += count;
    });
    return out;
}

/** Cut the chunk containing `node` in two at that node. Returns the same list when the cut is at an edge. */
export function splitChunkAt(chunks: ModelPortChunk[], node: number): ModelPortChunk[] {
    const out: ModelPortChunk[] = [];
    for (const c of chunks) {
        if (node > c.nodeStart && node < c.nodeStart + c.nodeCount) {
            const first = node - c.nodeStart;
            out.push({ ...c, nodeCount: first, nullAfter: undefined });
            out.push({
                ...c,
                nodeStart: node,
                nodeCount: c.nodeCount - first,
                order: c.order + 1,
                nullBefore: undefined,
            });
        } else {
            out.push(c);
        }
    }
    return out;
}

/** Merge chunk `index` with the one after it; the merged chunk keeps the first one's placement. */
export function mergeChunkWithNext(chunks: ModelPortChunk[], index: number): ModelPortChunk[] {
    if (index < 0 || index >= chunks.length - 1) return chunks;
    const a = chunks[index];
    const b = chunks[index + 1];
    if (a.nodeStart + a.nodeCount !== b.nodeStart) return chunks;
    const merged: ModelPortChunk = { ...a, nodeCount: a.nodeCount + b.nodeCount, nullAfter: b.nullAfter };
    return [...chunks.slice(0, index), merged, ...chunks.slice(index + 2)];
}

export interface ChunkProblem {
    model: string;
    /** Index into the model's chunks, when the problem is about one chunk. */
    chunk?: number;
    message: string;
}

/** Check a model's chunks against its node count. */
export function validateChunks(model: string, chunks: ModelPortChunk[], nodeCount: number): ChunkProblem[] {
    const problems: ChunkProblem[] = [];
    const sorted = chunks.map((c, i) => ({ c, i })).sort((a, b) => a.c.nodeStart - b.c.nodeStart);
    let cursor = 0;
    for (const { c, i } of sorted) {
        if (c.nodeStart < cursor)
            problems.push({ model, chunk: i, message: `overlaps the chunk before it at node ${c.nodeStart + 1}` });
        else if (c.nodeStart > cursor)
            problems.push({ model, chunk: i, message: `nodes ${cursor + 1}-${c.nodeStart} are not in any chunk` });
        if (c.nodeStart + c.nodeCount > nodeCount)
            problems.push({ model, chunk: i, message: `runs past the model's ${nodeCount} nodes` });
        if (!c.controller || c.port <= 0) problems.push({ model, chunk: i, message: 'has no controller port' });
        cursor = Math.max(cursor, c.nodeStart + c.nodeCount);
    }
    if (cursor < nodeCount && chunks.length)
        problems.push({ model, message: `nodes ${cursor + 1}-${nodeCount} are not in any chunk` });
    return problems;
}

export interface PortChainEntry {
    model: string;
    /** Index into the model's chunks. */
    chunkIndex: number;
    chunk: ModelPortChunk;
}

export interface PortChain {
    controller: string;
    port: number;
    smartRemote: number;
    /** In wire order. */
    entries: PortChainEntry[];
    /** Pixels on the port, nulls included. */
    pixels: number;
}

/**
 * The overridden wiring by controller port: every assigned chunk in the
 * document, grouped by (controller, port, smart remote) and sorted by order,
 * then by model name and node so equal numbers are still deterministic.
 */
export function portChains(doc: TestTweakDoc): PortChain[] {
    const byKey = new Map<string, PortChain>();
    for (const model of Object.keys(doc.models).sort()) {
        const chunks = doc.models[model].chunks;
        if (!chunks) continue;
        chunks.forEach((chunk, chunkIndex) => {
            if (!chunk.controller || chunk.port <= 0) return;
            const sr = chunk.smartRemote ?? 0;
            const key = `${chunk.controller}\u0000${chunk.port}\u0000${sr}`;
            let chain = byKey.get(key);
            if (!chain) {
                chain = { controller: chunk.controller, port: chunk.port, smartRemote: sr, entries: [], pixels: 0 };
                byKey.set(key, chain);
            }
            chain.entries.push({ model, chunkIndex, chunk });
            chain.pixels += chunk.nodeCount + (chunk.nullBefore ?? 0) + (chunk.nullAfter ?? 0);
        });
    }
    const chains = [...byKey.values()];
    for (const c of chains) {
        c.entries.sort(
            (a, b) =>
                a.chunk.order - b.chunk.order ||
                a.model.localeCompare(b.model) ||
                a.chunk.nodeStart - b.chunk.nodeStart,
        );
    }
    chains.sort((a, b) => a.controller.localeCompare(b.controller) || a.port - b.port || a.smartRemote - b.smartRemote);
    return chains;
}

/** A number that puts a new chunk at the end of a port, leaving room to insert before it later. */
export function nextOrderOnPort(doc: TestTweakDoc, controller: string, port: number, smartRemote = 0): number {
    let max = 0;
    for (const m of Object.values(doc.models)) {
        for (const c of m.chunks ?? []) {
            if (c.controller === controller && c.port === port && (c.smartRemote ?? 0) === smartRemote)
                max = Math.max(max, c.order);
        }
    }
    return Math.floor(max / 10) * 10 + 10;
}

/** Chunks on one port that share an order number (legal, but usually a slip). */
export function duplicateOrders(
    chains: PortChain[],
): { controller: string; port: number; order: number; models: string[] }[] {
    const out: { controller: string; port: number; order: number; models: string[] }[] = [];
    for (const chain of chains) {
        const seen = new Map<number, string[]>();
        for (const e of chain.entries) seen.set(e.chunk.order, [...(seen.get(e.chunk.order) ?? []), e.model]);
        for (const [order, models] of seen)
            if (models.length > 1) out.push({ controller: chain.controller, port: chain.port, order, models });
    }
    return out;
}

// ---------------------------------------------------------------------------
// What the player tells the screen about the show
// ---------------------------------------------------------------------------

/** A model as the Test + Tweak screen needs it. */
export interface TweakModelInfo {
    name: string;
    /** xLights DisplayAs. */
    type: string;
    nodeCount: number;
    channelsPerNode: number;
    /** Absolute 1-based first channel. */
    startChannel: number;
    /** False for models the pipeline carries as raw channels (DMX, serial, odd string types): no test, no tweak. */
    pixel: boolean;
    /** Node count of each physical string as xLights has it. */
    stringNodeCounts: number[];
    /** How many submodels the model has, when it has any. */
    subModels?: number;
    /** The xLights wiring: controller name ('' when unassigned), 1-based port (0 when none), smart remote. */
    controller: string;
    port: number;
    smartRemote?: number;
    protocol?: string;
    /** Color order, brightness (percent) and gamma xLights has on the model's controller connection. */
    xlColorOrder?: string;
    xlBrightness?: number;
    xlGamma?: number;
}

/** An xLights model group with the groups inside it resolved away, offered for copying into a test group. */
export interface XlModelGroup {
    name: string;
    models: string[];
    /** As "Model/Submodel". */
    subModels: string[];
}

export interface TweakControllerInfo {
    name: string;
    address?: string;
    /** Absolute 1-based first channel and channel count. */
    startChannel: number;
    channels: number;
}

/** Everything the screen loads in one call. */
export interface TestTweakSnapshot {
    doc: TestTweakDoc;
    status: TestTweakStatus;
    models: TweakModelInfo[];
    controllers: TweakControllerInfo[];
    /** Problems with the wiring overrides, as the player sees them. */
    problems: ChunkProblem[];
    /** Models whose wiring currently comes from the document rather than xLights. */
    rewired: string[];
    /** Bumps whenever the document changes, so a client can tell its own save from someone else's. */
    revision: number;
    /** The show's xLights model groups, flattened. Only when asked for: the list can be long. */
    xlGroups?: XlModelGroup[];
}

// ---------------------------------------------------------------------------
// Wiring plan: turning chunks into channels
// ---------------------------------------------------------------------------

/** A model's place in channel space, for planning. */
export interface WiringModel {
    name: string;
    /** Controller whose channel range holds the model in the xLights layout; '' when none. */
    controller: string;
    nodeCount: number;
    channelsPerNode: number;
    /** The model's channels as runs of nodes, absolute 1-based channels, in node order. */
    spans: { nodeStart: number; nodeCount: number; channel: number }[];
}

/** A chunk (or the part of one that fits a free block) with the channels it was given. */
export interface WiredString {
    model: string;
    chunkIndex: number;
    controller: string;
    port: number;
    smartRemote: number;
    nodeStart: number;
    nodeCount: number;
    /** Absolute 1-based channel of the first node. */
    channel: number;
    nullBefore?: number;
    nullAfter?: number;
    reverse?: boolean;
}

export interface WiringPlan {
    /** Models whose wiring comes from here; every other model keeps its xLights wiring. */
    overridden: string[];
    /** In channel order per controller. */
    strings: WiredString[];
    problems: ChunkProblem[];
}

/**
 * Give every chunk channels.
 *
 * Channel space is not renumbered: the channels an overridden model occupied
 * become a pool on the controller that carried them, and the chunks now
 * assigned to that controller are laid into the pool port by port, in wire
 * order.  So on each port, ascending start channel is ascending `order`,
 * which is the order controllers chain strings in.  A chunk that lands on a
 * controller with no room left (it moved in from elsewhere and nothing moved
 * out) is reported and its model keeps the xLights wiring.
 */
export function planChunkWiring(doc: TestTweakDoc, models: WiringModel[]): WiringPlan {
    const problems: ChunkProblem[] = [];
    const byName = new Map(models.map((m) => [m.name, m]));
    let candidates = new Set<string>();
    for (const [name, mt] of Object.entries(doc.models)) {
        if (!mt.chunks?.length) continue;
        const m = byName.get(name);
        if (!m) continue;
        const bad = validateChunks(name, mt.chunks, m.nodeCount);
        if (bad.length) problems.push(...bad);
        else candidates.add(name);
    }

    // Dropping a model returns its channels to their original use, which can shrink a pool; repeat until stable.
    for (;;) {
        const pools = new Map<string, { channel: number; count: number }[]>();
        for (const name of [...candidates].sort()) {
            const m = byName.get(name)!;
            const pool = pools.get(m.controller) ?? [];
            for (const s of m.spans) pool.push({ channel: s.channel, count: s.nodeCount * m.channelsPerNode });
            pools.set(m.controller, pool);
        }
        for (const pool of pools.values()) pool.sort((a, b) => a.channel - b.channel);

        const subset: TestTweakDoc = {
            ...doc,
            models: Object.fromEntries(Object.entries(doc.models).filter(([n]) => candidates.has(n))),
        };
        const strings: WiredString[] = [];
        const failed = new Set<string>();
        for (const chain of portChains(subset)) {
            const pool = pools.get(chain.controller) ?? [];
            for (const e of chain.entries) {
                const m = byName.get(e.model)!;
                const cpn = m.channelsPerNode;
                let node = e.chunk.nodeStart;
                let left = e.chunk.nodeCount;
                let first = true;
                while (left > 0) {
                    // Skip blocks too small for even one node.
                    while (pool.length && pool[0].count < cpn) pool.shift();
                    const block = pool[0];
                    if (!block) {
                        failed.add(e.model);
                        break;
                    }
                    const take = Math.min(left, Math.floor(block.count / cpn));
                    const last = take === left;
                    strings.push({
                        model: e.model,
                        chunkIndex: e.chunkIndex,
                        controller: chain.controller,
                        port: chain.port,
                        smartRemote: chain.smartRemote,
                        nodeStart: node,
                        nodeCount: take,
                        channel: block.channel,
                        ...(first && e.chunk.nullBefore ? { nullBefore: e.chunk.nullBefore } : {}),
                        ...(last && e.chunk.nullAfter ? { nullAfter: e.chunk.nullAfter } : {}),
                        ...(e.chunk.reverse ? { reverse: true } : {}),
                    });
                    block.channel += take * cpn;
                    block.count -= take * cpn;
                    node += take;
                    left -= take;
                    first = false;
                }
            }
        }
        if (!failed.size) {
            strings.sort((a, b) => a.controller.localeCompare(b.controller) || a.channel - b.channel);
            return { overridden: [...candidates].sort(), strings, problems };
        }
        for (const name of failed) {
            problems.push({
                model: name,
                message: 'its controller has no free channels for it; it keeps the xLights wiring',
            });
        }
        candidates = new Set([...candidates].filter((n) => !failed.has(n)));
    }
}
