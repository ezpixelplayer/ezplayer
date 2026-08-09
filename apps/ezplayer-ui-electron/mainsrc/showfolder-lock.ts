/**
 * Contents of the show-folder lock file.
 *
 * The lock itself is advisory and owned by the locking library, which uses a
 * sibling directory. A running player records what port it bound there,
 * which is how another process can learn the port.
 *
 * As the pure-Node CLI reads this to find
 * a running player, MUST stay free of any `electron` import.
 */

import fs from 'fs/promises';
import path from 'path';

export const SHOW_FOLDER_LOCK_FILENAME = '.ezplayer-folder.lock';

export interface ShowFolderLockInfo {
    /** Process id of the player holding the folder. */
    pid?: number;
    /** Ports actually bound, which may differ from the ones requested. */
    webPort?: number;
    kioskPort?: number;
    updatedAt?: string;
}

export function showFolderLockPath(showFolder: string): string {
    return path.join(showFolder, SHOW_FOLDER_LOCK_FILENAME);
}

export async function readShowFolderLock(showFolder: string): Promise<ShowFolderLockInfo | undefined> {
    try {
        const raw = await fs.readFile(showFolderLockPath(showFolder), 'utf8');
        const parsed = JSON.parse(raw) as ShowFolderLockInfo;
        if (!parsed || typeof parsed !== 'object') return undefined;
        return parsed;
    } catch {
        // Absent, unreadable, or written by a version that stored plain text.
        return undefined;
    }
}

/** Merge `info` into the lock file, leaving any keys it does not mention. */
export async function updateShowFolderLock(showFolder: string, info: ShowFolderLockInfo): Promise<void> {
    const merged: ShowFolderLockInfo = {
        ...((await readShowFolderLock(showFolder)) ?? {}),
        ...info,
        updatedAt: new Date().toISOString(),
    };
    // Plain write, not the atomic rename: renaming would swap the inode the
    // lock library is watching.
    await fs.writeFile(showFolderLockPath(showFolder), JSON.stringify(merged, null, 2) + '\n');
}

/** True if a process with this id exists. Signal 0 checks without signalling. */
function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM means it exists but belongs to someone else.
        return (e as { code?: string }).code === 'EPERM';
    }
}

/**
 * Port of the player currently holding this show folder, or undefined.
 *
 * The dead-process check matters: a stale entry would otherwise send callers at
 * whatever unrelated program has since taken that port.
 */
export async function runningPlayerWebPort(showFolder: string): Promise<number | undefined> {
    const info = await readShowFolderLock(showFolder);
    if (!info?.webPort || !Number.isInteger(info.webPort)) return undefined;
    if (info.pid !== undefined && !pidAlive(info.pid)) return undefined;
    return info.webPort;
}
