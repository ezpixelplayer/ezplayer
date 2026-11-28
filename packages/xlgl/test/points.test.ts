// One point per node onto its own texel, read back as RGBA. Skips where no GL
// context can be made (CI runners without a GPU or Mesa).
import { describe, expect, it } from 'vitest';
import { getXlgl, xlglError } from '../src/index';

const VS = `#version 330 core
in vec3 pos;
uniform vec2 size;
out vec3 vpos;
void main() {
    float i = float(gl_VertexID);
    float x = mod(i, size.x);
    float y = floor(i / size.x);
    gl_Position = vec4((x + 0.5) / size.x * 2.0 - 1.0, (y + 0.5) / size.y * 2.0 - 1.0, 0.0, 1.0);
    vpos = pos;
}`;
const FS = `#version 330 core
in vec3 vpos;
out vec4 color;
void main() { color = vec4(vpos, 0.5); }`;

const ctx = getXlgl();

describe.skipIf(!ctx)('xlgl point draw', () => {
    it('maps node i to texel i and reads its color back', () => {
        const { gl } = ctx!;
        const w = 4;
        const h = 3;
        const n = 10; // fewer nodes than texels: the rest stay cleared
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; ++i) {
            pos[i * 3] = i / n;
            pos[i * 3 + 1] = 1 - i / n;
            pos[i * 3 + 2] = 0.25;
        }
        const prog = gl.compile(VS, FS);
        const buf = gl.createBuffer(pos);
        const out = new Uint8Array(w * h * 4);
        const unbound = gl.draw({
            program: prog,
            w,
            h,
            mode: 'points',
            count: n,
            clearColor: [0, 0, 0, 0],
            attribs: [{ name: 'pos', buffer: buf, size: 3 }],
            uniforms: [['size', '2f', w, h]],
            out,
        });
        expect(unbound).toBe('');
        // Float to byte rounding is the implementation's; allow one LSB.
        const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
        for (let i = 0; i < n; ++i) {
            near(out[i * 4], (i / n) * 255);
            near(out[i * 4 + 1], (1 - i / n) * 255);
            near(out[i * 4 + 2], 0.25 * 255);
            near(out[i * 4 + 3], 0.5 * 255);
        }
        for (let i = n; i < w * h; ++i) expect(out[i * 4 + 3]).toBe(0);
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
    });
});

if (!ctx) console.warn(`xlgl unavailable, point draw test skipped: ${xlglError()}`);
