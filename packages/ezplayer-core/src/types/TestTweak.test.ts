import { describe, expect, it } from 'vitest';
import {
    effectiveTweak,
    emptyTestTweakDoc,
    isNeutralTweak,
    mergeChunkWithNext,
    nextOrderOnPort,
    normalizeActiveTest,
    normalizeTestTweakDoc,
    planChunkWiring,
    portChains,
    resolveTestTargets,
    splitChunkAt,
    splitIntoStrings,
    validateChunks,
    type ModelPortChunk,
    type TestTweakDoc,
    type WiringModel,
} from './TestTweak';

const chunk = (
    nodeStart: number,
    nodeCount: number,
    port: number,
    order: number,
    controller = 'C1',
): ModelPortChunk => ({
    nodeStart,
    nodeCount,
    controller,
    port,
    order,
});

describe('normalizeTestTweakDoc', () => {
    it('keeps what parses and drops the rest', () => {
        const doc = normalizeTestTweakDoc({
            version: 99,
            models: {
                Arch: { colorOrder: 'grb', brightness: 250, gamma: 'x', colorTempK: 3000, junk: 1 },
                Empty: {},
                Tree: {
                    chunks: [
                        { nodeStart: 50, nodeCount: 50, controller: 'C', port: 2, order: 20 },
                        { nodeStart: 0, nodeCount: 50, controller: 'C', port: 1, order: 10 },
                        { nodeStart: 'x' },
                    ],
                },
            },
            groups: [
                { id: 'g1', name: 'Roof', models: ['Arch', 'Arch', 3], tweak: { brightness: 50 } },
                { id: 'g1', name: 'dup' },
                { name: 'no id' },
            ],
            presets: [
                { id: 'p1', name: 'Bars', pattern: { kind: 'bars', colors: ['#FF0000', 'red'], speed: 1 } },
                { id: 'p2', name: 'bad', pattern: { kind: 'nope' } },
            ],
        });
        expect(doc.version).toBe(1);
        expect(doc.models.Arch).toEqual({ colorOrder: 'GRB', brightness: 100, colorTempK: 3000 });
        expect(doc.models.Empty).toBeUndefined();
        expect(doc.models.Tree.chunks!.map((c) => c.nodeStart)).toEqual([0, 50]);
        expect(doc.groups).toEqual([{ id: 'g1', name: 'Roof', models: ['Arch'], tweak: { brightness: 50 } }]);
        expect(doc.presets).toEqual([
            { id: 'p1', name: 'Bars', pattern: { kind: 'bars', colors: ['#ff0000'], speed: 1 } },
        ]);
    });

    it('turns garbage into an empty document', () => {
        expect(normalizeTestTweakDoc(null)).toEqual(emptyTestTweakDoc());
        expect(normalizeTestTweakDoc('x')).toEqual(emptyTestTweakDoc());
    });

    it('validates an active test', () => {
        expect(
            normalizeActiveTest({ pattern: { kind: 'solid' }, targets: { models: ['A'], all: true }, ttlMs: 5 }),
        ).toEqual({
            pattern: { kind: 'solid' },
            targets: { models: ['A'], all: true },
            ttlMs: 100,
        });
        expect(normalizeActiveTest({ targets: {} })).toBeUndefined();
    });
});

