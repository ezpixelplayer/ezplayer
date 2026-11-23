/*
 * Pixel targets: what an overlay or an effect can be aimed at. A model is a
 * run of canonical nodes; a submodel is any subset of its parent's nodes,
 * named "Model/Submodel". Each target knows its nodes, its strands and its
 * render buffer. Submodels stay out of the layout manifest.
 */

import { BufferSpec, DisplayLayout, LayoutModel, LayoutModelSpec } from './Layout';

/** 'area' is a crop of the parent's buffer, which has no strands. */
export type StrandKind = 'single' | 'multi' | 'multiEqual' | 'area';

export interface PixelTarget {
    /** Name to address it by: "Model" or "Model/Submodel". */
    name: string;
    model: string;
    subModel?: string;
    /** Canonical node per target node: canonical order for a model, listed order for a submodel. */
    nodes: Int32Array;
    /** First canonical node when the nodes are one ascending run, else -1. */
    nodeStart: number;
    strands: number[];
    kind: StrandKind;
    /** Dense grid, models only. */
    grid?: { width: number; height: number };
    /** Render buffer; cell nodes index into `nodes`. */
    buffer?: BufferSpec;
    vertical?: boolean;
    bufferStyle?: string;
    /** Model-local coordinates per target node. */
    local?: Float32Array;
}

export function strandKind(strands: number[] | undefined): StrandKind {
    if (!strands) return 'area';
    if (strands.length <= 1) return 'single';
    return strands.every((n) => n === strands[0]) ? 'multiEqual' : 'multi';
}

/** Runs of consecutive canonical nodes, in target order: what a range-based effect takes. */
export function targetRuns(nodes: Int32Array): { nodeStart: number; nodeCount: number }[] {
    const runs: { nodeStart: number; nodeCount: number }[] = [];
    for (let i = 0; i < nodes.length; ++i) {
        const last = runs[runs.length - 1];
        if (last && nodes[i] === last.nodeStart + last.nodeCount) last.nodeCount++;
        else runs.push({ nodeStart: nodes[i], nodeCount: 1 });
    }
    return runs;
}

/** Nodes that sit in more than one buffer cell. */
export function overlappingNodes(buffer: BufferSpec | undefined, nodeCount: number): number {
    if (!buffer || buffer.cells.length <= nodeCount * 3) return 0;
    const seen = new Uint8Array(nodeCount);
    let n = 0;
    for (let k = 0; k < buffer.cells.length; k += 3) {
        const node = buffer.cells[k];
        if (seen[node] === 1) n++;
        if (seen[node] < 2) seen[node]++;
    }
    return n;
}

export class TargetCatalog {
    private readonly specs = new Map<string, LayoutModelSpec>();
    private readonly models = new Map<string, LayoutModel>();
    private readonly cache = new Map<string, PixelTarget>();

    constructor(
        readonly layout: DisplayLayout,
        specs?: LayoutModelSpec[],
    ) {
        for (const m of layout.models) if (m.nodeStart >= 0) this.models.set(m.name, m);
        for (const s of specs ?? []) this.specs.set(s.name, s);
    }

    /** Pixel models, in layout order. */
    modelNames(): string[] {
        return [...this.models.keys()];
    }

    subModelNames(model: string): string[] {
        if (!this.models.has(model)) return [];
        return (this.specs.get(model)?.subModels ?? []).map((s) => s.name);
    }

    /** A model, or a submodel given as "Model/Submodel" or as a separate name. */
    find(name: string, subModel?: string): PixelTarget | undefined {
        if (subModel) return this.subTarget(name, subModel);
        const m = this.modelTarget(name);
        if (m) return m;
        // Model names may hold a slash themselves: try every split.
        for (let i = name.indexOf('/'); i >= 0; i = name.indexOf('/', i + 1)) {
            const t = this.subTarget(name.slice(0, i), name.slice(i + 1));
            if (t) return t;
        }
        return undefined;
    }

    private modelTarget(name: string): PixelTarget | undefined {
        const hit = this.cache.get(name);
        if (hit) return hit;
        const lm = this.models.get(name);
        if (!lm) return undefined;
        const spec = this.specs.get(name);
        const n = lm.nodeCount;
        const slot = (i: number) => (lm.perm ? lm.perm[i] : i);
        const nodes = new Int32Array(n);
        for (let i = 0; i < n; ++i) nodes[i] = lm.nodeStart + i;
        const t: PixelTarget = {
            name,
            model: name,
            nodes,
            nodeStart: lm.nodeStart,
            strands: spec?.strands?.length ? spec.strands : [n],
            kind: 'single',
            grid: lm.grid,
        };
        t.kind = strandKind(t.strands);
        if (spec?.buffer) {
            // Spec cells name xLights nodes; target nodes are canonical.
            const cells = Int32Array.from(spec.buffer.cells);
            for (let k = 0; k < cells.length; k += 3) cells[k] = slot(cells[k]);
            t.buffer = { width: spec.buffer.width, height: spec.buffer.height, cells };
        }
        if (spec?.local && spec.local.length >= n * 3) {
            const local = new Float32Array(n * 3);
            for (let i = 0; i < n; ++i) local.set(spec.local.subarray(i * 3, i * 3 + 3), slot(i) * 3);
            t.local = local;
        }
        this.cache.set(name, t);
        return t;
    }

    private subTarget(model: string, subModel: string): PixelTarget | undefined {
        const key = `${model}\n${subModel}`;
        const hit = this.cache.get(key);
        if (hit) return hit;
        const lm = this.models.get(model);
        const sub = this.specs.get(model)?.subModels?.find((s) => s.name === subModel);
        const parent = this.modelTarget(model);
        if (!lm || !sub || !parent) return undefined;
        const n = sub.nodes.length;
        const nodes = new Int32Array(n);
        let run = n > 0;
        for (let i = 0; i < n; ++i) {
            const p = sub.nodes[i];
            if (p < 0 || p >= lm.nodeCount) return undefined;
            nodes[i] = lm.nodeStart + (lm.perm ? lm.perm[p] : p);
            if (i > 0 && nodes[i] !== nodes[i - 1] + 1) run = false;
        }
        const t: PixelTarget = {
            name: `${model}/${subModel}`,
            model,
            subModel,
            nodes,
            nodeStart: run ? nodes[0] : -1,
            strands: sub.strands ?? [],
            kind: strandKind(sub.strands),
            buffer: sub.buffer,
            vertical: sub.vertical,
            bufferStyle: sub.bufferStyle,
        };
        if (parent.local) {
            const local = new Float32Array(n * 3);
            for (let i = 0; i < n; ++i) {
                const s = (nodes[i] - lm.nodeStart) * 3;
                local.set(parent.local.subarray(s, s + 3), i * 3);
            }
            t.local = local;
        }
        this.cache.set(key, t);
        return t;
    }
}
