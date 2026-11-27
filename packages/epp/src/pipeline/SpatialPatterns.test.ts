import { describe, expect, it } from 'vitest';
import { ChannelRoleSpec, compileLayout, LayoutModelSpec } from './Layout';
import { applyOutput, compileOutputMap } from './OutputMap';
import {
    patternAnimates,
    patternTargetOfModel,
    patternTargets,
    patternTargetsForModels,
    SpatialPatternRenderer,
    type SpatialPatternParams,
} from './SpatialPatterns';
import { TargetCatalog } from './Targets';

const RGB: ChannelRoleSpec[] = [
    { offset: 0, kind: 'red' },
    { offset: 1, kind: 'green' },
    { offset: 2, kind: 'blue' },
];
const RGBW: ChannelRoleSpec[] = [
    { offset: 0, kind: 'white' },
    { offset: 1, kind: 'red' },
    { offset: 2, kind: 'green' },
    { offset: 3, kind: 'blue' },
];

/** A horizontal strip of n nodes starting at x0, at height y. */
function strip(name: string, startChannel: number, n: number, x0: number, y: number): LayoutModelSpec {
    const world = new Float32Array(n * 3);
    for (let i = 0; i < n; ++i) {
        world[i * 3] = x0 + i;
        world[i * 3 + 1] = y;
    }
    return { name, startChannel, nodeCount: n, channelsPerNode: 3, roles: RGB, world };
}

function nodeRgb(frame: Uint8Array, node: number): number[] {
    return [frame[node * 3], frame[node * 3 + 1], frame[node * 3 + 2]];
}

