/**
 * Headless CLI dispatch — maps a verb to a command module.
 *
 * MUST stay free of any `electron` import: both the Electron entry and the
 * pure-Node CLI entry reach this. No verb (or `gui`) means "launch the app",
 * and the APP_VERBS need Electron; main.ts handles those. This module only
 * documents them and rejects them in the pure-Node entry.
 */

type CommandModule = { run: (args: string[]) => Promise<number> };

/**
 * Single source of truth for the text-only verbs, in the order usage output
 * lists them. These run in the pure-Node entry as well as the desktop binary.
 */
export const TOOL_VERBS = ['play', 'stats', 'discover', 'interfaces', 'controller', 'shell', 'files', 'help'] as const;

export type ToolVerb = (typeof TOOL_VERBS)[number];

/**
 * Verbs that need the Electron runtime (session, electron-store, the player),
 * so they exist only in the desktop binary; main.ts runs them after
 * `app.whenReady()`. The pure-Node entry rejects them with a pointer there.
 */
export const APP_VERBS = ['headless', 'reset'] as const;
export type AppVerb = (typeof APP_VERBS)[number];

const APP_USAGE: Record<AppVerb, { summary: string; detail: string }> = {
    headless: {
        summary: 'Run the full player with no windows.',
        detail:
            'Usage: EZPlayer headless [--show-folder=<dir>] [--web-port=<n>] [--kiosk-port=<n>]\n' +
            '                         [--user-data-dir=<dir>]\n' +
            '\n' +
            'Runs the player — scheduled and API-driven playback, light output, the LAN\n' +
            'web/API server, kiosk server and cloud connectivity — exactly as the windowed\n' +
            'app does, but without any windows or local speaker output. Requires a valid\n' +
            'show folder via --show-folder= or a previously configured one. Never modifies\n' +
            'persisted preferences. Stop it with Ctrl-C or SIGTERM.\n' +
            '\n' +
            'EZPLAYER_HEADLESS=1 in the environment is equivalent to the verb.\n' +
            '\n' +
            'Exit codes: 2 = no/invalid show folder, 3 = show folder locked by another\n' +
            'EZPlayer, 64 = unknown verb.',
    },
    reset: {
        summary: "Clear EZPlayer's persisted state and quit (back to the welcome screen).",
        detail:
            'Usage: EZPlayer reset [--no-cloud] [--user-data-dir=<dir>]\n' +
            '\n' +
            'Forgets the persisted show-folder pointer and clears the renderer\'s\n' +
            'localStorage, then quits without starting a show. The next launch shows the\n' +
            'welcome screen again so a new show folder can be picked. Your show folder\n' +
            "files are not touched — only EZPlayer's stored pointer to the folder.\n" +
            '\n' +
            '      --no-cloud       pin the welcome screen to local/xLights only (hide the\n' +
            '                       cloud option) on the next launch\n' +
            '      --cloud          show the cloud option on the next launch (the default)\n' +
            '      --user-data-dir  reset the isolated profile in <dir> instead of the\n' +
            '                       default one\n' +
            '\n' +
            'The legacy flags --reset, --reset-cloud and --reset-nocloud still work as\n' +
            'aliases of `reset` and `reset --no-cloud`.',
    },
};

/** True for a verb that only the desktop binary can run. */
export function isAppVerbName(verb: string): verb is AppVerb {
    return (APP_VERBS as readonly string[]).includes(verb);
}

export function appVerbSummary(verb: AppVerb): string {
    return APP_USAGE[verb].summary;
}

/** Full `--help` text for an app-only verb. */
export function appVerbUsage(verb: AppVerb): string {
    return APP_USAGE[verb].detail;
}

export type ResetOptions = { showCloud: boolean };

/**
 * Parse the options after `reset`: the options, `'help'`, or an error for an
 * unknown argument. Pure so it is unit-testable; mainsrc/reset.ts acts on it.
 */
export function parseResetArgs(args: string[]): ResetOptions | 'help' | { error: string } {
    let showCloud = true;
    for (const a of args) {
        if (HELP_FLAGS.has(a)) return 'help';
        else if (a === '--no-cloud' || a === '--nocloud') showCloud = false;
        else if (a === '--cloud') showCloud = true;
        else if (a.startsWith('--user-data-dir=')) continue; // applied by earlycli
        else return { error: `Unknown option "${a}" for reset.` };
    }
    return { showCloud };
}

