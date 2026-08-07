/** `EZPlayer files` — set the password that enables the file manager.
 *  Body is shared with `EZPlayer shell`. */

import { runRemoteAccessCommand } from './remoteaccess.js';

export async function run(args: string[]): Promise<number> {
    return runRemoteAccessCommand('files', args);
}
