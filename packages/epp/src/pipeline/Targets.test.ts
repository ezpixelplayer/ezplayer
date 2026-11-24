import { describe, expect, it } from 'vitest';
import type { GetNodeResult, SubModelResult, XlModelChannelInfo } from 'xllayoutcalcs';
import { compileLayout, LayoutModelSpec } from './Layout';
import { OverlayManager } from './Overlays';
import { strandKind, TargetCatalog, targetRuns } from './Targets';
import { layoutSpecsFromXlights } from './xlAdapter';

const RGB = [
    { offset: 0, kind: 'red' as const },
    { offset: 1, kind: 'green' as const },
    { offset: 2, kind: 'blue' as const },
];

/** (node, x, y) triples. */
const cells = (...t: number[]) => Int32Array.from(t);

function show() {
    const specs: LayoutModelSpec[] = [
        { name: 'Strip', startChannel: 0, nodeCount: 4, channelsPerNode: 3, roles: RGB },
        {
            // 8 nodes on a 5x5 buffer: a ring around an empty middle.
            name: 'Spinner',
            startChannel: 12,
            nodeCount: 8,
            channelsPerNode: 3,
            roles: RGB,
            buffer: { width: 5, height: 5, cells: cells(0, 2, 4, 1, 4, 4, 2, 4, 2, 3, 4, 0, 4, 2, 0, 5, 0, 0, 6, 0, 2, 7, 0, 4) },
            subModels: [
                {
                    // Two arms of two nodes, one row each.
                    name: 'Arms',
                    nodes: Int32Array.from([0, 4, 2, 6]),
                    strands: [2, 2],
                    vertical: false,
                    bufferStyle: 'Default',
                    buffer: { width: 2, height: 2, cells: cells(0, 0, 0, 1, 1, 0, 2, 0, 1, 3, 1, 1) },
                },
                {
                    // One strand that crosses itself: node 1 is walked first and last.
                    name: 'Loop',
                    nodes: Int32Array.from([1, 3, 5]),
                    strands: [4],
                    vertical: false,
                    bufferStyle: 'Default',
                    buffer: { width: 4, height: 1, cells: cells(0, 0, 0, 0, 3, 0, 1, 1, 0, 2, 2, 0) },
                },
                { name: 'Tail', nodes: Int32Array.from([6, 7]), vertical: true, bufferStyle: 'Default', buffer: { width: 1, height: 2, cells: cells(0, 0, 0, 1, 0, 1) } },
            ],
        },
    ];
    const layout = compileLayout(specs, { keepWorld: true });
    return { layout, specs, spinner: layout.models[1].nodeStart };
}

function composited(ov: OverlayManager, bytes: number) {
    const frame = new Uint8Array(bytes);
    ov.composite(frame, 3);
    return (node: number) => Array.from(frame.subarray(node * 3, node * 3 + 3));
}

describe('TargetCatalog', () => {
    it('resolves models and submodels to canonical nodes', () => {
        const { layout, specs, spinner } = show();
        const cat = new TargetCatalog(layout, specs);
        expect(cat.modelNames()).toEqual(['Strip', 'Spinner']);
        expect(cat.subModelNames('Spinner')).toEqual(['Arms', 'Loop', 'Tail']);
        const arms = cat.find('Spinner/Arms')!;
        expect(Array.from(arms.nodes)).toEqual([0, 4, 2, 6].map((n) => spinner + n));
        expect(arms.nodeStart).toBe(-1);
        expect(arms.kind).toBe('multiEqual');
        expect(cat.find('Spinner', 'Arms')).toBe(arms);
        // Consecutive nodes are one run, and an effect can take the runs.
        const tail = cat.find('Spinner/Tail')!;
        expect(tail.nodeStart).toBe(spinner + 6);
        expect(tail.kind).toBe('area');
        expect(targetRuns(tail.nodes)).toEqual([{ nodeStart: spinner + 6, nodeCount: 2 }]);
        expect(targetRuns(arms.nodes).length).toBe(4);
        expect(cat.find('Spinner/Nope')).toBeUndefined();
        expect(cat.find('Nope')).toBeUndefined();
    });

    it('names the strand shape', () => {
        expect(strandKind([10])).toBe('single');
        expect(strandKind([5, 5, 5])).toBe('multiEqual');
        expect(strandKind([5, 4])).toBe('multi');
        expect(strandKind(undefined)).toBe('area');
    });
});

