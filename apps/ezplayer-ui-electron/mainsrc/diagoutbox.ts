/**
 * On-disk outbox for crash reports, so a report made offline, rate-limited, or
 * just before the process died is sent later. One file per report; the name
 * carries the writing pid so concurrent instances (one per show folder) leave
 * each other's live reports alone, and a dead instance's reports are claimed
 * by rename, which only one claimant can win.
 */

import fs from 'node:fs';
import path from 'node:path';

export const OUTBOX_MAX_FILES = 30;
export const OUTBOX_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

export interface OutboxEntry {
    file: string;
    body: unknown;
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/** <time>-<pid>-<seq>.json */
const NAME = /^(\d+)-(\d+)-(\d+)\.json$/;

export class DiagOutbox {
    private seq = 0;

    constructor(
        private readonly dir: string,
        private readonly pid = process.pid,
    ) {}

    /** Returns the file to remove once the report is delivered, or undefined if it could not be saved. */
    save(body: unknown): string | undefined {
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            const file = path.join(this.dir, `${Date.now()}-${this.pid}-${++this.seq}.json`);
            fs.writeFileSync(file, JSON.stringify(body));
            return file;
        } catch {
            return undefined;
        }
    }

    remove(file: string | undefined): void {
        if (!file) return;
        try {
            fs.rmSync(file, { force: true });
        } catch {
            /* best-effort */
        }
    }

    removeAll(): void {
        for (const f of this.list()) this.remove(f.file);
    }

    /**
     * Reports waiting to be resent, oldest first: this process's own (except
     * those in `skip`, still in flight) and any left by dead processes, which
     * are claimed first. Prunes old and excess files on the way.
     */
    pending(skip: ReadonlySet<string> = new Set()): OutboxEntry[] {
        const now = Date.now();
        const files = this.list();
        const keep = files.slice(-OUTBOX_MAX_FILES);
        for (const f of files) {
            if (!keep.includes(f) || now - f.time > OUTBOX_MAX_AGE_MS) this.remove(f.file);
        }
        const out: OutboxEntry[] = [];
        for (const f of keep) {
            if (now - f.time > OUTBOX_MAX_AGE_MS || skip.has(f.file)) continue;
            let file = f.file;
            if (f.pid !== this.pid) {
                if (isAlive(f.pid)) continue;
                const claimed = path.join(this.dir, `${f.time}-${this.pid}-${++this.seq}.json`);
                try {
                    fs.renameSync(file, claimed);
                } catch {
                    continue; // another instance won it
                }
                file = claimed;
            }
            try {
                out.push({ file, body: JSON.parse(fs.readFileSync(file, 'utf8')) });
            } catch {
                this.remove(file);
            }
        }
        return out;
    }

    private list(): { file: string; time: number; pid: number }[] {
        let names: string[];
        try {
            names = fs.readdirSync(this.dir);
        } catch {
            return [];
        }
        return names
            .flatMap((name) => {
                const m = NAME.exec(name);
                return m ? [{ file: path.join(this.dir, name), time: Number(m[1]), pid: Number(m[2]) }] : [];
            })
            .sort((a, b) => a.time - b.time);
    }
}
