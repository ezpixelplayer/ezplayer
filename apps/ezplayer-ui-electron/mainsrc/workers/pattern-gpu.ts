/*
 * Pattern leases on the GPU: the program compiles to a vertex shader that puts every
 * node of the lease on its own texel, @ezplayer/xlgl draws the points and reads the
 * RGBA back in one synchronous call. Without a GL context (no GPU, no Mesa) every
 * lease falls back to the JavaScript evaluator in epp, which paints the same picture
 * slower.
 */

import { compilePatternGlsl, jsPatternBackend, PatternBackend, PatternLeaseSpec, PatternRenderer, PatternUniforms } from '@ezplayer/epp';
import { getXlgl, Xlgl, xlglError } from '@ezplayer/xlgl';

type Log = (level: 'info' | 'warn', msg: string) => void;

const UNIFORM_KIND: Record<number, string> = { 1: 'f', 2: '2f', 3: '3f', 4: '4f' };

class GpuPatternRenderer implements PatternRenderer {
    readonly backend = 'gpu';
    private readonly program: number;
    private readonly posBuf: number;
    private readonly localBuf?: number;
    private readonly w: number;
    private readonly h: number;
    private readonly out: Uint8Array;
    private readonly uniformTypes: Record<string, number>;
    private warnedUnbound = false;

    constructor(
        private readonly gl: Xlgl,
        private readonly spec: PatternLeaseSpec,
        private readonly log: Log,
    ) {
        const glsl = compilePatternGlsl(spec.program);
        this.program = gl.compile(glsl.vertex, glsl.fragment);
        this.posBuf = gl.createBuffer(spec.world);
        if (glsl.usesLocal && spec.local) this.localBuf = gl.createBuffer(spec.local);
        this.uniformTypes = glsl.uniforms;
        this.w = Math.max(1, Math.ceil(Math.sqrt(spec.nodeCount)));
        this.h = Math.max(1, Math.ceil(spec.nodeCount / this.w));
        this.out = new Uint8Array(this.w * this.h * 4);
    }

    render(uniforms: PatternUniforms, t: number, out: Uint8Array): void {
        const n = this.spec.nodeCount;
        const list: (string | number)[][] = [
            ['size', '2f', this.w, this.h],
            ['t', 'f', t],
            ['n', 'f', n],
        ];
        for (const [name, ty] of Object.entries(this.uniformTypes)) {
            const v = uniforms[name];
            if (v === undefined) continue;
            list.push([`U_${name}`, UNIFORM_KIND[ty], ...(typeof v === 'number' ? [v] : v)]);
        }
        const attribs = [{ name: 'pos', buffer: this.posBuf, size: 3 }];
        if (this.localBuf !== undefined) attribs.push({ name: 'local', buffer: this.localBuf, size: 3 });
        const unbound = this.gl.draw({
            program: this.program,
            w: this.w,
            h: this.h,
            mode: 'points',
            count: n,
            clearColor: [0, 0, 0, 0],
            attribs,
            uniforms: list,
            out: this.out,
        });
        if (unbound && !this.warnedUnbound) {
            this.warnedUnbound = true;
            // The built-ins t and n go unused by many programs; only a program's own uniform is worth a line.
            const own = unbound.split(',').filter((u) => u.startsWith('U_'));
            if (own.length) this.log('warn', `[pattern] uniforms the shader optimized away: ${own.join(', ')}`);
        }
        out.set(this.out.subarray(0, n * 4));
    }

    dispose(): void {
        try {
            this.gl.deleteBuffer(this.posBuf);
            if (this.localBuf !== undefined) this.gl.deleteBuffer(this.localBuf);
            this.gl.deleteProgram(this.program);
        } catch {
            /* context gone */
        }
    }
}

/**
 * A pattern backend that renders on the GPU when this thread can get a GL context
 * and falls back to JavaScript otherwise. Call it from the thread that owns the
 * pipeline; the context is created on first use and belongs to that thread.
 */
export function gpuPatternBackend(log: Log): PatternBackend {
    let announced = false;
    return (spec: PatternLeaseSpec): PatternRenderer => {
        const ctx = getXlgl();
        if (!announced) {
            announced = true;
            if (ctx) log('info', `[pattern] GPU patterns on ${ctx.info.renderer} (${ctx.info.version})`);
            else log('warn', `[pattern] no GL context (${xlglError() ?? 'unknown'}); patterns run in JavaScript`);
        }
        if (!ctx) return jsPatternBackend(spec);
        try {
            return new GpuPatternRenderer(ctx.gl, spec, log);
        } catch (e) {
            // A program the GPU compiler refuses still has to paint: the JS evaluator takes it.
            log('warn', `[pattern] GPU compile failed, using JavaScript: ${(e as Error).message}`);
            return jsPatternBackend(spec);
        }
    };
}
