import { describe, expect, it } from 'vitest';
import { ChannelRoleSpec, compileLayout, LayoutModelSpec } from './Layout';
import { applyInputMap, applyInputMapChunk, ChannelDescriptor, compileInputMap, inputMapProgram } from './InputMap';
import { applyOutput, compileOutputMap } from './OutputMap';
import { X_MEANING_WHITE } from './FramePool';

const RGB: ChannelRoleSpec[] = [
    { offset: 0, kind: 'red' },
    { offset: 1, kind: 'green' },
    { offset: 2, kind: 'blue' },
];
const GRB: ChannelRoleSpec[] = [
    { offset: 0, kind: 'green' },
    { offset: 1, kind: 'red' },
    { offset: 2, kind: 'blue' },
];
const RGBW: ChannelRoleSpec[] = [...RGB, { offset: 3, kind: 'white' }];
const MONO_ORANGE: ChannelRoleSpec[] = [{ offset: 0, kind: 'intensity', tint: '#ff8000' }];

function model(name: string, startChannel: number, nodeCount: number, roles = RGB, cpn = roles.length, extra: Partial<LayoutModelSpec> = {}): LayoutModelSpec {
    return { name, startChannel, nodeCount, channelsPerNode: cpn, roles, ...extra };
}

function descriptorOf(specs: LayoutModelSpec[], totalChannels: number): ChannelDescriptor {
    return {
        totalChannels,
        models: specs.map((m) => ({
            name: m.name,
            startChannel: m.startChannel,
            nodeCount: m.nodeCount,
            channelsPerNode: m.channelsPerNode,
            roles: m.roles,
            runs: m.runs,
            gamma: m.gamma,
            brightness: m.brightness,
        })),
    };
}

function randomFrame(n: number, seed = 1): Uint8Array {
    const out = new Uint8Array(n);
    let s = seed;
    for (let i = 0; i < n; ++i) {
        s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
        out[i] = (s >> 16) & 255;
    }
    return out;
}

