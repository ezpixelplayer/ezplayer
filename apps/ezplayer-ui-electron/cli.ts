/**
 * Pure-Node CLI entry → dist/cli.js. Runs the headless commands with zero
 * Electron in the process (for dev/headless/CI). The packaged EZPlayer.exe
 * reaches the same commands via the early guard in main.ts.
 *
 *   node dist/cli.js discover --networks 192.168.1.0/24
 */

import { runCli } from './cli/dispatch.js';

runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
        console.error(e);
        process.exit(1);
    },
);