/** `help` is answered inline; `controller` dispatches to a subcommand. */
type DispatchableVerb = Exclude<ToolVerb, 'help' | 'controller'>;

/**
 * Everything that acts on lighting controllers lives under one verb.
 */
export const CONTROLLER_SUBCOMMANDS = ['list', 'status', 'action', 'upload'] as const;
export type ControllerSubcommand = (typeof CONTROLLER_SUBCOMMANDS)[number];

const COMMANDS: Record<DispatchableVerb, () => Promise<CommandModule>> = {
    play: () => import('./commands/play.js'),
    stats: () => import('./commands/stats.js'),
    discover: () => import('./commands/discover.js'),
    interfaces: () => import('./commands/interfaces.js'),
    shell: () => import('./commands/shell.js'),
    files: () => import('./commands/files.js'),
};

const CONTROLLER_COMMANDS: Record<ControllerSubcommand, () => Promise<CommandModule>> = {
    list: () => import('./commands/controllers.js'),
    status: () => import('./commands/status.js'),
    action: () => import('./commands/action.js'),
    upload: () => import('./commands/upload.js'),
};

const HELP_SUMMARY = 'Show help for a verb, e.g. `EZPlayer help discover`.';
const CONTROLLER_SUMMARY = 'Inspect and manage lighting controllers.';

/** One-line summary for any verb, including the ones answered inline. */
export function toolVerbSummary(verb: ToolVerb): string {
    if (verb === 'help') return HELP_SUMMARY;
    if (verb === 'controller') return CONTROLLER_SUMMARY;
    return USAGE[verb].summary;
}

