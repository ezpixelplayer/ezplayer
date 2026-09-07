/**
 * Environment snapshot attached to every diagnostics report, so a crash row
 * in the cloud can answer "which distro / kernel / Pi model / how much RAM /
 * which GPU and is it software-rendered / X11 or Wayland / AppImage or deb"
 * without a support round-trip.
 *
 * Everything here is best-effort and never throws. The static half is
 * collected once and cached. GPU info is async (it round-trips to the GPU
 * process), so it is pre-warmed after app ready via `primeDiagEnv()` and a
 * report simply uses whatever has arrived by then — a crash path must not
 * wait on a GPU process that may be the thing that just died.
 *
 * Keep the JSON well under the cloud's 4096-char `env` cap.
 */

import { app, screen } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import { isHeadless } from './earlycli.js';

export interface DiagEnvOs {
    /** process.platform (linux/win32/darwin). */
    platform: string;
    /** Kernel release, e.g. "6.8.0-45-generic" / "10.0.26100". */
    release: string;
    /** os.version(), e.g. "#45-Ubuntu SMP ..." / "Windows 11 Pro". */
    version?: string;
    /** Kernel machine type, e.g. "x86_64" / "aarch64" / "armv7l". */
    machine?: string;
    /** Linux /etc/os-release PRETTY_NAME, e.g. "Ubuntu 24.04.1 LTS". */
    distro?: string;
    distroId?: string;
    distroVersion?: string;
    /** /proc/device-tree/model, e.g. "Raspberry Pi 4 Model B Rev 1.4". */
    model?: string;
}

export interface DiagEnvHw {
    /** process.arch — the app build's arch (x64/arm64/arm). */
    arch: string;
    cpu?: string;
    cores?: number;
    totalMemMB: number;
}

export interface DiagEnvPkg {
    packaged: boolean;
    appimage?: boolean;
    snap?: boolean;
    flatpak?: boolean;
    node: string;
    chrome: string;
}

export interface DiagEnvSession {
    headless: boolean;
    /** XDG_SESSION_TYPE: x11 / wayland / tty. */
    type?: string;
    desktop?: string;
    wayland?: boolean;
    display?: boolean;
    ozone?: string;
}

export interface DiagEnvGpuDevice {
    vendorId?: number;
    deviceId?: number;
    driverVendor?: string;
    driverVersion?: string;
    active?: boolean;
}

export interface DiagEnvGpu {
    /** --disable-gpu in effect (headless on Linux sets it). */
    disabled: boolean;
    /** Subset of app.getGPUFeatureStatus(); "enabled" / "disabled_software" etc. */
    features?: Record<string, string>;
    /** From getGPUInfo('complete').auxAttributes — "llvmpipe" means software rendering. */
    glRenderer?: string;
    glVendor?: string;
    glVersion?: string;
    devices?: DiagEnvGpuDevice[];
    /** 'complete' | 'basic' | 'pending' | 'failed'. */
    info: string;
}

export interface DiagEnvSnapshot {
    os: DiagEnvOs;
    hw: DiagEnvHw;
    pkg: DiagEnvPkg;
    session: DiagEnvSession;
    gpu: DiagEnvGpu;
    /** "1920x1080@1" per display; empty when headless / before ready. */
    displays?: string[];
    /** Per-report dynamics. */
    now: {
        uptimeS: number;
        rssMB: number;
        freeMemMB: number;
        loadavg?: number[];
        /** Count of native minidumps sitting in the local crashDumps dir. */
        minidumps?: number;
        /** Last periodic app.getAppMetrics() sample (renderer/GPU memory).
         *  Sampled, not live: by the time render-process-gone fires the
         *  renderer is gone, so this is the only pre-crash memory view. */
        procs?: DiagEnvProc[];
        procsAgeS?: number;
    };
}

export interface DiagEnvProc {
    /** Browser / Tab / GPU / Utility. */
    type: string;
    name?: string;
    /** Working set (RSS) in MB. */
    rssMB: number;
    /** Peak working set in MB; Windows only. */
    peakMB?: number;
    cpu?: number;
}

