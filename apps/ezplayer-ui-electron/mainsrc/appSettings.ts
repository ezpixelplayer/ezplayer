/**
 * App-global settings that live outside the show folder: diagnostics consent
 * (electron-store) and the OS login item. One snapshot is pushed to every UI
 * (Electron renderer, LAN WS, cloud bridge); changes arrive as an
 * `AppSettingsCommand` over any of those transports.
 */

import { app } from 'electron';
import type { AppSettingsCommand, AppSettingsState, LoginItemState } from '@ezplayer/ezplayer-core';
import { getDiagnosticsConsent, setDiagnosticsConsent } from './diagnostics.js';

/** Electron login items are available on Windows and macOS (not Linux). */
function isLoginItemPlatformSupported(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin';
}

/** Dev runs use the raw Electron binary, so only the installed app can register one. */
function isLoginItemSupported(): boolean {
    return app.isPackaged && isLoginItemPlatformSupported();
}

/** Options shared by get/set so the OS reports the same openAtLogin state. */
function getLoginItemOptions(): { path: string; args: string[] } | null {
    if (!isLoginItemSupported()) {
        return null;
    }
    return { path: process.execPath, args: [] };
}

function getLoginItemState(): LoginItemState {
    const opts = getLoginItemOptions();
    if (!opts) {
        return {
            availability: isLoginItemPlatformSupported() ? 'dev-mode' : 'unsupported-platform',
            openAtLogin: false,
        };
    }
    return { availability: 'ok', openAtLogin: app.getLoginItemSettings(opts).openAtLogin };
}

function setOpenAtLogin(openAtLogin: boolean): void {
    const opts = getLoginItemOptions();
    if (!opts) {
        if (!isLoginItemPlatformSupported()) {
            throw new Error('Start at sign-in is only available on Windows and macOS.');
        }
        throw new Error(
            'Start at sign-in is only available in the installed EZPlayer application, not in development mode.',
        );
    }
    app.setLoginItemSettings({ ...opts, openAtLogin: !!openAtLogin });
}

export function getAppSettingsState(): AppSettingsState {
    return { diagnostics: getDiagnosticsConsent(), loginItem: getLoginItemState() };
}

let broadcaster: ((state: AppSettingsState) => void) | null = null;

export function publishAppSettings(): void {
    broadcaster?.(getAppSettingsState());
}

/** Injected by server-worker-manager so state reaches every UI without a module cycle. */
export function setAppSettingsBroadcaster(fn: (state: AppSettingsState) => void): void {
    broadcaster = fn;
    publishAppSettings();
}

export async function dispatchAppSettingsCommand(cmd: AppSettingsCommand): Promise<void> {
    try {
        switch (cmd.type) {
            case 'setDiagnosticsConsent': {
                // Wire input: keep only the known boolean fields.
                const p = cmd.patch ?? {};
                setDiagnosticsConsent({
                    ...(typeof p.uploadEnabled === 'boolean' ? { uploadEnabled: p.uploadEnabled } : {}),
                    ...(typeof p.includePlayerId === 'boolean' ? { includePlayerId: p.includePlayerId } : {}),
                });
                break;
            }
            case 'setOpenAtLogin':
                setOpenAtLogin(cmd.openAtLogin);
                break;
        }
    } finally {
        // Re-publish even on failure so an optimistic UI snaps back to the real state.
        publishAppSettings();
    }
}