/** One-line + detailed usage per command, for `--help`. */
const USAGE: Record<DispatchableVerb | ControllerSubcommand, { summary: string; detail: string }> = {
    play: {
        summary: 'Play a sequence on the running player and report playback statistics.',
        detail:
            'Usage: EZPlayer play <sequence> [--host <host[:port]>] [--show-folder <dir>]\n' +
            '                       [--duration <s>] [--interval <s>] [--no-output]\n' +
            '                       [--keep-playing] [--json] [--quiet]\n' +
            '\n' +
            'Plays <sequence> (its id, title, or .fseq file name) as an immediate jukebox\n' +
            'play on the running app — windowed or `EZPlayer headless` — resets the\n' +
            'cumulative counters first, prints one trace line per sample to stderr while\n' +
            'it plays, and a summary at the end: frames sent / skipped (late) / missed\n' +
            '(no data), worst lag, send time, playback-loop delay, FSEQ cache fetches,\n' +
            'hits/misses, read + decompress time. Stops the sequence when done.\n' +
            '\n' +
            'Typical benchmark run against a show folder, no controllers needed:\n' +
            '  EZPlayer headless --show-folder=<dir> --web-port=3123\n' +
            '  EZPlayer play "My Song" --host 127.0.0.1:3123 --no-output\n' +
            '\n' +
            '      --host          the EZPlayer to drive. Without it, the local player is\n' +
            '                      found via the show folder lock file (see --show-folder),\n' +
            '                      then EZPLAYER_WEB_PORT, then 127.0.0.1:3000\n' +
            '  -s, --show-folder   show folder whose lock file names the running player\n' +
            '                      (default: the current directory, if it is a show folder)\n' +
            '  -d, --duration      seconds to run (default: the sequence length + 2)\n' +
            '  -i, --interval      seconds between samples (default 1)\n' +
            '      --no-output     suppress controller output for the run (frames are\n' +
            '                      still produced and previewed; nothing goes on the wire)\n' +
            '      --keep-playing  leave the sequence playing at the end\n' +
            '      --json          machine-readable summary + samples on stdout\n' +
            '  -q, --quiet         no per-sample trace',
    },
    stats: {
        summary: "Print the running player's playback statistics.",
        detail:
            'Usage: EZPlayer stats [--host <host[:port]>] [--show-folder <dir>] [--reset]\n' +
            '                      [--watch [<s>]] [--json]\n' +
            '\n' +
            "The same counters as the Status screen's stats dialog, as text.\n" +
            '      --host          the EZPlayer to ask; defaults like `play` (lock file,\n' +
            '                      then EZPLAYER_WEB_PORT, then 127.0.0.1:3000)\n' +
            '  -s, --show-folder   show folder whose lock file names the running player\n' +
            '      --reset         reset the cumulative counters first\n' +
            '  -w, --watch         keep sampling every <s> seconds (default 1), one trace\n' +
            '                      line per sample, until interrupted\n' +
            '      --json          raw {stats, pStatus, serverNow} JSON on stdout',
    },
    discover: {
        summary: 'Scan networks for lighting controllers.',
        detail:
            'Usage: EZPlayer discover [--networks <cidr[,cidr...]>] [--depth sweep|identify|full] [--fpp-proxy] [--ezp-proxy]\n' +
            '\n' +
            '  -n, --networks  comma-separated CIDRs to scan (e.g. 192.168.1.0/24).\n' +
            '                  Omit to scan every external host network.\n' +
            '  -d, --depth     sweep    = liveness only (IP/MAC/protocols)\n' +
            '                  identify = + driver-confirm vendor/model/firmware (default)\n' +
            '                  full     = + full per-device detail\n' +
            '      --fpp-proxy recurse one level through FPP proxies (identify/full only)\n' +
            '      --ezp-proxy federate one level through discovered EZPlayers via their\n' +
            '                  scan API (identify/full only)',
    },
    interfaces: {
        summary: "List this host's networks (CIDRs to feed --networks).",
        detail: 'Usage: EZPlayer interfaces',
    },
    list: {
        summary: 'Show the controller reconcile state (known vs. scanned).',
        detail:
            'Usage: EZPlayer controller list [--host <host[:port]>] [--json]\n' +
            '\n' +
            "Prints the running app's controller state: known controllers (xLights ∪\n" +
            'records) joined against scanned devices — present/absent/unregistered —\n' +
            'plus recent operations and network policies.\n' +
            '\n' +
            '      --host  the EZPlayer to ask (default 127.0.0.1:3000; the port also\n' +
            '              honors EZPLAYER_WEB_PORT)\n' +
            '      --json  raw ControllerOpsState JSON on stdout',
    },
    status: {
        summary: 'Deep-read one controller and print its detail report.',
        detail:
            'Usage: EZPlayer controller status <ip-or-name> [--host <host[:port]>] [--fpp-proxy <ip>] [--json]\n' +
            '\n' +
            'Probes the device directly (standalone for an IP target). A name is\n' +
            "resolved through the running app's known/scanned state (--host).\n" +
            '      --fpp-proxy  route the probe through an FPP-style /proxy bridge\n' +
            '      --json       raw ControllerReport JSON on stdout',
    },
    action: {
        summary: 'Run a management action (e.g. reboot) on a controller.',
        detail:
            'Usage: EZPlayer controller action <ip-or-name> <actionId> [--host <host[:port]>] [--fpp-proxy <ip>]\n' +
            '       EZPlayer controller action <ip-or-name> --list\n' +
            '\n' +
            'Identifies the device, then dispatches the driver action directly.\n' +
            "      --list       enumerate the actions the device's driver offers\n" +
            '      --fpp-proxy  route the probe through an FPP-style /proxy bridge',
    },
    upload: {
        summary: 'Upload xLights-derived config to a controller (via the app).',
        detail:
            'Usage: EZPlayer controller upload <name> [--scope inputs|strings|full] [--host <host[:port]>]\n' +
            '\n' +
            "Pushes the show's xLights intent for the known controller <name> through\n" +
            'the running app (which owns the intent + does a post-upload read-back).\n' +
            '      --scope  inputs  = input/universe config only\n' +
            '               strings = string/port outputs only\n' +
            '               full    = both (default)',
    },
    shell: {
        summary: 'Set the password that enables the remote terminal.',
        detail: remoteAccessUsage('shell'),
    },
    files: {
        summary: 'Set the password that enables the file manager.',
        detail: remoteAccessUsage('files'),
    },
};

