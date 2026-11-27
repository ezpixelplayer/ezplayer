import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SAMPLE_MS, UsageLedger } from './apps-usage';

const game = { instance: 'game', appId: 'tag-the-monsters', startedAt: 1000 };
const board = { instance: 'board', appId: 'message-board', startedAt: 1000 };

describe('usage ledger', () => {
    it('counts run time for every process up, lease time for those holding one, and starts', () => {
        const l = new UsageLedger(undefined);
        l.sample(10_000, [game, board], new Set());
        l.sample(15_000, [game, board], new Set(['game']));
        l.sample(20_000, [game], new Set(['game']));
        // Holding a lease at a sample counts the stretch since the sample before.
        expect(l.records.game).toMatchObject({
            runs: 1,
            runMs: 10_000,
            activeMs: 10_000,
            lastActiveAt: 20_000,
            firstRunAt: 1000,
        });
        expect(l.records.board).toMatchObject({ runs: 1, runMs: 5_000, activeMs: 0 });
        expect(l.records.board.lastActiveAt).toBeUndefined();
        // A new startedAt is another run; the process that was down added nothing meanwhile.
        l.sample(25_000, [{ ...game, startedAt: 24_000 }], new Set());
        expect(l.records.game).toMatchObject({ runs: 2, runMs: 15_000, lastRunAt: 24_000, firstRunAt: 1000 });
    });

    it('caps a long gap between samples, as after the computer slept', () => {
        const l = new UsageLedger(undefined);
        l.sample(0, [game], new Set(['game']));
        l.sample(3_600_000, [game], new Set(['game']));
        expect(l.records.game.runMs).toBe(MAX_SAMPLE_MS);
        expect(l.records.game.activeMs).toBe(MAX_SAMPLE_MS);
    });

    it('adds visitor traffic, also for an instance it has not seen run, when the app is known', () => {
        const l = new UsageLedger(undefined);
        l.sample(0, [game], new Set());
        l.addTraffic(
            { game: { requests: 5, events: 2 }, board: { requests: 3, events: 0 }, gone: { requests: 1, events: 0 } },
            (i) => (i === 'board' ? 'message-board' : undefined),
        );
        expect(l.records.game).toMatchObject({ requests: 5, events: 2 });
        expect(l.records.board).toMatchObject({ appId: 'message-board', requests: 3, runs: 0 });
        expect(l.records.gone).toBeUndefined();
    });

    it('saves what it counted and reads it back; reset empties it', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-usage-'));
        const file = path.join(dir, 'apps-usage.json');
        const l = new UsageLedger(file);
        await l.save(); // nothing counted yet: nothing written
        await expect(fsp.stat(file)).rejects.toThrow();
        l.sample(0, [game], new Set());
        l.sample(5_000, [game], new Set(['game']));
        await l.save();
        const back = await UsageLedger.load(file);
        expect(back.records.game).toMatchObject({ appId: 'tag-the-monsters', runs: 1, runMs: 5_000, activeMs: 5_000 });
        back.reset();
        await back.save();
        expect((await UsageLedger.load(file)).records).toEqual({});
        await fsp.rm(dir, { recursive: true, force: true });
    });
});
