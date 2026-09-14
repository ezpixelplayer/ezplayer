# Pixel Output Pipeline Redesign

Status: proposal (2026-09-13). Scope: everything between "bytes on disk" and "bytes on the wire / in the preview", plus the hooks that later features hang off.

## 1. Where we are

The current path lives in `FSeqPrefetchCache`, `FrameSender` (`framesend.ts`), `SendJob`/`DDPSender`/`E131Sender`, and `LatestFrameRingBuffer`.

```
fseq chunk --zstd worker--> dense channel-space chunk (scatter plan applied)
                                  |
   background fseq (same path) ---+--> maxUint8 into mixFrame
                                  |
                                  +--> exportRing.publishFrom (copy, 4 slots, SAB)
                                  |
                                  +--> SendJob.dataBuffers = [frame]; per-sender parts
                                       (bufStart = startCh-1, bufLen = nCh) -> packets
```

What it does well: the prefetch cache with tiers and budgets, the sparse scatter plan at decode time, the per-sender heap pacer, the SAB ring buffer for previews, buffer pools for decode.

What locks us in:

- The **frame format is xLights channel space**. Color order, gamma, and brightness are whatever the render baked in, and the preview has to undo that per point using `channelRoles`. Every consumer re-derives model structure from channel numbers.
- The **input file and the layout are the same thing**. A layout change means every fseq is wrong.
- **Black frames are a second code path** (`sendBlackFrame`) that never reaches the preview, and pause/idle/lead-pad each hit it differently.
- **Blend is one function** (`maxUint8`) with no place to add a second layer, a brightness knob, or an overlay.
- **The send holds the dispatch loop.** Pacing only works by spending the loop's own time, which is why it fought prefetch and decode (see the pacing note in memory).
- Controller FPS caps are "skip the frame", with no way to fold the skipped frame into the next one.
- E1.31 assumes one universe size and consecutive universes.

## 2. Target shape

```
             Ingest (ahead of time, parallel)
 fseq / other file / live input
   -> decode -> Input Map (scatter + canonicalize) -> canonical chunks in cache
                                                          |
 Conductor (schedule, run states, timing)                 v
   picks frame slot, snapshots params, submits  --->  Compose workers (N, split by node range)
                                                      stages: sources, blends, adjust, overlays,
                                                      effects, test modes  -> canonical frame (SAB)
                                                          |
                                     +--------------------+--------------------+
                                     v                    v                    v
                              Output worker(s)      Preview readers       Window outputs
                              Output Map: encode    (electron, LAN,      (HDMI / virtual
                              gamma/brightness/     cloud) read RGB8      matrix) read the
                              color order/RGBW/     by node index         matrix run as a
                              port map -> packets                         texture
```

Three compiled artifacts define a running pipeline. All three are immutable once built:

| Artifact | Built from | Changes when |
|---|---|---|
| **Display Layout** | `xlights_rgbeffects.xml` via `xllayoutcalcs` | models, nodes, or geometry change |
| **Input Map** (one per source file) | the file's own channel descriptor plus the Display Layout | a new file is seen, or the layout changes |
| **Output Map** (one per output) | `xlights_networks.xml`, controller records, port overrides, per-controller policy | wiring, port map, or gamma policy changes |

Between Input Map and Output Map sits the **canonical frame**. Everything creative happens there.

## 3. Design question 1: the intermediate format

**Decision: 8-bit interleaved RGB per node, in Display Layout node order, plus a raw-channel region for non-pixel data. One `SharedArrayBuffer` per frame slot. The pixel stride (3 or 4 bytes) and the meaning of the fourth byte are a pipeline-global choice recorded in the header; RGB8 is the default.**

### Frame slot layout

```
[ header: 64 bytes, Int32 fields, atomics ]
[ pixel region: nodeCount * 3 bytes, RGB RGB RGB ... ]
[ raw region:   rawChannelCount bytes ]
```

