/**
 * Pure decision helpers for renderer deaths. No Electron imports so the
 * rules are unit-testable; the Electron glue lives in gpuFallback.ts.
 */

export interface GpuFallbackInput {
    /** RenderProcessGoneDetails.reason. */
    reason: string;
    /** Seconds since the main process started. */
    uptimeS: number;
    /** A GPU process exists right now (app.getAppMetrics). */
    gpuProcessAlive: boolean;
    /** A GPU process died or failed to launch earlier in this run (child-process-gone). */
    gpuProcessFaulted: boolean;
    /** --disable-gpu is already in effect. */
    gpuAlreadyDisabled: boolean;
    /** A fallback relaunch was already requested in this run. */
    alreadyTriggered: boolean;
}

/** Renderer deaths later than this are not treated as a GPU startup failure. */
export const GPU_FALLBACK_MAX_UPTIME_S = 120;

/** Chromium starts the GPU process a few hundred ms after the first window, so
 *  "no GPU process" is re-checked after this delay before it is believed. */
export const GPU_FALLBACK_RECHECK_MS = 1500;

// Reasons that are faults. 'oom', 'killed' and 'clean-exit' are not GPU problems.
const FAULT_REASONS = new Set(['crashed', 'abnormal-exit', 'launch-failed', 'integrity-failure']);

/**
 * True when a renderer death should trigger the one-time software-rendering
 * relaunch: a renderer fault early in the run while no GPU process is alive, or
 * after the GPU process itself has died.
 */
export function shouldFallbackToSoftwareGpu(input: GpuFallbackInput): boolean {
    if (input.alreadyTriggered || input.gpuAlreadyDisabled) return false;
    if (!FAULT_REASONS.has(input.reason)) return false;
    if (input.uptimeS > GPU_FALLBACK_MAX_UPTIME_S) return false;
    return input.gpuProcessFaulted || !input.gpuProcessAlive;
}

export type GpuMode = 'hardware' | 'software';

/**
 * Chromium switches for the software-rendering mode, as [name, value?].
 * --disable-gpu alone leaves Linux with no WebGL (Windows still gets WARP);
 * forcing ANGLE onto the bundled SwiftShader keeps WebGL working at a few FPS.
 * Verified on Electron 41.10.7: the WebGL renderer reports "SwiftShader Device".
 */
export const SOFTWARE_GL_SWITCHES: ReadonlyArray<readonly [string, string?]> = [
    ['disable-gpu'],
    ['use-gl', 'angle'],
    ['use-angle', 'swiftshader'],
    ['enable-unsafe-swiftshader'],
];

/** EZP_GPU: 'hardware' retries the GPU and clears a saved fallback; 'software' forces software rendering. */
export function parseGpuModeEnv(value: string | undefined): GpuMode | undefined {
    const v = value?.trim().toLowerCase();
    if (v === 'hardware' || v === 'hw' || v === 'gpu') return 'hardware';
    if (v === 'software' || v === 'sw' || v === 'none') return 'software';
    return undefined;
}

const POSIX_SIGNALS: Record<number, string> = {
    1: 'SIGHUP',
    2: 'SIGINT',
    3: 'SIGQUIT',
    4: 'SIGILL',
    5: 'SIGTRAP',
    6: 'SIGABRT',
    7: 'SIGBUS',
    8: 'SIGFPE',
    9: 'SIGKILL',
    11: 'SIGSEGV',
    13: 'SIGPIPE',
    15: 'SIGTERM',
    31: 'SIGSYS',
};

/**
 * Human-readable form of RenderProcessGoneDetails.exitCode. On POSIX Electron
 * passes the raw waitpid status: low 7 bits are the signal, bit 7 the core-dump
 * flag, and a normal exit code sits in bits 8-15, so 4 and 132 are both SIGILL,
 * without and with a core file. Windows codes are NTSTATUS values.
 */
export function describeExitCode(exitCode: number, platform: NodeJS.Platform = process.platform): string {
    if (platform === 'win32') {
        return `0x${(exitCode >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
    }
    const status = exitCode >>> 0;
    const sig = status & 0x7f;
    if (sig !== 0 && status <= 0xff) {
        const name = POSIX_SIGNALS[sig] ?? `signal ${sig}`;
        return status & 0x80 ? `${name}, core dumped` : name;
    }
    return `exit ${(status >> 8) & 0xff}`;
}
