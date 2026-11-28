#!/usr/bin/env node
// Full-layout point draw: load a show's layout the way the pixel pipeline does, put one
// point per node on its own texel, evaluate a flashlight cone in the vertex shader, read
// RGBA back and time it. Runs in a worker thread like the pipeline. Read-only.
//
//   node packages/xlgl/tools/beam-probe.mjs <showFolder> [frames]
//   XLGL_SOFTWARE=1 node ...          (Mesa llvmpipe instead of the GPU)
//   ELECTRON_RUN_AS_NODE=1 <electron> packages/xlgl/tools/beam-probe.mjs <showFolder>
//
// Needs `pnpm --filter @ezplayer/epp build` and `pnpm --filter @ezplayer/xlgl build` first.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHOW = process.argv[2];
const FRAMES = Number(process.argv[3] ?? 200);

if (isMainThread) {
    if (!SHOW) {
        console.error('usage: beam-probe.mjs <showFolder> [frames]');
        process.exit(2);
    }
    const w = new Worker(new URL(import.meta.url), { workerData: { SHOW, FRAMES } });
    w.on('message', (m) => console.log(m));
    w.on('error', (e) => {
        console.error('worker error:', e);
        process.exitCode = 1;
    });
    w.on('exit', (c) => {
        if (c) process.exitCode = c;
    });
} else {
    await main(workerData.SHOW, workerData.FRAMES);
}

