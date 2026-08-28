/**
 * One hidden BrowserWindow (and therefore one AudioContext) per audio output
 * sink. Chromium binds a single sink per AudioContext via setSinkId; multi-
 * output means N windows, each fed the same PCM chunks (unity gain in the
 * buffer; per-sink volume applied via GainNode in the audio window).
 *
 * Primary sink comes from `PlaybackSettings.primaryAudioOutputDeviceId`
 * (`''` = system Default). Additional sinks come from
 * `PlaybackSettings.additionalAudioOutputs`.
 */
import path from 'path';
import { pathToFileURL } from 'url';
import { BrowserWindow, app } from 'electron';
import type { AdditionalAudioOutput, AudioChunk, PlaybackSettings, VolumeControlState } from '@ezplayer/ezplayer-core';
import { getActiveVolumeSchedule } from '@ezplayer/ezplayer-core';
import { safeSend } from './safe-send.js';

/** Chromium synthetic sinks and empty id (= system default). Not valid additional picks. */
function isPhysicalAdditionalSinkId(deviceId: string | undefined): boolean {
    return Boolean(deviceId && deviceId !== 'default' && deviceId !== 'communications');
}

/** Empty string = Chromium system default sink. */
export const DEFAULT_AUDIO_SINK_ID = '';


/** Resolve additional sinks from settings, migrating deprecated device-id lists. */
export function additionalOutputsFromSettings(
    settings: PlaybackSettings | null | undefined,
): AdditionalAudioOutput[] | undefined {
    if (!settings) return undefined;
    const useDefault = defaultAudioOutputEnabledFromSettings(settings);
    const raw =
        settings.additionalAudioOutputs && settings.additionalAudioOutputs.length > 0
            ? settings.additionalAudioOutputs
            : settings.audioOutputDeviceIds && settings.audioOutputDeviceIds.length > 0
              ? settings.audioOutputDeviceIds.filter(Boolean).map((deviceId, i) => ({
                    id: `migrated-${i}-${deviceId}`,
                    deviceId,
                    volumeControl: { defaultVolume: 100, schedule: [] },
                }))
              : undefined;
    if (!raw) return undefined;
    if (useDefault) {
        const primaryId = primarySinkIdFromSettings(settings);
        return raw.filter((o) => o.deviceId !== primaryId && isPhysicalAdditionalSinkId(o.deviceId));
    }
    const sysDefaultId = settings.systemDefaultOutputDeviceId;
    return raw.filter(
        (o) => isPhysicalAdditionalSinkId(o.deviceId) && o.deviceId !== sysDefaultId,
    );
}

export function primarySinkIdFromSettings(settings: PlaybackSettings | null | undefined): string {
    return settings?.primaryAudioOutputDeviceId ?? DEFAULT_AUDIO_SINK_ID;
}

/** When false, the system-default sink window is not created. */
export function defaultAudioOutputEnabledFromSettings(settings: PlaybackSettings | null | undefined): boolean {
    return settings?.useDefaultAudioOutput !== false;
}

let preloadPath = '';
/** Absolute path to packaged audio-window.html (used when packaged / no Vite). */
let htmlFilePath = '';
/** When set (dev), load from Vite instead of a stale dist/ snapshot. */
let htmlBaseUrl: string | undefined;
/** Headless / CLI runs stay silent on local speakers. */
let audioWindowsEnabled = true;

/** sinkId → hidden audio render window */
const audioWindows = new Map<string, BrowserWindow>();

/** Additional sinks (excludes primary). Keyed by deviceId. */
let additionalByDeviceId = new Map<string, AdditionalAudioOutput>();

/** Sink that receives primary volumeControl / worker volumeSF. */
let primarySinkId = DEFAULT_AUDIO_SINK_ID;

/** Last primary linear gain from the playback worker (0–1). */
let lastPrimaryVolumeSF = 1;

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

function audioWindowLoadUrl(sinkId: string): string {
    const url = htmlBaseUrl ? new URL(htmlBaseUrl) : pathToFileURL(htmlFilePath);
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

    win.webContents.once('did-finish-load', () => {
        pushGainToWindow(sinkId, win);
    });

    return win;
}