describe('effectiveTweak', () => {
    const doc: TestTweakDoc = {
        ...emptyTestTweakDoc(),
        models: { Arch: { brightness: 50, gamma: 2.2 }, Star: {} },
        groups: [
            {
                id: 'g1',
                name: 'Roof',
                models: ['Arch', 'Star'],
                tweak: { brightness: 80, colorOrder: 'GRB', gamma: 1.8 },
            },
            {
                id: 'g2',
                name: 'All',
                models: ['Arch', 'Star', 'Tree'],
                tweak: { brightness: 50, colorOrder: 'BGR', colorTempK: 4000 },
            },
            { id: 'g3', name: 'No tweak', models: ['Arch'] },
        ],
    };

    it('multiplies brightness through groups and the model', () => {
        expect(effectiveTweak(doc, 'Arch').brightness).toBeCloseTo(0.2);
        expect(effectiveTweak(doc, 'Tree').brightness).toBeCloseTo(0.5);
    });

    it("lets the model's own value win, then the first group that sets one", () => {
        const arch = effectiveTweak(doc, 'Arch');
        expect(arch.gamma).toBe(2.2);
        expect(arch.colorOrder).toBe('GRB');
        expect(arch.colorTempK).toBe(4000);
        expect(arch.fromGroups).toEqual(['g1', 'g2']);
        expect(effectiveTweak(doc, 'Star').gamma).toBe(1.8);
    });

    it('is neutral for a model nothing mentions', () => {
        expect(isNeutralTweak(effectiveTweak(doc, 'Nobody'))).toBe(true);
        expect(isNeutralTweak(effectiveTweak(doc, 'Tree'))).toBe(false);
    });

    it('resolves targets through groups without duplicates', () => {
        expect(resolveTestTargets(doc, { models: ['Tree'], groups: ['g1', 'missing'] })).toEqual([
            'Tree',
            'Arch',
            'Star',
        ]);
        expect(resolveTestTargets(doc, { all: true, models: ['Arch'] }, ['A', 'Arch'])).toEqual(['A', 'Arch']);
        expect(resolveTestTargets(doc, { models: ['Arch'], subModels: ['Tree/Star'] })).toEqual(['Arch', 'Tree/Star']);
    });
});

describe('chunks', () => {
    it('splits into strings, keeping the placement of what was there', () => {
        expect(splitIntoStrings([50, 50, 0, 25])).toEqual([
            chunk(0, 50, 0, 0, ''),
            chunk(50, 50, 0, 0, ''),
            chunk(100, 25, 0, 0, ''),
        ]);
        const again = splitIntoStrings([50, 50], [chunk(0, 100, 3, 10)]);
        expect(again).toEqual([chunk(0, 50, 3, 10), chunk(50, 50, 3, 11)]);
    });

    it('cuts and merges', () => {
        const cut = splitChunkAt([chunk(0, 100, 1, 10)], 40);
        expect(cut.map((c) => [c.nodeStart, c.nodeCount, c.order])).toEqual([
            [0, 40, 10],
            [40, 60, 11],
        ]);
        expect(splitChunkAt(cut, 40)).toEqual(cut);
        expect(mergeChunkWithNext(cut, 0).map((c) => [c.nodeStart, c.nodeCount])).toEqual([[0, 100]]);
        expect(mergeChunkWithNext(cut, 1)).toBe(cut);
    });

    it('reports gaps, overlaps, overruns and unassigned chunks', () => {
        expect(validateChunks('M', [chunk(0, 50, 1, 1), chunk(50, 50, 1, 2)], 100)).toEqual([]);
        const msgs = validateChunks('M', [chunk(0, 40, 1, 1), chunk(50, 60, 0, 2), chunk(30, 5, 1, 3)], 100).map(
            (p) => p.message,
        );
        expect(msgs.some((m) => m.includes('overlaps'))).toBe(true);
        expect(msgs.some((m) => m.includes('not in any chunk'))).toBe(true);
        expect(msgs.some((m) => m.includes('past'))).toBe(true);
        expect(msgs.some((m) => m.includes('no controller port'))).toBe(true);
    });

    it('chains chunks on a port in ascending order, gaps allowed', () => {
        const doc: TestTweakDoc = {
            ...emptyTestTweakDoc(),
            models: {
                A: { chunks: [chunk(0, 10, 1, 100), chunk(10, 10, 2, 10)] },
                B: { chunks: [chunk(0, 5, 1, 11)] },
                C: { chunks: [chunk(0, 7, 1, 30), { ...chunk(7, 3, 1, 5), nullBefore: 2 }] },
            },
        };
        const chains = portChains(doc);
        expect(chains.map((c) => `${c.controller}:${c.port}`)).toEqual(['C1:1', 'C1:2']);
        expect(chains[0].entries.map((e) => `${e.model}@${e.chunk.order}`)).toEqual(['C@5', 'B@11', 'C@30', 'A@100']);
        expect(chains[0].pixels).toBe(10 + 5 + 7 + 3 + 2);
        expect(nextOrderOnPort(doc, 'C1', 1)).toBe(110);
        expect(nextOrderOnPort(doc, 'C1', 9)).toBe(10);
    });
});

