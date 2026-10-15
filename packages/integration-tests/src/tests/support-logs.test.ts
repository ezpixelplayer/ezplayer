/** Supportability: the app log captures main and worker output, the support
 *  zip downloads from the web server at each level, and a killed run is flagged
 *  on the next start. */

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
        expect(zip.file('settings.json')).toBeTruthy();
        expect(zip.file('network.json')).toBeNull();
        expect(zip.file('show/xlights_networks.xml')).toBeNull();
    });

    it('adds the show setup, then the layout, at higher levels', async () => {
        const get = async (level: string) => {
            const res = await fetch(`${app!.base}/api/ezp/support/logs.zip?level=${level}`);
            expect(res.status).toBe(200);
            expect(res.headers.get('content-disposition')).toContain(`ezplayer-${level}-`);
            return JSZip.loadAsync(await res.arrayBuffer());
        };
        const setup = await get('setup');
        expect(setup.file('network.json')).toBeTruthy();
        expect(setup.file('show/xlights_networks.xml')).toBeTruthy();
        expect(setup.file('show/xlights_rgbeffects.xml')).toBeNull();
        const layout = await get('layout');
        expect(layout.file('show/xlights_rgbeffects.xml')).toBeTruthy();

        expect((await fetch(`${app!.base}/api/ezp/support/logs.zip?level=everything`)).status).toBe(400);
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