const METRICS_INTERVAL_MS = 60_000;
let lastMetrics: { at: number; procs: DiagEnvProc[] } | undefined;
let metricsTimer: NodeJS.Timeout | undefined;

function sampleMetrics(): void {
    try {
        const procs = app
            .getAppMetrics()
            .filter((p) => p.type === 'Browser' || p.type === 'Tab' || p.type === 'GPU' || p.type === 'Utility')
            .slice(0, 8)
            .map((p) => ({
                type: p.type,
                name: p.name?.slice(0, 24),
                rssMB: Math.round(p.memory.workingSetSize / 1024),
                ...(p.memory.peakWorkingSetSize ? { peakMB: Math.round(p.memory.peakWorkingSetSize / 1024) } : {}),
                cpu: Math.round(p.cpu.percentCPUUsage * 10) / 10,
            }));
        lastMetrics = { at: Date.now(), procs };
    } catch {
        /* keep the previous sample */
    }
}

function readOsRelease(): Pick<DiagEnvOs, 'distro' | 'distroId' | 'distroVersion'> {
    if (process.platform !== 'linux') return {};
    try {
        const out: Record<string, string> = {};
        for (const line of fs.readFileSync('/etc/os-release', 'utf8').split('\n')) {
            const eq = line.indexOf('=');
            if (eq <= 0) continue;
            const k = line.slice(0, eq).trim();
            let v = line.slice(eq + 1).trim();
            if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
            out[k] = v;
        }
        return {
            distro: out.PRETTY_NAME?.slice(0, 96),
            distroId: out.ID?.slice(0, 32),
            distroVersion: out.VERSION_ID?.slice(0, 32),
        };
    } catch {
        return {};
    }
}

function readDeviceModel(): string | undefined {
    if (process.platform !== 'linux') return undefined;
    try {
        // NUL-terminated string from the device tree.
        return fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim().slice(0, 96) || undefined;
    } catch {
        return undefined;
    }
}

function collectStatic(): Omit<DiagEnvSnapshot, 'gpu' | 'displays' | 'now'> {
    const cpus = (() => {
        try {
            return os.cpus();
        } catch {
            return [];
        }
    })();
    const env = process.env;
    return {
        os: {
            platform: process.platform,
            release: os.release(),
            version: (() => {
                try {
                    return os.version().slice(0, 96);
                } catch {
                    return undefined;
                }
            })(),
            machine: typeof os.machine === 'function' ? os.machine() : undefined,
            ...readOsRelease(),
            model: readDeviceModel(),
        },
        hw: {
            arch: process.arch,
            cpu: cpus[0]?.model?.trim().slice(0, 64),
            cores: cpus.length || undefined,
            totalMemMB: Math.round(os.totalmem() / 1048576),
        },
        pkg: {
            packaged: app.isPackaged,
            ...(process.platform === 'linux'
                ? { appimage: !!env.APPIMAGE, snap: !!env.SNAP, flatpak: !!env.FLATPAK_ID }
                : {}),
            node: process.versions.node,
            chrome: process.versions.chrome,
        },
        session: {
            headless: isHeadless(),
            ...(process.platform === 'linux'
                ? {
                      type: env.XDG_SESSION_TYPE?.slice(0, 16),
                      desktop: env.XDG_CURRENT_DESKTOP?.slice(0, 32),
                      wayland: !!env.WAYLAND_DISPLAY,
                      display: !!env.DISPLAY,
                      ozone: app.commandLine.getSwitchValue('ozone-platform') || undefined,
                  }
                : {}),
        },
    };
}

let staticPart: ReturnType<typeof collectStatic> | undefined;
let gpuPart: DiagEnvGpu = { disabled: false, info: 'pending' };
let primed = false;

const GPU_FEATURE_KEYS = ['gpu_compositing', 'opengl', 'webgl', 'webgl2', 'video_decode', '2d_canvas', 'rasterization'];

