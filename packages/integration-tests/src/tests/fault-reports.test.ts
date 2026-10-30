/** Main-process and worker faults, injected with EZP_FAULT, reach a mock
 *  crash-report endpoint; reports that fail to upload are kept and resent. */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { startMockDiag, type MockDiag } from '../harness/mock-diag.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

let show: FixtureShow;
let mock: MockDiag;
let app: EzPlayerProc | undefined;

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
    mock = await startMockDiag();
});
afterEach(async () => {
    await app?.stop();
    app = undefined;
    mock.reports.length = 0;
    mock.status = 200;
});
afterAll(async () => {
    await mock.close();
});

const mainLog = (a: EzPlayerProc) => fsp.readFile(path.join(a.userDataDir, 'logs', 'ezplayer-main.log'), 'utf8');

describe('main-process and worker faults', () => {
    it('reports an uncaught exception and an unhandled rejection in main', async () => {
        app = await startEzPlayer(show.dir, { diagUrl: mock.url, faults: ['main-throw', 'main-reject'] });
        const thrown = await mock.waitFor('uncaughtException', 'ezp-fault: main-throw');
        expect(thrown.stack).toContain('ezp-fault: main-throw');
        expect(thrown.appVersion).toBeTruthy();
        await mock.waitFor('unhandledRejection', 'ezp-fault: main-reject');
        const log = await mainLog(app);
        expect(log).toContain('[diag] uncaughtException: ezp-fault: main-throw');
        expect(log).toContain('[diag] uncaughtException upload: HTTP 200');
    });

    it('reports a playback worker that dies', async () => {
        app = await startEzPlayer(show.dir, { diagUrl: mock.url, faults: ['playback-worker-throw'] });
        await mock.waitFor('worker-error', 'playback: ezp-fault: playback-worker-throw');
    });

    it('reports a server worker that dies', async () => {
        app = await startEzPlayer(show.dir, {
            diagUrl: mock.url,
            faults: ['server-worker-throw'],
            noApiWait: true,
        });
        await mock.waitFor('worker-error', 'server-worker: ezp-fault: server-worker-throw');
    });

    it('keeps a report the endpoint refused and resends it', async () => {
        mock.status = 503;
        app = await startEzPlayer(show.dir, { diagUrl: mock.url, faults: ['main-throw'] });
        await mock.waitFor('uncaughtException', 'main-throw');
        const outbox = path.join(app.userDataDir, 'diag-outbox');
        expect(await fsp.readdir(outbox)).toHaveLength(1);

        mock.status = 200;
        // First resend pass runs 15 s after startup.
        const deadline = Date.now() + 30_000;
        while (!mock.reports.some((r) => r.answered === 200) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 250));
        }
        expect(mock.reports.map((r) => [r.kind, r.answered])).toEqual([
            ['uncaughtException', 503],
            ['uncaughtException', 200],
        ]);
        await new Promise((r) => setTimeout(r, 500));
        expect(await fsp.readdir(outbox)).toHaveLength(0);
        expect(await mainLog(app)).toContain('[diag] uncaughtException upload: HTTP 503; kept for retry');
    });

    it('uploads an unclean-exit report on the start after a kill', async () => {
        const first = await startEzPlayer(show.dir, { diagUrl: mock.url });
        const killedPid = first.child.pid;
        first.child.kill('SIGKILL');
        await first.stop();
        app = await startEzPlayer(show.dir, { diagUrl: mock.url, userDataDir: first.userDataDir });
        const r = await mock.waitFor('unclean-exit');
        expect(JSON.parse(r.extra!)).toMatchObject({ pid: killedPid });
    });
});
