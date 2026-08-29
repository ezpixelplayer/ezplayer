import { describe, it, expect } from 'vitest';
import {
    buildPortMap,
    portIntentFromModelIntents,
    expandIntentStrings,
    getPortSR,
} from '../src/util/controllerPortMap';
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

describe('buildPortMap rows and serial ports', () => {
    it('draws every fitted pixel port, starting at 1, even past the last used one', () => {
        const map = buildPortMap([mi({ name: 'Arch', controllerPort: 25, nodeCount: 50 })], undefined, undefined, {
            pixelPortCount: 32,
        });
        expect(map.rows.map((r) => r.port)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
        expect(map.rows[24].intendedPixels).toBe(50);
        expect(map.rows[0].intendedPixels).toBeUndefined();
        expect(map.serial).toEqual([]);
    });

    it('still extends past the fitted count when intent or device use a higher port', () => {
        const map = buildPortMap(undefined, undefined, [{ port: 40, pixels: 10 }], { pixelPortCount: 32 });
        expect(map.rows.length).toBe(40);
    });

    it('lists serial ports separately with channels, intent vs device', () => {
        const map = buildPortMap(undefined, undefined, undefined, {
            serialPortCount: 2,
            serialIntent: [
                {
                    port: 1,
                    models: ['PAR 1', 'PAR 2'],
                    channels: 20,
                    startChannel: 1001,
                    protocol: 'dmx',
                    modelChannels: [
                        { name: 'PAR 1', startChannel: 1001, channels: 10 },
                        { name: 'PAR 2', startChannel: 1011, channels: 10 },
                    ],
                },
            ],
            serialActual: [{ port: 1, protocol: 'dmx', channels: 16 }],
        });
        expect(map.rows).toEqual([]);
        expect(map.serial.map((s) => s.port)).toEqual([1, 2]);
        expect(map.serial[0]).toMatchObject({
            models: ['PAR 1', 'PAR 2'],
            startChannel: 1001,
            intendedChannels: 20,
            actualChannels: 16,
            drift: true, // device short of the 20 channels xLights needs
        });
        // DMX addresses are relative to the port's first channel.
        expect(map.serial[0].modelChannels.map((m) => [m.name, m.address])).toEqual([
            ['PAR 1', 1],
            ['PAR 2', 11],
        ]);
        expect(map.serial[1]).toMatchObject({ models: [], drift: false });
    });

    it('does not flag serial drift before the device has been read, and tolerates padding', () => {
        const intent = [{ port: 1, models: ['PAR'], channels: 10 }];
        expect(buildPortMap(undefined, undefined, undefined, { serialIntent: intent }).serial[0].drift).toBe(false);
        expect(
            buildPortMap(undefined, undefined, undefined, {
                serialIntent: intent,
                serialActual: [{ port: 1, channels: 16 }],
            }).serial[0].drift,
        ).toBe(false);
    });
});
