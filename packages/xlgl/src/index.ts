/**
 * @ezplayer/xlgl
 *
 * An offscreen GL 3.3 core context in process, exposed through Node-API: compile a
 * program, upload vertex buffers, draw into a w*h RGBA target and read it straight
 * back into a caller-owned array. No window, no GL headers, no import libraries:
 * glcore.h loads the system GL (WGL on Windows, EGL surfaceless on Linux) or Mesa's
 * llvmpipe for machines without a GPU.
 *
 * The native source comes from xlrender's tools/xlgl (crazts), where it runs ISF
 * shaders byte-identical to xLights. Here it evaluates overlay patterns per node:
 * one point per node, one texel per point.
 *
 * The context belongs to the thread that calls init(); release() lets another
 * thread take it. Every call is synchronous.
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface XlglInfo {
    renderer: string;
    version: string;
    vendor: string;
}
export interface XlglAttrib {
    name: string;
    buffer: number;
    /** floats per vertex (1..4) */
    size: number;
    /** bytes between vertices; 0 = tightly packed */
    stride?: number;
    offset?: number;
}
export interface XlglDraw {
    program: number;
    w: number;
    h: number;
    mode?: 'triangle_strip' | 'triangles' | 'lines' | 'line_strip' | 'points';
    first?: number;
    count?: number;
    depth?: boolean;
    /** default true */
    clear?: boolean;
    clearColor?: [number, number, number, number];
    attribs: XlglAttrib[];
    /** [name, 'i'|'f'|'2f'|'3f'|'4f'|'m4', ...values] */
    uniforms: (string | number)[][];
    /** RGBA w*h bytes bound as texture unit 0, or 128 floats for an audio texture */
    texture?: Uint8Array | Uint8ClampedArray | Float32Array | null;
    /** RGBA w*h bytes, filled bottom row first */
    out?: Uint8Array | Uint8ClampedArray;
}
export interface Xlgl {
    init(opts: { gl?: string }): XlglInfo;
    release(): void;
    /** Throws with the compiler log. */
    compile(vs: string, fs: string): number;
    deleteProgram(id: number): void;
    hasUniform(program: number, name: string): boolean;
    createBuffer(data: ArrayBufferView, dynamic?: boolean): number;
    updateBuffer(id: number, data: ArrayBufferView): void;
    deleteBuffer(id: number): void;
    /** Returns the comma-separated names of uniforms the program does not have. */
    draw(req: XlglDraw): string;
}

export interface XlglOptions {
    /** Mesa llvmpipe instead of the system GL. Default: $XLGL_SOFTWARE === '1'. */
    software?: boolean;
    /** Windows: an explicit GL DLL. Default: $XLGL_GL, or the Mesa DLL when software. */
    glDll?: string;
    /** Folder holding Mesa's opengl32.dll for the software path. Default: $XLGL_MESA, or ./mesa beside the addon. */
    mesaDir?: string;
}

let loaded: { gl: Xlgl; info: XlglInfo } | null | undefined;
let lastError: string | undefined;

const require = createRequire(import.meta.url);

/** $XLGL names an explicit addon file; otherwise the package's own build. */
function addonFile(): string {
    const explicit = process.env.XLGL;
    if (explicit && fs.existsSync(explicit)) return explicit;
    const bindings = require('bindings') as (opts: { bindings: string; path: true }) => string;
    return bindings({ bindings: 'xlgl', path: true });
}

/**
 * The GL context for this thread, created on first call. null when the addon is
 * missing or no context can be made; callers then fall back to CPU evaluation.
 */
export function getXlgl(opts: XlglOptions = {}): { gl: Xlgl; info: XlglInfo } | null {
    if (loaded !== undefined) return loaded;
    loaded = null;
    try {
        const file = addonFile();
        const gl = require(file) as Xlgl;
        const software = opts.software ?? process.env.XLGL_SOFTWARE === '1';
        let glDll = opts.glDll ?? process.env.XLGL_GL ?? '';
        if (process.platform === 'win32') {
            if (!glDll && software) {
                const mesa = path.join(opts.mesaDir ?? process.env.XLGL_MESA ?? path.join(path.dirname(file), 'mesa'), 'opengl32.dll');
                if (!fs.existsSync(mesa)) throw new Error(`software GL requested but ${mesa} is missing (see tools/get-mesa.ps1)`);
                glDll = mesa;
            }
            // Without this Mesa's WGL picks its D3D12 driver, which is still the GPU.
            if (software) process.env.GALLIUM_DRIVER = 'llvmpipe';
        } else if (software) {
            process.env.LIBGL_ALWAYS_SOFTWARE = '1';
            process.env.GALLIUM_DRIVER = 'llvmpipe';
        }
        const info = gl.init(glDll ? { gl: glDll } : {});
        loaded = { gl, info };
    } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
    }
    return loaded;
}

/** Why getXlgl() returned null, if it did. */
export function xlglError(): string | undefined {
    return lastError;
}

/** Unbinds the context from this thread; the next getXlgl() binds it again. */
export function releaseXlgl(): void {
    if (loaded) {
        loaded.gl.release();
        loaded = undefined;
    }
}
