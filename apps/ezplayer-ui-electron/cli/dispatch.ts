/**
 * Headless CLI dispatch — maps a verb to a command module.
 *
 * MUST stay free of any `electron` import: this is reached from both the
 * Electron entry (main.ts) and the pure-Node entry (cli.ts → dist/cli.js).
 * The absence of a verb (or `gui`) means "launch the app" — handled by
 * main.ts, not here.
 */

type CommandModule = { run: (args: string[]) => Promise<number> };

const COMMANDS: Record<string, () => Promise<CommandModule>> = {
    discover: () => import('./commands/discover.js'),
    interfaces: () => import('./commands/interfaces.js'),
    controllers: () => import('./commands/controllers.js'),
    status: () => import('./commands/status.js'),
    action: () => import('./commands/action.js'),
    upload: () => import('./commands/upload.js'),
};

/** One-line + detailed usage per command, for `--help`. */
const USAGE: Record<string, { summary: string; detail: string }> = {
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
    controllers: {
        summary: 'Show the controller reconcile state (known vs. scanned).',
        detail:
            'Usage: EZPlayer controllers [--host <host[:port]>] [--json]\n' +
            '\n' +
            'Prints the running app\'s controller state: known controllers (xLights ∪\n' +
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
            'Usage: EZPlayer status <ip-or-name> [--host <host[:port]>] [--fpp-proxy <ip>] [--json]\n' +
            '\n' +
            'Probes the device directly (standalone for an IP target). A name is\n' +
            'resolved through the running app\'s known/scanned state (--host).\n' +
            '      --fpp-proxy  route the probe through an FPP-style /proxy bridge\n' +
            '      --json       raw ControllerReport JSON on stdout',
    },
    action: {
        summary: 'Run a management action (e.g. reboot) on a controller.',
        detail:
            'Usage: EZPlayer action <ip-or-name> <actionId> [--host <host[:port]>] [--fpp-proxy <ip>]\n' +
            '       EZPlayer action <ip-or-name> --list\n' +
            '\n' +
            'Identifies the device, then dispatches the driver action directly.\n' +
            '      --list       enumerate the actions the device\'s driver offers\n' +
            '      --fpp-proxy  route the probe through an FPP-style /proxy bridge',
    },
    upload: {
        summary: 'Upload xLights-derived config to a controller (via the app).',
        detail:
            'Usage: EZPlayer upload <name> [--scope inputs|strings|full] [--host <host[:port]>]\n' +
            '\n' +
            'Pushes the show\'s xLights intent for the known controller <name> through\n' +
            'the running app (which owns the intent + does a post-upload read-back).\n' +
            '      --scope  inputs  = input/universe config only\n' +
            '               strings = string/port outputs only\n' +
            '               full    = both (default)',
    },
};

const HELP_FLAGS = new Set(['help', '--help', '-h']);

function printTopHelp(): void {
    console.log('EZPlayer — headless commands\n');
    console.log('Usage: EZPlayer <command> [options]\n');
    console.log('Commands:');
    for (const [name, u] of Object.entries(USAGE)) {
        console.log(`  ${name.padEnd(12)} ${u.summary}`);
    }
    console.log('\nRun "EZPlayer <command> --help" for command options.');
    console.log('With no command (or `gui`), EZPlayer launches the desktop app.');
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

/** Run the command named by args[0] with the remaining args. Returns an exit code. */
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

    const loader = COMMANDS[verb];
    if (!loader) {
        console.error(`Unknown command "${verb}".\n`);
        printTopHelp();
        return 2;
    }

    if (rest.some((a) => HELP_FLAGS.has(a))) {
        console.log(USAGE[verb].detail);
        return 0;
    }

    const mod = await loader();
    return mod.run(rest);
}
