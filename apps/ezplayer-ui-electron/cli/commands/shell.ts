/** `EZPlayer shell` — set the password that enables the remote terminal.    */

import { runRemoteAccessCommand } from './remoteaccess.js';

export async function run(args: string[]): Promise<number> {
    return runRemoteAccessCommand('shell', args);
}
