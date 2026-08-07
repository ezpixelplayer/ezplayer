/**
 * Shared implementation of `EZPlayer shell` and `EZPlayer files` — the only way
 * to turn either remote-access feature on.
 *
 * Writing a password is what makes that feature's tile appear in Settings;
 * clearing it makes the feature vanish and kills its endpoint. Deliberately
 * CLI-only: arming remote access should require access to the machine, not just
 * access to the UI. The two features have separate passwords, so granting the
 * file manager does not grant a shell.
 *
 * Passwords live in the show folder (`<showFolder>/.ezplayer/remote-access.json`),
 * so the folder has to be named. Works with the player stopped — it only
 * touches that file. If a player IS running locally we then nudge it over
 * loopback so the change takes effect without a restart; that nudge is
 * best-effort and never fails the command.
 */

import fs from 'fs';
import path from 'path';
import { SUBDIR_NAME } from '../../mainsrc/data/SettingsMigration.js';
import {
    clearFeaturePassword,
    FEATURE_LABEL,
    readRemoteAccessConfig,
    remoteAccessConfigPath,
    setFeaturePassword,
    featureEnabled,
    type RemoteFeature,
} from '../../mainsrc/remoteaccess.js';

const DEFAULT_PORT = 3000;
const MIN_PASSWORD_LENGTH = 8;
const BOM_CODE_POINT = 0xfeff;

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = '\u007f';

/** Read `--flag value` or `--flag=value` for any of the given aliases. */
function flagValue(args: string[], ...names: string[]): string | undefined {
    for (const name of names) {
        const eq = args.find((a) => a.startsWith(`${name}=`));
        if (eq) return eq.slice(name.length + 1);
        const idx = args.indexOf(name);
        if (idx >= 0 && args[idx + 1] !== undefined && !args[idx + 1].startsWith('-')) return args[idx + 1];
    }
    return undefined;
}

function localPort(args: string[]): number {
    const n = parseInt(flagValue(args, '--port', '-p') ?? '', 10);
    if (Number.isInteger(n) && n > 0) return n;
    const env = Number(process.env.EZPLAYER_WEB_PORT);
    return Number.isInteger(env) && env > 0 ? env : DEFAULT_PORT;
}

/**
 * Which show folder to act on: `--show-folder` if given, else the current
 * directory when it already looks like a show folder. Never guessed further
 * than that — writing a password into the wrong show would be silently wrong in
 * exactly the way a security setting must not be.
 */
function resolveShowFolder(args: string[]): { showFolder: string } | { error: string } {
    const explicit = flagValue(args, '--show-folder', '--showfolder', '-s');
    if (explicit) {
        const dir = path.resolve(explicit);
        if (!fs.existsSync(dir)) return { error: `show folder does not exist: ${dir}` };
        return { showFolder: dir };
    }
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, SUBDIR_NAME))) return { showFolder: cwd };
    return {
        error:
            `--show-folder <dir> is required.\n\n` +
            `The password lives in that show's ${SUBDIR_NAME}/ config directory, so the folder\n` +
            `has to be named explicitly. Run this from inside a show folder — one that\n` +
            `already has a ${SUBDIR_NAME}/ directory — and it is used automatically.`,
    };
}

/**
 * Thrown when no password source is available at all, as opposed to being
 * handed a bad password. Carries the operator-facing explanation.
 */
class NoPasswordSource extends Error {}

/** Read one line from stdin. Rejects rather than returning an empty string when
 *  stdin yields nothing, so "there was no input" never masquerades as "the
 *  password was blank". */
async function readLinePlain(): Promise<string> {
    const chunks: Buffer[] = [];
    try {
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    } catch {
        throw new NoPasswordSource(stdinUnavailableMessage());
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw.length === 0) throw new NoPasswordSource(stdinUnavailableMessage());
    return raw.split(/\r?\n/)[0] ?? '';
}

/** True in the packaged Windows app (as opposed to the pure-Node CLI). */
function isWindowsElectron(): boolean {
    return process.platform === 'win32' && !!(process as { versions?: { electron?: string } }).versions?.electron;
}

const USE_INSTEAD =
    'Use one of these instead:\n' +
    '  ezplayer <verb> --show-folder <dir> --password-file secret.txt\n' +
    '  ezplayer <verb> --show-folder <dir> --password <pw>\n' +
    '\n' +
    '--password-file is the better of the two: unlike --password it keeps the\n' +
    'password out of your shell history and out of the process list. Delete the\n' +
    'file afterwards.';

function stdinUnavailableMessage(): string {
    if (isWindowsElectron()) {
        return (
            'nothing arrived on standard input.\n\n' +
            'Run directly, EZPlayer.exe is a Windows GUI binary: it can print to the\n' +
            'console but cannot read from it, and your shell does not wait for it. Use\n' +
            'the ezplayer.cmd launcher installed beside it, which fixes both — then\n' +
            'piping works:\n' +
            '  type secret.txt | ezplayer <verb> --show-folder <dir> --stdin\n' +
            '\n' +
            USE_INSTEAD
        );
    }
    return 'nothing arrived on standard input.';
}

/** We could read a password, but not without showing it on screen. */
function cannotPromptMessage(): string {
    if (isWindowsElectron()) {
        return (
            'cannot prompt for a password here.\n\n' +
            "Electron's Node mode has no TTY support on Windows, so there is no way to\n" +
            'turn off echo — the password would be typed in plain view. Rather than do\n' +
            'that, EZPlayer asks you to supply it another way.\n\n' +
            USE_INSTEAD
        );
    }
    return (
        'cannot prompt for a password: standard input is not a terminal, so echo\n' +
        'cannot be turned off.\n\n' + USE_INSTEAD
    );
}