/** Both remote-access verbs take identical options and differ only in what they
 *  unlock, so their help is generated from one template. */
function remoteAccessUsage(verb: 'shell' | 'files'): string {
    const what =
        verb === 'shell'
            ? 'a terminal on the player machine'
            : "a file manager for the player's show folder (browse, upload,\n" + 'download, rename, move and delete)';
    const tile = verb === 'shell' ? 'Shell' : 'Files';
    const pad = ' '.repeat(5 - verb.length);
    return (
        `Usage: EZPlayer ${verb}${pad}[--show-folder <dir>] (--password-file <f> | --password <pw>)\n` +
        `       EZPlayer ${verb}${pad}[--show-folder <dir>] --clear\n` +
        `       EZPlayer ${verb}${pad}[--show-folder <dir>] --status\n` +
        '\n' +
        `This feature is OFF and unreachable until a password is set here, and\n` +
        `there is no way to set one from the UI. Once set, a ${tile} tile appears in\n` +
        `that show's Settings screen; opening it asks for this password and then\n` +
        `gives you ${what}, over the LAN UI or the cloud alike.\n` +
        '\n' +
        'The terminal and the file manager have SEPARATE passwords, so granting\n' +
        'one does not grant the other.\n' +
        '\n' +
        'Passwords are stored hashed in\n' +
        '<show folder>/.ezplayer/remote-access.json, so they are per-show settings\n' +
        'that travel with the folder. Give the folder with --show-folder; if the\n' +
        'current directory is already a show folder (it has a .ezplayer/\n' +
        'directory) that one is used.\n' +
        '\n' +
        'Works whether or not a player is running. If one is running locally it is\n' +
        'nudged over loopback to pick the change up without a restart.\n' +
        '\n' +
        'WINDOWS: Use the ezplayer.cmd launcher installed beside EZPlayer;\n' +
        'then --stdin and exit codes behave normally.\n' +
        '\n' +
        'Prefer --password-file over --password: it keeps the password out of your\n' +
        'shell history and out of the process list. Delete the file afterwards.\n' +
        '\n' +
        '      --show-folder    the show to set the password for (default: the\n' +
        '                       current directory, if it is a show folder)\n' +
        '      --password-file  read the password from the first line of a file\n' +
        '      --password       the new password, given inline (see caveat above)\n' +
        '      --stdin          read the password from stdin (not on Windows GUI)\n' +
        '      --clear          remove the password, disabling this feature entirely\n' +
        '      --status         report whether it is enabled for this show\n' +
        '      --port           loopback port of the running player (default 3000;\n' +
        '                       also honors EZPLAYER_WEB_PORT)'
    );
}

const HELP_FLAGS = new Set(['help', '--help', '-h']);

/** Narrow an arbitrary bareword to a verb that has a command module. */
function isDispatchable(verb: string): verb is DispatchableVerb {
    return Object.prototype.hasOwnProperty.call(COMMANDS, verb);
}

/** Whether an arbitrary bareword is one of our text-only verbs. */
export function isToolVerbName(verb: string): verb is ToolVerb {
    return (TOOL_VERBS as readonly string[]).includes(verb);
}

function printTopHelp(): void {
    console.log('EZPlayer — command line\n');
    console.log('Usage: EZPlayer [<command>] [options]\n');
    console.log('Commands:');
    for (const verb of TOOL_VERBS) {
        console.log(`  ${verb.padEnd(12)} ${toolVerbSummary(verb)}`);
        if (verb === 'controller') {
            for (const sub of CONTROLLER_SUBCOMMANDS) {
                console.log(`    ${sub.padEnd(10)} ${USAGE[sub].summary}`);
            }
        }
    }
    console.log('\nDesktop-app commands (EZPlayer binary only, not the console launcher):');
    for (const verb of APP_VERBS) {
        console.log(`  ${verb.padEnd(12)} ${appVerbSummary(verb)}`);
    }
    console.log('\nRun "EZPlayer <command> --help" (or "EZPlayer help <command>") for options.');
    console.log('With no command (or `gui`), EZPlayer launches the desktop app.');
}

