/**
 * One hidden BrowserWindow (and therefore one AudioContext) per audio output
 * sink. Chromium binds a single sink per AudioContext via setSinkId; multi-
 * output means N windows, each fed the same PCM chunks.
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, app } from 'electron';
import type { AudioChunk } from '@ezplayer/ezplayer-core';
import { safeSend } from './safe-send.js';

/** Empty string = Chromium system default sink. */
export const DEFAULT_AUDIO_SINK_ID = '';

let preloadPath = '';
/** Absolute path to packaged audio-window.html (used when packaged / no Vite). */
let htmlFilePath = '';
/** When set (dev), load from Vite instead of a stale dist/ snapshot. */
let htmlBaseUrl: string | undefined;
/** Headless / CLI runs stay silent on local speakers. */
let audioWindowsEnabled = true;

/** sinkId → hidden audio render window */
const audioWindows = new Map<string, BrowserWindow>();

export function setAudioWindowsEnabled(enabled: boolean) {
    audioWindowsEnabled = enabled;
    if (!enabled) {
        destroyAllAudioWindows();
    }
}

export function configureAudioWindowPaths(opts: {
    preloadPath: string;
    htmlFilePath: string;
    /** e.g. http://localhost:5173/audio-window.html — preferred in `pnpm run dev`. */
    htmlBaseUrl?: string;
}) {
    preloadPath = opts.preloadPath;
    htmlFilePath = opts.htmlFilePath;
    htmlBaseUrl = opts.htmlBaseUrl;
}

function normalizeSinkIds(deviceIds: string[] | undefined | null): string[] {
    if (!deviceIds || deviceIds.length === 0) {
        return [DEFAULT_AUDIO_SINK_ID];
    }
    return Array.from(new Set(deviceIds));
}

function audioWindowLoadUrl(sinkId: string): string {
    const url = htmlBaseUrl
        ? new URL(htmlBaseUrl)
        : pathToFileURL(htmlFilePath);
    url.searchParams.set('sinkId', sinkId);
    return url.toString();
}

function createAudioWindow(sinkId: string): BrowserWindow {
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
            additionalArguments: [`--ezp-audio-sink=${encodeURIComponent(sinkId)}`],
        },
    });

    const loadUrl = audioWindowLoadUrl(sinkId);
    console.log(`[audio] create window sink=${sinkId || '(default)'} url=${loadUrl}`);
    win.loadURL(loadUrl);

    win.on('closed', () => {
        for (const [id, w] of audioWindows) {
            if (w === win) {
                audioWindows.delete(id);
                break;
            }
        }
    });

    return win;
}

/** Create / destroy hidden audio windows so the set matches `deviceIds`. */
export function syncAudioOutputDevices(deviceIds: string[] | undefined | null): void {
    if (!audioWindowsEnabled) {
        return;
    }

    const desired = normalizeSinkIds(deviceIds);
    const desiredSet = new Set(desired);

    for (const [id, win] of [...audioWindows.entries()]) {
        if (!desiredSet.has(id)) {
            if (!win.isDestroyed()) {
                win.destroy();
            }
            audioWindows.delete(id);
        }
    }

    for (const id of desired) {
        if (!audioWindows.has(id)) {
            audioWindows.set(id, createAudioWindow(id));
        }
    }

    console.log(
        `[audio] sync sinks (${desired.length}): ${desired.map((id) => (id ? id.slice(0, 12) + '…' : '(default)')).join(', ')}`,
    );
}

export function getAudioWindows(): BrowserWindow[] {
    return [...audioWindows.values()].filter((w) => !w.isDestroyed());
}

export function destroyAllAudioWindows(): void {
    for (const win of audioWindows.values()) {
        if (!win.isDestroyed()) {
            win.destroy();
        }
    }
    audioWindows.clear();
}

/** Fan-out one PCM chunk to every audio window (structured-clone per send). */
export function broadcastAudioChunk(chunk: AudioChunk): void {
    for (const win of getAudioWindows()) {
        safeSend(win, 'audio:chunk', chunk);
    }
}

/** Resolve the packaged/dev path to audio-window.html next to the main bundle. */
export function audioWindowHtmlPath(mainDirname: string): string {
    return path.join(mainDirname, '../dist/audio-window.html');
}

/** Vite URL for the audio engine page while developing. */
export function audioWindowDevUrl(): string | undefined {
    if (app.isPackaged) return undefined;
    return 'http://localhost:5173/audio-window.html';
}
