import { describe, expect, it } from 'vitest';
import {
    addAudioListener,
    cleanAudioBus,
    removeAudioBus,
    removeAudioListener,
    resolveAudioBuses,
    upsertAudioBus,
} from './audioBuses';

describe('audio buses', () => {
    it('always has main and immediate', () => {
        const buses = resolveAudioBuses(undefined);
        expect(buses.map((b) => b.name)).toEqual(['main', 'immediate']);
        expect(buses[1]).toEqual({
            name: 'immediate',
            leadMs: 40,
            chunkMs: 20,
            volume: 100,
            outputs: [],
            playLocally: true,
            listeners: [],
            builtIn: true,
        });
    });

    it('lets settings adjust immediate but not main, and adds the rest once', () => {
        const buses = resolveAudioBuses({
            audioBuses: [
                { name: 'main', leadMs: 10 },
                { name: 'immediate', leadMs: 60, volume: 50 },
                { name: 'tree', chunkMs: 10, outputs: [{ deviceId: 'abc', label: 'USB' }] },
                { name: 'tree', chunkMs: 99 },
            ],
        });
        expect(buses.map((b) => b.name)).toEqual(['main', 'immediate', 'tree']);
        expect(buses[0].leadMs).toBe(700);
        expect(buses[1]).toMatchObject({ leadMs: 60, chunkMs: 20, volume: 50, builtIn: true });
        expect(buses[2]).toMatchObject({ chunkMs: 10, builtIn: false, outputs: [{ deviceId: 'abc', label: 'USB' }] });
    });

    it('checks and clamps a definition from a client', () => {
        expect(cleanAudioBus({ name: 'porch', leadMs: 3, chunkMs: 1000, volume: 150.4 })).toEqual({
            ok: true,
            bus: { name: 'porch', leadMs: 10, chunkMs: 200, volume: 100 },
        });
        expect(cleanAudioBus({ name: 'porch' })).toEqual({ ok: true, bus: { name: 'porch' } });
        expect(cleanAudioBus({ name: 'main' })).toMatchObject({ ok: false });
        expect(cleanAudioBus({ name: 'a/b' })).toMatchObject({ ok: false });
        expect(cleanAudioBus({ name: 'x', leadMs: 'soon' })).toMatchObject({
            ok: false,
            error: 'leadMs must be a number',
        });
        expect(cleanAudioBus({ name: 'x', outputs: [{ label: 'no id' }] })).toMatchObject({ ok: false });
        expect(cleanAudioBus({ name: 'x', playLocally: 'no' })).toMatchObject({ ok: false });
        expect(cleanAudioBus({ name: 'x', playLocally: false, outputs: [] })).toEqual({
            ok: true,
            bus: { name: 'x', playLocally: false, outputs: undefined },
        });
        expect(resolveAudioBuses({ audioBuses: [{ name: 'x', playLocally: false }] })[2].playLocally).toBe(false);
        expect(cleanAudioBus(undefined)).toMatchObject({ ok: false });
    });

    it('adds, merges and removes entries in settings', () => {
        let s: { audioBuses?: { name: string; leadMs?: number; volume?: number }[]; other: number } = { other: 1 };
        s = upsertAudioBus(s, { name: 'tree', leadMs: 100 });
        s = upsertAudioBus(s, { name: 'tree', volume: 30 });
        expect(s).toEqual({ other: 1, audioBuses: [{ name: 'tree', leadMs: 100, volume: 30 }] });
        expect(removeAudioBus(s, 'tree')).toEqual({ other: 1, audioBuses: undefined });
    });

    it('keeps the listeners that have connected and the buses sent to them', () => {
        expect(cleanAudioBus({ name: 'x', listeners: ['pi', 'pi', 'porch pi'] })).toEqual({
            ok: true,
            bus: { name: 'x', listeners: ['pi', 'porch pi'] },
        });
        expect(cleanAudioBus({ name: 'x', listeners: ['a/b'] })).toMatchObject({ ok: false });
        expect(cleanAudioBus({ name: 'x', listeners: [] })).toEqual({
            ok: true,
            bus: { name: 'x', listeners: undefined },
        });
        let s = addAudioListener({ audioBuses: [{ name: 'tree', listeners: ['pi', 'shed'] }] }, 'pi');
        expect(addAudioListener(s, 'pi')).toBe(s);
        s = addAudioListener(s, 'shed');
        expect(resolveAudioBuses(s)[2].listeners).toEqual(['pi', 'shed']);
        s = removeAudioListener(s, 'pi');
        expect(s).toEqual({ audioBuses: [{ name: 'tree', listeners: ['shed'] }], audioListeners: [{ name: 'shed' }] });
        expect(removeAudioListener(s, 'shed')).toEqual({
            audioBuses: [{ name: 'tree', listeners: undefined }],
            audioListeners: undefined,
        });
    });
});
