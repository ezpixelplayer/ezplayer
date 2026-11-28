import { describe, expect, it } from 'vitest';
import { emptyTestTweakDoc, planChunkWiring, type ControllerModelIntent, type TestTweakDoc } from '@ezplayer/ezplayer-core';
import type { XlControllerInfo, XlModelChannelInfo } from 'xllayoutcalcs';
import { adjustFromDoc, rewriteIntentsForPlan, wiringModelsFrom } from './testtweak';

/** Just the fields the helpers read. */
function model(p: Partial<XlModelChannelInfo> & { name: string; startChannel: number; nodeCount: number }): XlModelChannelInfo {
    return {
        displayAs: 'Single Line',
        channelCount: p.nodeCount * 3,
        controllerName: 'C1',
        controllerPort: 1,
        controllerProtocol: 'ws2811',
        numPhysicalStrings: 1,
        stringNodeCounts: [p.nodeCount],
        stringStartChannels: [p.startChannel],
        ...p,
    } as XlModelChannelInfo;
}

const controllers = [
    { name: 'C1', startChannel: 1, maxChannels: 600 },
    { name: 'C2', startChannel: 601, maxChannels: 300 },
] as XlControllerInfo[];

const baseIntent = (m: XlModelChannelInfo): ControllerModelIntent => ({
    name: m.name,
    controllerPort: m.controllerPort,
    protocol: m.controllerProtocol,
    startChannel: m.startChannel,
    nodeCount: m.nodeCount,
    channels: m.channelCount,
    nullPixels: 2,
    smartRemote: 3,
    stringStartChannels: m.stringStartChannels,
    stringNodeCounts: m.stringNodeCounts,
});

describe('adjustFromDoc', () => {
    it('turns effective tweaks into output settings and leaves out models that set nothing', () => {
        const doc: TestTweakDoc = {
            ...emptyTestTweakDoc(),
            profiles: [{ id: 'p', name: 'P', brightness: 50, gamma: 2 }],
            models: {
                A: { profile: 'p', brightness: 25, colorOrder: 'GRB' },
                B: { brightness: 100, gamma: 1, colorTempK: 6500 },
                C: { colorTempK: 3000 },
                D: { profile: 'p' },
            },
        };
        const adj = adjustFromDoc(doc);
        // B sets a straight curve on purpose: that replaces the layout's dimming curve, so it is passed on.
        expect(Object.keys(adj).sort()).toEqual(['A', 'B', 'C', 'D']);
        expect(adj.B).toEqual({ gamma: 1, brightness: 1 });
        expect(adj.A).toEqual({ colorOrder: 'GRB', gamma: 2, brightness: 0.25 });
        expect(adj.D).toEqual({ gamma: 2, brightness: 0.5 });
        expect(adj.C.gain![0]).toBe(1);
        expect(adj.C.gain![2]).toBeLessThan(1);
    });
});

describe('wiringModelsFrom', () => {
    it('finds the controller that carries a model by channel, and its per-string spans', () => {
        const models = [
            model({ name: 'A', startChannel: 1, nodeCount: 100 }),
            // Says C1, but its channels are in C2's range.
            model({ name: 'B', startChannel: 601, nodeCount: 50 }),
            model({ name: 'S', startChannel: 301, nodeCount: 20, numPhysicalStrings: 2, stringNodeCounts: [10, 10], stringStartChannels: [301, 401] }),
        ];
        const w = wiringModelsFrom(models, controllers);
        expect(w.map((m) => [m.name, m.controller])).toEqual([
            ['A', 'C1'],
            ['B', 'C2'],
            ['S', 'C1'],
        ]);
        expect(w[2].spans).toEqual([
            { nodeStart: 0, nodeCount: 10, channel: 301 },
            { nodeStart: 10, nodeCount: 10, channel: 401 },
        ]);
    });
});

describe('rewriteIntentsForPlan', () => {
    const models = [model({ name: 'A', startChannel: 1, nodeCount: 100 }), model({ name: 'B', startChannel: 301, nodeCount: 50 })];

    it('replaces an overridden model by one intent per planned string', () => {
        const doc: TestTweakDoc = {
            ...emptyTestTweakDoc(),
            models: {
                A: {
                    chunks: [
                        { nodeStart: 0, nodeCount: 60, controller: 'C1', port: 3, order: 10, nullBefore: 1 },
                        { nodeStart: 60, nodeCount: 40, controller: 'C1', port: 4, order: 10, reverse: true, smartRemote: 2 },
                    ],
                },
            },
        };
        const plan = planChunkWiring(doc, wiringModelsFrom(models, controllers));
        expect(plan.problems).toEqual([]);
        const by = new Map<string, ControllerModelIntent[]>([['C1', models.map(baseIntent)]]);
        rewriteIntentsForPlan(by, plan, models, baseIntent);
        const c1 = by.get('C1')!;
        expect(c1.map((i) => [i.name, i.controllerPort, i.startChannel, i.nodeCount, i.channels])).toEqual([
            ['B', 1, 301, 50, 150],
            ['A', 3, 1, 60, 180],
            ['A', 4, 181, 40, 120],
        ]);
        // The model's own nulls, remote and string spread give way to the chunk's.
        expect(c1[1]).toMatchObject({ nullPixels: 1 });
        expect(c1[1].smartRemote).toBeUndefined();
        expect(c1[1].stringStartChannels).toBeUndefined();
        expect(c1[2]).toMatchObject({ reverse: true, smartRemote: 2 });
        expect(c1[2].nullPixels).toBeUndefined();
        // B is untouched.
        expect(c1[0]).toEqual(baseIntent(models[1]));
    });

    it('does nothing without overrides', () => {
        const by = new Map<string, ControllerModelIntent[]>([['C1', models.map(baseIntent)]]);
        const before = JSON.stringify([...by]);
        rewriteIntentsForPlan(by, planChunkWiring(emptyTestTweakDoc(), wiringModelsFrom(models, controllers)), models, baseIntent);
        expect(JSON.stringify([...by])).toBe(before);
    });
});
