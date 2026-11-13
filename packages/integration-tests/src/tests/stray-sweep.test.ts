/**
 * The stray sweep, and above all what it refuses to do.
 *
 * A spawned player can outlive the run that started it, and finding it
 * afterwards used to mean guessing from process names and start times. That
 * guess is dangerous: it has already cost somebody an unrelated process. So
 * the sweep kills a pid only when the live process still carries the
 * `--user-data-dir` marker its note was written for, and leaves anything else
 * alone. These tests are about that boundary, not about the killing.
 *
 * Each sweep here runs against its own registry directory, so the suite can
 * never reach a lab run that is genuinely in progress.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stopStrayEzPlayers, harnessRegistryDir } from '../harness/ezplayer-proc.js';

const alive: ChildProcess[] = [];

afterEach(() => {
    for (const c of alive.splice(0)) {
        if (c.exitCode === null) c.kill('SIGKILL');
    }
});

/**
 * A harmless long-running process, standing in for somebody else's work.
 *
 * It has to be a script *file*: with `node -e`, a trailing `--user-data-dir=`
 * is read as an unknown node option and the process exits at once, which looks
 * to a sweep exactly like a stale note.
 */
function bystander(marker: string): ChildProcess {
    const script = path.join(mkdtempSync(path.join(os.tmpdir(), 'ezp-bystander-')), 'idle.cjs');
    writeFileSync(script, 'setTimeout(() => {}, 60000);');
    const child = spawn(process.execPath, [script, marker], { stdio: 'ignore' });
    alive.push(child);
    return child;
}

function noteFor(dir: string, pid: number, marker: string): string {
    const file = path.join(dir, `${pid}.json`);
    writeFileSync(
        file,
        JSON.stringify({ pid, port: 1, userDataDir: 'unused', startedAt: new Date().toISOString(), marker }),
    );
    return file;
}

function registry(): string {
    return mkdtempSync(path.join(os.tmpdir(), 'ezp-sweep-test-'));
}

/** Wait briefly for a process to die, so a kill is not raced. */
async function exited(child: ChildProcess, ms = 10_000): Promise<boolean> {
    if (child.exitCode !== null) return true;
    return await Promise.race([
        new Promise<boolean>((r) => child.once('exit', () => r(true))),
        new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
    ]);
}

describe('the stray sweep', () => {
    it('leaves a process alone when the note does not match it', async () => {
        // The accident this prevents: a pid that is no longer ours, or was
        // never ours, named in a note.
        const dir = registry();
        const victim = bystander('--user-data-dir=C:/somewhere/real');
        expect(victim.pid).toBeDefined();
        const note = noteFor(dir, victim.pid!, '--user-data-dir=C:/a/path/this/process/never/had');

        const sweep = stopStrayEzPlayers({ dir });

        expect(sweep.killed).toEqual([]);
        expect(sweep.spared).toEqual([
            { pid: victim.pid, reason: 'running process is not the one this note was written for' },
        ]);
        // Still running, which is the whole point.
        expect(await exited(victim, 1500)).toBe(false);
        expect(victim.exitCode).toBeNull();
        // The misleading note is gone, so it cannot mislead a later sweep.
        expect(existsSync(note)).toBe(false);
    });

    it('stops a process the note does match', async () => {
        const dir = registry();
        const udd = path.join(os.tmpdir(), 'ezp-udd-sweep-test-marker');
        const stray = bystander(`--user-data-dir=${udd}`);
        expect(stray.pid).toBeDefined();
        noteFor(dir, stray.pid!, `--user-data-dir=${udd}`);

        const sweep = stopStrayEzPlayers({ dir });

        expect(sweep.killed).toEqual([stray.pid]);
        expect(sweep.spared).toEqual([]);
        expect(await exited(stray)).toBe(true);
        expect(readdirSync(dir)).toEqual([]);
    });

    it('clears a note whose process is already gone', async () => {
        const dir = registry();
        const gone = bystander('--user-data-dir=C:/gone');
        const pid = gone.pid!;
        gone.kill('SIGKILL');
        await exited(gone);
        noteFor(dir, pid, '--user-data-dir=C:/gone');

        const sweep = stopStrayEzPlayers({ dir });

        expect(sweep.stale).toEqual([pid]);
        expect(sweep.killed).toEqual([]);
        expect(readdirSync(dir)).toEqual([]);
    });

    it('never touches its own process, however a note is written', async () => {
        const dir = registry();
        // A note naming the runner itself must not be acted on, whatever its
        // marker says -- a sweep that can kill its own run is worse than none.
        const cmd = process.argv.join(' ');
        noteFor(dir, process.pid, cmd.slice(0, 20));

        const sweep = stopStrayEzPlayers({ dir });

        expect(sweep.killed).toEqual([]);
        expect(sweep.stale).toEqual([]);
    });

    it('reports nothing rather than failing when no run has been recorded', () => {
        const sweep = stopStrayEzPlayers({ dir: path.join(registry(), 'not-created-yet') });
        expect(sweep).toEqual({ killed: [], stale: [], spared: [] });
    });

    it('names a real directory for the notes', () => {
        expect(harnessRegistryDir()).toContain('ezp-harness');
    });
});