describe('SpatialPatternRenderer', () => {
    const specs = [strip('Left', 0, 10, 0, 0), strip('Right', 30, 10, 10, 0), strip('Other', 60, 4, 0, 5)];
    const layout = compileLayout(specs, { keepWorld: true });
    const left = layout.models.find((m) => m.name === 'Left')!;
    const right = layout.models.find((m) => m.name === 'Right')!;
    const other = layout.models.find((m) => m.name === 'Other')!;

    it('paints only the targets', () => {
        const r = new SpatialPatternRenderer(layout, patternTargetsForModels(layout, ['Left', 'nope']), {
            kind: 'solid',
            colors: ['#102030'],
        });
        const frame = new Uint8Array(layout.frameBytes).fill(7);
        r.render(frame, 3, 0);
        expect(r.nodeCount).toBe(10);
        expect(nodeRgb(frame, left.nodeStart)).toEqual([0x10, 0x20, 0x30]);
        expect(nodeRgb(frame, left.nodeStart + 9)).toEqual([0x10, 0x20, 0x30]);
        expect(nodeRgb(frame, right.nodeStart)).toEqual([7, 7, 7]);
        expect(nodeRgb(frame, other.nodeStart)).toEqual([7, 7, 7]);
    });

    it('runs bars across a group as one picture in world space', () => {
        // 20 nodes along x; two bands, so Left is the first color and Right the second.
        const r = new SpatialPatternRenderer(layout, [left, right].map(patternTargetOfModel), {
            kind: 'bars',
            colors: ['#ff0000', '#0000ff'],
            width: 0.5,
            speed: 0,
            angleDeg: 0,
        });
        const frame = new Uint8Array(layout.frameBytes);
        r.render(frame, 3, 0);
        expect(nodeRgb(frame, left.nodeStart + 2)).toEqual([255, 0, 0]);
        expect(nodeRgb(frame, right.nodeStart + 2)).toEqual([0, 0, 255]);
    });

    it('turns the bars with the angle', () => {
        // Bars travelling along Y: every node of a horizontal strip sits in the same band.
        const r = new SpatialPatternRenderer(layout, [left, other].map(patternTargetOfModel), {
            kind: 'bars',
            colors: ['#ff0000', '#0000ff'],
            width: 0.6,
            speed: 0,
            angleDeg: 90,
        });
        const frame = new Uint8Array(layout.frameBytes);
        r.render(frame, 3, 0);
        expect(nodeRgb(frame, left.nodeStart)).toEqual([255, 0, 0]);
        expect(nodeRgb(frame, left.nodeStart + 9)).toEqual([255, 0, 0]);
        expect(nodeRgb(frame, other.nodeStart)).toEqual([0, 0, 255]);
    });

    it('moves a chase along the wiring over time', () => {
        const r = new SpatialPatternRenderer(layout, [patternTargetOfModel(left)], {
            kind: 'chase',
            width: 0.1,
            speed: 1,
            colors: ['#ffffff'],
        });
        const frame = new Uint8Array(layout.frameBytes);
        const litAt = (tMs: number) => {
            r.render(frame, 3, tMs);
            const lit: number[] = [];
            for (let i = 0; i < 10; ++i) if (frame[(left.nodeStart + i) * 3]) lit.push(i);
            return lit;
        };
        expect(litAt(0)).toEqual([0]);
        // The window is [pos, pos + width): at 0.55 of the way along, node 6 (at 0.6) is the one inside it.
        expect(litAt(550)).toEqual([6]);
    });

    it('marks the first, last and every Nth node in wiring order', () => {
        // A 2x2 grid wired right-to-left on the bottom row: canonical order differs from wiring order.
        const grid: LayoutModelSpec = {
            name: 'G',
            startChannel: 0,
            nodeCount: 4,
            channelsPerNode: 3,
            roles: RGB,
            grid: { width: 2, height: 2, xy: Int32Array.from([1, 0, 0, 0, 0, 1, 1, 1]) },
        };
        const gl = compileLayout([grid], { keepWorld: true });
        const g = gl.models[0];
        const r = new SpatialPatternRenderer(gl, [patternTargetOfModel(g)], { kind: 'markers', every: 100 });
        const frame = new Uint8Array(gl.frameBytes);
        r.render(frame, 3, 0);
        // Wiring node 0 is canonical cell (1,0) = index 1 and is green; wiring node 3 is cell (1,1) = index 3 and is red.
        expect(nodeRgb(frame, g.nodeStart + 1)).toEqual([0, 255, 0]);
        expect(nodeRgb(frame, g.nodeStart + 3)).toEqual([255, 0, 0]);
        expect(nodeRgb(frame, g.nodeStart)).toEqual([0, 0, 0]);
    });

    it('steps the color cycle and scales by intensity', () => {
        const r = new SpatialPatternRenderer(layout, [patternTargetOfModel(left)], {
            kind: 'colorCycle',
            periodMs: 100,
            intensity: 0.5,
        });
        const frame = new Uint8Array(layout.frameBytes);
        r.render(frame, 3, 0);
        expect(nodeRgb(frame, left.nodeStart)).toEqual([128, 0, 0]);
        r.render(frame, 3, 150);
        expect(nodeRgb(frame, left.nodeStart)).toEqual([0, 128, 0]);
        r.render(frame, 3, 350);
        expect(nodeRgb(frame, left.nodeStart)).toEqual([128, 128, 128]);
    });

    it('knows which patterns animate', () => {
        expect(patternAnimates({ kind: 'solid' })).toBe(false);
        expect(patternAnimates({ kind: 'bars', speed: 0 })).toBe(false);
        expect(patternAnimates({ kind: 'bars' })).toBe(true);
        expect(patternAnimates({ kind: 'strobe' })).toBe(true);
    });
});

