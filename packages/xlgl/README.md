# @ezplayer/xlgl

An offscreen OpenGL 3.3 core context inside the Node process, as a Node-API addon.
The player uses it to evaluate overlay patterns on the GPU: every node of the layout
is one point, every point lands on its own texel, and the texels read back as one
RGBA color per node. There is no window and no copy through another process; a draw
is a synchronous call that fills a caller-owned array.

The native source (`src/glcore.h`, `src/xlgl.cpp`) comes from xlrender's `tools/xlgl`
in the crazts repo, where it runs xLights ISF shaders byte-identical to the desktop.
It loads GL dynamically with no headers or import libraries: WGL from `opengl32.dll`
on Windows, EGL surfaceless on Linux. Both repos are AGPL-3.0-only.

```ts
import { getXlgl } from '@ezplayer/xlgl';

const ctx = getXlgl();                     // null when no GL context can be made
if (ctx) {
    const { gl, info } = ctx;              // info.renderer names the GPU or llvmpipe
    const prog = gl.compile(vertexSrc, fragmentSrc);   // throws with the compiler log
    const pos = gl.createBuffer(new Float32Array([...]));
    const out = new Uint8Array(w * h * 4);
    gl.draw({ program: prog, w, h, mode: 'points', count: nodes,
              attribs: [{ name: 'pos', buffer: pos, size: 3 }],
              uniforms: [['t', 'f', seconds], ['color', '3f', 1, 0.9, 0.7]],
              out });
}
```

`draw` returns the names of uniforms the program does not have instead of failing.
`depth: true` adds a depth buffer; modes are `points`, `lines`, `line_strip`,
`triangles`, `triangle_strip`; uniform kinds `i`, `f`, `2f`, `3f`, `4f`, `m4`.
The read-back fills the bottom row first, like `glReadPixels`.

## Threads

The context belongs to the thread that first calls `getXlgl()`. The pixel pipeline
worker owns it in the player. `releaseXlgl()` unbinds it so another thread can take
over.

## Software GL

`XLGL_SOFTWARE=1` (or `getXlgl({ software: true })`) selects Mesa llvmpipe for a machine
without a usable GPU. Linux needs `libegl1`, `libgl1` and `libgl1-mesa-dri` at run time
and no X server. Windows needs Mesa's `opengl32.dll` and `libgallium_wgl.dll` in a `mesa`
folder beside the addon (or `$XLGL_MESA`); `tools/get-mesa.ps1` fetches them from the
mesa-dist-win release. The folder is git-ignored.

GL is not bit-exact across implementations: llvmpipe and a GPU differ by up to one
LSB, which the overlay blend does not care about.

## Building

`pnpm install` runs `node-gyp rebuild` like the other native package here (needs a C++
toolchain and Python 3 for node-gyp). The addon lands in `build/Release/xlgl.node` and is
loaded through `bindings`; `$XLGL=<file>` overrides it.
