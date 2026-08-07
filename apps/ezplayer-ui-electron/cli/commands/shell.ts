/**
 * `EZPlayer shell` — manage the remote-shell password.
 *
 * This is the ONLY way to turn the terminal feature on. Writing the password
 * here is what makes the Shell tile appear in Settings; clearing it makes the
 * feature vanish and kills the endpoint. Deliberately CLI-only: arming a remote
 * shell should require access to the machine, not just access to the UI.
 *
 * The password lives in the show folder (`<showFolder>/.ezplayer/shell.json`),
 * so the folder has to be named. Works with the player stopped — it only
 * touches that file. If a player IS running locally we then nudge it over
 * loopback so the change takes effect without a restart; that nudge is
 * best-effort and never fails the command.
 */

import fs from 'fs';
import path from 'path';
import { SUBDIR_NAME } from '../../mainsrc/data/SettingsMigration.js';
import {
    clearShellPassword,
    readShellConfig,
    setShellPassword,
    shellConfigPath,
    shellEnabled,
} from '../../mainsrc/shellconfig.js';

const DEFAULT_PORT = 3000;
const MIN_PASSWORD_LENGTH = 8;

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
 * than that — writing a shell password into the wrong show would be silently
 * wrong in exactly the way a security setting must not be.
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
            `The shell password lives in that show's ${SUBDIR_NAME}/ config directory, so the\n` +
            `folder has to be named explicitly. Run this from inside a show folder — one that\n` +
            `already has a ${SUBDIR_NAME}/ directory — and it is used automatically.`,
    };
}

async function readLinePlain(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

/** Read one line from stdin with the terminal echo turned off. Falls back to a
 *  plain (echoing) read when stdin isn't a TTY, which is what happens under
 *  `--stdin` and in scripts. */
async function readSecret(prompt: string): Promise<string> {
    const stdin = process.stdin;
    if (stdin.isTTY !== true) return readLinePlain();

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

/** Tell a locally-running player to re-read the config. Loopback only, and the
 *  route it hits is loopback-only on the server side too. */
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

export async function run(args: string[]): Promise<number> {
    const resolved = resolveShowFolder(args);
    if ('error' in resolved) {
        console.error(`error: ${resolved.error}`);
        return 2;
    }
    const { showFolder } = resolved;
    const configFile = shellConfigPath(showFolder);
    const port = localPort(args);

    if (args.includes('--status')) {
        const cfg = await readShellConfig(showFolder);
        console.log(`Show folder:    ${showFolder}`);
        console.log(`Config file:    ${configFile}`);
        console.log(`Remote shell:   ${shellEnabled(cfg) ? 'ENABLED (password set)' : 'disabled (no password set)'}`);
        if (cfg?.updatedAt) console.log(`Last changed:   ${cfg.updatedAt}`);
        if (cfg?.shell) console.log(`Shell override: ${cfg.shell}`);
        return 0;
    }

    if (args.includes('--clear')) {
        if (!(await clearShellPassword(showFolder))) {
            console.log(`No shell password was set for ${showFolder}; nothing to clear.`);
            return 0;
        }
        console.log('Shell password cleared. The terminal is now disabled entirely.');
        console.log(`Config file: ${configFile}`);
        reportNudge(await nudgeRunningPlayer(port), port);
        return 0;
    }

    const inline = flagValue(args, '--password');
    let password: string;
    try {
        if (inline !== undefined) {
            password = inline;
        } else if (args.includes('--stdin')) {
            password = await readLinePlain();
        } else {
            password = await readSecret('New shell password: ');
            const confirm = await readSecret('Confirm password: ');
            if (password !== confirm) {
                console.error('Passwords did not match; nothing was changed.');
                return 1;
            }
        }
    } catch {
        console.error('\nCancelled; nothing was changed.');
        return 1;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters; nothing was changed.`);
        return 1;
    }

    await setShellPassword(showFolder, password);
    console.log(`Shell password set for ${showFolder}.`);
    console.log("A Shell tile will now appear in this show's Settings screen.");
    console.log(`Config file: ${configFile}`);
    reportNudge(await nudgeRunningPlayer(port), port);
    return 0;
}