describe('submodels, strands and local space', () => {
    // A 4x2 tree: two strands of four, standing side by side, placed far from the origin.
    const n = 8;
    const world = new Float32Array(n * 3);
    const local = new Float32Array(n * 3);
    for (let i = 0; i < n; ++i) {
        const x = Math.floor(i / 4);
        const y = i % 4;
        world.set([100 + x, 50 + y, 0], i * 3);
        local.set([x, y, 0], i * 3);
    }
    const tree: LayoutModelSpec = {
        name: 'Tree',
        startChannel: 0,
        nodeCount: n,
        channelsPerNode: 3,
        roles: RGB,
        world,
        local,
        strands: [4, 4],
        subModels: [
            {
                name: 'Tops',
                nodes: Int32Array.from([7, 3]),
                strands: [1, 1],
                vertical: false,
                bufferStyle: 'Default',
                buffer: { width: 2, height: 1, cells: Int32Array.from([0, 0, 0, 1, 1, 0]) },
            },
        ],
    };
    const far = strip('Far', 30, 4, 0, 0);
    const specs = [tree, far];
    const layout = compileLayout(specs, { keepWorld: true });
    const catalog = new TargetCatalog(layout, specs);
    const t = layout.models.find((m) => m.name === 'Tree')!;
    const paint = (names: string[], params: ConstructorParameters<typeof SpatialPatternRenderer>[2], tMs = 0) => {
        const r = new SpatialPatternRenderer(layout, patternTargets(catalog, names), params);
        const frame = new Uint8Array(layout.frameBytes);
        r.render(frame, 3, tMs);
        return { r, frame };
    };

    it('paints only the nodes of a submodel', () => {
        const { r, frame } = paint(['Tree/Tops', 'Tree/Nope'], { kind: 'solid', colors: ['#0a0b0c'] });
        expect(r.names).toEqual(['Tree/Tops']);
        expect(r.nodeCount).toBe(2);
        const lit: number[] = [];
        for (let i = 0; i < n; ++i) if (frame[(t.nodeStart + i) * 3]) lit.push(i);
        expect(lit).toEqual([3, 7]);
    });

    it('counts a submodel in the order it lists its nodes', () => {
        const { frame } = paint(['Tree/Tops'], { kind: 'markers', every: 100 });
        // Listed 7 then 3: node 7 is first (green), node 3 last (red).
        expect(nodeRgb(frame, t.nodeStart + 7)).toEqual([0, 255, 0]);
        expect(nodeRgb(frame, t.nodeStart + 3)).toEqual([255, 0, 0]);
    });

    it('gives each strand its own color', () => {
        const { frame } = paint(['Tree'], { kind: 'strands', colors: ['#ff0000', '#0000ff'] });
        for (let i = 0; i < 4; ++i) expect(nodeRgb(frame, t.nodeStart + i)).toEqual([255, 0, 0]);
        for (let i = 4; i < 8; ++i) expect(nodeRgb(frame, t.nodeStart + i)).toEqual([0, 0, 255]);
    });

    it('restarts markers and the chase on every strand in strand space', () => {
        const { frame } = paint(['Tree'], { kind: 'markers', every: 100, space: 'strand' });
        expect(nodeRgb(frame, t.nodeStart)).toEqual([0, 255, 0]);
        expect(nodeRgb(frame, t.nodeStart + 3)).toEqual([255, 0, 0]);
        expect(nodeRgb(frame, t.nodeStart + 4)).toEqual([0, 255, 0]);
        expect(nodeRgb(frame, t.nodeStart + 7)).toEqual([255, 0, 0]);
        const chase = paint(['Tree'], { kind: 'chase', width: 0.25, speed: 0, space: 'strand', colors: ['#ffffff'] });
        const lit: number[] = [];
        for (let i = 0; i < n; ++i) if (chase.frame[(t.nodeStart + i) * 3]) lit.push(i);
        expect(lit).toEqual([0, 4]);
    });

    it('gives every target the whole pattern in local space, and one picture across them in world space', () => {
        const bars: SpatialPatternParams = {
            kind: 'bars',
            colors: ['#ff0000', '#0000ff'],
            width: 0.6,
            speed: 0,
            angleDeg: 0,
        };
        // World: the tree sits at x 100..101, the strip at 0..3, so the tree is all in the last band.
        const w = paint(['Tree', 'Far'], { ...bars, space: 'world' });
        expect(nodeRgb(w.frame, t.nodeStart)).toEqual([0, 0, 255]);
        expect(nodeRgb(w.frame, t.nodeStart + 4)).toEqual([0, 0, 255]);
        // Local: the tree's own two columns split between the bands.
        const l = paint(['Tree', 'Far'], { ...bars, space: 'local' });
        expect(nodeRgb(l.frame, t.nodeStart)).toEqual([255, 0, 0]);
        expect(nodeRgb(l.frame, t.nodeStart + 4)).toEqual([0, 0, 255]);
        // The strip has no local coordinates and uses its own extent of the world.
        const f = layout.models.find((m) => m.name === 'Far')!;
        expect(nodeRgb(l.frame, f.nodeStart)).toEqual([255, 0, 0]);
        expect(nodeRgb(l.frame, f.nodeStart + 3)).toEqual([0, 0, 255]);
    });
});