describe('InputMap', () => {
    it('decodes GRB from the file into canonical RGB and reports mismatches', () => {
        const layoutSpecs = [model('A', 0, 2), model('Missing', 6, 1)];
        const layout = compileLayout(layoutSpecs);
        const fileDesc = descriptorOf([model('A', 0, 3, GRB), model('Extra', 9, 1)], 12);
        const map = compileInputMap(fileDesc, layout);
        expect(map.missing).toEqual(['Missing']);
        expect(map.extra).toEqual(['Extra']);
        expect(map.resized).toEqual([{ name: 'A', file: 3, layout: 2 }]);
        const src = Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90, 1, 2, 3]);
        const dst = new Uint8Array(layout.frameBytes).fill(0xee);
        applyInputMap(inputMapProgram(map), src, 0, dst, 0);
        // file GRB -> canonical RGB
        expect(Array.from(dst.subarray(0, 6))).toEqual([20, 10, 30, 50, 40, 60]);
        // 'Missing' at node 16 stays black; unwritten frame bytes are zeroed.
        expect(dst[16 * 3]).toBe(0);
        // channel 6..9 (Missing's channels) come through as a raw span? No: Missing owns them, so they are not raw.
        expect(layout.rawSpans).toEqual([]);
    });

    it('carries raw spans by channel identity and inverts baked gamma', () => {
        const dmx: LayoutModelSpec = model('Head', 6, 1, [], 8);
        const layout = compileLayout([model('A', 0, 2), dmx], { channelCeiling: 20 });
        expect(layout.rawSpans).toEqual([{ channelStart: 6, count: 14, rawOffset: 0 }]);
        const desc = descriptorOf([model('A', 0, 2, RGB, 3, { gamma: 2.2 }), dmx], 20);
        const map = compileInputMap(desc, layout);
        expect(map.inverted).toEqual(['A']);
        const src = new Uint8Array(20);
        src[0] = 255;
        src[1] = 128;
        for (let i = 6; i < 20; ++i) src[i] = i;
        const dst = new Uint8Array(layout.frameBytes);
        applyInputMap(inputMapProgram(map), src, 0, dst, 0);
        expect(dst[0]).toBe(255);
        expect(dst[1]).toBe(Math.round(255 * Math.pow(128 / 255, 1 / 2.2)));
        expect(Array.from(dst.subarray(layout.rawOffset, layout.rawOffset + 14))).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    });

    it('decodes mono and rgbw, and permutes grids', () => {
        const grid = model('M', 0, 4, RGB, 3, { grid: { width: 2, height: 2, xy: Int32Array.from([0, 0, 0, 1, 1, 0, 1, 1]) } });
        const specs = [grid, model('Orange', 12, 2, MONO_ORANGE, 1), model('Star', 14, 1, RGBW, 4)];
        const layout = compileLayout(specs);
        expect(layout.pixelStride).toBe(4);
        expect(layout.xMeaning).toBe(X_MEANING_WHITE);
        const map = compileInputMap(descriptorOf(specs, 18), layout);
        const src = Uint8Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 200, 100, 9, 8, 7, 6]);
        const dst = new Uint8Array(layout.frameBytes);
        applyInputMap(inputMapProgram(map), src, 0, dst, 0);
        const node = (n: number) => Array.from(dst.subarray(n * 4, n * 4 + 4));
        // Grid: node1 (0,1) -> canonical 2; node2 (1,0) -> canonical 1.
        expect(node(0)).toEqual([1, 1, 1, 0]);
        expect(node(1)).toEqual([3, 3, 3, 0]);
        expect(node(2)).toEqual([2, 2, 2, 0]);
        expect(node(3)).toEqual([4, 4, 4, 0]);
        const orange = layout.models[1].nodeStart;
        expect(node(orange)).toEqual([200, 100, 0, 0]);
        expect(node(orange + 1)).toEqual([100, 50, 0, 0]);
        const star = layout.models[2].nodeStart;
        expect(node(star)).toEqual([9, 8, 7, 6]);
    });

    it('applies to every frame of a chunk', () => {
        const layout = compileLayout([model('A', 0, 1)]);
        const map = inputMapProgram(compileInputMap(descriptorOf([model('A', 0, 1)], 4), layout));
        const src = Uint8Array.from([1, 2, 3, 0, 4, 5, 6, 0]);
        const dst = new Uint8Array(layout.frameBytes * 2);
        applyInputMapChunk(map, src, 4, dst, 2);
        expect(Array.from(dst.subarray(0, 3))).toEqual([1, 2, 3]);
        expect(Array.from(dst.subarray(layout.frameBytes, layout.frameBytes + 3))).toEqual([4, 5, 6]);
    });
});

