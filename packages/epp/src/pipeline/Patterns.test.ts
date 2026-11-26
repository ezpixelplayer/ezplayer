import { describe, expect, it } from 'vitest';
import {
    compilePatternGlsl,
    compilePatternJs,
    normalizeUniforms,
    PATTERN_PRESETS,
    PatternError,
    PatternProgram,
    resolvePattern,
    validatePattern,
} from './Patterns';

/** World positions for a few nodes on a line along x. */
function line(n: number, step = 10): Float32Array {
    const w = new Float32Array(n * 3);
    for (let i = 0; i < n; ++i) w[i * 3] = i * step;
    return w;
}

function render(program: PatternProgram, world: Float32Array, t = 0, uniforms = {}): Uint8Array {
    const n = world.length / 3;
    const out = new Uint8Array(n * 4);
    compilePatternJs(program)(world, undefined, n, t, normalizeUniforms(program, uniforms), out);
    return out;
}

describe('pattern programs', () => {
    it('evaluates constants, uniforms, inputs and swizzles per node', () => {
        const program: PatternProgram = {
            uniforms: { tint: '#ff8000', k: 0.5 },
            color: { op: 'mul', args: ['$tint', '$k'] },
            alpha: { op: 'div', args: ['pos.x', 20] },
        };
        const out = render(program, line(3));
        // node 0: alpha 0; node 1: alpha 0.5; node 2: alpha 1
        expect([...out.subarray(0, 4)]).toEqual([128, 64, 0, 0]);
        expect([...out.subarray(4, 8)]).toEqual([128, 64, 0, 128]);
        expect([...out.subarray(8, 12)]).toEqual([128, 64, 0, 255]);
        // A runtime uniform of the right shape overrides the default; the wrong shape is refused.
        const out2 = render(program, line(1), 0, { tint: [0, 1, 0], k: 1 });
        expect([...out2.subarray(0, 3)]).toEqual([0, 255, 0]);
        expect(() => normalizeUniforms(program, { tint: 1 })).toThrow(PatternError);
        expect(() => normalizeUniforms(program, { k: [1, 2] })).toThrow(PatternError);
    });

    it('rejects programs that cannot compile', () => {
        expect(() => validatePattern({ color: 1 })).toThrow(/vec3 or vec4/);
        expect(() => validatePattern({ color: '$nope' })).toThrow(/unknown uniform/);
        expect(() => validatePattern({ color: { op: 'frobnicate', args: [] } })).toThrow(/unknown op/);
        expect(() => validatePattern({ color: { op: 'add', args: [[1, 2], [1, 2, 3]] } })).toThrow(/mixed vector sizes/);
        expect(() => validatePattern({ color: 'pos', alpha: 'pos' })).toThrow(/alpha must be a float/);
        expect(() => validatePattern({ color: 'pos.w' })).toThrow(/not in a vec3/);
        expect(() => validatePattern({ uniforms: { 't': 1 }, color: 'pos' })).toThrow(/shadows/);
    });

    it('computes the beam preset like the hand formula', () => {
        const program = PATTERN_PRESETS.beam;
        const world = new Float32Array([0, 0, -100, 10, 0, -100, 0, 0, 100]);
        const out = render(program, world, 0, { origin: [0, 0, 0], dir: [0, 0, -1], halfAngle: 0.2, softness: 0.5, range: 200 });
        // On axis, half way out: full edge, half falloff.
        expect(out[3]).toBe(128);
        // 0.0997 rad off axis: inside the soft rim, which runs 0.1..0.2 rad, so nearly full.
        const ang = Math.atan2(10, 100);
        const tt = Math.min(1, Math.max(0, (ang - 0.1) / 0.1));
        const edge = 1 - tt * tt * (3 - 2 * tt);
        const fall = 1 - Math.hypot(10, 100) / 200;
        expect(Math.abs(out[7] - Math.round(edge * fall * 255))).toBeLessThanOrEqual(1);
        // Behind the wand: dark.
        expect(out[11]).toBe(0);
        // The color is the uniform.
        expect([...out.subarray(0, 3)]).toEqual([255, 240, 192]);
    });

    it('runs every preset on both backends', () => {
        const world = line(50, 7);
        for (const [name, program] of Object.entries(PATTERN_PRESETS)) {
            const out = render(program, world, 1.5);
            expect(out.length, name).toBe(200);
            const gl = compilePatternGlsl(program);
            expect(gl.vertex, name).toContain('#version 330 core');
            expect(gl.vertex, name).toContain('gl_Position');
            for (const u of Object.keys(gl.uniforms)) expect(gl.vertex, name).toContain(`uniform ${['', 'float', 'vec2', 'vec3', 'vec4'][gl.uniforms[u]]} U_${u};`);
        }
        const { program, uniforms, preset } = resolvePattern({ preset: 'shockwave', uniforms: { radius: 50 } });
        expect(preset).toBe('shockwave');
        expect(uniforms.radius).toBe(50);
        expect(uniforms.thickness).toBe(20);
        expect(program).toBe(PATTERN_PRESETS.shockwave);
        expect(() => resolvePattern({ preset: 'lava' })).toThrow(/unknown preset/);
        expect(() => resolvePattern({})).toThrow(PatternError);
    });

    it('declares only the uniforms and attributes a program uses in GLSL', () => {
        const gl = compilePatternGlsl({ uniforms: { a: 1, b: [1, 2, 3] }, color: { op: 'mul', args: ['local', '$a'] } });
        expect(gl.usesLocal).toBe(true);
        expect(gl.vertex).toContain('in vec3 local;');
        expect(gl.uniforms).toEqual({ a: 1 });
        expect(gl.vertex).not.toContain('U_b');
        const ramp = compilePatternGlsl({ color: { op: 'ramp', args: ['u'], stops: [[0, '#000000'], [1, '#ffffff']] } });
        expect(ramp.vertex).toContain('vec3 ramp0(float x)');
        expect(ramp.usesLocal).toBe(false);
    });

    it('interpolates ramps and converts hsv', () => {
        const ramp: PatternProgram = { color: { op: 'ramp', args: ['u'], stops: [[0, '#000000'], [1, '#ff0000']] } };
        const out = render(ramp, line(3));
        expect([out[0], out[4], out[8]]).toEqual([0, 128, 255]);
        const hsv: PatternProgram = { color: { op: 'hsv', args: [{ op: 'vec3', args: ['u', 1, 1] }] } };
        const h = render(hsv, line(4));
        expect([...h.subarray(0, 3)]).toEqual([255, 0, 0]); // hue 0
        expect([...h.subarray(4, 7)]).toEqual([0, 255, 0]); // hue 1/3
        expect([...h.subarray(8, 11)]).toEqual([0, 0, 255]); // hue 2/3
    });

    it('keeps noise in 0..1 and smooth between lattice points', () => {
        const p: PatternProgram = { color: { op: 'vec3', args: [{ op: 'noise', args: [{ op: 'mul', args: ['pos', 0.013] }] }] } };
        const out = render(p, line(400, 1));
        let maxStep = 0;
        for (let i = 1; i < 400; ++i) maxStep = Math.max(maxStep, Math.abs(out[i * 4] - out[(i - 1) * 4]));
        expect(maxStep).toBeLessThan(40);
        expect(Math.max(...out.filter((_, k) => k % 4 === 0))).toBeGreaterThan(100);
    });
});