describe('alignment grid', () => {
    // A 5x5 sheet at z 0, one unit apart, with its corner far from the origin.
    const n = 25;
    const world = new Float32Array(n * 3);
    for (let i = 0; i < n; ++i) world.set([200 + (i % 5), 70 + Math.floor(i / 5), 0], i * 3);
    const sheet: LayoutModelSpec = {
        name: 'Sheet',
        startChannel: 0,
        nodeCount: n,
        channelsPerNode: 3,
        roles: RGB,
        world,
    };
    const layout = compileLayout([sheet], { keepWorld: true });
    const m = layout.models[0];
    const paint = (params: Partial<SpatialPatternParams>) => {
        const r = new SpatialPatternRenderer(layout, [patternTargetOfModel(m)], {
            kind: 'grid',
            colors: ['#ff0000', '#00ff00', '#000000'],
            spacing: 0.5,
            thickness: 0.2,
            ...params,
        });
        const frame = new Uint8Array(layout.frameBytes);
        r.render(frame, 3, 0);
        return (x: number, y: number) => nodeRgb(frame, m.nodeStart + y * 5 + x);
    };

    it('lights the planes through the centre and every spacing from it, an axis a color', () => {
        const at = paint({});
        // The extent is 4, so planes are 2 apart: columns and rows 0, 2 and 4.
        expect(at(1, 1)).toEqual([0, 0, 0]);
        expect(at(2, 1)).toEqual([255, 0, 0]);
        expect(at(1, 2)).toEqual([0, 255, 0]);
        expect(at(0, 3)).toEqual([255, 0, 0]);
        // On both: the brightest of each channel.
        expect(at(2, 2)).toEqual([255, 255, 0]);
    });

    it('slides with the offset, one axis at a time', () => {
        const at = paint({ offsetY: 0.5 });
        expect(at(1, 2)).toEqual([0, 0, 0]);
        expect(at(1, 1)).toEqual([0, 255, 0]);
        expect(at(1, 3)).toEqual([0, 255, 0]);
        expect(at(2, 3)).toEqual([255, 255, 0]);
    });

    it('turns about the upright axis with the angle, leaving level lines level', () => {
        // The sheet is flat at z 0. A quarter turn about y puts the depth planes where the upright ones were.
        const flat = paint({ colors: ['#000000', '#00ff00', '#0000ff'] });
        expect(flat(1, 1)).toEqual([0, 0, 255]);
        const at = paint({ angleDeg: 90, colors: ['#000000', '#00ff00', '#0000ff'] });
        expect(at(2, 1)).toEqual([0, 0, 255]);
        expect(at(1, 1)).toEqual([0, 0, 0]);
        expect(at(1, 2)).toEqual([0, 255, 0]);
        expect(at(2, 2)).toEqual([0, 255, 255]);
    });
});