describe('planChunkWiring', () => {
    const models: WiringModel[] = [
        {
            name: 'A',
            controller: 'C1',
            nodeCount: 100,
            channelsPerNode: 3,
            spans: [{ nodeStart: 0, nodeCount: 100, channel: 1 }],
        },
        {
            name: 'B',
            controller: 'C1',
            nodeCount: 50,
            channelsPerNode: 3,
            spans: [{ nodeStart: 0, nodeCount: 50, channel: 301 }],
        },
        {
            name: 'X',
            controller: 'C2',
            nodeCount: 50,
            channelsPerNode: 3,
            spans: [{ nodeStart: 0, nodeCount: 50, channel: 1001 }],
        },
    ];
    const docOf = (m: TestTweakDoc['models']): TestTweakDoc => ({ ...emptyTestTweakDoc(), models: m });

    it('leaves a model that is split in place on its own channels', () => {
        const plan = planChunkWiring(docOf({ A: { chunks: [chunk(0, 60, 1, 10), chunk(60, 40, 2, 10)] } }), models);
        expect(plan.problems).toEqual([]);
        expect(plan.overridden).toEqual(['A']);
        expect(plan.strings.map((s) => [s.port, s.nodeStart, s.nodeCount, s.channel])).toEqual([
            [1, 0, 60, 1],
            [2, 60, 40, 181],
        ]);
    });

    it('lays channels out in wire order, so start channel order is chain order', () => {
        // The second half of A goes first on port 1, then B, then the first half of A.
        const plan = planChunkWiring(
            docOf({
                A: { chunks: [chunk(0, 50, 1, 30), chunk(50, 50, 1, 10)] },
                B: { chunks: [chunk(0, 50, 1, 20)] },
            }),
            models,
        );
        expect(plan.problems).toEqual([]);
        expect(plan.strings.map((s) => [s.model, s.nodeStart, s.channel])).toEqual([
            ['A', 50, 1],
            ['B', 0, 151],
            ['A', 0, 301],
        ]);
    });

    it('swaps models between controllers when the channels fit', () => {
        const plan = planChunkWiring(
            docOf({ B: { chunks: [chunk(0, 50, 4, 10, 'C2')] }, X: { chunks: [chunk(0, 50, 7, 10, 'C1')] } }),
            models,
        );
        expect(plan.problems).toEqual([]);
        expect(plan.strings.map((s) => [s.model, s.controller, s.port, s.channel])).toEqual([
            ['X', 'C1', 7, 301],
            ['B', 'C2', 4, 1001],
        ]);
    });

    it('keeps the xLights wiring for a model its new controller has no channels for', () => {
        const plan = planChunkWiring(
            docOf({
                A: { chunks: [chunk(0, 60, 1, 10), chunk(60, 40, 2, 10)] },
                X: { chunks: [chunk(0, 50, 3, 10, 'C1')] },
            }),
            models,
        );
        expect(plan.overridden).toEqual(['A']);
        expect(plan.problems.map((p) => p.model)).toEqual(['X']);
        expect(plan.strings.every((s) => s.model === 'A')).toBe(true);
    });

    it('skips models whose chunks do not cover them', () => {
        const plan = planChunkWiring(docOf({ A: { chunks: [chunk(0, 60, 1, 10)] } }), models);
        expect(plan.overridden).toEqual([]);
        expect(plan.problems.length).toBe(1);
    });

    it('splits a chunk across free blocks and keeps nulls at its ends', () => {
        const split: WiringModel[] = [
            {
                name: 'S',
                controller: 'C1',
                nodeCount: 6,
                channelsPerNode: 3,
                spans: [
                    { nodeStart: 0, nodeCount: 3, channel: 1 },
                    { nodeStart: 3, nodeCount: 3, channel: 101 },
                ],
            },
        ];
        const plan = planChunkWiring(
            docOf({ S: { chunks: [{ ...chunk(0, 6, 1, 10), nullBefore: 1, nullAfter: 2, reverse: true }] } }),
            split,
        );
        expect(plan.strings).toEqual([
            {
                model: 'S',
                chunkIndex: 0,
                controller: 'C1',
                port: 1,
                smartRemote: 0,
                nodeStart: 0,
                nodeCount: 3,
                channel: 1,
                nullBefore: 1,
                reverse: true,
            },
            {
                model: 'S',
                chunkIndex: 0,
                controller: 'C1',
                port: 1,
                smartRemote: 0,
                nodeStart: 3,
                nodeCount: 3,
                channel: 101,
                nullAfter: 2,
                reverse: true,
            },
        ]);
    });
});