function gpuFeatures(): Record<string, string> | undefined {
    if (!app.isReady()) return undefined;
    try {
        const all = app.getGPUFeatureStatus() as unknown as Record<string, string>;
        const out: Record<string, string> = {};
        for (const k of GPU_FEATURE_KEYS) if (typeof all[k] === 'string') out[k] = all[k];
        return out;
    } catch {
        return undefined;
    }
}

/**
 * Kick off the async GPU query. Call once after app ready; safe to call
 * again (no-op). Never rejects.
 */
export function primeDiagEnv(): void {
    if (primed) return;
    primed = true;
    try {
        staticPart ??= collectStatic();
    } catch {
        /* keep going; snapshot() will retry */
    }
    gpuPart = { ...gpuPart, disabled: app.commandLine.hasSwitch('disable-gpu'), features: gpuFeatures() };
    if (!app.isReady()) return;
    sampleMetrics();
    metricsTimer ??= setInterval(sampleMetrics, METRICS_INTERVAL_MS);
    metricsTimer.unref();
    void (async () => {
        try {
            // 'complete' carries glRenderer (the software-vs-hardware tell);
            // fall back to 'basic' if it fails or stalls.
            const info = (await Promise.race([
                app.getGPUInfo('complete'),
                new Promise<undefined>((r) => setTimeout(() => r(undefined), 8000)),
            ])) as { auxAttributes?: Record<string, unknown>; gpuDevice?: DiagEnvGpuDevice[] } | undefined;
            const level = info ? 'complete' : 'basic';
            const got =
                info ?? ((await app.getGPUInfo('basic')) as { auxAttributes?: Record<string, unknown>; gpuDevice?: DiagEnvGpuDevice[] });
            const aux = got.auxAttributes ?? {};
            const str = (v: unknown, n: number) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);
            gpuPart = {
                ...gpuPart,
                info: level,
                glRenderer: str(aux.glRenderer, 96),
                glVendor: str(aux.glVendor, 48),
                glVersion: str(aux.glVersion, 64),
                devices: (got.gpuDevice ?? []).slice(0, 4).map((d) => ({
                    vendorId: d.vendorId,
                    deviceId: d.deviceId,
                    driverVendor: str(d.driverVendor, 32),
                    driverVersion: str(d.driverVersion, 32),
                    active: d.active,
                })),
            };
        } catch {
            gpuPart = { ...gpuPart, info: 'failed' };
        }
    })();
}

function displays(): string[] | undefined {
    if (!app.isReady() || isHeadless()) return undefined;
    try {
        return screen
            .getAllDisplays()
            .slice(0, 4)
            .map((d) => `${d.size.width}x${d.size.height}@${d.scaleFactor}`);
    } catch {
        return undefined;
    }
}

function minidumpCount(): number | undefined {
    try {
        return fs.readdirSync(app.getPath('crashDumps')).filter((f) => f.endsWith('.dmp')).length;
    } catch {
        return undefined;
    }
}

/** Current snapshot; cheap and synchronous. Never throws. */
export function getDiagEnv(): DiagEnvSnapshot | undefined {
    try {
        staticPart ??= collectStatic();
        if (gpuPart.features === undefined) gpuPart = { ...gpuPart, features: gpuFeatures() };
        return {
            ...staticPart,
            gpu: gpuPart,
            displays: displays(),
            now: {
                uptimeS: Math.round(process.uptime()),
                rssMB: Math.round(process.memoryUsage().rss / 1048576),
                freeMemMB: Math.round(os.freemem() / 1048576),
                ...(process.platform === 'linux' ? { loadavg: os.loadavg().map((x) => Math.round(x * 100) / 100) } : {}),
                minidumps: minidumpCount(),
                ...(lastMetrics
                    ? { procs: lastMetrics.procs, procsAgeS: Math.round((Date.now() - lastMetrics.at) / 1000) }
                    : {}),
            },
        };
    } catch {
        return undefined;
    }
}