describe('overlay leases on submodels', () => {
    it('lists models only unless asked for more', () => {
        const { layout, specs } = show();
        const ov = new OverlayManager(layout, specs);
        expect(ov.targets()).toEqual([
            { model: 'Strip', nodeCount: 4 },
            { model: 'Spinner', nodeCount: 8, subModels: 3 },
        ]);
        const all = ov.targets({ detail: 'submodels' });
        expect(all.map((t) => t.target)).toEqual(['Strip', 'Spinner', 'Spinner/Arms', 'Spinner/Loop', 'Spinner/Tail']);
        expect(all[2]).toMatchObject({ subModel: 'Arms', nodeCount: 4, kind: 'multiEqual', strands: [2, 2], buffer: { width: 2, height: 2 }, overlaps: 0 });
        expect(all[3]).toMatchObject({ kind: 'single', strands: [4], overlaps: 1 });
        expect(all[1].nodes).toBeUndefined();
        // One submodel, with where its nodes are.
        const one = ov.targets({ model: 'Spinner/Loop', detail: 'nodes' });
        expect(one.length).toBe(1);
        expect(one[0].nodes!.cells).toEqual([0, 0, 0, 0, 3, 0, 1, 1, 0, 2, 2, 0]);
        expect(one[0].nodes!.world!.length).toBe(9);
        expect(ov.targets({ model: 'Spinner' }).length).toBe(1);
        expect(ov.targets({ model: 'Nope' })).toEqual([]);
    });

    it('paints a submodel through its buffer, top row first', () => {
        const { layout, specs, spinner } = show();
        const ov = new OverlayManager(layout, specs);
        const lease = ov.open({ mode: 'layer', name: 't', model: 'Spinner/Arms' }, 0);
        expect(lease).toMatchObject({ model: 'Spinner', subModel: 'Arms', format: 'buffer', width: 2, height: 2, frameBytes: 12, nodeStart: -1, nodeCount: 4 });
        // Top row (the second arm) red, bottom row (the first arm) blue.
        const payload = Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]);
        expect(ov.write(lease.id, lease.token, 1, 0, payload, true, 1)).toBe(true);
        const node = composited(ov, layout.frameBytes);
        expect(node(spinner + 0)).toEqual([0, 0, 255]);
        expect(node(spinner + 4)).toEqual([0, 0, 255]);
        expect(node(spinner + 2)).toEqual([255, 0, 0]);
        expect(node(spinner + 6)).toEqual([255, 0, 0]);
        // Nodes outside the submodel stay dark.
        expect(node(spinner + 1)).toEqual([0, 0, 0]);
        expect(node(0)).toEqual([0, 0, 0]);
    });

    it('takes one color per node in listed order', () => {
        const { layout, specs, spinner } = show();
        const ov = new OverlayManager(layout, specs);
        const lease = ov.open({ mode: 'layer', name: 't', model: 'Spinner', subModel: 'Arms', format: 'nodes' }, 0);
        expect(lease.frameBytes).toBe(12);
        ov.write(lease.id, lease.token, 1, 0, Uint8Array.from([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]), true, 1);
        const node = composited(ov, layout.frameBytes);
        expect([0, 4, 2, 6].map((n) => node(spinner + n)[0])).toEqual([1, 2, 3, 4]);
    });

    it('settles a node listed twice by the rule asked for', () => {
        const { layout, specs, spinner } = show();
        // Cells along the strand: node 1, node 3, node 5, node 1 again.
        const payload = Uint8Array.from([10, 200, 0, 20, 0, 0, 30, 0, 0, 40, 100, 0]);
        const crossing = (overlap?: 'last' | 'first' | 'max') => {
            const ov = new OverlayManager(layout, specs);
            const lease = ov.open({ mode: 'layer', name: 't', model: 'Spinner/Loop', overlap }, 0);
            expect(lease.overlap).toBe(overlap ?? 'last');
            ov.write(lease.id, lease.token, 1, 0, payload, true, 1);
            return composited(ov, layout.frameBytes)(spinner + 1);
        };
        expect(crossing()).toEqual([40, 100, 0]);
        expect(crossing('first')).toEqual([10, 200, 0]);
        expect(crossing('max')).toEqual([40, 200, 0]);
    });

    it('addresses a whole model as a sparse grid, and scales a smaller picture onto it', () => {
        const { layout, specs, spinner } = show();
        const ov = new OverlayManager(layout, specs);
        const lease = ov.open({ mode: 'layer', name: 't', model: 'Spinner', format: 'buffer' }, 0);
        expect(lease).toMatchObject({ width: 5, height: 5, frameBytes: 75, nodeStart: spinner });
        const payload = new Uint8Array(75);
        payload[2 * 3] = 99; // top row, middle: node 0 at (2, 4)
        payload[(4 * 5 + 4) * 3 + 1] = 77; // bottom row, right: node 3 at (4, 0)
        payload[(2 * 5 + 2) * 3 + 2] = 55; // the empty middle
        ov.write(lease.id, lease.token, 1, 0, payload, true, 1);
        let node = composited(ov, layout.frameBytes);
        expect(node(spinner + 0)).toEqual([99, 0, 0]);
        expect(node(spinner + 3)).toEqual([0, 77, 0]);
        expect(node(spinner + 2)).toEqual([0, 0, 0]);

        // 1 wide, 2 high: the top half green, the bottom half blue.
        const ov2 = new OverlayManager(layout, specs);
        const half = ov2.open({ mode: 'layer', name: 't', model: 'Spinner', format: 'buffer', width: 1, height: 2 }, 0);
        ov2.write(half.id, half.token, 1, 0, Uint8Array.from([0, 255, 0, 0, 0, 255]), true, 1);
        node = composited(ov2, layout.frameBytes);
        expect(node(spinner + 0)).toEqual([0, 255, 0]);
        expect(node(spinner + 4)).toEqual([0, 0, 255]);
        // A model with no known buffer cannot be opened this way.
        expect(() => ov2.open({ mode: 'layer', name: 't', model: 'Strip', format: 'buffer' }, 0)).toThrow(/buffer/);
        expect(() => ov2.open({ mode: 'layer', name: 't', model: 'Spinner/Nope' }, 0)).toThrow(/Spinner\/Nope/);
    });
});

