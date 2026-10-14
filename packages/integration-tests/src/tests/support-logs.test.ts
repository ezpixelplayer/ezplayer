/** Supportability: the app log captures main and worker output, the logs zip
 *  downloads from the web server, and a killed run is flagged on the next start. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

let show: FixtureShow;
let app: EzPlayerProc | undefined;

async function waitForLogLine(file: string, text: string, timeoutMs = 10_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const body = await fsp.readFile(file, 'utf8').catch(() => '');
        if (body.includes(text) || Date.now() > deadline) return body;
        await new Promise((r) => setTimeout(r, 200));
    }
}

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
});

afterAll(async () => {
    await app?.stop();
});

describe('support logs', () => {
    it('serves a logs zip with main and worker output', async () => {
        app = await startEzPlayer(show.dir);
        const mainLog = path.join(app.userDataDir, 'logs', 'ezplayer-main.log');
        await waitForLogLine(mainLog, '[server-worker]');

        const res = await fetch(`${app.base}/api/ezp/support/logs.zip`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/zip');
        expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="ezplayer-logs-.*\.zip"$/);

        const zip = await JSZip.loadAsync(await res.arrayBuffer());
        const log = await zip.file('logs/ezplayer-main.log')!.async('string');
        expect(log).toContain(`==== start pid=${app.child.pid}`);
        expect(log).toContain('[server-worker]');
        const summary = JSON.parse(await zip.file('diagnostics.json')!.async('string'));
        expect(summary.reporting.uploadEnabled).toBe(false);
        expect(zip.file(`logs/session-${app.child.pid}.json`)).toBeTruthy();
    });

    it('flags a killed run on the next start, locally even with uploads off', async () => {
        const first = app!;
        const killedPid = first.child.pid;
        first.child.kill('SIGKILL');
        await first.stop();

        app = await startEzPlayer(show.dir, { userDataDir: first.userDataDir });
        const log = await waitForLogLine(
            path.join(app.userDataDir, 'logs', 'ezplayer-main.log'),
            '[diag] not uploaded',
        );
        expect(log).toContain(`Previous run (pid ${killedPid}`);
        expect(log).toContain('[diag] unclean-exit: previous run did not exit normally');
        expect(log).toContain('[diag] not uploaded: reporting is turned off');
    });
});
