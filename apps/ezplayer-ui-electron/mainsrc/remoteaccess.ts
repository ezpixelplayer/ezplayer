/**
 * Configuration for the password-gated remote-access features: the terminal
 * (`shell`) and the file manager (`files`).
 *
 * Lives in the SHOW FOLDER, next to the other per-show settings:
 * `<showFolder>/.ezplayer/remote-access.json`. That makes remote access a
 * property of the show a player has open rather than of the machine — move the
 * folder to another player and the setting travels with it, and two shows on
 * one machine can differ.
 *
 * Each feature has its OWN password and is independently off by default. That
 * split is the point: handing someone the file manager should not hand them a
 * shell. (The reverse is moot — anyone with a shell already has the files.)
 *
 * MUST stay free of any `electron` import: the pure-Node CLI, the Electron
 * main process and the server worker thread all read this.
 *
 * A feature is INERT unless this file carries a password for it, and there is
 * deliberately no UI that can create one — only `EZPlayer shell` / `EZPlayer
 * files`.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { atomicWriteFile } from './data/atomicWrite.js';
import { settingsPath } from './data/SettingsMigration.js';

const scrypt = promisify(scryptCb) as (
    password: string | Buffer,
    salt: Buffer,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** scrypt work factors. N=32768/r=8 is ~32MB and ~100ms — deliberately slow,
 *  since the only thing standing between a cloud viewer and a shell is this
 *  hash. Stored per-record so the cost can be raised later without stranding
 *  existing passwords. */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
/** node's default maxmem (32MB) is exactly N*r*128 and so trips its own check. */
const MAX_MEM = 96 * 1024 * 1024;

export const REMOTE_ACCESS_FILENAME = 'remote-access.json';

/** The password-gated features. Each is configured and enabled separately. */
export type RemoteFeature = 'shell' | 'files';

export const REMOTE_FEATURES: readonly RemoteFeature[] = ['shell', 'files'];

/** Human label used in CLI and log output. */
export const FEATURE_LABEL: Record<RemoteFeature, string> = {
    shell: 'Remote shell',
    files: 'File manager',
};

export interface PasswordRecord {
    algo: 'scrypt';
    N: number;
    r: number;
    p: number;
    /** base64 */
    salt: string;
    /** base64 */
    hash: string;
}

export interface FeatureConfig {
    password?: PasswordRecord;
    /** Shell only: override the command to spawn, e.g. "/bin/zsh". */
    command?: string;
    /** ISO timestamp of the last change, for humans reading the file. */
    updatedAt?: string;
}

export interface RemoteAccessConfig {
    version: 1;
    shell?: FeatureConfig;
    files?: FeatureConfig;
}

/** `<showFolder>/.ezplayer/remote-access.json`. */
export function remoteAccessConfigPath(showFolder: string): string {
    return settingsPath(showFolder, REMOTE_ACCESS_FILENAME);
}

/** Parsed config, or undefined when the file is absent/empty/corrupt. A broken
 *  file must read as "everything off", never as "on with no password". An
 *  undefined show folder (none loaded yet) is likewise off. */
export async function readRemoteAccessConfig(showFolder: string | undefined): Promise<RemoteAccessConfig | undefined> {
    if (!showFolder) return undefined;
    try {
        const raw = await fs.readFile(remoteAccessConfigPath(showFolder), 'utf8');
        if (raw.trim() === '') return undefined;
        const parsed = JSON.parse(raw) as RemoteAccessConfig;
        if (!parsed || typeof parsed !== 'object') return undefined;
        return parsed;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code === 'ENOENT' || e instanceof SyntaxError) return undefined;
        // A permissions problem or an I/O error is not a reason to open access
        // up; treat it as off, but say so.
        console.error('[remoteaccess] could not read remote-access config:', e);
        return undefined;
    }
}

function isUsableRecord(rec: PasswordRecord | undefined): rec is PasswordRecord {
    return (
        !!rec &&
        rec.algo === 'scrypt' &&
        Number.isInteger(rec.N) &&
        Number.isInteger(rec.r) &&
        Number.isInteger(rec.p) &&
        typeof rec.salt === 'string' &&
        typeof rec.hash === 'string' &&
        rec.salt.length > 0 &&
        rec.hash.length > 0
    );
}

/** True when this feature has a password configured — its single gate. */
export function featureEnabled(cfg: RemoteAccessConfig | undefined, feature: RemoteFeature): boolean {
    return isUsableRecord(cfg?.[feature]?.password);
}

/** Convenience for callers that only need the boolean. */
export async function isFeatureEnabled(showFolder: string | undefined, feature: RemoteFeature): Promise<boolean> {
    return featureEnabled(await readRemoteAccessConfig(showFolder), feature);
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, KEY_LEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: MAX_MEM,
    });
    return {
        algo: 'scrypt',
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        salt: salt.toString('base64'),
        hash: hash.toString('base64'),
    };
}

/** Constant-time check of `password` against the stored record for `feature`.
 *  Each feature's password is checked only against its own record, so one
 *  never unlocks the other. */
export async function verifyFeaturePassword(
    cfg: RemoteAccessConfig | undefined,
    feature: RemoteFeature,
    password: string,
): Promise<boolean> {
    const rec = cfg?.[feature]?.password;
    if (!isUsableRecord(rec)) return false;
    let expected: Buffer;
    let actual: Buffer;
    try {
        expected = Buffer.from(rec.hash, 'base64');
        actual = await scrypt(password, Buffer.from(rec.salt, 'base64'), expected.length, {
            N: rec.N,
            r: rec.r,
            p: rec.p,
            maxmem: MAX_MEM,
        });
    } catch (e) {
        console.error('[remoteaccess] password verification failed to run:', e);
        return false;
    }
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
}

async function writeConfig(showFolder: string, cfg: RemoteAccessConfig): Promise<void> {
    const target = remoteAccessConfigPath(showFolder);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await atomicWriteFile(target, JSON.stringify(cfg, null, 2));
    // Best-effort: keep the hashes off other local accounts. No-op on Windows,
    // where ACLs are inherited rather than set from a mode.
    if (process.platform !== 'win32') {
        try {
            await fs.chmod(target, 0o600);
        } catch {
            /* non-fatal */
        }
    }
}

/** Set (or replace) a feature's password. Returns the file it wrote. */
export async function setFeaturePassword(
    showFolder: string,
    feature: RemoteFeature,
    password: string,
): Promise<string> {
    const existing = (await readRemoteAccessConfig(showFolder)) ?? { version: 1 as const };
    const next: RemoteAccessConfig = {
        ...existing,
        version: 1,
        [feature]: {
            ...existing[feature],
            password: await hashPassword(password),
            updatedAt: new Date().toISOString(),
        },
    };
    await writeConfig(showFolder, next);
    return remoteAccessConfigPath(showFolder);
}

/** Remove a feature's password, disabling it entirely. Returns false when
 *  there was nothing to clear. */
export async function clearFeaturePassword(showFolder: string, feature: RemoteFeature): Promise<boolean> {
    const existing = await readRemoteAccessConfig(showFolder);
    if (!existing?.[feature]?.password) return false;
    const featureCfg: FeatureConfig = { ...existing[feature], updatedAt: new Date().toISOString() };
    delete featureCfg.password;
    await writeConfig(showFolder, { ...existing, version: 1, [feature]: featureCfg });
    return true;
}

/** The shell to spawn: explicit override, else the platform default. */
export function resolveShellCommand(cfg: RemoteAccessConfig | undefined): string {
    const override = cfg?.shell?.command?.trim();
    if (override) return override;
    if (process.platform === 'win32') {
        return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/sh';
}