- **Node order** is decided by the Display Layout compiler, not by channel number. Models are contiguous. Matrices and trees are stored row-major, bottom row first, left to right, matching `bufX`/`bufY` from `xllayoutcalcs`, so a matrix's run is directly a texture and directly an xlrender `RenderBuffer` target. Each model run starts on a 16-byte boundary (WASM SIMD width). Padding is at most 15 bytes per model.
- **Color is always RGB**, regardless of string type. Ingest decodes `channelRoles` (red/green/blue/white/warmWhite/intensity/tint/unused) into RGB. Output encodes back to whatever the port wants (GRB, RGBW, single-color intensity). This is what lets the preview, HDMI output, overlays, and effects all speak one language.
- **Values are renderer intent**: what xLights would write with gamma 1.0 and brightness 100. Brightness and gamma are applied on the way out. This matches how controllers treat 8-bit input today, so an unmodified show gives byte-identical wire output once the controller-side policy is set to "controller applies gamma" (see section 7).
- **Raw region** carries DMX fixtures, moving heads, serial, and any fseq channel span not owned by a pixel model. Those bytes pass through untouched, which is what keeps controller output byte-exact for the parts of the display we do not interpret. Moving-head effects can address the raw region later using `mhChannelsToState`.

### RGB8 or RGBX8

A fourth byte per node buys 32-bit node alignment (four nodes per WASM SIMD register, `Uint32` copies), a direct RGBA8 texture upload, and a place to carry one extra per-node value. It costs a third more memory and bandwidth on every pass, for a byte most stages never read. Neither side wins on paper, so the format is not baked in:

