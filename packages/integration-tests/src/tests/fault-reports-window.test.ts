/** Main-window faults, injected with EZP_FAULT, reach a mock crash-report
 *  endpoint: errors before and after the app mounts, a page that never comes
 *  up, a hang, and dead renderer and GPU processes. Runs the windowed app. */

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
});
afterAll(async () => {
    await mock.close();
});

const start = async (faults: string[]) =>
    (app = await startEzPlayer(show.dir, { windowed: true, diagUrl: mock.url, faults }));
const mainLog = (a: EzPlayerProc) => fsp.readFile(path.join(a.userDataDir, 'logs', 'ezplayer-main.log'), 'utf8');

/** Ready watchdog (45 s) plus startup. */
const NOT_READY_WAIT_MS = 70_000;

describe('main window faults', () => {
    it('reports errors thrown and rejected in the page once the app is up', async () => {
        await start(['renderer-throw', 'renderer-reject']);
        const thrown = await mock.waitFor('renderer-error', 'ezp-fault: renderer-throw');
        expect(thrown.stack).toContain('ezp-fault: renderer-throw');
        await mock.waitFor('renderer-error', 'ezp-fault: renderer-reject');
        const log = await mainLog(app!);
        expect(log).toMatch(/\[renderer:main\] app up \d+ ms after load started/);
        expect(log).toContain('[renderer:main] E Uncaught Error: ezp-fault: renderer-throw');
    });

    it('reports an error thrown while the app bundle loads', async () => {
        await start(['bundle-throw']);
        await mock.waitFor('renderer-error', 'ezp-fault: bundle-throw');
    });

    it('reports a page that loads but never mounts the app', { timeout: 100_000 }, async () => {
        await start(['bundle-empty']);
        const r = await mock.waitFor('renderer-not-ready', '', NOT_READY_WAIT_MS);
        expect(JSON.parse(r.extra!)).toMatchObject({ page: { rootChildren: 0, hasElectronApi: true } });
        expect(mock.reports.filter((x) => x.kind === 'renderer-error')).toEqual([]);
    });

    it('reports a preload that fails', async () => {
        await start(['preload-throw']);
        await mock.waitFor('renderer-error', 'preload-error: ezp-fault: preload-throw');
    });

    it('reports a page that fails to load', async () => {
        await start(['bad-url']);
        const r = await mock.waitFor('did-fail-load');
        expect(r.extra).toContain('missing.html');
    });

    it('reports a renderer that stops answering', { timeout: 100_000 }, async () => {
        await start(['renderer-hang']);
        const r = await mock.waitFor('renderer-hang', 'not answering', 60_000);
        expect(r.message).toMatch(/not answering for \d+s/);
    });

    it('reports a renderer process that crashes', async () => {
        await start(['renderer-crash']);
        await mock.waitFor('render-process-gone');
    });

    it('reports a GPU process that crashes', async () => {
        await start(['gpu-crash']);
        const r = await mock.waitFor('child-process-gone');
        expect(JSON.parse(r.extra!)).toMatchObject({ type: 'GPU' });
    });
});
