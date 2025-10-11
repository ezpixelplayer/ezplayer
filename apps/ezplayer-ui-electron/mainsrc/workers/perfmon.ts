// perfmon.ts
import { monitorEventLoopDelay, performance, PerformanceObserver, PerformanceEntry, IntervalHistogram } from 'node:perf_hooks';
import inspector from 'node:inspector';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import async_hooks from 'node:async_hooks';
import { writeFile } from 'node:fs/promises';

//////
// GC Logging
let obs: PerformanceObserver | undefined = undefined;
export function startGCLogging(log: (l: string) => void) {
    if (obs) return;

    // Define human-readable names for GC kinds
    const GC_KINDS: Record<number, string> = {
        0: 'Unknown',
        1: 'Scavenge',
        2: 'MarkSweepCompact',
        3: 'IncrementalMarking',
        4: 'ProcessWeakCallbacks',
        8: 'EmbedderCleanup',
    };

    // Set up GC observer
    obs = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry: PerformanceEntry) => {
            if (entry.duration < 1) return;
            const dkind = entry.detail as { kind?: number } | undefined;
            const kind = dkind?.kind ? (GC_KINDS[dkind.kind] ?? `Kind ${dkind.kind}`) : `<UNKNOWN>`;
            log(`[GC] ${kind} took ${entry.duration.toFixed(2)}ms`);
        });
    });

    obs.observe({ entryTypes: ['gc'], buffered: true });
}
export function stopGCLogging() {
    if (!obs) return;
    obs.disconnect();
    obs = undefined;
}

///////
// Event loop utilization (elu)
let lastELU = performance.eventLoopUtilization();
function eluNow() {
    const now = performance.eventLoopUtilization();
    const delta = performance.eventLoopUtilization(now, lastELU);
    lastELU = now;
    return { now, delta };
}

////////
// Event loop delay
// Periodic health sampler
const LOOP_DELAY_THRESHOLD_MS = 10;   // flag if single-tick delay exceeds this
const BUSY_UTIL_THRESHOLD = 0.90;      // flag if ELU > 95%

let eldHist: IntervalHistogram | undefined = undefined;
let eldTimeout: NodeJS.Timeout | undefined = undefined;
export function startELDMonitor(log: (l: string) => void): void {
    if (eldHist) return;
    eldHist = monitorEventLoopDelay({ resolution: 10 });
    eldHist.enable();

    eldTimeout = setInterval(() => {
        const delay = Number(eldHist!.percentile(99).toFixed(1)); // p99 loop delay in ms over window
        const { now: elu } = eluNow(); // { idle, active, utilization }
        const asyncTop = snapshotAsyncCounts();

        if (delay > LOOP_DELAY_THRESHOLD_MS || elu.utilization > BUSY_UTIL_THRESHOLD) {
            log(`[STALLKIT] delay(p99)=${delay}ms, ELU=${(elu.utilization * 100).toFixed(1)}%, outstanding=${JSON.stringify(asyncTop)}`);
            captureProfile(log, `delay${delay}-elu${(elu.utilization * 100) | 0}`).catch(() => { });
        }
    }, 200);
}
export function stopELDMonitor() {
    if (eldTimeout) {
        clearInterval(eldTimeout);
        eldTimeout = undefined;
    }
    if (eldHist) {
        eldHist.disable();
        eldHist = undefined;
    }
}

///////
// Profile (from above)
let profiling = false;
let session: inspector.Session | undefined = undefined;
let tracing: import('node:trace_events').Tracing | undefined = undefined;

const PROFILE_DURATION_MS = 2000;      // capture 2s CPU profile on stall
const TRACE_CATS = ['node.perf', 'v8', 'node.async_hooks', 'node.fs', 'node.http', 'uv', 'node.worker'];

async function captureProfile(log: (msg: string) => void, tag: string) {
    if (profiling) return;
    profiling = true;

    if (!tracing) {
        try {
            const trace = require('node:trace_events') as typeof import('node:trace_events');
            tracing = trace.createTracing({ categories: TRACE_CATS });
        }
        catch (e) {
            log(`Note: Trace events are not available: ${(e as Error).message}`);
        }
    }

    if (!session) {
        session = new inspector.Session();
        session.connect();
    }
    const cpuPath = join(tmpdir(), `cpu-${tag}-${Date.now()}.cpuprofile`);
    const tracePath = join(tmpdir(), `trace-${tag}-${Date.now()}.json`);

    // Start V8 CPU profiler
    await new Promise<void>((res, rej) => {
        session!.post('Profiler.enable', () => {
            session!.post('Profiler.start', (err) => err ? rej(err) : res());
        });
    });

    // Start trace-events (writes continuously to file)
    try {
        tracing?.enable();
    }
    catch (e) {
        log(`Note: Trace events are not available: ${(e as Error).message}`);
        tracing = undefined;
    }
    const traceStream = tracing ? createWriteStream(tracePath) : undefined;

    // Route trace events to file
    (tracing as any).stream = traceStream; // supported in Node 20+; otherwise run with --trace-event-file-pattern

    setTimeout(async () => {
        // Stop profiler
        let pres: ((_v: unknown) => void) | undefined = undefined;
        let prej: ((reason: unknown) => void) | undefined = undefined;
        const ppromise = new Promise((resolve, reject) => { pres = resolve; prej = reject; })

        session!.post('Profiler.stop', async (err, { profile }) => {
            try {
                if (!err) {
                    await writeFile(cpuPath, JSON.stringify(profile));
                    log(`[STALLKIT] CPU profile saved: ${cpuPath}`);
                }
                session!.post('Profiler.disable');
                pres?.(undefined);
            }
            catch (e) { prej?.(e) }
        });
        await ppromise;

        // Stop trace
        tracing?.disable();
        traceStream?.end();
        if (tracing) log(`[STALLKIT] Trace saved: ${tracePath}`);
        profiling = false;
    }, PROFILE_DURATION_MS);
}

///////
// Async things

// Track outstanding async resources by type
let asyncCounts: Map<string, number> | undefined = undefined;
let asyncHook: async_hooks.AsyncHook | undefined = undefined;

export function startAsyncCounts() {
    if (asyncCounts) return;
    asyncCounts = new Map<string, number>();
    asyncHook = async_hooks.createHook({
        init(_asyncId, type, _triggerAsyncId, _resource) {
            asyncCounts!.set(type, (asyncCounts!.get(type) ?? 0) + 1);
        },
        destroy(_asyncId) { /* no-op: we only sample counts periodically */ }
    });
    asyncHook.enable();
}

export function stopAsyncCounts() {
    if (!asyncCounts) return;
    asyncHook?.disable();
    asyncHook = undefined;
    asyncCounts = undefined;
}

export function snapshotAsyncCounts() {
    if (!asyncCounts) return [];
    // Shallow copy to plain object for logging
    const obj = [...asyncCounts.entries()].sort((a, b) => b[1] - a[1]);
    asyncCounts = new Map(); // reset counts
    return obj;
}
