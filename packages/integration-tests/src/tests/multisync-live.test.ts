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
import { sineWav } from '../fixtures/wav.js';
import { appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FPP_URL = process.env.FPP_URL;
const SYNC_TARGET = process.env.FPP_SYNC_TARGET;
const SONG = 'SyncLiveSong.fseq';
const SHOW = 'SyncLiveShow';
/** A second show whose song has audio, for the media sync packets. */
const MEDIA_SONG = 'SyncLiveMedia.fseq';
const MEDIA_WAV = 'SyncLiveMedia.wav';
const MEDIA_SHOW = 'SyncLiveMediaShow';
/** A short song for the looping cases: boundaries every 10 s. */
const LOOP_SONG = 'SyncLiveLoop.fseq';
const LOOP_SHOW = 'SyncLiveLoopShow';
/** The 60 s song cut to a 10 s item: the master loops while the remote still has frames. */
const SHORT_SHOW = 'SyncLiveShortShow';
const SHORT_ITEM_SECONDS = 10;

interface FppStatus {
    status_name: string;
    mode_name: string;
    current_sequence: string;
    current_song: string;
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

        // A song with audio, on both as well: the remote plays its own copy of
        // the audio from our media sync packets.
        const mediaBytes = buildFseq({ channels: 150, frames: 1200, value: 42 }); // 60 s
        const wav = sineWav({ seconds: 60 });
        for (const c of [ezp, fpp]) {
            expect(
                (await fetch(`${c.base}/api/sequence/${MEDIA_SONG}`, { method: 'POST', body: mediaBytes })).status,
            ).toBe(200);
            expect((await fetch(`${c.base}/api/file/music/${MEDIA_WAV}`, { method: 'POST', body: wav })).status).toBe(
                200,
            );
        }
        expect(
            (
                await ezp.putPlaylist(MEDIA_SHOW, {
                    name: MEDIA_SHOW,
                    mainPlaylist: [
                        { type: 'both', enabled: 1, playOnce: 0, sequenceName: MEDIA_SONG, mediaName: MEDIA_WAV },
                    ],
                })
            ).status,
        ).toBe(200);

        // The looping cases: a 10 s song on both, and the 60 s song as a 10 s item.
        const loopBytes = buildFseq({ channels: 150, frames: 200, value: 42 }); // 10 s
        for (const c of [ezp, fpp]) {
            expect(
                (await fetch(`${c.base}/api/sequence/${LOOP_SONG}`, { method: 'POST', body: loopBytes })).status,
            ).toBe(200);
        }
        expect(
            (
                await ezp.putPlaylist(LOOP_SHOW, {
                    name: LOOP_SHOW,
                    mainPlaylist: [{ type: 'sequence', enabled: 1, playOnce: 0, sequenceName: LOOP_SONG }],
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await ezp.putPlaylist(SHORT_SHOW, {
                    name: SHORT_SHOW,
                    mainPlaylist: [{ type: 'sequence', enabled: 1, playOnce: 0, sequenceName: SONG }],
                })
            ).status,
        ).toBe(200);
        // Shorten the 60 s song's record to a 10 s item, as a playlist does when
        // the work's length is less than the file's.
        const current = (await (await fetch(`${app.base}/api/ezp/current-show`)).json()) as {
            sequences: Array<{ id: string; files?: { fseq?: string }; work?: Record<string, unknown> }>;
        };
        // files.fseq may be a bare name or an absolute path depending on origin.
        const rec = current.sequences.find((s) => s.files?.fseq?.replace(/\\/g, '/').endsWith(SONG));
        expect(rec, `sequence record for ${SONG}`).toBeDefined();
        const shortened = await fetch(`${app.base}/api/ezp/sequences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ ...rec, work: { ...(rec!.work ?? {}), length: SHORT_ITEM_SECONDS } }]),
        });
        expect(shortened.status).toBe(200);

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

    it('makes a real FPP remote play the song audio from our media sync packets', async (ctx) => {
        if (!remoteReady) return ctx.skip();
        await ezp.command('Start Playlist', MEDIA_SHOW, '0');
        await ezp.waitForStatus((s) => s.status_name === 'playing', {
            label: 'master playing media',
            timeoutMs: 20_000,
        });

        // The remote opens both our sequence and, from the media OPEN/START, its
        // own copy of the audio.
        const playing = await waitForFpp(
            (s) => s.status_name === 'playing' && s.current_sequence === MEDIA_SONG && s.current_song === MEDIA_WAV,
            'follows our media start',
        );
        expect(playing.current_song).toBe(MEDIA_WAV);

        // ...and keeps tracking our position while both run.
        const first = Number(playing.seconds_elapsed);
        await new Promise((r) => setTimeout(r, 3000));
        const later = await waitForFpp((s) => s.status_name === 'playing', 'still playing media');
        expect(later.current_song).toBe(MEDIA_WAV);
        expect(Number(later.seconds_elapsed)).toBeGreaterThan(first);
        const ours = Number(((await (await fetch(`${app.base}/api/fppd/status`)).json()) as FppStatus).seconds_elapsed);
        expect(Math.abs(ours - Number(later.seconds_elapsed))).toBeLessThan(2.5);

        // Our STOP closes the audio too: the remote goes idle with no song.
        await ezp.command('Stop Now');
        const idle = await waitForFpp((s) => s.status_name === 'idle', 'follows our stop');
        expect(idle.current_song).toBe('');
    }, 120_000);

    /** One sample of both ends. */
    interface Sample {
        t: number;
        master: number;
        remote: number;
        remoteStatus: string;
    }

    /** Sample the master's and the remote's positions every 200 ms for `seconds`. */
    const samplePositions = async (seconds: number): Promise<Sample[]> => {
        const out: Sample[] = [];
        const t0 = Date.now();
        while (Date.now() - t0 < seconds * 1000) {
            const [m, r] = await Promise.all([
                fetch(`${app.base}/api/fppd/status`).then((res) => res.json() as Promise<FppStatus>),
                fppStatus(),
            ]);
            out.push({
                t: (Date.now() - t0) / 1000,
                master: Number(m.seconds_elapsed),
                remote: r ? Number(r.seconds_elapsed) : NaN,
                remoteStatus: r?.status_name ?? 'unreachable',
            });
            await new Promise((res) => setTimeout(res, 200));
        }
        return out;
    };

    /**
     * What happened at each of the master's loop boundaries: how long after the
     * master started over the remote did, and the longest the remote's position
     * stood still or it was not playing around that boundary.
     */
    const boundaries = (samples: Sample[]) => {
        const out: { at: number; remoteRestartAfter: number; remoteStallSeconds: number }[] = [];
        for (let i = 1; i < samples.length; i++) {
            if (samples[i].master >= samples[i - 1].master) continue;
            const at = samples[i].t;
            // The remote has started over once its position drops.
            let restart = Infinity;
            for (let j = i; j < samples.length; j++) {
                if (samples[j].remote < samples[j - 1].remote) {
                    restart = samples[j].t - at;
                    break;
                }
            }
            // Longest run, from a second before the boundary on, of the remote
            // not advancing or not playing.
            let stall = 0;
            let runStart: number | undefined;
            for (let j = Math.max(1, i - 5); j < samples.length; j++) {
                const stuck =
                    samples[j].remoteStatus !== 'playing' ||
                    (samples[j].remote === samples[j - 1].remote && samples[j].master !== samples[j - 1].master);
                if (stuck) {
                    runStart ??= samples[j - 1].t;
                    stall = Math.max(stall, samples[j].t - runStart);
                } else runStart = undefined;
            }
            out.push({ at, remoteRestartAfter: restart, remoteStallSeconds: stall });
        }
        return out;
    };

    const runLoopCase = async (playlist: string, label: string) => {
        await ezp.command('Start Playlist', playlist, '1');
        await ezp.waitForStatus((s) => s.status_name === 'playing', {
            label: `${label} master playing`,
            timeoutMs: 20_000,
        });
        await waitForFpp((s) => s.status_name === 'playing', `${label} remote follows`);
        // Three boundaries of a 10 s item.
        const samples = await samplePositions(34);
        await ezp.command('Stop Now');
        await waitForFpp((s) => s.status_name === 'idle', `${label} remote stops`);
        const b = boundaries(samples);
        console.log(`[multisync-live] ${label}: ${b.length} loop boundaries`, JSON.stringify(b));
        // Passing tests' console output is not shown; keep the measurements for the record.
        appendFileSync(
            path.join(os.tmpdir(), 'multisync-loop.jsonl'),
            JSON.stringify({
                at: new Date().toISOString(),
                build: process.env.MULTISYNC_BUILD ?? '',
                label,
                boundaries: b,
            }) + '\n',
        );
        expect(b.length).toBeGreaterThanOrEqual(2);
        for (const x of b) {
            // The remote starts over with us, and does not stand still across the boundary.
            expect(x.remoteRestartAfter, `remote restart after boundary at ${x.at}s`).toBeLessThan(1.5);
            expect(x.remoteStallSeconds, `remote stall at boundary ${x.at}s`).toBeLessThan(1.5);
        }
    };

    it('keeps a real FPP remote going when the same file loops', async (ctx) => {
        if (!remoteReady) return ctx.skip();
        await runLoopCase(LOOP_SHOW, 'whole-file loop');
    }, 120_000);

    it('keeps a real FPP remote going when a short item loops inside a longer file', async (ctx) => {
        if (!remoteReady) return ctx.skip();
        await runLoopCase(SHORT_SHOW, 'short-item loop');
    }, 120_000);
});
