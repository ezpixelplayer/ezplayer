/**
 * Remote-shell configuration: the password that gates the terminal feature.
 *
 * Lives in the SHOW FOLDER, next to the other per-show settings:
 * `<showFolder>/.ezplayer/shell.json`. That makes the shell a property of the
 * show a player has open rather than of the machine — move the folder to
 * another player and the setting travels with it, and two shows on one machine
 * can differ. It also means every reader already knows where to look, since
 * they all know the show folder.
 *
 * MUST stay free of any `electron` import. Three very different processes read
 * this file: the pure-Node CLI (`dist/cli.js`), the Electron main process, and
 * the server worker (a worker_thread).
 *
 * The shell is INERT unless this file exists and carries a password record.
 * There is deliberately no UI path to create one — only `EZPlayer shell`.
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

export const SHELL_CONFIG_FILENAME = 'shell.json';

export interface ShellPasswordRecord {
    algo: 'scrypt';
    N: number;
    r: number;
    p: number;
    /** base64 */
    salt: string;
    /** base64 */
    hash: string;
}

export interface ShellConfig {
    version: 1;
    password?: ShellPasswordRecord;
    /** Optional shell override, e.g. "/bin/zsh" or "cmd.exe". Default is the
     *  platform login shell. */
    shell?: string;
    /** ISO timestamp of the last write, for humans reading the file. */
    updatedAt?: string;
}

/** `<showFolder>/.ezplayer/shell.json`. */
export function shellConfigPath(showFolder: string): string {
    return settingsPath(showFolder, SHELL_CONFIG_FILENAME);
}

/** Parsed config, or undefined when the file is absent/empty/corrupt. A broken
 *  file must read as "feature off", never as "feature on with no password".
 *  An undefined show folder (no show loaded yet) is likewise "off". */
export async function readShellConfig(showFolder: string | undefined): Promise<ShellConfig | undefined> {
    if (!showFolder) return undefined;
    try {
        const raw = await fs.readFile(shellConfigPath(showFolder), 'utf8');
        if (raw.trim() === '') return undefined;
        const parsed = JSON.parse(raw) as ShellConfig;
        if (!parsed || typeof parsed !== 'object') return undefined;
        return parsed;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code === 'ENOENT' || e instanceof SyntaxError) return undefined;
        // A permissions problem or an I/O error is not a reason to open the
        // shell up; treat it as "off" but say so.
        console.error('[shellconfig] could not read shell config:', e);
        return undefined;
    }
}

function isUsableRecord(rec: ShellPasswordRecord | undefined): rec is ShellPasswordRecord {
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

/** True when a password is configured — the single gate for the whole feature. */
export function shellEnabled(cfg: ShellConfig | undefined): boolean {
    return isUsableRecord(cfg?.password);
}

/** Convenience for callers that only need the boolean. */
export async function isShellEnabled(showFolder: string | undefined): Promise<boolean> {
    return shellEnabled(await readShellConfig(showFolder));
}

export async function hashShellPassword(password: string): Promise<ShellPasswordRecord> {
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

/** Constant-time check of `password` against the stored record. */
export async function verifyShellPassword(cfg: ShellConfig | undefined, password: string): Promise<boolean> {
    const rec = cfg?.password;
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
        console.error('[shellconfig] password verification failed to run:', e);
        return false;
    }
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
}

async function writeShellConfig(showFolder: string, cfg: ShellConfig): Promise<void> {
    const target = shellConfigPath(showFolder);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await atomicWriteFile(target, JSON.stringify(cfg, null, 2));
    // Best-effort: keep the hash off other local accounts. No-op on Windows,
    // where ACLs are inherited rather than set from a mode.
    if (process.platform !== 'win32') {
        try {
            await fs.chmod(target, 0o600);
        } catch {
            /* non-fatal */
        }
    }
}

/** Set (or replace) the shell password. Returns the file it wrote. */
export async function setShellPassword(showFolder: string, password: string): Promise<string> {
    const existing = (await readShellConfig(showFolder)) ?? { version: 1 as const };
    const next: ShellConfig = {
        ...existing,
        version: 1,
        password: await hashShellPassword(password),
        updatedAt: new Date().toISOString(),
    };
    await writeShellConfig(showFolder, next);
    return shellConfigPath(showFolder);
}

/** Remove the password, which disables the shell entirely. Returns false when
 *  there was nothing to clear. */
export async function clearShellPassword(showFolder: string): Promise<boolean> {
    const existing = await readShellConfig(showFolder);
    if (!existing?.password) return false;
    const next: ShellConfig = { ...existing, version: 1, updatedAt: new Date().toISOString() };
    delete next.password;
    await writeShellConfig(showFolder, next);
    return true;
}

/** The shell to spawn: explicit override, else the platform default. */
export function resolveShellCommand(cfg: ShellConfig | undefined): string {
    const override = cfg?.shell?.trim();
    if (override) return override;
    if (process.platform === 'win32') {
        return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/sh';
}
