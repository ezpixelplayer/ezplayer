import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DiagOutbox, OUTBOX_MAX_AGE_MS, OUTBOX_MAX_FILES } from './diagoutbox.js';

let dir: string;

/** A pid that is certainly not running: a child that has already exited. */
const deadPid = spawnSync(process.execPath, ['-e', '0']).pid!;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezp-outbox-'));
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('DiagOutbox', () => {
    it('saves, lists its own reports except those in flight, and removes', () => {
        const box = new DiagOutbox(dir);
        const a = box.save({ kind: 'a' })!;
        const b = box.save({ kind: 'b' })!;
        expect(box.pending().map((e) => e.body)).toEqual([{ kind: 'a' }, { kind: 'b' }]);
        expect(box.pending(new Set([a])).map((e) => e.body)).toEqual([{ kind: 'b' }]);
        box.remove(a);
        box.remove(b);
        expect(box.pending()).toEqual([]);
    });

    it("leaves a live instance's reports alone and claims a dead one's", () => {
        new DiagOutbox(dir, process.ppid).save({ kind: 'live' });
        new DiagOutbox(dir, deadPid).save({ kind: 'dead' });
        const box = new DiagOutbox(dir);
        const got = box.pending();
        expect(got.map((e) => e.body)).toEqual([{ kind: 'dead' }]);
        expect(path.basename(got[0].file)).toContain(`-${process.pid}-`);
        // Claimed: a second instance finds nothing left to take.
        expect(new DiagOutbox(dir, process.pid + 1).pending().map((e) => e.body)).not.toContainEqual({ kind: 'dead' });
    });

    it('drops old, excess and unreadable files', () => {
        const box = new DiagOutbox(dir);
        const old = Date.now() - OUTBOX_MAX_AGE_MS - 1000;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${old}-${process.pid}-1.json`), '{}');
        fs.writeFileSync(path.join(dir, `${Date.now() + 60_000}-${process.pid}-2.json`), 'not json');
        for (let i = 0; i < OUTBOX_MAX_FILES + 5; i++) box.save({ i });
        const got = box.pending();
        expect(got).toHaveLength(OUTBOX_MAX_FILES - 1);
        expect(got.at(-1)!.body).toEqual({ i: OUTBOX_MAX_FILES + 4 });
        expect(fs.readdirSync(dir)).toHaveLength(OUTBOX_MAX_FILES - 1);
    });
});
