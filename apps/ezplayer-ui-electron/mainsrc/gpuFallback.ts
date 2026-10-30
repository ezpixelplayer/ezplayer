/**
 * Software-rendering fallback for machines whose GPU process never comes up.
 *
 * On such machines Chromium reports every GPU feature off, app.getAppMetrics()
 * lists no GPU process, and renderer processes die early with a signal. When a
 * renderer dies that way, this module records a sticky fallback and relaunches
 * the app; the next start turns hardware acceleration off and routes WebGL to
 * the bundled SwiftShader before Electron is ready. EZP_GPU=hardware clears the
 * record so the GPU can be retried after a driver fix.
 */

import { app } from 'electron';
import Store from 'electron-store';
import { ezpVersions } from '../versions.js';
import {
    GPU_FALLBACK_RECHECK_MS,
    parseGpuModeEnv,
    shouldFallbackToSoftwareGpu,
    SOFTWARE_GL_SWITCHES,
} from './rendererCrashPolicy.js';

interface GpuFallbackRecord {
    since: number;
    reason: string;
    exitCode: number;
    appVersion: string;
}

const store = new Store<{ softwareFallback?: GpuFallbackRecord }>({ name: 'gpu' });

let triggered = false;
let gpuProcessFaulted = false;

/** Hardware acceleration off, WebGL on the bundled SwiftShader. */
function applySoftwareGlSwitches(): void {
    for (const [name, value] of SOFTWARE_GL_SWITCHES) {
        if (value === undefined) app.commandLine.appendSwitch(name);
        else app.commandLine.appendSwitch(name, value);
    }
}

/** Call before app ready: honors EZP_GPU and a fallback saved by an earlier run. */
export function applyGpuStartupPolicy(): void {
    // Let WebGL fall back to SwiftShader when Chromium blocklists the GPU. Safe here: the
    // renderer only loads our own pages.
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');

    const mode = parseGpuModeEnv(process.env.EZP_GPU);
    const saved = store.get('softwareFallback');
    if (mode === 'hardware') {
        if (saved) {
            console.log('[gpu] EZP_GPU=hardware: clearing the saved software-rendering fallback');
            store.delete('softwareFallback');
        }
        return;
    }
    if (mode === 'software') {
        console.log('[gpu] EZP_GPU=software: software rendering (SwiftShader)');
        applySoftwareGlSwitches();
        return;
    }
    if (saved) {
        console.log(
            `[gpu] software rendering (SwiftShader): renderer ${saved.reason} with no GPU process on ${new Date(saved.since).toISOString()} (v${saved.appVersion}). Set EZP_GPU=hardware to retry the GPU.`,
        );
        applySoftwareGlSwitches();
    }
}

/** Called from app 'child-process-gone': a dead GPU process counts as evidence. */
export function noteChildProcessGone(details: { type: string; reason: string }): void {
    if (details.type === 'GPU' && details.reason !== 'clean-exit') gpuProcessFaulted = true;
}

function gpuProcessAlive(): boolean {
    try {
        return app.getAppMetrics().some((p) => p.type === 'GPU');
    } catch {
        // Unknown: assume healthy so a metrics failure cannot cause a relaunch.
        return true;
    }
}

function decide(details: { reason: string }): boolean {
    return shouldFallbackToSoftwareGpu({
        reason: details.reason,
        uptimeS: process.uptime(),
        gpuProcessAlive: gpuProcessAlive(),
        gpuProcessFaulted,
        gpuAlreadyDisabled: app.commandLine.hasSwitch('disable-gpu'),
        alreadyTriggered: triggered,
    });
}

/**
 * Decide on and schedule the fallback relaunch for a dead renderer. Resolves
 * true when app.relaunch() has been queued; the caller must then quit so the
 * show-folder lock is released before the new instance starts.
 */
export async function maybeFallbackToSoftwareGpu(details: { reason: string; exitCode: number }): Promise<boolean> {
    if (!decide(details)) return false;
    // Hold the slot during the re-check so other dying renderers return false meanwhile.
    triggered = true;
    await new Promise((r) => setTimeout(r, GPU_FALLBACK_RECHECK_MS));
    triggered = false;
    if (!decide(details)) return false;
    triggered = true;
    store.set('softwareFallback', {
        since: Date.now(),
        reason: details.reason,
        exitCode: details.exitCode,
        appVersion: ezpVersions.version,
    });
    console.error('[gpu] renderer died with no GPU process alive; relaunching with software rendering');
    app.relaunch();
    return true;
}
