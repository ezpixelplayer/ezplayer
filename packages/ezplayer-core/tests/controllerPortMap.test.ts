import { describe, it, expect } from 'vitest';
import { portIntentFromModelIntents, expandIntentStrings, getPortSR } from '../src/util/controllerPortMap';
import type { ControllerModelIntent } from '../src/types/ControllerOps';

/** Minimal rich model intent. */
function mi(partial: Partial<ControllerModelIntent> & { name: string; controllerPort: number }): ControllerModelIntent {
    return { protocol: 'ws2811', startChannel: 1, nodeCount: 0, ...partial };
}

describe('portIntentFromModelIntents', () => {
    it('spreads a 3-string model across 3 ports with per-port pixel shares', () => {
        const out = portIntentFromModelIntents([
            mi({
                name: 'Mega',
                controllerPort: 2,
                startChannel: 1,
                nodeCount: 350,
                stringStartChannels: [1, 301, 751],
                stringNodeCounts: [100, 150, 100],
            }),
        ]);
        expect(out.map((p) => p.port)).toEqual([2, 3, 4]);
        expect(out.map((p) => p.pixels)).toEqual([100, 150, 100]);
        for (const p of out) expect(p.models).toEqual(['Mega']);
        expect(out.map((p) => p.modelLabels)).toEqual([['Mega [1/3]'], ['Mega [2/3]'], ['Mega [3/3]']]);
        expect(out[0].protocol).toBe('ws2811');
    });

    it('lists every model landing on a port, in chain order, with the port pixel sum', () => {
        const out = portIntentFromModelIntents([
            mi({
                name: 'Mega',
                controllerPort: 2,
                startChannel: 1,
                nodeCount: 300,
                stringStartChannels: [1, 301, 601],
                stringNodeCounts: [100, 100, 100],
            }),
            mi({ name: 'Arch', controllerPort: 3, startChannel: 901, nodeCount: 50 }),
        ]);
        const p3 = out.find((p) => p.port === 3)!;
        expect(p3.models).toEqual(['Mega', 'Arch']); // string 2 of Mega chains before Arch
        expect(p3.modelLabels).toEqual(['Mega [2/3]', 'Arch']);
        expect(p3.pixels).toBe(150);
    });

    it('keeps an SR cascade-on-port model on ONE physical port across slots A/B/C', () => {
        const out = portIntentFromModelIntents([
            mi({
                name: 'Spinner',
                controllerPort: 8,
                startChannel: 1,
                nodeCount: 90,
                smartRemote: 1,
                srCascadeOnPort: true,
                srMaxCascade: 3,
                stringStartChannels: [1, 91, 181],
                stringNodeCounts: [30, 30, 30],
            }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].port).toBe(8);
        expect(out[0].models).toEqual(['Spinner']); // once, not three times
        expect(out[0].modelLabels).toEqual(['Spinner [1,2,3/3 ABC]']);
        expect(out[0].pixels).toBe(90);
    });

    it('walks an SR cascade across the 4-port bank (one string per port, same slot)', () => {
        const out = portIntentFromModelIntents([
            mi({
                name: 'Icicles',
                controllerPort: 1,
                startChannel: 1,
                nodeCount: 200,
                smartRemote: 1,
                srMaxCascade: 1,
                stringStartChannels: [1, 151, 301, 451],
                stringNodeCounts: [50, 50, 50, 50],
            }),
        ]);
        expect(out.map((p) => p.port)).toEqual([1, 2, 3, 4]);
        expect(out.map((p) => p.pixels)).toEqual([50, 50, 50, 50]);
        expect(out[1].modelLabels).toEqual(['Icicles [2/4 A]']);
    });

    it('annotates a whole single-string model on an SR slot with just the letter', () => {
        const out = portIntentFromModelIntents([
            mi({ name: 'Star', controllerPort: 5, startChannel: 1, nodeCount: 25, smartRemote: 2 }),
        ]);
        expect(out).toEqual([{ port: 5, models: ['Star'], modelLabels: ['Star [B]'], pixels: 25, protocol: 'ws2811' }]);
    });

    it('agrees with expandIntentStrings/getPortSR on placement (same cascade rules)', () => {
        const intents = [
            mi({
                name: 'Mega',
                controllerPort: 2,
                startChannel: 1,
                nodeCount: 300,
                stringStartChannels: [1, 301, 601],
                stringNodeCounts: [100, 100, 100],
            }),
        ];
        const strings = expandIntentStrings(intents);
        const ports = portIntentFromModelIntents(intents).map((p) => p.port);
        expect([...new Set(strings.map((s) => s.port))].sort((a, b) => a - b)).toEqual(ports);
        expect(getPortSR(3, 2, 0, false, 1)).toEqual({ port: 4, smartRemote: 0 });
    });
});
