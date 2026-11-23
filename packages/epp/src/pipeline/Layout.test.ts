import { describe, expect, it } from 'vitest';
import { ChannelRoleSpec, classifyRoles, compileLayout, LayoutModelSpec, layoutManifest } from './Layout';
import { X_MEANING_NONE, X_MEANING_WHITE } from './FramePool';

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

function model(name: string, startChannel: number, nodeCount: number, roles = RGB, cpn = roles.length): LayoutModelSpec {
    return { name, startChannel, nodeCount, channelsPerNode: cpn, roles };
}

describe('classifyRoles', () => {
    it('recognizes rgb in any order', () => {
        const c = classifyRoles(GRB, 3, false);
        expect(c.kind).toBe('rgb');
        expect([c.r, c.g, c.b]).toEqual([1, 0, 2]);
    });
    it('rgbw needs a white-capable layout, otherwise raw', () => {
        expect(classifyRoles(RGBW, 4, false).kind).toBe('raw');
        const c = classifyRoles(RGBW, 4, true);
        expect(c.kind).toBe('rgbw');
        expect(c.w).toBe(3);
    });
    it('mono with a full-scale tint is lossless; a dim tint is raw', () => {
        const ok = classifyRoles([{ offset: 0, kind: 'intensity', tint: '#ff8000' }], 1, false);
        expect(ok.kind).toBe('mono');
        expect([ok.tintR, ok.tintG, ok.tintB]).toEqual([255, 128, 0]);
        const dim = classifyRoles([{ offset: 0, kind: 'intensity', tint: '#804000' }], 1, false);
        expect(dim.kind).toBe('raw');
    });
    it('a lone warm white channel is mono with the warm tint', () => {
        const c = classifyRoles([{ offset: 0, kind: 'warmWhite' }], 1, false);
        expect(c.kind).toBe('mono');
        expect(c.mono).toBe(0);
        expect([c.tintR, c.tintG, c.tintB]).toEqual([255, 229, 204]);
    });
    it('superstrings and duplicates are raw', () => {
        expect(classifyRoles([{ offset: 0, kind: 'tint', tint: '#ff0000' }, { offset: 1, kind: 'tint', tint: '#00ff00' }], 2, false).kind).toBe('raw');
        expect(classifyRoles([...RGB, { offset: 3, kind: 'red' }], 4, false).kind).toBe('raw');
    });
});

describe('compileLayout', () => {
    it('lays models out contiguously, 16-byte aligned, in channel order', () => {
        const layout = compileLayout([model('B', 300, 10), model('A', 0, 100)]);
        expect(layout.pixelStride).toBe(3);
        expect(layout.xMeaning).toBe(X_MEANING_NONE);
        expect(layout.models.map((m) => m.name)).toEqual(['A', 'B']);
        expect(layout.models[0].nodeStart).toBe(0);
        // Runs start on 16-node boundaries so both strides stay 16-byte aligned.
        expect(layout.models[1].nodeStart).toBe(112);
        expect(layout.nodeCount).toBe(128);
        expect(layout.pixelBytes).toBe(384);
        expect(layout.totalChannels).toBe(330);
        // Gap of 0 channels between A (0..300) and B (300..330): no raw spans.
        expect(layout.rawSpans).toEqual([]);
        expect(layout.rawCount).toBe(0);
        expect(layout.frameBytes).toBe(384);
    });

    it('collects unowned channels and raw models into the raw region', () => {
        const dmx: LayoutModelSpec = {
            name: 'MovingHead',
            startChannel: 400,
            nodeCount: 1,
            channelsPerNode: 16,
            roles: [], // no roles: raw
        };
        const layout = compileLayout([model('A', 0, 10), dmx, model('B', 500, 5)], { channelCeiling: 600 });
        expect(layout.models.find((m) => m.name === 'MovingHead')!.nodeStart).toBe(-1);
        // The gap after A and the raw DMX model merge into one span.
        expect(layout.rawSpans).toEqual([
            { channelStart: 30, count: 470, rawOffset: 0 },
            { channelStart: 515, count: 85, rawOffset: 470 },
        ]);
        expect(layout.rawCount).toBe(555);
        expect(layout.totalChannels).toBe(600);
        expect(layout.frameBytes).toBe(layout.pixelBytes + 556);
    });

    it('chooses RGBX white when any model has white', () => {
        const layout = compileLayout([model('rgb', 0, 4), model('star', 12, 4, RGBW, 4)]);
        expect(layout.pixelStride).toBe(4);
        expect(layout.xMeaning).toBe(X_MEANING_WHITE);
        expect(layout.models[1].codec.kind).toBe('rgbw');
        // Forced RGB8: the RGBW model falls back to raw.
        const rgb8 = compileLayout([model('rgb', 0, 4), model('star', 12, 4, RGBW, 4)], { pixelStride: 3 });
        expect(rgb8.models[1].codec.kind).toBe('raw');
        expect(rgb8.rawSpans).toEqual([{ channelStart: 12, count: 16, rawOffset: 0 }]);
    });

    it('permutes a dense grid into row-major order and keeps world coords', () => {
        // 2x2 matrix wired vertically: node0=(0,0) node1=(0,1) node2=(1,0) node3=(1,1)
        const spec: LayoutModelSpec = {
            ...model('M', 0, 4),
            grid: { width: 2, height: 2, xy: Int32Array.from([0, 0, 0, 1, 1, 0, 1, 1]) },
            world: Float32Array.from([0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0]),
        };
        const layout = compileLayout([spec], { keepWorld: true });
        const m = layout.models[0];
        expect(m.grid).toEqual({ width: 2, height: 2 });
        expect(Array.from(m.perm!)).toEqual([0, 2, 1, 3]);
        // node1 (bufX 0, bufY 1) lands at canonical 2 with its world coord.
        expect(Array.from(layout.world!.subarray(6, 9))).toEqual([0, 1, 0]);
    });

    it('rejects a grid that is not a bijection', () => {
        const spec: LayoutModelSpec = {
            ...model('M', 0, 4),
            grid: { width: 2, height: 2, xy: Int32Array.from([0, 0, 0, 0, 1, 0, 1, 1]) },
        };
        expect(compileLayout([spec]).models[0].perm).toBeUndefined();
    });

    it('honors multi-run models and versions the manifest', () => {
        const spec: LayoutModelSpec = {
            ...model('Arch', 0, 6),
            runs: [
                { nodeStart: 0, nodeCount: 3, channelStart: 0 },
                { nodeStart: 3, nodeCount: 3, channelStart: 100 },
            ],
        };
        const a = compileLayout([spec]);
        expect(a.rawSpans).toEqual([{ channelStart: 9, count: 91, rawOffset: 0 }]);
        const b = compileLayout([spec]);
        expect(a.layoutVersion).toBe(b.layoutVersion);
        const c = compileLayout([{ ...spec, name: 'Arch2' }]);
        expect(c.layoutVersion).not.toBe(a.layoutVersion);
        expect(layoutManifest(a).models[0].name).toBe('Arch');
    });
});
