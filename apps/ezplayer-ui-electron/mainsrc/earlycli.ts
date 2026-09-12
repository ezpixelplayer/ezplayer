import { app } from 'electron';
import * as path from 'path';

/**
 * Early CLI parsing: an optional verb as the first argument, then flags.
 * Must be the entry point's first import as `--user-data-dir=` has to apply
 * before anything constructs an electron-store.
 */

/**
 * APP_VERBS need the Electron runtime and run after app.whenReady(); TOOL_VERBS
 * run text-only and exit *before* any Electron bootstrap.
 */
import {
    APP_VERBS,
    appVerbSummary,
    isToolVerbName,
    TOOL_VERBS,
    toolVerbSummary,
    type AppVerb,
    type ToolVerb,
} from '../cli/dispatch.js';

const KNOWN_VERBS = [...APP_VERBS, ...TOOL_VERBS] as const;
export type CliVerb = (typeof KNOWN_VERBS)[number];

/** Deprecated aliases of `reset`, kept so existing shortcuts and scripts work. */
const LEGACY_RESET_FLAGS = ['--reset', '--reset-cloud', '--reset-nocloud'] as const;

// The verb is the first non-flag argument after the executable (and, in dev,
// after the app path). Chromium switches can precede the app path.
function firstPositionalIndex(argv: string[]): number {
    let i = 1; // skip executable
    while (i < argv.length && argv[i].startsWith('-')) i++;
    if (!app.isPackaged && i < argv.length) i++; // skip the app path
    while (i < argv.length && argv[i].startsWith('-')) i++;
    return i;
}

let verb: CliVerb | null = null;
let unknownVerb: string | null = null;
const firstIndex = firstPositionalIndex(process.argv);
const first = process.argv[firstIndex];
if (first && !first.startsWith('-')) {
    if ((KNOWN_VERBS as readonly string[]).includes(first)) {
        verb = first as CliVerb;
    } else {
        unknownVerb = first;
    }
}
if (!verb && !unknownVerb && process.env.EZPLAYER_HEADLESS === '1') {
    verb = 'headless';
}

export function getCliVerb(): CliVerb | null {
    return verb;
}

/** Non-null when the first positional argument wasn't a recognized verb. */
export function getUnknownVerb(): string | null {
    return unknownVerb;
}

export function isHeadless(): boolean {
    return verb === 'headless';
}

/**
 * Arguments for the `reset` verb, or null when no reset was asked for. The
 * legacy flags map onto the verb's options: `--reset` / `--reset-cloud` →
 * `reset`, `--reset-nocloud` → `reset --no-cloud`.
 */
export function getResetArgs(): string[] | null {
    if (verb === 'reset') return getCliArgs().slice(1);
    const legacy = LEGACY_RESET_FLAGS.find((f) => process.argv.includes(f));
    if (!legacy) return null;
    console.warn(`EZPlayer: ${legacy} is deprecated; use \`EZPlayer reset${legacy === '--reset-nocloud' ? ' --no-cloud' : ''}\`.`);
    return legacy === '--reset-nocloud' ? ['--no-cloud'] : [];
}

/** True for text-only verbs that run and exit before the app bootstraps. */
export function isToolVerb(): boolean {
    return verb !== null && isToolVerbName(verb);
}

/**
 * Argv from the verb onward (verb + its flags). Uses the same positional scan
 * as the verb detection, so it is correct both packaged and in dev, where the
 * app path precedes the verb.
 */
export function getCliArgs(): string[] {
    return process.argv.slice(firstIndex);
}

export function cliUsage(): string {
    return [
        'Usage: ezplayer [<verb>] [options]',
        '',
        'Verbs:',
        '  (none)      Launch the windowed player.',
        ...APP_VERBS.map((verb: AppVerb) => `  ${verb.padEnd(11)} ${appVerbSummary(verb)}`),
        ...TOOL_VERBS.map((verb: ToolVerb) => `  ${verb.padEnd(11)} ${toolVerbSummary(verb)}`),
        '',
        'Common options:',
        '  --show-folder=<path>    xLights show folder to open',
        '  --web-port=<port>       Web UI / API port (default 3000)',
        '  --kiosk-port=<port>     Kiosk port (default 3001, 0 disables)',
        '  --user-data-dir=<path>  Isolate all persisted app state to <path>',
    ].join('\n');
}

const udArg = process.argv.find((a) => a.startsWith('--user-data-dir='));
if (udArg) {
    const dir = path.resolve(udArg.substring('--user-data-dir='.length));
    app.setPath('userData', dir);
    app.setPath('sessionData', dir);
    app.setAppLogsPath(path.join(dir, 'logs'));
}
