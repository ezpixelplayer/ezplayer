/**
 * Headless CLI dispatch — maps a verb to a command module.
 *
 * MUST stay free of any `electron` import: both the Electron entry and the
 * pure-Node CLI entry reach this. No verb (or `gui`) means "launch the app",
 * which is not handled here.
 */

type CommandModule = { run: (args: string[]) => Promise<number> };

/**
 * Single source of truth for verbs, in the order usage output lists them.
 */
export const TOOL_VERBS = ['discover', 'interfaces', 'controller', 'shell', 'files', 'help'] as const;

export type ToolVerb = (typeof TOOL_VERBS)[number];

/** `help` is answered inline; `controller` dispatches to a subcommand. */
type DispatchableVerb = Exclude<ToolVerb, 'help' | 'controller'>;

/**
 * Everything that acts on lighting controllers lives under one verb.
 */
export const CONTROLLER_SUBCOMMANDS = ['list', 'status', 'action', 'upload'] as const;
export type ControllerSubcommand = (typeof CONTROLLER_SUBCOMMANDS)[number];

const COMMANDS: Record<DispatchableVerb, () => Promise<CommandModule>> = {
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
    discover: {
        summary: 'Scan networks for lighting controllers.',
        detail:
            'Usage: EZPlayer discover [--networks <cidr[,cidr…]>] [--depth sweep|identify|full] [--fpp-proxy] [--ezp-proxy]\n' +
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
    console.log('EZPlayer — headless commands\n');
    console.log('Usage: EZPlayer <command> [options]\n');
    console.log('Commands:');
    for (const verb of TOOL_VERBS) {
        console.log(`  ${verb.padEnd(12)} ${toolVerbSummary(verb)}`);
        if (verb === 'controller') {
            for (const sub of CONTROLLER_SUBCOMMANDS) {
                console.log(`    ${sub.padEnd(10)} ${USAGE[sub].summary}`);
            }
        }
    }
    console.log('\nRun "EZPlayer <command> --help" for command options.');
    console.log('With no command (or `gui`), EZPlayer launches the desktop app.');
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

    if (!verb || HELP_FLAGS.has(verb)) {
        printTopHelp();
        return 0;
    }

    // Only the pure-Node entry gets here with `gui` — no window to open.
    if (verb === 'gui') {
        console.error('The `gui` verb launches the desktop app; it is not available in the headless CLI.');
        console.error('Run the EZPlayer app directly, or with no command.\n');
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