/** Detail help for a verb (or `controller <sub>`), or null when there is none. */
function verbDetail(verb: string, sub?: string): string | null {
    if (verb === 'controller') {
        return sub && isControllerSubcommand(sub) ? USAGE[sub].detail : null;
    }
    if (isDispatchable(verb)) return USAGE[verb].detail;
    if (isAppVerbName(verb)) return APP_USAGE[verb].detail;
    return null;
}

/** `help [<verb> [<sub>]]`, also reached via `--help`/`-h` as the first arg. */
function runHelp(rest: string[]): number {
    const [verb, sub] = rest;
    if (!verb) {
        printTopHelp();
        return 0;
    }
    if (verb === 'controller' && !sub) {
        printControllerHelp();
        return 0;
    }
    const detail = verbDetail(verb, sub);
    if (detail === null) {
        console.error(`Unknown command "${rest.join(' ')}".\n`);
        printTopHelp();
        return 2;
    }
    console.log(detail);
    return 0;
}

function printControllerHelp(): void {
    console.log(`EZPlayer controller — ${CONTROLLER_SUMMARY}\n`);
    console.log('Usage: EZPlayer controller <subcommand> [options]\n');
    console.log('Subcommands:');
    for (const sub of CONTROLLER_SUBCOMMANDS) {
        console.log(`  ${sub.padEnd(10)} ${USAGE[sub].summary}`);
    }
    console.log('\nRun "EZPlayer controller <subcommand> --help" for its options.');
}

function isControllerSubcommand(name: string): name is ControllerSubcommand {
    return Object.prototype.hasOwnProperty.call(CONTROLLER_COMMANDS, name);
}

/** Resolve `controller <sub>` to a loader, printing help or an error itself. */
async function runControllerVerb(rest: string[]): Promise<number> {
    const [sub, ...subRest] = rest;

    if (!sub || HELP_FLAGS.has(sub)) {
        printControllerHelp();
        return sub ? 0 : 2;
    }
    if (!isControllerSubcommand(sub)) {
        console.error(`Unknown controller subcommand "${sub}".\n`);
        printControllerHelp();
        return 2;
    }
    if (subRest.some((a) => HELP_FLAGS.has(a))) {
        console.log(USAGE[sub].detail);
        return 0;
    }
    const mod = await CONTROLLER_COMMANDS[sub]();
    return mod.run(subRest);
}

/** True if `verb` should run headless. Any bareword is claimed by the CLI —
 *  even an unknown one, so a typo errors out instead of silently launching the
 *  GUI. Leading-dash args are GUI/Chromium flags and fall through, apart from
 *  the help flags. */
export function isHeadlessVerb(verb: string | undefined): boolean {
    if (!verb || verb === 'gui') return false;
    if (verb.startsWith('-')) return HELP_FLAGS.has(verb);
    return true;
}

export async function runCli(args: string[]): Promise<number> {
    const [verb, ...rest] = args;

    if (!verb || HELP_FLAGS.has(verb)) return runHelp(rest);

    // Only the pure-Node entry gets here with `gui` or an app-only verb — the
    // desktop binary handles them in main.ts before reaching runCli.
    if (verb === 'gui') {
        console.error('The `gui` verb launches the desktop app; it is not available in the headless CLI.');
        console.error('Run the EZPlayer app directly, or with no command.\n');
        printTopHelp();
        return 2;
    }
    if (isAppVerbName(verb)) {
        if (rest.some((a) => HELP_FLAGS.has(a))) {
            console.log(APP_USAGE[verb].detail);
            return 0;
        }
        console.error(`The \`${verb}\` command needs the desktop app runtime; it is not available in the headless CLI.`);
        console.error(`Run it on the EZPlayer app binary instead, e.g. \`EZPlayer.exe ${verb}\` (not the console launcher).\n`);
        printTopHelp();
        return 2;
    }

    if (verb === 'controller') return runControllerVerb(rest);

    if (!isDispatchable(verb)) {
        console.error(`Unknown command "${verb}".\n`);
        printTopHelp();
        return 2;
    }

    if (rest.some((a) => HELP_FLAGS.has(a))) {
        console.log(USAGE[verb].detail);
        return 0;
    }

    const mod = await COMMANDS[verb]();
    return mod.run(rest);
}
