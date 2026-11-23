import { describe, expect, it } from 'vitest';
import {
    BLEND_ADD,
    BLEND_ALPHA,
    BLEND_MAX,
    BLEND_MULTIPLY,
    BLEND_REPLACE,
    BLEND_SCREEN,
    BLEND_SUBTRACT,
    BLEND_UNDERLAY,
    blendModeFromName,
    blendNodes,
    dynamicGammaNodes,
    fillNodes,
    isBlack,
    lutNodes,
    scaleNodes,
    scaleNodesRgb,
    testPatternNodes,
} from './Kernels';
import { buildForwardLut } from './OutputMap';
import { ParamsBlock } from './Params';
import { StatsBlock } from './Stats';

describe('blendNodes', () => {
    const dst3 = () => Uint8Array.from([10, 200, 0, 0, 0, 0, 100, 100, 100]);
    const src3 = () => Uint8Array.from([50, 100, 255, 1, 2, 3, 100, 100, 100]);

    it('max matches the legacy per-channel brightest', () => {
        const d = dst3();
        blendNodes(BLEND_MAX, d, src3(), 3, 0, 3);
        expect(Array.from(d)).toEqual([50, 200, 255, 1, 2, 3, 100, 100, 100]);
    });
    it('replace, underlay, add, subtract, multiply, screen, alpha', () => {
        let d = dst3();
        blendNodes(BLEND_REPLACE, d, src3(), 3, 0, 3);
        expect(Array.from(d)).toEqual(Array.from(src3()));
        d = dst3();
        blendNodes(BLEND_UNDERLAY, d, src3(), 3, 0, 3);
        expect(Array.from(d)).toEqual([10, 200, 0, 1, 2, 3, 100, 100, 100]);
        d = dst3();
        blendNodes(BLEND_ADD, d, src3(), 3, 0, 3);
        expect(Array.from(d)).toEqual([60, 255, 255, 1, 2, 3, 200, 200, 200]);
        d = dst3();
        blendNodes(BLEND_SUBTRACT, d, src3(), 3, 0, 3);
        expect(Array.from(d)).toEqual([0, 100, 0, 0, 0, 0, 0, 0, 0]);
        d = dst3();
        blendNodes(BLEND_MULTIPLY, d, src3(), 3, 0, 3);
        expect(Array.from(d)).toEqual([2, 78, 0, 0, 0, 0, 39, 39, 39]);
        d = dst3();
        blendNodes(BLEND_SCREEN, d, src3(), 3, 0, 3);
        expect(d[0]).toBe(255 - Math.round(((255 - 10) * (255 - 50)) / 255));
        d = dst3();
        blendNodes(BLEND_ALPHA, d, src3(), 3, 0, 3, 128);
        expect(d[1]).toBe(Math.round((200 * 127 + 100 * 128) / 255));
    });
    it('respects the node range and leaves X alone unless asked', () => {
        const d = Uint8Array.from([0, 0, 0, 9, 0, 0, 0, 9]);
        const s = Uint8Array.from([1, 1, 1, 1, 2, 2, 2, 2]);
        blendNodes(BLEND_MAX, d, s, 4, 1, 2);
        expect(Array.from(d)).toEqual([0, 0, 0, 9, 2, 2, 2, 9]);
        blendNodes(BLEND_REPLACE, d, s, 4, 0, 1, 255, true);
        expect(Array.from(d)).toEqual([1, 1, 1, 1, 2, 2, 2, 9]);
    });
    it('maps names', () => {
        expect(blendModeFromName('Brightest')).toBe(BLEND_MAX);
        expect(blendModeFromName('overlay')).toBe(BLEND_REPLACE);
        expect(blendModeFromName('nope', BLEND_ADD)).toBe(BLEND_ADD);
    });
});

