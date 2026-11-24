// App processes outlive a player that dies without cleaning up (nothing ties a child to
// its parent on Windows). The supervisor notes every pid it starts; the next player kills
// the ones still alive, after proving by command line that the pid still is that app.

import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { settingsPath } from '../data/SettingsDir.js';

export interface RunningNote {
    pid: number;
    /** The script or executable name the process was started with, to recognize it by. */
    script: string;
    startedAt: number;
}

export type RunningFile = Record<string, RunningNote>;

function filePath(showFolder: string): string {
    return settingsPath(showFolder, 'apps-running.json');
}

export async function writeRunning(showFolder: string, notes: RunningFile): Promise<void> {
    try {
        await fsp.writeFile(filePath(showFolder), JSON.stringify(notes, null, 2));
    } catch (err) {
        console.warn('[apps] could not note running processes:', err);
    }
}

/** The command line of a live process, or undefined when it is gone or unreadable. */
function commandLineOf(pid: number): string | undefined {
    try {
        if (process.platform === 'win32') {
            const out = execFileSync('wmic', ['process', 'where', `processid=${pid}`, 'get', 'commandline'], {
                encoding: 'utf8',
                timeout: 5_000,
                windowsHide: true,
            });
            const line = out
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l && !/^CommandLine$/i.test(l))[0];
            return line;
        }
        const out = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000 });
        return out.trim() || undefined;
    } catch {
        return undefined;
    }
}

function killTree(pid: number): void {
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 10_000,
        });
    } else {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            /* gone */
        }
    }
}

/** Kill app processes a previous player left behind. Returns the instance names it found alive. */
export async function sweepStale(showFolder: string): Promise<string[]> {
    let notes: RunningFile;
    try {
        notes = JSON.parse(await fsp.readFile(filePath(showFolder), 'utf8')) as RunningFile;
    } catch {
        return [];
    }
    const killed: string[] = [];
    for (const [name, note] of Object.entries(notes)) {
        if (!note?.pid || note.pid === process.pid) continue;
        const cmd = commandLineOf(note.pid);
        // A reused pid belongs to someone else unless the command line still names the app.
        if (!cmd || !cmd.includes(note.script)) continue;
        console.warn(`[apps] killing ${name} (pid ${note.pid}) left over from a previous run`);
        killTree(note.pid);
        killed.push(name);
    }
    await writeRunning(showFolder, {});
    return killed;
}