/** Read one line from stdin with the terminal echo turned off. */
async function readSecret(prompt: string): Promise<string> {
    const stdin = process.stdin;
    // Without a TTY there is no way to turn echo off. Rather than quietly type
    // a password in plain view, say so and point at the alternatives.
    if (stdin.isTTY !== true) throw new NoPasswordSource(cannotPromptMessage());

    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    return new Promise<string>((resolve, reject) => {
        let buf = '';
        const done = (fn: () => void) => {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            fn();
        };
        const onData = (chunk: string) => {
            for (const ch of chunk) {
                if (ch === '\r' || ch === '\n') return done(() => resolve(buf));
                if (ch === CTRL_C || ch === CTRL_D) return done(() => reject(new Error('cancelled')));
                if (ch === BACKSPACE || ch === '\b') {
                    buf = buf.slice(0, -1);
                    continue;
                }
                buf += ch;
            }
        };
        stdin.on('data', onData);
    });
}

/**
 * First line of a file, for `--password-file`. The recommended way to set a
 * password from the packaged Windows app: no stdin needed, and unlike
 * `--password` the value never reaches shell history or the process list.
 */
function readPasswordFile(file: string): string {
    const resolved = path.resolve(file);
    let raw: string;
    try {
        raw = fs.readFileSync(resolved, 'utf8');
    } catch (e) {
        const code = (e as { code?: string }).code;
        throw new NoPasswordSource(
            code === 'ENOENT' ? `password file not found: ${resolved}` : `could not read password file: ${resolved}`,
        );
    }
    // Strip a UTF-8 BOM — Windows editors and `Set-Content` add one freely, and
    // it would silently become part of the password.
    const withoutBom = raw.charCodeAt(0) === BOM_CODE_POINT ? raw.slice(1) : raw;
    const first = withoutBom.split(/\r?\n/)[0] ?? '';
    if (first.trim().length === 0) throw new NoPasswordSource(`password file is empty: ${resolved}`);
    return first;
}

/** Tell a locally-running player to re-read the config. Dials loopback only. */
async function nudgeRunningPlayer(port: number): Promise<'applied' | 'not-running' | 'failed'> {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/ezp/shell/reload`, {
            method: 'POST',
            signal: AbortSignal.timeout(3_000),
        });
        return res.ok ? 'applied' : 'failed';
    } catch {
        return 'not-running';
    }
}

function reportNudge(result: 'applied' | 'not-running' | 'failed', port: number): void {
    if (result === 'applied') {
        console.log('The running player picked up the change; no restart needed.');
    } else if (result === 'not-running') {
        console.log(`No player answered on 127.0.0.1:${port}. The change applies the next time one starts.`);
    } else {
        console.log('A player answered but refused the reload. Restart it to pick up the change.');
    }
}

/** Body of both verbs; `feature` is the only difference. */
export async function runRemoteAccessCommand(feature: RemoteFeature, args: string[]): Promise<number> {
    const resolved = resolveShowFolder(args);
    if ('error' in resolved) {
        console.error(`error: ${resolved.error}`);
        return 2;
    }
    const { showFolder } = resolved;
    const configFile = remoteAccessConfigPath(showFolder);
    const label = FEATURE_LABEL[feature];
    const port = localPort(args);

    if (args.includes('--status')) {
        const cfg = await readRemoteAccessConfig(showFolder);
        console.log(`Show folder:  ${showFolder}`);
        console.log(`Config file:  ${configFile}`);
        console.log(`${label}: ${featureEnabled(cfg, feature) ? 'ENABLED (password set)' : 'disabled (no password set)'}`);
        const updated = cfg?.[feature]?.updatedAt;
        if (updated) console.log(`Last changed: ${updated}`);
        if (feature === 'shell' && cfg?.shell?.command) console.log(`Shell override: ${cfg.shell.command}`);
        return 0;
    }

    if (args.includes('--clear')) {
        if (!(await clearFeaturePassword(showFolder, feature))) {
            console.log(`No ${label.toLowerCase()} password was set for ${showFolder}; nothing to clear.`);
            return 0;
        }
        console.log(`${label} password cleared. It is now disabled entirely.`);
        console.log(`Config file: ${configFile}`);
        reportNudge(await nudgeRunningPlayer(port), port);
        return 0;
    }

    const inline = flagValue(args, '--password');
    const passwordFile = flagValue(args, '--password-file');
    let password: string;
    try {
        if (inline !== undefined) {
            password = inline;
        } else if (passwordFile !== undefined) {
            password = readPasswordFile(passwordFile);
        } else if (args.includes('--stdin')) {
            password = await readLinePlain();
        } else {
            password = await readSecret(`New ${label.toLowerCase()} password: `);
            const confirm = await readSecret('Confirm password: ');
            if (password !== confirm) {
                console.error('Passwords did not match; nothing was changed.');
                return 1;
            }
        }
    } catch (e) {
        if (e instanceof NoPasswordSource) {
            console.error(`error: ${e.message}`);
            return 2;
        }
        console.error('\nCancelled; nothing was changed.');
        return 1;
    }

    if (password.length === 0) {
        console.error('No password was given; nothing was changed.');
        return 1;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        console.error(
            `Password must be at least ${MIN_PASSWORD_LENGTH} characters ` +
                `(got ${password.length}); nothing was changed.`,
        );
        return 1;
    }

    await setFeaturePassword(showFolder, feature, password);
    const tile = feature === 'shell' ? 'Shell' : 'Files';
    console.log(`${label} password set for ${showFolder}.`);
    console.log(`A ${tile} tile will now appear in this show's Settings screen.`);
    console.log(`Config file: ${configFile}`);
    reportNudge(await nudgeRunningPlayer(port), port);
    return 0;
}
