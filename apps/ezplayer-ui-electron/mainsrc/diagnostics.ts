/**
 * Opt-out anonymous crash/diagnostics reporting.
 *
 * Consent is app-global (electron-store, machine-wide, survives show-folder
 * switches): `uploadEnabled` defaults ON (opt-out), `includePlayerId`
 * defaults OFF (opt-in) — the player ID lets the operator connect a report
 * to a specific installation, so it requires an explicit tick.
 *
 * `reportDiagEvent` is safe to call from any crash path: it never throws,
 * and self-throttles so a crash loop can't flood the cloud (which rate-limits
 * per IP on its side too). Each report is saved to an outbox before upload and
 * removed once delivered; `startOutboxRetry` resends what is left.
 */

import { app } from 'electron';
import Store from 'electron-store';
import path from 'node:path';
import type { DiagnosticsConsent } from '@ezplayer/ezplayer-core';
import { DEFAULT_CLOUD_SERVICE_URL, getCloudConfigCache } from './data/CloudConfigStorage.js';
import { ezpVersions } from '../versions.js';
import { getDiagEnv } from './diagEnv.js';
import { DiagOutbox } from './diagoutbox.js';

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
    | 'renderer-error'
    | 'renderer-not-ready'
    | 'renderer-hang'
    | 'unclean-exit';

/**
 * Exit codes Windows hands to processes it terminates at logoff / shutdown /
 * restart: DBG_TERMINATE_PROCESS (utility processes) and
 * STATUS_CONTROL_C_EXIT (renderers). Electron surfaces these as
 * reason 'killed' — the OS ending the session, not a crash.
 */
const WIN_SESSION_END_EXIT_CODES = new Set([0x40010004, 0xc000013a]);

let sessionEnding = false;

/** Call once the OS session is definitely ending (BrowserWindow 'session-end'). */
export function noteSessionEnding(): void {
    sessionEnding = true;
}

/**
 * True for render/child-process-gone events that are the OS or a normal exit
 * taking the process down rather than a fault. Windows kills the children
 * before (or racing) 'session-end', so the exit codes are checked as well as
 * the flag.
 */
export function isExpectedProcessExit(details: { reason: string; exitCode: number }): boolean {
    if (sessionEnding) return true;
    if (details.reason === 'clean-exit') return true;
    return (
        process.platform === 'win32' &&
        details.reason === 'killed' &&
        // exitCode arrives signed for renderers (-1073741510 === 0xC000013A)
        WIN_SESSION_END_EXIT_CODES.has(details.exitCode >>> 0)
    );
}

const MAX_REPORTS_PER_HOUR = 10;
const UPLOAD_TIMEOUT_MS = 20_000;
const RETRY_FIRST_MS = 15_000;
const RETRY_EVERY_MS = 30 * 60_000;
/** The server allows one report per 2 minutes after a short burst. */
const RETRY_SPACING_MS = 130_000;

let sentTimestamps: number[] = [];
const inFlight = new Set<Promise<unknown>>();
const inFlightFiles = new Set<string>();
let outbox: DiagOutbox | undefined;

function getOutbox(): DiagOutbox {
    outbox ??= new DiagOutbox(path.join(app.getPath('userData'), 'diag-outbox'));
    return outbox;
}

/** Resolves when pending uploads have settled or the timeout passes. Never rejects. */
export function flushDiagReports(timeoutMs: number): Promise<void> {
    if (inFlight.size === 0) return Promise.resolve();
    return Promise.race([
        Promise.allSettled([...inFlight]).then(() => undefined),
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ]);
}

function reportUrl(): string {
    // EZP_DIAG_URL points test runs at a mock endpoint.
    const cloudUrl = process.env.EZP_DIAG_URL || getCloudConfigCache().cloudServiceUrl || DEFAULT_CLOUD_SERVICE_URL;
    const base = cloudUrl.endsWith('/') ? cloudUrl : `${cloudUrl}/`;
    return `${base}api/diag/crashreport`;
}

/** Delivered, or rejected in a way a retry will not fix. */
function isFinalStatus(status: number): boolean {
    return status < 400 || (status < 500 && status !== 408 && status !== 429);
}

/** Resolves true once the report no longer needs sending. */
function upload(kind: string, body: unknown, file: string | undefined): Promise<boolean> {
    if (file) inFlightFiles.add(file);
    const p = fetch(reportUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    }).then(
        (res) => {
            const final = isFinalStatus(res.status);
            console.warn(`[diag] ${kind} upload: HTTP ${res.status}${final ? '' : '; kept for retry'}`);
            if (final) getOutbox().remove(file);
            return final;
        },
        (err: unknown) => {
            console.warn(`[diag] ${kind} upload failed: ${String(err)}; kept for retry`);
            return false;
        },
    );
    inFlight.add(p);
    void p.finally(() => {
        inFlight.delete(p);
        if (file) inFlightFiles.delete(file);
    });
    return p;
}

export function reportDiagEvent(kind: DiagEventKind, message: string, stack?: string, extra?: unknown): void {
    try {
        // Always recorded in the local log, whether or not it is uploaded.
        console.warn(`[diag] ${kind}: ${message}`);
        if (!getDiagnosticsConsent().uploadEnabled) {
            console.warn('[diag] not uploaded: reporting is turned off');
            return;
        }
        const now = Date.now();
        sentTimestamps = sentTimestamps.filter((t) => now - t < 3_600_000);
        if (sentTimestamps.length >= MAX_REPORTS_PER_HOUR) {
            console.warn('[diag] not uploaded: hourly limit reached');
            return;
        }
        sentTimestamps.push(now);

        const cfg = getCloudConfigCache();
        const body = {
            kind,
            message: message.slice(0, 2048),
            ...(stack ? { stack: stack.slice(0, 8192) } : {}),
            ...(extra !== undefined ? { extra: JSON.stringify(extra).slice(0, 4096) } : {}),
            appVersion: ezpVersions.version,
            platform: process.platform,
            arch: process.arch,
            electron: process.versions.electron,
            // OS / distro / GPU / memory / session snapshot; see diagEnv.ts.
            ...(() => {
                const env = getDiagEnv();
                return env ? { env: JSON.stringify(env).slice(0, 4096) } : {};
            })(),
            ...(getDiagnosticsConsent().includePlayerId && cfg.playerIdToken
                ? { player_token: cfg.playerIdToken }
                : {}),
        };
        // Saved first, so a report survives the process dying mid-upload.
        void upload(kind, body, getOutbox().save(body));
    } catch {
        /* never throw from a crash path */
    }
}

let retrying = false;

async function retryPass(): Promise<void> {
    if (retrying) return;
    retrying = true;
    try {
        if (!getDiagnosticsConsent().uploadEnabled) {
            getOutbox().removeAll();
            return;
        }
        const entries = getOutbox().pending(inFlightFiles);
        if (entries.length) console.warn(`[diag] resending ${entries.length} saved report(s)`);
        for (const [i, e] of entries.entries()) {
            if (i > 0) await new Promise((r) => setTimeout(r, RETRY_SPACING_MS));
            const kind = (e.body as { kind?: unknown })?.kind;
            if (!(await upload(`${String(kind)} (saved)`, e.body, e.file))) break;
        }
    } catch {
        /* best-effort */
    } finally {
        retrying = false;
    }
}

/** Resend saved reports shortly after startup, then periodically. */
export function startOutboxRetry(): void {
    setTimeout(() => {
        void retryPass();
        setInterval(() => void retryPass(), RETRY_EVERY_MS).unref();
    }, RETRY_FIRST_MS).unref();
}