- The header carries `pixelStride` (3 or 4) and `xMeaning` (none, alpha, white, priority). Both are fixed for the life of a pipeline; changing them is a structural change like any other.
- Every kernel takes the stride as a parameter. Inner loops cost the same either way, and the stride-4 path can take the `Uint32` route where it helps. Readers get the stride from the header.
- Layers are always RGBA. Alpha is a property of a source (an overlay with transparent regions, an effect sequence, xlrender's `RenderBuffer`), not of the composited frame, which has nothing behind it. So RGBX with `alpha` is only worth choosing when a downstream consumer wants coverage, for instance an underlay blend that fills unpainted nodes rather than black ones.
- `white` keeps W from RGBW files intact through the pipeline instead of folding it on ingest, and hands it to the encoder for RGBW ports. It removes the lossy round trip listed in the open questions for shows that opt in.
- `priority` is an owner byte: a stage that claims a node (a test mode on one model, an exclusive overlay lease) writes its rank, and later stages with lower rank leave the node alone. This is the per-node Z order reading of the fourth byte.

Ship RGB8, keep the stride parametric from the first kernel, and decide per show once the SIMD kernels exist to measure against.

### Why 8-bit and not 16-bit or float

The bandwidth target (3 GB/s of channels) is already the whole story at 8 bits. Sixteen bits doubles every pass and every cache. xLights renders 8-bit, controllers take 8-bit, and the only precision loss we introduce is in blending and in inverting baked gamma on legacy files, both of which are bounded and both of which are visible today too. Effects that need precision keep private float scratch and quantize when they composite. The header carries a format version so a region could be widened later without touching readers that check the version.

### Why interleaved and not planar

Interleaved matches the wire (DDP and E1.31 RGB nodes), the preview (a single RGB8 attribute upload), texture upload, and the existing JS loops. Planar would help SIMD lane packing but nothing else, and the kernels that matter (LUT, blend, copy) are fine interleaved.

### Frame header (Int32 indices)

```
0 magic        1 formatVersion   2 layoutVersion   3 pipelineId
4 seq          5 frameNumber     6 sourceStamp     7 state
8 refcount     9 timeLo         10 timeHi         11 nodeCount
12 rawCount   13 paramsSlot     14 pixelStride    15 xMeaning
```

`refcount` is an atomic. `state` is FREE, COMPOSING, READY, or RETIRING. The pool control block (a separate small SAB) holds `latestSlot` and `latestSeq`, which is exactly the contract `LatestFrameRingBuffer` readers already use, so previews keep their `tryReadLatest` loop.

### Layout manifest

A JSON document, versioned by `layoutVersion`, that readers fetch once: model name, node range, matrix width and height, channelsPerNode on the wire, and a `Float32Array` of world coordinates parallel to node order (`wX`, `wY`, `wZ` from `NodeCoord`). The coordinate array is what makes 3D coordinate shaders (10f) a per-node kernel instead of a geometry problem.

## 4. Design question 2: locking a file's translation

**Decision: every source file gets a pinned channel descriptor. The Input Map is compiled from (descriptor, layout) and applied inside the ingest worker, so the play-time cost is zero and a layout change cannot silently corrupt old renders.**

### The channel descriptor

Per model: name, 0-based start channel, node count, channels per node, channel roles, and the gamma and brightness the renderer baked in (normally 1.0 and 100). Plus total channels and a hash. This is exactly `XlModelChannelInfo` minus the controller fields.

Sources, in priority order:

1. **An fseq variable header.** FSEQ v2 already carries key/value headers (`mf`, `sp`). We define one, say `EZ`, holding the descriptor as compressed JSON. xlrender can write it today. xLights cannot, until someone adds it upstream.
2. **A sidecar** `<file>.fseq.ezmap.json` next to the file.
3. **Pin on first sight.** When a file with neither is first seen, snapshot the descriptor derived from the current `rgbeffects` into the show's map registry, keyed by file path, size, mtime, and the v2 header UUID. That file is then locked to that descriptor until the user re-pins it. This gives feature 1 with no format change at all and is the default path for every existing show.

### Compiling the Input Map

The compiler walks the descriptor's models and the layout's models by name:

| Case | Action |
|---|---|
| Same name, same node count, same roles | one run: copy with permute (roles to RGB) |
| Same name, node count differs | truncate or zero-fill, warn once; matrices may later get nearest-neighbor resample |
| In file, not in layout | dropped, logged |
| In layout, not in file | nodes stay black; an underlay background fills them naturally |
| Channels owned by no model | raw span, copied through |

Runs with identical kind and adjacent addresses merge. The output is a flat typed-array program: `srcOffset, dstOffset, count, kind, lutId`. Decode kinds: RGB permute (three offsets), RGBW to RGB (drop or fold W by policy), intensity to RGB (value times tint), raw copy. Legacy files with baked gamma get an inverse LUT per model, flagged as lossy in stats.

The Input Map is applied in the existing zstd worker pool right after decompression, replacing `scatterChunk`. The cache key for a chunk gains the Input Map id, so a layout change invalidates cached chunks without any special handling. Chunks in the cache are already canonical frames. The FSEQ-specific code shrinks to header parsing, chunk index, and decompress, behind a `FrameSource` interface: `describe()` returns frame count, ms per frame, and the descriptor; `fetchChunk(range)` returns canonical frames. A second file format, or a live input, implements the same interface. Feature 2 is a new `FrameSource`, not a new pipeline.

## 5. Design question 3: pipeline changes

**Decision: structural changes recompile and version; parametric changes double-buffer. A frame captures both at creation and carries them to the end.**

- **Structural**: layout, input maps, output maps, the stage list itself, frame pool geometry. Compiled off the hot path (pure data, can run in a worker). The conductor swaps the "current pipeline" pointer between frames. The old pipeline holds a refcount of in-flight frames and is released, buffers and all, when that hits zero. No frame ever sees two versions.
- **Parametric**: brightness values and schedules, blend mode and opacity per layer, overlay lease state, effect parameters from an API or MIDI. These live in a params block (typed arrays in a SAB) that the conductor writes into the inactive half and flips at frame start. The frame header's `paramsSlot` says which half it used. No recompile, no allocation.

The line between the two: if it changes the size or order of any buffer, or the list of kernels to run, it is structural. Everything else is a parameter. Moving a prop to another port is structural (Output Map recompiles in milliseconds). Dimming the whole show is parametric.

## 6. Threads, frames in flight, and failure modes

### Threads

| Thread | Today | Proposed |
|---|---|---|
| Conductor | `playbackmaster` does everything | schedule, run states, prefetch planning, frame timing, stats. Never touches pixels. |
| Ingest pool | 4 zstd workers | same pool; now also applies Input Maps |
| Compose pool | none (mix on conductor) | new; N workers, each owns a node-range partition |
| Output workers | none (send on conductor) | new; one per NIC or sender group, owns its sockets and the pacer |
| Preview readers | electron, server worker | unchanged contract, new format |

Compose workers block on `Atomics.wait` for a job counter, so they cost nothing idle. Output workers need their event loop for `dgram` callbacks, so they use `Atomics.waitAsync` with a short spin at the end, the same shape as `xbusySleep` today. All inter-thread data goes through SABs; `postMessage` is for control only (pipeline swap, params flip, shutdown).

### Frame lifecycle

1. Conductor takes a FREE slot, sets `pipelineId`, `paramsSlot`, `frameNumber`, and posts a compose job with the input references (canonical chunk views from the ingest cache, overlay layer refs).
2. Compose workers run the stage list over their partitions with a barrier between stages. Last worker out marks READY, sets `latestSlot`, bumps `latestSeq`, notifies.
3. Output workers take READY frames at their own cadence. Each holds a refcount while encoding and sending. Preview readers do not hold refs; the pool never recycles the current `latestSlot`.
4. When refcount is zero and the slot is not latest, it is FREE again.

Pool size: latest plus one composing plus one per output worker plus slack. Eight slots is plenty; at 10M pixels that is 240 MB, at a 50k-pixel show it is 1.2 MB.

### Degradation

- Compose of frame N still running when N+1 is due: skip N+1, count `composeOverrun`. Outputs keep sending N. The old frame is reused rather than a stale mix being produced.
- An output worker still sending N when N+1 becomes READY: that output skips N+1, counts it, and moves to the newest READY frame when free. This is the existing `isCurrentlySending` rule, now per output worker instead of per loop iteration.
- No FREE slot: skip compose, count `poolExhausted`. This is the observable form of "something is holding frames too long".
- An ingest chunk not ready: the source stage writes black for that source (or leaves the underlay), counts `missedSourceFrame`. This replaces `missedFramesCumulative` and the lead-pad special case.

All counters live in a stats SAB so the conductor reads them without messages.

### Black, idle, pause, and controller FPS

Black is the compositor with no sources. Idle, pause, lead and trail pads, and shutdown all produce ordinary frames at the idle cadence, go through the output workers, and appear in every preview. `sendBlackFrame` goes away.

Per-controller minimum frame time moves into the output worker. When a controller's cadence means frame N is skipped, the worker keeps a ref to N and the encode kernel for N+1 can take `max` or an average with N per node before sending. This is feature 8's "blend the suppressed frame into the next one" and it costs one extra ref, not a copy.

## 7. Output Map

The Output Map is a compiled program per output. For each output it produces one contiguous wire buffer in the output's own address space, so packetization stays the existing `parts` slicing in `DDPSender` and `E131Sender`.

Segment fields: `dstOffset, srcNodeStart, nodeCount, encodeKind, lutId, colorPerm, groupCount, nullBefore, nullAfter, indexTableId`. Encode kinds: RGB permute, RGB to RGBW (policy: none, min-channel extraction, color-temperature model), RGB to single-color intensity (dot with tint), raw copy. Reverse and zig-zag use an index table. `groupCount` repeats a node. `lutId` picks one 256-entry table per (gamma, brightness) pair; per-channel dimming curves get three tables.

Inputs to the compiler: `XlControllerInfo` and `XlModelChannelInfo` (controller name, port, `modelChain`, string start channels, `controllerConnection` brightness/gamma/colorOrder/nulls/grouping/reverse/zigZag), the EZP controller records, and a new **port override** table: model or string to (controller, port, position, smart remote). This is feature 3. Splitting a prop across ports is two overrides with node ranges.

**Gamma policy per controller** (feature 4): `controller` means the wire carries renderer intent and the controller applies its own curve, which is today's behavior and the default for existing shows. `player` means the Output Map applies brightness and gamma and the controller must be set to gamma 1.0, brightness 100, RGB order. The controller-ops upload path already knows how to set those, so switching a controller to `player` mode can reconcile it in the same step. Absolute addressing (`keepChannelNumbers`, FPP proxy) is just `dstOffset` math.

Two outputs are not sockets:

- **Legacy channel-space export.** An output whose wire buffer is xLights channel space with `controller` policy everywhere. During migration this feeds the existing ring buffer consumers unchanged, and it is also the byte-exact regression oracle: same fseq, same bytes, old path versus new.
- **Window output.** An output whose "wire" is a rectangle of a matrix run handed to a renderer-process window as a texture, full screen on a chosen display. That is feature 6 and virtual-matrix controllers with one mechanism.

## 8. The compositor

A stage list (later a DAG) run per frame. Stages read the frame, private layer buffers, or external inputs, and write the frame or a layer. Targets are the whole display, a model, a group, a submodel, a node range, or "nodes with world coords in this region".

| Kind | Examples | Feature |
|---|---|---|
| Source | foreground sequence, background sequence, effect sequence triggered at a time, overlay lease, generated effect, test pattern | 9, 10c, 10d, 10e, 11 |
| Blend | max (today), replace, underlay (only where the frame is black), add, subtract, multiply, screen, alpha with opacity | 9 |
| Adjust | brightness global and per model with schedules, dynamic gamma indexed to the brightest channel, warm-white and RGBW color temperature | 7, 10a, 10b |
| Coordinate | kernel over (wX, wY, wZ, t, params) per node: noise textures, shockwaves, beam highlight | 10f |
| Override | test modes that replace everything downstream of a point | 11 |

Every kernel has the signature "run over nodes [start, end) of frame F with params P", which is what makes the compose pool's partitioning trivial and what lets a kernel be swapped from TypeScript to WASM SIMD or a native addon without touching the stage list. The app already builds native addons, so that path exists.

### Reusing xlrender

xlrender's effects render into a `RenderBuffer` (RGBA, width by height, row 0 at the bottom) whose node mapping comes from the same `xllayoutcalcs` coordinates the layout compiler uses. An effect stage runs an xlrender effect into a per-model `RenderBuffer` and a buffer-to-nodes kernel composites it into the model's run. The parts of xlrender that need refactoring are the module-level context registries in `effects/context.ts`; the effect functions themselves are already pure over a buffer and settings. Shader effects are unattainable in Node (xlrender's own conclusion), which is why the next item exists.

### External producers and the GPU

An **overlay lease** is the single mechanism for anything that produces pixels outside the compose pool: an HTTP call opens a lease on a target (model, submodel, group, or the whole display) with a format (RGB8 grid of w by h, or a node list), a blend mode, opacity, and a TTL. It returns a lease id and a UDP port or WebSocket. Frames arrive as DDP-shaped packets with lease id, sequence, and optional zstd, into a double-buffered layer. The compositor samples the latest complete layer each frame and holds it until the TTL lapses. That serves a Tetris on another machine, a MIDI-driven effect patch, whole-display input, and a shader host: an Electron renderer window running WebGL against the layout manifest and writing its result back through a lease. The GPU stays out of the core path and the core path stays testable without one.

## 9. Previews and the ring buffer

The frame pool **is** the ring buffer. `LatestFrameRingBuffer` readers keep `tryReadLatest` and gain `layoutVersion`; on a mismatch they refetch the manifest. The 3D preview's per-point `colorMix` loop becomes "point i reads node n at bytes 3n..3n+2", and since the whole node region is one contiguous RGB8 array it can be uploaded as a single attribute buffer instead of scanned per point. The LAN and cloud endpoints keep their 8-byte header and add the layout version. A matrix is available as a texture rectangle for the "flat with texture" presentation. The legacy channel-space output keeps old clients working until they move.

## 10. Performance

Passes per frame in the steady state: ingest copy (ahead of time), one composite pass per active stage, one encode pass per output. A plain show is about three passes over the pixel region.

| Target | Pixels/s | Bytes/s per pass | Realistic host |
|---|---|---|---|
| Pi 5 | 10 M | 30 MB | 2 compose workers, 1 output worker, TypeScript kernels |
| Laptop | 30 M | 90 MB | 4 compose workers, 1 output worker, TypeScript kernels |
| Big PC | 1 G | 3 GB | 8 to 16 compose workers, 3 output workers, WASM SIMD or native kernels |

Plain TypeScript loops over `Uint8Array` reach roughly 1 to 2 GB/s per core for copy and max, and about a third of that for LUT-heavy encode. The Pi and laptop targets fit in TypeScript. The 1 GPix/s target does not: three passes at 3 GB/s each across 16 cores needs the encode and blend kernels in WASM SIMD or native code, and it needs the output workers to hand the kernel-produced wire buffers to sockets without further copying. The design does not prevent that; it also does not deliver it for free. Say so in the tracking issue.

Allocation discipline, all checked by a test that runs a thousand frames and asserts heap size and external memory are flat:

- Frame slots, layer buffers, params blocks, stats, and wire buffers are allocated at pipeline compile.
- Job descriptors are a preallocated ring of typed arrays.
- Kernels take offsets and lengths, never allocate views per frame.
- The ingest cache keeps its pools and budgets; canonical chunks are the same size class as dense chunks today.

## 11. Delivery plan

Each phase ships on its own and is verified with the integration harness's mock controller, which already checks DDP bytes at the receiver.

**Phase 0: pool and threads, same format.** Replace `mixFrame`, `blackFrame`, and `exportRing` with a frame pool of SAB slots still in channel space. Black becomes a frame. Move sending to an output worker. Verify: byte-identical wire output; pacing on with no frame loss on the production show (the thing that failed twice before).

**Phase 1: canonical format.** Display Layout compiler, Input Map in the ingest worker, descriptor pinning, legacy channel-space output feeding the old preview consumers, new preview format behind a flag. Verify: byte-identical wire output through the legacy output; preview shows the same colors.

**Phase 2: compositor.** Stage list, compose pool, blend modes, brightness and schedules, controller-FPS fold, test patterns in previews. Verify: `max` blend matches today's `maxUint8` exactly; overrun counters behave under a forced slow kernel.

**Phase 3: output side.** Gamma and brightness in the Output Map, RGBW and single-color encode, port overrides, per-controller policy with controller reconcile. Verify: a controller set to `player` policy and gamma 1.0 lights identically to the same controller in `controller` policy.

**Phase 4: effects.** Overlay leases and the UDP feed, effect sequences, dynamic gamma and white modes, coordinate kernels, then the xlrender effect stage and the renderer-hosted shader producer. Effect rendering stays on the list; it is last within the phase because every earlier item is a smaller kernel with a clearer test.

**Phase 5: sources.** A canonical sequence format designed for random access and per-model chunking, whole-display input as a `FrameSource`, audio-overlay hooks alongside effect sequences.

## 12. Open questions

- **Descriptor in the fseq header.** Which two-letter key, and will xLights upstream accept writing it. The sidecar and pin-on-first-sight paths do not depend on the answer.
- **RGBW and single-color round trips are lossy by construction** under RGB8. Policy defaults need choosing: fold W into RGB on ingest or drop it; extract W as min(R,G,B) on output or use the temperature model. RGBX8 with `white` sidesteps it for shows that opt in.
- **Legacy baked gamma.** Inverting a 2.2 curve in 8 bits crushes the low end. We should surface this per file rather than hide it.
- **Compose partition balance.** Static partition by node count is simple; an effect stage that owns a 500k-pixel matrix on one worker will be the long pole. A work-stealing split of large models across workers is the fix if it shows up.
- **E1.31 with mixed universe sizes** is a prerequisite for Output Map segments landing at exact universe boundaries. It is a contained fix in `E131Sender` and should go in Phase 0.
- **Renderer-process SAB access** for the window output and shader producer. The 3D preview already reads a SAB in the renderer, so cross-origin isolation is set; the window output needs the same wiring.