describe('layoutSpecsFromXlights with submodels', () => {
    it('carries buffers, strands and local coordinates', () => {
        const coord = (bufX: number, bufY: number, i: number) => ({ bufX, bufY, bufZ: 0, modelX: i, modelY: 0, modelZ: 0, wX: i * 10, wY: 5, wZ: 0 });
        const nodes = [0, 1, 2, 3].map((i) => ({ coords: [coord(i, 0, i)] }));
        const model = {
            name: 'Arch',
            startChannel: 1,
            channelCount: 12,
            nodeCount: 4,
            simple: true,
            rgbOffsets: { r: 0, g: 1, b: 2 },
            stringStartChannels: [1],
            stringNodeCounts: [4],
            gamma: 1,
            brightness: 1,
        } as unknown as XlModelChannelInfo;
        const result = { nodes, logicalBufferWidth: 4, logicalBufferHeight: 1, modelType: 'Arches' } as unknown as GetNodeResult;
        const sub = {
            def: { name: 'Ends', isRanges: true, vertical: false, bufferStyle: 'Default', lines: ['1,4', '4-3,0,9'], subBuffer: '' },
            // Node 4 is walked on both lines; its latest cell is listed first.
            nodes: [
                { parentIndex: 0, coords: [{ bufX: 0, bufY: 0 }] },
                { parentIndex: 3, coords: [{ bufX: 0, bufY: 1 }, { bufX: 1, bufY: 0 }] },
                { parentIndex: 2, coords: [{ bufX: 1, bufY: 1 }] },
            ],
            bufferWi: 2,
            bufferHt: 2,
        } as unknown as SubModelResult;
        const [spec] = layoutSpecsFromXlights([model], new Map([['Arch', result]]), new Map([['Arch', [sub]]]));
        expect(spec.buffer).toEqual({ width: 4, height: 1, cells: cells(0, 0, 0, 1, 1, 0, 2, 2, 0, 3, 3, 0) });
        expect(Array.from(spec.local!.subarray(0, 6))).toEqual([0, 0, 0, 1, 0, 0]);
        const ends = spec.subModels![0];
        expect(Array.from(ends.nodes)).toEqual([0, 3, 2]);
        // The node past the end of the model and the gap do not count.
        expect(ends.strands).toEqual([2, 2]);
        // Walk order: the primary (latest) cell of node 4 comes last.
        expect(Array.from(ends.buffer.cells)).toEqual([0, 0, 0, 1, 1, 0, 1, 0, 1, 2, 1, 1]);

        const layout = compileLayout([spec], { keepWorld: true });
        const ov = new OverlayManager(layout, [spec]);
        const info = ov.targets({ model: 'Arch/Ends', detail: 'nodes' })[0];
        expect(info).toMatchObject({ kind: 'multiEqual', overlaps: 1, bufferStyle: 'Default', vertical: false });
        expect(info.nodes!.world).toEqual([0, 5, 0, 30, 5, 0, 20, 5, 0]);
        expect(info.nodes!.local).toEqual([0, 0, 0, 3, 0, 0, 2, 0, 0]);
    });
});
