/**
 * Opt-out anonymous crash/diagnostics reporting.
 *
 * Consent is app-global (electron-store, machine-wide, survives show-folder
 * switches): `uploadEnabled` defaults ON (opt-out), `includePlayerId`
 * defaults OFF (opt-in) — the player ID lets the operator connect a report
 * to a specific installation, so it requires an explicit tick.
 *
 * `reportDiagEvent` is safe to call from any crash path: it never throws,
 * uploads best-effort with no retry, and self-throttles so a crash loop
 * can't flood the cloud (which rate-limits per IP on its side too).
 */

import Store from 'electron-store';
import type { DiagnosticsConsent } from '@ezplayer/ezplayer-core';
import { DEFAULT_CLOUD_SERVICE_URL, getCloudConfigCache } from './data/CloudConfigStorage.js';
import { ezpVersions } from '../versions.js';

const store = new Store<{ diagnostics?: DiagnosticsConsent }>({ name: 'diagnostics' });

export function getDiagnosticsConsent(): DiagnosticsConsent {
    const d = store.get('diagnostics');
    return {
        uploadEnabled: d?.uploadEnabled !== false,
        includePlayerId: d?.includePlayerId === true,
    };
}

export function setDiagnosticsConsent(patch: Partial<DiagnosticsConsent>): DiagnosticsConsent {
    const next = { ...getDiagnosticsConsent(), ...patch };
    store.set('diagnostics', next);
    return next;
}

export type DiagEventKind =
    | 'uncaughtException'
    | 'unhandledRejection'
    | 'render-process-gone'
    | 'child-process-gone'
    | 'unresponsive'
    | 'did-fail-load'
    | 'worker-error'
    | 'renderer-error';

const MAX_REPORTS_PER_HOUR = 10;
let sentTimestamps: number[] = [];

export function reportDiagEvent(kind: DiagEventKind, message: string, stack?: string, extra?: unknown): void {
    try {
        if (!getDiagnosticsConsent().uploadEnabled) return;
        const now = Date.now();
        sentTimestamps = sentTimestamps.filter((t) => now - t < 3_600_000);
        if (sentTimestamps.length >= MAX_REPORTS_PER_HOUR) return;
        sentTimestamps.push(now);

        const cfg = getCloudConfigCache();
        const cloudUrl = cfg.cloudServiceUrl || DEFAULT_CLOUD_SERVICE_URL;
        const base = cloudUrl.endsWith('/') ? cloudUrl : `${cloudUrl}/`;
        const body = {
            kind,
            message: message.slice(0, 2048),
            ...(stack ? { stack: stack.slice(0, 8192) } : {}),
            ...(extra !== undefined ? { extra: JSON.stringify(extra).slice(0, 4096) } : {}),
            appVersion: ezpVersions.version,
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            ...(getDiagnosticsConsent().includePlayerId && cfg.playerIdToken
                ? { player_token: cfg.playerIdToken }
                : {}),
        };
        void fetch(`${base}api/diag/crashreport`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        }).catch(() => {
            /* best-effort */
        });
    } catch {
        /* never throw from a crash path */
    }
}
