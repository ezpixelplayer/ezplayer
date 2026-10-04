/**
 * One hidden BrowserWindow (one AudioContext) per audio output. Chromium binds
 * one sink per AudioContext, so N outputs means N windows fed the same
 * unity-gain PCM; each window applies its own volume via a GainNode.
 *
 * With `useDefaultAudioOutput` on there is a single window on the system
 * default sink. Off, there is one window per `PlaybackSettings.audioOutputs`
 * entry; the window resolves and tracks its device itself (see
 * src/audio-window.ts) and mutes while it is absent.
 *
 * Volume is decided in one place — the playback worker (see
 * `resolveVolumeTargets` in ezplayer-core): it slews every output toward its
 * own scheduled level, folds in mute, and sends the resulting per-output
 * gains with each audio chunk. This module only applies them.
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, app } from 'electron';
import type { AudioChunk, AudioOutputTarget, PlaybackSettings } from '@ezplayer/ezplayer-core';
import { DEFAULT_VOLUME_TARGET_ID, isPhysicalAudioOutput } from '@ezplayer/ezplayer-core';
import { safeSend } from './safe-send.js';

const DEFAULT_TARGET: AudioOutputTarget = { deviceId: '', label: 'System default' };

interface AudioOutputWindow {
    win: BrowserWindow;
    target: AudioOutputTarget;
    lastGain?: number;
}

let preloadPath = '';
let htmlFilePath = '';
let htmlBaseUrl: string | undefined;
/** Headless / CLI runs stay silent on local speakers. */
let audioWindowsEnabled = true;

/** DEFAULT_VOLUME_TARGET_ID or AudioOutputConfig.id */
const outputs = new Map<string, AudioOutputWindow>();

/** Latest linear gains from the worker, by output key. The default-sink
 *  window reads `DEFAULT_VOLUME_TARGET_ID`. Unknown keys play at unity until
 *  the worker's next chunk names them. */
let workerGains: Record<string, number> = {};

export function setAudioWindowsEnabled(enabled: boolean) {
    audioWindowsEnabled = enabled;
    if (!enabled) destroyAllAudioWindows();
}

export function configureAudioWindowPaths(opts: { preloadPath: string; htmlFilePath: string; htmlBaseUrl?: string }) {
    preloadPath = opts.preloadPath;
    htmlFilePath = opts.htmlFilePath;
    htmlBaseUrl = opts.htmlBaseUrl;
}

function sameTarget(a: AudioOutputTarget, b: AudioOutputTarget): boolean {
    return a.deviceId === b.deviceId && a.label === b.label && a.groupId === b.groupId;
}

function createAudioWindow(key: string, target: AudioOutputTarget): BrowserWindow {
    if (!preloadPath || (!htmlFilePath && !htmlBaseUrl)) {
        throw new Error('configureAudioWindowPaths must be called before creating audio windows');
    }
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            webSecurity: false,
            // Hidden window default-throttles audio render; keep it full-priority.
            backgroundThrottling: false,
            additionalArguments: [`--ezp-audio-output=${encodeURIComponent(JSON.stringify(target))}`],
        },
    });
    const url = htmlBaseUrl ? new URL(htmlBaseUrl) : pathToFileURL(htmlFilePath);
    console.log(`[audio] create window ${key}: ${target.label || '(default)'}`);
    win.loadURL(url.toString());

    win.on('closed', () => {
        const cur = outputs.get(key);
        if (cur?.win === win) outputs.delete(key);
    });
    win.webContents.once('did-finish-load', () => {
        const cur = outputs.get(key);
        if (cur?.win === win) {
            cur.lastGain = undefined;
            pushGain(key, cur);
        }
    });
    return win;
}

function gainFor(key: string): number {
    const g = workerGains[key];
    return Number.isFinite(g) ? Math.max(0, Math.min(1, g)) : 1;
}

function pushGain(key: string, out: AudioOutputWindow) {
    if (out.win.isDestroyed()) return;
    const gain = gainFor(key);
    if (gain === out.lastGain) return;
    out.lastGain = gain;
    safeSend(out.win, 'audio:gain', gain);
}

function destroyOutput(key: string) {
    const out = outputs.get(key);
    if (!out) return;
    outputs.delete(key);
    if (!out.win.isDestroyed()) out.win.destroy();
}

/** Reconcile windows to settings: default sink only, or one per named output. */
export function syncAudioOutputsFromSettings(settings: PlaybackSettings | null | undefined): void {
    if (!audioWindowsEnabled) return;

    const useDefault = settings?.useDefaultAudioOutput !== false;
    const desired = new Map<string, AudioOutputTarget>();
    if (useDefault) {
        desired.set(DEFAULT_VOLUME_TARGET_ID, DEFAULT_TARGET);
    } else {
        for (const o of settings?.audioOutputs ?? []) {
            if (!isPhysicalAudioOutput({ deviceId: o.deviceId, kind: 'audiooutput' })) continue;
            desired.set(o.id, { deviceId: o.deviceId, label: o.label, groupId: o.groupId });
        }
    }

    for (const key of [...outputs.keys()]) {
        const want = desired.get(key);
        const have = outputs.get(key)!;
        if (!want || !sameTarget(want, have.target)) destroyOutput(key);
    }
    for (const [key, target] of desired) {
        let out = outputs.get(key);
        if (!out) {
            out = { win: createAudioWindow(key, target), target };
            outputs.set(key, out);
        }
        pushGain(key, out);
    }

    const names = [...outputs.values()].map((o) => o.target.label || '(default)');
    console.log(`[audio] outputs: ${names.join(', ') || 'none'}`);
}

export function getAudioWindows(): BrowserWindow[] {
    return [...outputs.values()].map((o) => o.win).filter((w) => !w.isDestroyed());
}

export function destroyAllAudioWindows(): void {
    for (const key of [...outputs.keys()]) destroyOutput(key);
}

/**
 * Fan out one unity-gain chunk. `gains` are the worker's current linear gains
 * per output key (mute already applied). `volumeSF` is the legacy single gain
 * and stands in for the default output when `gains` is absent.
 */
export function broadcastAudioChunk(chunk: AudioChunk, volumeSF = 1, gains?: Record<string, number>): void {
    workerGains = gains ?? { [DEFAULT_VOLUME_TARGET_ID]: volumeSF };
    for (const [key, out] of outputs) {
        if (out.win.isDestroyed()) continue;
        pushGain(key, out);
        safeSend(out.win, 'audio:chunk', chunk);
    }
}

export function audioWindowHtmlPath(mainDirname: string): string {
    return path.join(mainDirname, '../dist/audio-window.html');
}

/** Vite dev server URL; dist/audio-window.html is only refreshed by build:react. */
export function audioWindowDevUrl(): string | undefined {
    if (app.isPackaged) return undefined;
    return 'http://localhost:5173/audio-window.html';
}
