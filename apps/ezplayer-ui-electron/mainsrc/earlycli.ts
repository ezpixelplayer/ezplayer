import { app } from 'electron';
import * as path from 'path';

/**
 * Early CLI parsing. This module's side effects MUST run before any
 * electron-store construction (showfolder.ts, webport.ts, ipcautoupdate.ts all
 * build Stores at import time), so it has to be the first import of main.ts —
 * `--user-data-dir=` redirects everything those Stores persist.
 *
 * CLI shape: an optional verb as the first argument, then flags.
 *   EZPlayer.exe [<verb>] [--flags...]
 *   electron dist/main.js [<verb>] [--flags...]
 * No verb = the windowed GUI app, exactly as before. Squirrel/Chromium noise
 * arguments are all dash-prefixed, so they can never be mistaken for a verb.
 */

const KNOWN_VERBS = ['headless'] as const;
export type CliVerb = (typeof KNOWN_VERBS)[number];

// argv[0] is the executable; in dev (unpackaged) argv[1] is the app path.
const args = process.argv.slice(app.isPackaged ? 1 : 2);

let verb: CliVerb | null = null;
let unknownVerb: string | null = null;
const first = args[0];
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

export function cliUsage(): string {
    return [
        'Usage: ezplayer [<verb>] [options]',
        '',
        'Verbs:',
        '  (none)      Launch the windowed player.',
        '  headless    Run the player with no windows. Requires a valid show',
        '              folder via --show-folder= or a previously configured one.',
        '',
        'Common options:',
        '  --show-folder=<path>    xLights show folder to open',
        '  --web-port=<port>       Web UI / API port (default 3000)',
        '  --kiosk-port=<port>     Kiosk port (default 3001, 0 disables)',
        '  --user-data-dir=<path>  Isolate all persisted app state to <path>',
    ].join('\n');
}

// --user-data-dir: redirect userData/sessionData/logs so a headless or test
// instance never touches (or poisons) the interactive install's state.
const udArg = process.argv.find((a) => a.startsWith('--user-data-dir='));
if (udArg) {
    const dir = path.resolve(udArg.substring('--user-data-dir='.length));
    app.setPath('userData', dir);
    app.setPath('sessionData', dir);
    app.setAppLogsPath(path.join(dir, 'logs'));
}