describe('fill, lut, scale, isBlack, dynamic gamma', () => {
    it('fills and detects black', () => {
        const f = new Uint8Array(12);
        expect(isBlack(f, 3, 0, 4)).toBe(true);
        fillNodes(f, 3, 1, 3, 5, 6, 7);
        expect(Array.from(f)).toEqual([0, 0, 0, 5, 6, 7, 5, 6, 7, 0, 0, 0]);
        expect(isBlack(f, 3, 0, 4)).toBe(false);
        expect(isBlack(f, 3, 3, 4)).toBe(true);
    });
    it('applies a LUT and a scale', () => {
        const lut = new Uint8Array(256);
        buildForwardLut(1, 0.5, lut);
        const f = Uint8Array.from([255, 100, 0, 200]);
        lutNodes(f, 4, 0, 1, lut);
        expect(Array.from(f)).toEqual([128, 50, 0, 200]);
        const g = Uint8Array.from([255, 100, 0]);
        scaleNodes(g, 3, 0, 1, 0.5);
        expect(Array.from(g)).toEqual([128, 50, 0]);
    });
    it('scales channels independently, leaving X alone unless asked', () => {
        const f = Uint8Array.from([255, 255, 255, 200, 100, 100, 100, 200]);
        scaleNodesRgb(f, 4, 0, 2, 1, 0.5, 0.25);
        expect(Array.from(f)).toEqual([255, 128, 64, 200, 100, 50, 25, 200]);
        scaleNodesRgb(f, 4, 0, 2, 1, 1, 1, 0.5);
        expect(Array.from(f)).toEqual([255, 128, 64, 100, 100, 50, 25, 100]);
        const g = Uint8Array.from([255, 100, 0]);
        scaleNodesRgb(g, 3, 0, 1, 1, 1, 1);
        expect(Array.from(g)).toEqual([255, 100, 0]);
        scaleNodesRgb(g, 3, 0, 1, 0.5, 0.5, 0.5);
        expect(Array.from(g)).toEqual([128, 50, 0]); // same as scaleNodes at 0.5
    });
    it('dynamic gamma keeps hue ratios', () => {
        const lut = new Uint8Array(256);
        buildForwardLut(2.2, 1, lut);
        const f = Uint8Array.from([200, 100, 0]);
        dynamicGammaNodes(f, 3, 0, 1, lut);
        expect(f[0]).toBe(lut[200]);
        expect(f[1]).toBe(Math.round((100 * lut[200]) / 200));
        expect(f[2]).toBe(0);
    });
    it('renders test patterns', () => {
        const f = new Uint8Array(4 * 3);
        testPatternNodes(f, 3, 0, 4, { kind: 'chase', r: 255, g: 255, b: 255, speed: 1 }, 2000);
        expect(Array.from(f)).toEqual([0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0]);
        testPatternNodes(f, 3, 0, 4, { kind: 'axes', grid: { width: 2, height: 2 } }, 0);
        expect(Array.from(f)).toEqual([0, 0, 32, 255, 0, 32, 0, 255, 32, 255, 255, 32]);
        testPatternNodes(f, 3, 0, 4, { kind: 'rainbow' }, 0);
        expect(Array.from(f.subarray(0, 3))).toEqual([255, 0, 0]);
    });
});

describe('ParamsBlock', () => {
    it('double-buffers commits', () => {
        const p = ParamsBlock.allocate(4);
        p.define('brightness', 0, 1);
        p.define('bgOpacity', 1, 0.5);
        const s0 = p.commit();
        expect(p.read(s0, 0)).toBe(1);
        expect(p.commit()).toBe(s0); // nothing dirty: no flip
        p.setByName('brightness', 0.25);
        const s1 = p.commit();
        expect(s1).toBe(s0 ^ 1);
        expect(p.read(s0, 0)).toBe(1); // the old slot still holds the old value for frames in flight
        expect(p.read(s1, 0)).toBe(0.25);
        expect(p.generation()).toBe(2);
        const client = new ParamsBlock(p.buffer);
        expect(client.read(client.activeSlot(), 0)).toBe(0.25);
    });
});

describe('StatsBlock', () => {
    it('counts and gauges across attachments', () => {
        const s = StatsBlock.allocate(['a', 'b', 'c'], ['g']);
        s.inc(s.counter('b'), 3);
        s.inc(s.counter('b'));
        s.maxGauge(s.gauge('g'), 2.5);
        s.maxGauge(s.gauge('g'), 1);
        const t = new StatsBlock(s.buffer, ['a', 'b', 'c'], ['g']);
        expect(t.snapshot()).toEqual({ counters: { a: 0, b: 4, c: 0 }, gauges: { g: 2.5 } });
        expect(() => new StatsBlock(s.buffer, ['a'], [])).toThrow();
    });
});