describe('OutputMap adjust', () => {
    const lut = (v: number, gamma: number, bright: number) =>
        Math.min(255, Math.round(255 * bright * Math.pow(v / 255, gamma)));

    it('trims a model under controller policy and leaves the others byte-exact', () => {
        const layout = compileLayout([strip('A', 0, 2, 0, 0), strip('B', 6, 2, 0, 1)]);
        const omap = compileOutputMap(layout, [
            {
                id: 'c',
                channelStart: 0,
                channelCount: 12,
                adjust: { A: { colorOrder: 'GRB', brightness: 0.5, gamma: 2, gain: [1, 0.5, 0.25] } },
            },
        ]);
        const a = layout.models.find((m) => m.name === 'A')!;
        const b = layout.models.find((m) => m.name === 'B')!;
        const frame = new Uint8Array(layout.frameBytes);
        frame.set([200, 100, 50, 255, 255, 255], a.nodeStart * 3);
        frame.set([200, 100, 50, 255, 255, 255], b.nodeStart * 3);
        const wire = new Uint8Array(12);
        applyOutput(omap.outputs[0], 3, frame, 0, wire);
        expect(Array.from(wire.subarray(0, 6))).toEqual([
            lut(100, 2, 0.25),
            lut(200, 2, 0.5),
            lut(50, 2, 0.125),
            lut(255, 2, 0.25),
            lut(255, 2, 0.5),
            lut(255, 2, 0.125),
        ]);
        expect(Array.from(wire.subarray(6))).toEqual([200, 100, 50, 255, 255, 255]);
    });

    it('multiplies the trim into the player policy brightness', () => {
        const spec = { ...strip('A', 0, 1, 0, 0), outputBrightness: 0.5, outputGamma: 2 };
        const layout = compileLayout([spec]);
        const omap = compileOutputMap(layout, [
            { id: 'p', channelStart: 0, channelCount: 3, policy: 'player', adjust: { A: { brightness: 0.5 } } },
        ]);
        const frame = new Uint8Array(layout.frameBytes);
        frame.set([255, 128, 0]);
        const wire = new Uint8Array(3);
        applyOutput(omap.outputs[0], 3, frame, 0, wire);
        expect(Array.from(wire)).toEqual([lut(255, 2, 0.25), lut(128, 2, 0.25), 0]);
    });

    it('places rewired models over the range derivation and skips the ones wired elsewhere', () => {
        const layout = compileLayout([strip('A', 0, 2, 0, 0), strip('B', 6, 2, 0, 1), strip('C', 12, 1, 0, 2)]);
        const omap = compileOutputMap(layout, [
            {
                id: 'c',
                channelStart: 0,
                channelCount: 15,
                // A's two nodes swap places within A's own channels; C left for another controller.
                place: [
                    { model: 'A', nodeStart: 1, nodeCount: 1, dstOffset: 0 },
                    { model: 'A', nodeStart: 0, nodeCount: 1, dstOffset: 3 },
                ],
                skipModels: ['C'],
            },
        ]);
        const frame = new Uint8Array(layout.frameBytes);
        const at = (name: string) => layout.models.find((m) => m.name === name)!.nodeStart * 3;
        frame.set([1, 2, 3, 4, 5, 6], at('A'));
        frame.set([7, 8, 9, 10, 11, 12], at('B'));
        frame.set([13, 14, 15], at('C'));
        const wire = new Uint8Array(15);
        applyOutput(omap.outputs[0], 3, frame, 0, wire);
        expect(Array.from(wire)).toEqual([4, 5, 6, 1, 2, 3, 7, 8, 9, 10, 11, 12, 0, 0, 0]);
    });

    it('permutes the color slots of an RGBW node and keeps white out of the color balance', () => {
        const m: LayoutModelSpec = { name: 'W', startChannel: 0, nodeCount: 1, channelsPerNode: 4, roles: RGBW };
        const layout = compileLayout([m]);
        expect(layout.pixelStride).toBe(4);
        const omap = compileOutputMap(layout, [
            { id: 'c', channelStart: 0, channelCount: 4, adjust: { W: { colorOrder: 'BGR', gain: [0.5, 1, 1] } } },
        ]);
        const frame = new Uint8Array(layout.frameBytes);
        frame.set([200, 100, 50, 80]);
        const wire = new Uint8Array(4);
        applyOutput(omap.outputs[0], 4, frame, 0, wire);
        // White stays in slot 0 untouched; colors land B, G, R with red halved.
        expect(Array.from(wire)).toEqual([80, 50, 100, 100]);
    });
});
