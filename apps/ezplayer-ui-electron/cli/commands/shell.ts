/** `EZPlayer shell` — set the password that enables the remote terminal.
 *  Body is shared with `EZPlayer files`. */

import { runRemoteAccessCommand } from './remoteaccess.js';

export async function run(args: string[]): Promise<number> {
    return runRemoteAccessCommand('shell', args);
}
