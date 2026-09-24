/** EZPlayer as MultiSync master, with a real FPP as the remote — the wire
 *  format against the implementation that has to read it, which a mock
 *  remote cannot check.
 *
 *  Opt-in: FPP_URL plus FPP_SYNC_TARGET (host:port of that FPP's MultiSync
 *  port). For the Docker FPP under WSL2 that is the WSL VM's IP (`wsl
 *  hostname -I`) plus the published UDP port: WSL forwards only TCP on
 *  localhost, so 127.0.0.1 drops these packets silently.
 *
 *  The FPP is switched to remote mode for the test (and back afterwards)
 *  unless it is a remote already, so it must be a disposable one. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

const FPP_URL = process.env.FPP_URL;
const SYNC_TARGET = process.env.FPP_SYNC_TARGET;
const SONG = 'SyncLiveSong.fseq';
const SHOW = 'SyncLiveShow';

interface FppStatus {
    status_name: string;
    mode_name: string;
    current_sequence: string;
    seconds_elapsed: string;
}

/** FPP's status, or undefined while fppd is restarting — switching modes
 *  restarts it, and the web server answers 503 with an HTML page meanwhile. */
const fppStatus = async (): Promise<FppStatus | undefined> => {
    try {
        const res = await fetch(`${FPP_URL}/api/fppd/status`);
        if (!res.ok) return undefined;
        return (await res.json()) as FppStatus;
    } catch {
        return undefined;
    }
};

/** Poll the FPP until `pred` holds, or fail with what it last reported. */
const waitForFpp = async (pred: (s: FppStatus) => boolean, label: string, timeoutMs = 30_000): Promise<FppStatus> => {
    const deadline = Date.now() + timeoutMs;
    let last: FppStatus | undefined;
    for (;;) {
        last = await fppStatus();
        if (last && pred(last)) return last;
        if (Date.now() > deadline) throw new Error(`FPP ${label} timed out; last=${JSON.stringify(last)}`);
        await new Promise((r) => setTimeout(r, 250));
    }
};

describe.skipIf(!FPP_URL || !SYNC_TARGET)('EZPlayer sync master, real FPP remote', () => {
    let show: FixtureShow;
    let app: EzPlayerProc;
    let ezp: FppClient;
    let fpp: FppClient;
    /** The FPP is a sync remote and can be driven. */
    let remoteReady = false;
    /** We changed its mode, so we put it back afterwards. */
    let modeChanged = false;

    beforeAll(async () => {
        show = await createFixtureShow({ channels: 150 });
        app = await startEzPlayer(show.dir);
        ezp = new FppClient(app.base);
        fpp = new FppClient(FPP_URL!);

        // The FPP may still be restarting fppd from an earlier run's cleanup.
        await waitForFpp(() => true, 'API ready before setup', 60_000);

        // The remote plays its own copy of the sequence, so both need it.
        const bytes = buildFseq({ channels: 150, frames: 1200, value: 42 }); // 60 s
        for (const c of [ezp, fpp]) {
            await c.command('Stop Now');
            expect((await fetch(`${c.base}/api/sequence/${SONG}`, { method: 'POST', body: bytes })).status).toBe(200);
        }
        expect(
            (
                await ezp.putPlaylist(SHOW, {
                    name: SHOW,
                    mainPlaylist: [{ type: 'sequence', enabled: 1, playOnce: 0, sequenceName: SONG }],
                })
            ).status,
        ).toBe(200);

        // Point our sync master at the FPP, and make the FPP a remote.
        const settings = await fetch(`${app.base}/api/ezp/playback-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audioSyncAdjust: 0,
                backgroundSequence: 'overlay',
                viewerControl: { enabled: false, type: 'disabled', schedule: [] },
                volumeControl: { defaultVolume: 100, schedule: [] },
                sync: { multisync: { enabled: true, remotes: [SYNC_TARGET] } },
            }),
        });
        expect(settings.status).toBe(200);

        // Already a remote? Then leave the mode alone — switching restarts
        // fppd, and some releases (9.5 in Docker) do not bring it back
        // without a container restart.
        const before = await waitForFpp(() => true, 'API ready', 60_000);
        if (before.mode_name === 'remote') {
            remoteReady = true;
            return;
        }

        // 5.x has no remote-mode command (its mode is a settings-file edit),
        // so there we have nothing to drive and the test skips.
        const commands = (await (await fetch(`${FPP_URL}/api/commands`)).json()) as { name: string }[];
        if (!commands.some((c) => c.name === 'Switch To Remote Mode')) return;
        expect((await fpp.command('Switch To Remote Mode')).status).toBe(200);
        modeChanged = true;
        // fppd restarts into remote mode; if it does not come back, the test
        // skips rather than reporting our sync as broken.
        try {
            await waitForFpp((s) => s.mode_name === 'remote' && s.status_name === 'idle', 'remote mode idle', 60_000);
            remoteReady = true;
        } catch {
            console.warn(`[multisync-live] ${FPP_URL} did not come back after the mode switch; skipping`);
        }
    }, 120_000);

    afterAll(async () => {
        if (modeChanged) await fpp?.command('Switch To Player Mode').catch(() => undefined);
        await app?.stop();
        await show?.cleanup();
    });

    it('makes a real FPP remote play, track and stop with us', async (ctx) => {
        if (!remoteReady) return ctx.skip();
        await ezp.command('Start Playlist', SHOW, '0');
        await ezp.waitForStatus((s) => s.status_name === 'playing', { label: 'master playing', timeoutMs: 20_000 });

        // The remote follows our OPEN/START within a second or so.
        const playing = await waitForFpp((s) => s.status_name === 'playing', 'follows our start');
        expect(playing.current_sequence).toBe(SONG);

        // ...and tracks our position from the SYNC packets rather than free-running.
        const first = Number(playing.seconds_elapsed);
        await new Promise((r) => setTimeout(r, 3000));
        const second = Number((await waitForFpp((s) => s.status_name === 'playing', 'still playing')).seconds_elapsed);
        expect(second).toBeGreaterThan(first);
        const ours = Number(((await (await fetch(`${app.base}/api/fppd/status`)).json()) as FppStatus).seconds_elapsed);
        // Same position within a couple of seconds: a remote that ignored our
        // sync packets would drift from a different start time.
        expect(Math.abs(ours - second)).toBeLessThan(2.5);

        await ezp.command('Stop Now');
        await waitForFpp((s) => s.status_name === 'idle', 'follows our stop');
    }, 120_000);
});
