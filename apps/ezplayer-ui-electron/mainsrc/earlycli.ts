import { app } from 'electron';
import * as path from 'path';

/**
 * Early CLI parsing: an optional verb as the first argument, then flags.
 * Must be main.ts's first import — `--user-data-dir=` has to apply before
 * showfolder/webport/ipcautoupdate construct their electron-stores.
 */

const KNOWN_VERBS = [
    'headless',
    'discover',
    'interfaces',
    'controllers',
    'status',
    'action',
    'upload',
    'shell',
    'help',
] as const;
export type CliVerb = (typeof KNOWN_VERBS)[number];

/**
 * Verbs that run text-only and exit *before* any Electron bootstrap — unlike
 * `headless`, which is a full player that merely has no windows. These are
 * dispatched by cli/dispatch.ts.
 */
const TOOL_VERBS: readonly string[] = [
    'discover',
    'interfaces',
    'controllers',
    'status',
    'action',
    'upload',
    'shell',
    'help',
];

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

/** True for text-only verbs that run and exit before the app bootstraps. */
export function isToolVerb(): boolean {
    return verb !== null && TOOL_VERBS.includes(verb);
}

/**
 * Argv from the verb onward (verb + its flags), for cli/dispatch.ts. Uses the
 * same positional scan as the verb detection, so it is correct both packaged
 * and in dev (where the app path precedes the verb).
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
        '  headless    Run the player with no windows. Requires a valid show',
        '              folder via --show-folder= or a previously configured one.',
        '  discover    Scan networks for lighting controllers (text-only, exits).',
        '  interfaces  List this host\'s networks (text-only, exits).',
        '  controllers Show the controller reconcile state from the running app.',
        '  status      Deep-read one controller and print its detail report.',
        '  action      Run a management action (e.g. reboot) on a controller.',
        '  upload      Upload xLights-derived config to a controller (via the app).',
        '  help        Show help for a verb, e.g. `ezplayer help discover`.',
        '',
        'Common options:',
        '  --show-folder=<path>    xLights show folder to open',
        '  --web-port=<port>       Web UI / API port (default 3000)',
        '  --kiosk-port=<port>     Kiosk port (default 3001, 0 disables)',
        '  --user-data-dir=<path>  Isolate all persisted app state to <path>',
    ].join('\n');
}

// --user-data-dir: redirect userData/sessionData/logs (isolated test/second instances)
const udArg = process.argv.find((a) => a.startsWith('--user-data-dir='));
if (udArg) {
    const dir = path.resolve(udArg.substring('--user-data-dir='.length));
    app.setPath('userData', dir);
    app.setPath('sessionData', dir);
    app.setAppLogsPath(path.join(dir, 'logs'));
}
