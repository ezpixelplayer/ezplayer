/** `EZPlayer files` — set the password that enables the file manager. */

import { runRemoteAccessCommand } from './remoteaccess.js';

export async function run(args: string[]): Promise<number> {
    return runRemoteAccessCommand('files', args);
}