function effectiveVolumeSF(volumeControl: VolumeControlState | undefined, now: Date): number {
    if (!volumeControl) return 1;
    const sched = getActiveVolumeSchedule(volumeControl, now);
    const level = sched?.volumeLevel ?? volumeControl.defaultVolume ?? 100;
    return Math.max(0, Math.min(100, level)) / 100;
}

function gainForSink(sinkId: string, now: Date = new Date()): number {
    if (sinkId === primarySinkId) {
        return lastPrimaryVolumeSF;
    }
    const cfg = additionalByDeviceId.get(sinkId);
    return effectiveVolumeSF(cfg?.volumeControl, now);
}

function pushGainToWindow(sinkId: string, win: BrowserWindow, now?: Date) {
    if (win.isDestroyed()) return;
    safeSend(win, 'audio:gain', gainForSink(sinkId, now ?? new Date()));
}

function pushAllGains(now: Date = new Date()) {
    for (const [sinkId, win] of audioWindows) {
        pushGainToWindow(sinkId, win, now);
    }
}

/**
 * Ensure the primary sink plus every configured additional device has a live
 * audio window. Prefer `syncAudioOutputsFromSettings`.
 */
export function syncAdditionalAudioOutputs(
    outputs: AdditionalAudioOutput[] | undefined | null,
    primaryId: string = DEFAULT_AUDIO_SINK_ID,
    options?: { includePrimary?: boolean },
): void {
    if (!audioWindowsEnabled) {
        return;
    }

    const includePrimary = options?.includePrimary !== false;
    primarySinkId = includePrimary ? primaryId : DEFAULT_AUDIO_SINK_ID;
    const raw = outputs ?? [];
    // Drop additional entries that would duplicate the primary sink, and never
    // route additional outputs through the system-default sink ('' / synthetic).
    const filtered = includePrimary
        ? raw.filter((o) => o.deviceId !== primaryId && isPhysicalAdditionalSinkId(o.deviceId))
        : raw.filter((o) => isPhysicalAdditionalSinkId(o.deviceId));
    additionalByDeviceId = new Map(filtered.map((o) => [o.deviceId, o]));

    const desired = [
        ...(includePrimary ? [primarySinkId] : []),
        ...new Set(filtered.map((o) => o.deviceId)),
    ];
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

    pushAllGains();

    console.log(
        `[audio] sync sinks (${desired.length}): ${desired.map((id) => (id ? id.slice(0, 12) + '…' : '(default)')).join(', ')}`,
    );
}

/** Sync primary + additional sinks from playback settings. */
export function syncAudioOutputsFromSettings(settings: PlaybackSettings | null | undefined): void {
    const useDefault = defaultAudioOutputEnabledFromSettings(settings);
    if (useDefault) {
        syncAdditionalAudioOutputs(undefined, primarySinkIdFromSettings(settings), { includePrimary: true });
    } else {
        syncAdditionalAudioOutputs(additionalOutputsFromSettings(settings), DEFAULT_AUDIO_SINK_ID, {
            includePrimary: false,
        });
    }
}

/** @deprecated Use syncAudioOutputsFromSettings. */
export function syncAudioOutputDevices(deviceIds: string[] | undefined | null): void {
    const outputs: AdditionalAudioOutput[] | undefined = deviceIds?.length
        ? deviceIds.filter(Boolean).map((deviceId, i) => ({
              id: `legacy-${i}-${deviceId}`,
              deviceId,
              volumeControl: { defaultVolume: 100, schedule: [] },
          }))
        : undefined;
    syncAdditionalAudioOutputs(outputs, DEFAULT_AUDIO_SINK_ID);
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
    additionalByDeviceId.clear();
    primarySinkId = DEFAULT_AUDIO_SINK_ID;
}

/**
 * Fan-out one unity-gain PCM chunk to every audio window. `primaryVolumeSF` is
 * the primary/local volume already applied for web clients; local windows apply
 * it (and per-additional volumes) via GainNode instead.
 */
export function broadcastAudioChunk(chunk: AudioChunk, primaryVolumeSF = 1): void {
    lastPrimaryVolumeSF = primaryVolumeSF;
    const now = new Date();
    for (const [sinkId, win] of audioWindows) {
        if (win.isDestroyed()) continue;
        pushGainToWindow(sinkId, win, now);
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
