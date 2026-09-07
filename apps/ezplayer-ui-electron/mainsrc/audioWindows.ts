/**
 * One hidden BrowserWindow (one AudioContext) per audio output. Chromium binds
 * one sink per AudioContext, so N outputs means N windows fed the same
 * unity-gain PCM; each window applies its own volume via a GainNode.
 *
 * With `useDefaultAudioOutput` on there is a single window on the system
 * default sink using the worker's volume. Off, there is one window per
 * `PlaybackSettings.audioOutputs` entry; the window resolves and tracks its
 * device itself (see src/audio-window.ts) and mutes while it is absent.
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, app } from 'electron';
import type { AudioChunk, AudioOutputTarget, PlaybackSettings, VolumeControlState } from '@ezplayer/ezplayer-core';
import { getActiveVolumeSchedule, isPhysicalAudioOutput } from '@ezplayer/ezplayer-core';
import { safeSend } from './safe-send.js';

const DEFAULT_KEY = 'default';
const DEFAULT_TARGET: AudioOutputTarget = { deviceId: '', label: 'System default' };

interface AudioOutputWindow {
    win: BrowserWindow;
    target: AudioOutputTarget;
    volumeControl?: VolumeControlState;
    lastGain?: number;
}

let preloadPath = '';
let htmlFilePath = '';
let htmlBaseUrl: string | undefined;
/** Headless / CLI runs stay silent on local speakers. */
let audioWindowsEnabled = true;

/** DEFAULT_KEY or AudioOutputConfig.id */
const outputs = new Map<string, AudioOutputWindow>();

/** Linear gain from the playback worker; applies to the default-sink window. */
let workerVolumeSF = 1;

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
            pushGain(cur, new Date());
        }
    });
    return win;
}

function effectiveVolumeSF(volumeControl: VolumeControlState | undefined, now: Date): number {
    if (!volumeControl) return workerVolumeSF;
    const sched = getActiveVolumeSchedule(volumeControl, now);
    const level = sched?.volumeLevel ?? volumeControl.defaultVolume ?? 100;
    return Math.max(0, Math.min(100, level)) / 100;
}

function pushGain(out: AudioOutputWindow, now: Date) {
    if (out.win.isDestroyed()) return;
    const gain = effectiveVolumeSF(out.volumeControl, now);
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
    const desired = new Map<string, { target: AudioOutputTarget; volumeControl?: VolumeControlState }>();
    if (useDefault) {
        desired.set(DEFAULT_KEY, { target: DEFAULT_TARGET });
    } else {
        for (const o of settings?.audioOutputs ?? []) {
            if (!isPhysicalAudioOutput({ deviceId: o.deviceId, kind: 'audiooutput' })) continue;
            desired.set(o.id, {
                target: { deviceId: o.deviceId, label: o.label, groupId: o.groupId },
                volumeControl: o.volumeControl,
            });
        }
    }

    for (const key of [...outputs.keys()]) {
        const want = desired.get(key);
        const have = outputs.get(key)!;
        if (!want || !sameTarget(want.target, have.target)) destroyOutput(key);
    }
    const now = new Date();
    for (const [key, want] of desired) {
        let out = outputs.get(key);
        if (!out) {
            out = { win: createAudioWindow(key, want.target), target: want.target };
            outputs.set(key, out);
        }
        out.volumeControl = want.volumeControl;
        pushGain(out, now);
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

/** Fan out one unity-gain chunk; `volumeSF` is the worker's current global volume. */
export function broadcastAudioChunk(chunk: AudioChunk, volumeSF = 1): void {
    workerVolumeSF = volumeSF;
    const now = new Date();
    for (const out of outputs.values()) {
        if (out.win.isDestroyed()) continue;
        pushGain(out, now);
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
