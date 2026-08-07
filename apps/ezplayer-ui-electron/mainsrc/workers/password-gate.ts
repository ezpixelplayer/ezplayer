/**
 * The password check shared by the remote-access WebSockets (`/terminal`,
 * `/filemanager`).
 *
 * Both endpoints enforce the same three things, in this order:
 *   1. The feature does not exist unless a password is configured for it in the
 *      open show's `.ezplayer/remote-access.json` — only the CLI can put one
 *      there.
 *   2. A freshly-opened socket may send exactly one kind of message: `auth`.
 *   3. Wrong passwords are throttled with escalating lockouts, so the password —
 *      not the network — is what an attacker has to beat.
 *
 * Lockout state is per-feature and process-wide rather than per-IP: guessing
 * from a second address should not buy a fresh budget.
 */

import {
    featureEnabled,
    readRemoteAccessConfig,
    verifyFeaturePassword,
    type RemoteFeature,
} from '../remoteaccess.js';

/** How long an unauthenticated socket may sit there. */
export const AUTH_TIMEOUT_MS = 20_000;
/** Failures tolerated before lockouts begin. */
const FREE_ATTEMPTS = 3;
/** Lockout after that grows 5s, 10s, 20s … to this ceiling. */
const BASE_LOCKOUT_MS = 5_000;
const MAX_LOCKOUT_MS = 5 * 60_000;

interface Attempts {
    failures: number;
    lockedUntil: number;
}

const attempts = new Map<RemoteFeature, Attempts>();

function stateFor(feature: RemoteFeature): Attempts {
    let s = attempts.get(feature);
    if (!s) {
        s = { failures: 0, lockedUntil: 0 };
        attempts.set(feature, s);
    }
    return s;
}

export type AuthResult =
    | { ok: true; showFolder: string | undefined }
    | { ok: false; reason: string; code: 4401 | 4403 | 4429 };

/**
 * Check a password for `feature` against the config in `showFolder`.
 *
 * The show folder is re-read on every attempt rather than cached, so clearing
 * the password (or switching shows) takes effect immediately, including for a
 * socket that is already mid-handshake.
 */
export async function authenticateFeature(
    feature: RemoteFeature,
    showFolder: string | undefined,
    password: unknown,
): Promise<AuthResult> {
    const state = stateFor(feature);
    const waitMs = Math.max(0, state.lockedUntil - Date.now());
    if (waitMs > 0) {
        return {
            ok: false,
            code: 4429,
            reason: `too many failed attempts; try again in ${Math.ceil(waitMs / 1000)}s`,
        };
    }

    const cfg = await readRemoteAccessConfig(showFolder);
    if (!featureEnabled(cfg, feature)) {
        return { ok: false, code: 4403, reason: 'this feature is not enabled on this player' };
    }

    const supplied = typeof password === 'string' ? password : '';
    if (!(await verifyFeaturePassword(cfg, feature, supplied))) {
        state.failures += 1;
        if (state.failures > FREE_ATTEMPTS) {
            const step = state.failures - FREE_ATTEMPTS - 1;
            const delay = Math.min(BASE_LOCKOUT_MS * 2 ** step, MAX_LOCKOUT_MS);
            state.lockedUntil = Date.now() + delay;
            console.warn(
                `[${feature}] ${state.failures} failed logins; locked out for ${Math.round(delay / 1000)}s`,
            );
        }
        return { ok: false, code: 4401, reason: 'incorrect password' };
    }

    state.failures = 0;
    state.lockedUntil = 0;
    return { ok: true, showFolder };
}

/** True when the feature has a password configured — the gate for accepting an
 *  upgrade at all, so a disabled feature has nothing on the network. */
export async function featureEndpointEnabled(
    feature: RemoteFeature,
    showFolder: string | undefined,
): Promise<boolean> {
    return featureEnabled(await readRemoteAccessConfig(showFolder), feature);
}

/** Test seam: forget lockout state. */
export function resetAuthThrottleForTests(): void {
    attempts.clear();
}