describe('OutputMap', () => {
    const show: LayoutModelSpec[] = [
        model('Arch', 0, 50, GRB),
        model('Matrix', 150, 16, RGB, 3, { grid: { width: 4, height: 4, xy: Int32Array.from([0, 0, 0, 1, 0, 2, 0, 3, 1, 3, 1, 2, 1, 1, 1, 0, 2, 0, 2, 1, 2, 2, 2, 3, 3, 3, 3, 2, 3, 1, 3, 0]) } }),
        model('Orange', 198, 10, MONO_ORANGE, 1),
        model('Star', 208, 8, RGBW, 4),
        model('Head', 300, 1, [], 16),
        model('Split', 400, 6, RGB, 3, { runs: [{ nodeStart: 0, nodeCount: 3, channelStart: 400 }, { nodeStart: 3, nodeCount: 3, channelStart: 450 }] }),
    ];
    const TOTAL = 512;

    it('round-trips a whole channel space byte-exactly through canonical form', () => {
        const layout = compileLayout(show, { channelCeiling: TOTAL });
        const desc = descriptorOf(show, TOTAL);
        const imap = inputMapProgram(compileInputMap(desc, layout));
        const omap = compileOutputMap(layout, [{ id: 'all', channelStart: 0, channelCount: TOTAL }]);
        const src = randomFrame(TOTAL);
        const frame = new Uint8Array(layout.frameBytes);
        applyInputMap(imap, src, 0, frame, 0);
        const wire = new Uint8Array(omap.outputs[0].wireBytes);
        applyOutput(omap.outputs[0], layout.pixelStride, frame, 0, wire);
        expect(Array.from(wire)).toEqual(Array.from(src));
    });

    it('splits the channel space across controllers, including a cut through a node', () => {
        const layout = compileLayout(show, { channelCeiling: TOTAL });
        const imap = inputMapProgram(compileInputMap(descriptorOf(show, TOTAL), layout));
        // Controller boundaries at 100 (inside Arch node 33) and 205 (inside Orange, a 1-channel model; exact node edge) and 210 (inside Star node 0).
        const omap = compileOutputMap(layout, [
            { id: 'c1', channelStart: 0, channelCount: 100 },
            { id: 'c2', channelStart: 100, channelCount: 110 },
            { id: 'c3', channelStart: 210, channelCount: TOTAL - 210 },
        ]);
        const src = randomFrame(TOTAL, 7);
        const frame = new Uint8Array(layout.frameBytes);
        applyInputMap(imap, src, 0, frame, 0);
        const joined = new Uint8Array(TOTAL);
        for (const out of omap.outputs) {
            const wire = new Uint8Array(out.wireBytes);
            applyOutput(out, layout.pixelStride, frame, 0, wire);
            const spec = { c1: 0, c2: 100, c3: 210 }[out.id]!;
            joined.set(wire, spec);
        }
        expect(Array.from(joined)).toEqual(Array.from(src));
    });

    it('applies color order, gamma and brightness under player policy', () => {
        const specs = [model('A', 0, 2, RGB, 3, { outputColorOrder: 'GRB', outputGamma: 2.0, outputBrightness: 0.5 })];
        const layout = compileLayout(specs);
        const omap = compileOutputMap(layout, [{ id: 'p', channelStart: 0, channelCount: 6, policy: 'player' }]);
        const frame = new Uint8Array(layout.frameBytes);
        frame.set([255, 0, 128, 0, 255, 0]);
        const wire = new Uint8Array(6);
        applyOutput(omap.outputs[0], 3, frame, 0, wire);
        // xLights order: gamma first, then brightness, so -50 at gamma 2 lights at half, not a quarter.
        const lut = (v: number) => Math.round(255 * 0.5 * Math.pow(v / 255, 2));
        expect(Array.from(wire)).toEqual([lut(0), lut(255), lut(128), lut(255), lut(0), lut(0)]);
        // Controller policy leaves the connection's settings to the controller: the wire is in string type order.
        const cmap = compileOutputMap(layout, [{ id: 'c', channelStart: 0, channelCount: 6 }]);
        applyOutput(cmap.outputs[0], 3, frame, 0, wire);
        expect(Array.from(wire)).toEqual([255, 0, 128, 0, 255, 0]);
    });

    it('lays out explicit port segments with nulls, grouping and reversal', () => {
        const layout = compileLayout([model('A', 0, 4), model('Head', 12, 1, [], 4)], { channelCeiling: 16 });
        // Range covers only the pixel model; raw Head channels (12..16) stay off this port.
        const omap = compileOutputMap(layout, [
            {
                id: 'port',
                channelStart: 0,
                channelCount: 12,
                segments: [
                    { model: 'A', nodeStart: 0, nodeCount: 2, dstOffset: 0, nullBefore: 1, groupCount: 2 },
                    { model: 'A', nodeStart: 2, nodeCount: 2, dstOffset: 15, reverse: true, colorOrder: 'BGR' },
                ],
            },
        ]);
        const frame = new Uint8Array(layout.frameBytes);
        frame.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        frame.set([90, 91, 92, 93], layout.rawOffset);
        const out = omap.outputs[0];
        expect(out.wireBytes).toBe(21);
        const wire = new Uint8Array(out.wireBytes);
        applyOutput(out, 3, frame, 0, wire);
        expect(Array.from(wire)).toEqual([
            0, 0, 0, // null pixel
            1, 2, 3, 1, 2, 3, 4, 5, 6, 4, 5, 6, // nodes 0 and 1, each grouped x2
            12, 11, 10, 9, 8, 7, // nodes 3 then 2 (reversed), BGR
        ]);
    });
});