async function main(show, frames) {
    const log = (s) => parentPort.postMessage(s);
    const req = createRequire(path.join(REPO, 'packages/epp/package.json'));
    const { DOMParser } = req('@xmldom/xmldom');
    const xl = req('xllayoutcalcs');
    const epp = await import(pathToFileURL(path.join(REPO, 'packages/epp/dist/index.mjs')));
    const { getXlgl, xlglError } = await import(pathToFileURL(path.join(REPO, 'packages/xlgl/dist/index.js')));

    const t0 = performance.now();
    const parse = (f) => new DOMParser().parseFromString(fs.readFileSync(path.join(show, f), 'utf8'), 'text/xml');
    const xrgb = parse('xlights_rgbeffects.xml');
    const xnet = parse('xlights_networks.xml');
    xl.migrateToFormat(xrgb, 'x2026_3');
    const opts = { warnUnusedAttrs: false };
    const parsed = xl.getControllersAndModelChannels(xrgb, xnet, opts);
    const coords = new Map();
    for (const [name, m] of xl.getAllModelCoordinates(xrgb, xnet, false, opts).models) coords.set(name, m.nodeResult);
    const specs = epp.layoutSpecsFromXlights(parsed.models, coords);
    const layout = epp.compileLayout(specs, { keepWorld: true });
    const N = layout.nodeCount;
    const world = layout.world;
    if (!world) throw new Error('layout has no world coordinates');
    log(`layout: ${layout.models.length} models, ${N} nodes, loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < N; ++i)
        for (let k = 0; k < 3; ++k) {
            const v = world[i * 3 + k];
            if (v < lo[k]) lo[k] = v;
            if (v > hi[k]) hi[k] = v;
        }
    log(`extent: x ${lo[0].toFixed(0)}..${hi[0].toFixed(0)}  y ${lo[1].toFixed(0)}..${hi[1].toFixed(0)}  z ${lo[2].toFixed(0)}..${hi[2].toFixed(0)}`);

    const ctx = getXlgl();
    if (!ctx) throw new Error(`no GL: ${xlglError()}`);
    const { gl, info } = ctx;
    log(`GL: ${info.renderer} | ${info.version} | ${info.vendor}`);

    const W = Math.ceil(Math.sqrt(N));
    const H = Math.ceil(N / W);
    const VS = `#version 330 core
in vec3 pos;
uniform vec2 size;
uniform vec3 origin;
uniform vec3 dir;
uniform float halfAngle;
uniform float range;
uniform vec3 color;
out vec4 vcolor;
void main() {
    float i = float(gl_VertexID);
    float x = mod(i, size.x);
    float y = floor(i / size.x);
    gl_Position = vec4((x + 0.5) / size.x * 2.0 - 1.0, (y + 0.5) / size.y * 2.0 - 1.0, 0.0, 1.0);
    vec3 v = pos - origin;
    float d = length(v);
    float ang = acos(clamp(dot(v / max(d, 1e-6), dir), -1.0, 1.0));
    float edge = 1.0 - smoothstep(halfAngle * 0.7, halfAngle, ang);
    float fall = clamp(1.0 - d / range, 0.0, 1.0);
    vcolor = vec4(color, edge * fall);
}`;
    const FS = `#version 330 core
in vec4 vcolor;
out vec4 color;
void main() { color = vcolor; }`;
    const prog = gl.compile(VS, FS);
    const buf = gl.createBuffer(world);
    const out = new Uint8Array(W * H * 4);
    log(`target ${W}x${H} for ${N} points; vertex buffer ${(world.byteLength / 1e6).toFixed(1)} MB`);

    // The holder stands in front of the yard (xLights +z faces the viewer) and sweeps across it.
    const cx = (lo[0] + hi[0]) / 2;
    const cz = hi[2] + (hi[2] - lo[2]) * 0.3;
    const eye = lo[1] + (hi[1] - lo[1]) * 0.25;
    const range = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    const halfAngle = 0.12;
    const color = [1.0, 0.92, 0.7];
    const target = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const baseYaw = Math.atan2(target[0] - cx, -(target[2] - cz));
    const basePitch = Math.atan2(target[1] - eye, Math.hypot(target[0] - cx, target[2] - cz));
    const dirAt = (t) => {
        const yaw = baseYaw + Math.sin(t * 0.7) * 0.6;
        const pitch = basePitch + 0.1 * Math.sin(t * 1.3);
        return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    };
    const litCount = () => {
        let lit = 0;
        for (let i = 0; i < N; ++i) if (out[i * 4 + 3] > 0) ++lit;
        return lit;
    };

    const times = [];
    for (let f = 0; f < frames; ++f) {
        const dir = dirAt(f / 40);
        const s = performance.now();
        const unbound = gl.draw({
            program: prog,
            w: W,
            h: H,
            mode: 'points',
            count: N,
            clearColor: [0, 0, 0, 0],
            attribs: [{ name: 'pos', buffer: buf, size: 3 }],
            uniforms: [
                ['size', '2f', W, H],
                ['origin', '3f', cx, eye, cz],
                ['dir', '3f', ...dir],
                ['halfAngle', 'f', halfAngle],
                ['range', 'f', range],
                ['color', '3f', ...color],
            ],
            out,
        });
        times.push(performance.now() - s);
        if (f === 0 && unbound) log(`unbound uniforms: ${unbound}`);
        if (f % 50 === 0) log(`frame ${f}: ${litCount()} nodes lit`);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
    log(`draw+readback over ${frames} frames: avg ${avg.toFixed(2)} ms, p50 ${pct(0.5)}, p99 ${pct(0.99)}, max ${times[times.length - 1].toFixed(2)} ms`);

    // CPU reference for the last frame: the same math in JS, alpha within 2 LSB.
    const dir = dirAt((frames - 1) / 40);
    const s = performance.now();
    let mismatches = 0;
    let maxErr = 0;
    for (let i = 0; i < N; ++i) {
        const vx = world[i * 3] - cx;
        const vy = world[i * 3 + 1] - eye;
        const vz = world[i * 3 + 2] - cz;
        const d = Math.hypot(vx, vy, vz) || 1e-6;
        const ang = Math.acos(Math.max(-1, Math.min(1, (vx * dir[0] + vy * dir[1] + vz * dir[2]) / d)));
        const tt = Math.max(0, Math.min(1, (ang - halfAngle * 0.7) / (halfAngle * 0.3)));
        const edge = 1 - tt * tt * (3 - 2 * tt);
        const fall = Math.max(0, Math.min(1, 1 - d / range));
        const err = Math.abs(Math.round(edge * fall * 255) - out[i * 4 + 3]);
        if (err > maxErr) maxErr = err;
        if (err > 2) ++mismatches;
    }
    log(`CPU reference: ${(performance.now() - s).toFixed(1)} ms for one frame in JS; ${mismatches} nodes differ by >2 LSB, max error ${maxErr}`);
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
    log('PROBE-OK');
}
