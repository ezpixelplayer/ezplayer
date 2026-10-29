/** Content distribution against the real lab FPPs: what each device ends up
 *  holding, read back from the device's own metadata rather than from our
 *  report. Mocks cannot check the upload APIs or the slicing arithmetic
 *  against the firmware that has to read the result.
 *
 *  Opt-in: LAB_FPP_TARGETS, a comma-separated list of FPP addresses. The show
 *  comes from LAB_SHOW_FOLDER; it is copied to a temp folder first, so the
 *  real one is left alone.
 *
 *  LAB_FPP_REMOTES (a subset of the targets) switches those devices to remote
 *  mode, which is what makes a slice worth sending, and puts them back
 *  afterwards — so name only disposable ones. With LAB_SYNC set as well, the
 *  show is played and each remote has to follow it.
 *
 *  Playing drives whatever is wired to those controllers: expect lights.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseChannelRanges } from '@ezplayer/epp';
import type { ContentDistReport, ControllerOpsState, DiscoveredController } from '@ezplayer/ezplayer-core';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';

const TARGETS = (process.env.LAB_FPP_TARGETS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const SHOW_FOLDER = process.env.LAB_SHOW_FOLDER ?? 'C:/Users/Chuck/Documents/xlightsShows/TestLab';
const REMOTES = (process.env.LAB_FPP_REMOTES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const PLAY = !!process.env.LAB_SYNC;
const PLAYLIST = 'LabContentDist';

const idOf = (address: string) => `${address}|direct`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FppStatus {
    status_name: string;
    mode_name: string;
    current_sequence: string;
    seconds_elapsed: string;
}

/** A device's status, or undefined while fppd restarts (the web server
 *  answers with an error page meanwhile). */
async function fppStatus(address: string): Promise<FppStatus | undefined> {
    try {
        const res = await fetch(`http://${address}/api/fppd/status`, { signal: AbortSignal.timeout(5000) });
        return res.ok ? ((await res.json()) as FppStatus) : undefined;
    } catch {
        return undefined;
    }
}

async function waitForFpp(
    address: string,
    pred: (s: FppStatus) => boolean,
    label: string,
    timeoutMs = 30_000,
): Promise<FppStatus> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const last = await fppStatus(address);
        if (last && pred(last)) return last;
        if (Date.now() > deadline) throw new Error(`${address} ${label} timed out; last=${JSON.stringify(last)}`);
        await sleep(250);
    }
}

/** What the device says it holds for this sequence. */
async function deviceMeta(
    address: string,
    sequence: string,
): Promise<{ ChannelCount: number; NumFrames: number; StepTime: number; ID: string; Ranges?: unknown } | undefined> {
    try {
        const res = await fetch(`http://${address}/api/sequence/${encodeURIComponent(sequence)}/meta`, {
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return undefined;
        return (await res.json()) as Awaited<ReturnType<typeof deviceMeta>>;
    } catch {
        return undefined;
    }
}

/** What the show's own file holds, from its header alone. */
async function fseqHeader(file: string): Promise<{ channels: number; frames: number }> {
    const fh = await fsp.open(file, 'r');
    try {
        const buf = Buffer.alloc(32);
        await fh.read(buf, 0, 32, 0);
        if (buf.toString('ascii', 0, 4) !== 'PSEQ') throw new Error(`${file} is not an FSEQ file`);
        return { channels: buf.readUInt32LE(10), frames: buf.readUInt32LE(14) };
    } finally {
        await fh.close();
    }
}

/** Channels of this show a device with these ranges drives. */
function sliceWidth(ranges: string | undefined, showChannels: number): number {
    return parseChannelRanges(ranges).reduce(
        (n, r) => n + Math.max(0, Math.min(r.startch + r.chcount, showChannels) - r.startch),
        0,
    );
}

describe.skipIf(!TARGETS.length)('content distribution to the lab FPPs', () => {
    let app: EzPlayerProc;
    let ezp: FppClient;
    let showDir: string;
    let sequence: string;
    let showChannels: number;
    let showFrames: number;
    /** Devices we switched to remote mode, to put back afterwards. */
    const switched: string[] = [];

    const state = async (): Promise<ControllerOpsState> =>
        (await (await fetch(`${app.base}/api/ezp/controllers`)).json()) as ControllerOpsState;
    const device = async (address: string): Promise<DiscoveredController | undefined> =>
        (await state()).devices[idOf(address)];

    /** Run a distribution and wait for it, as the UI's button does. */
    async function distribute(body: Record<string, unknown> = {}): Promise<ContentDistReport> {
        const res = await fetch(`${app.base}/api/ezp/controllers/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cmd: 'distribute', ...body }),
        });
        expect(res.status, await res.text()).toBe(200);
        const deadline = Date.now() + 300_000;
        for (;;) {
            const now = await state();
            if (!now.contentDist?.run) {
                const report = now.contentDist?.lastReport;
                if (!report) throw new Error('no distribution report');
                return report;
            }
            if (Date.now() > deadline) throw new Error('distribution did not finish');
            await sleep(500);
        }
    }

    beforeAll(async () => {
        // A copy, so a lab run never writes to the real show folder.
        showDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-lab-show-'));
        await fsp.cp(SHOW_FOLDER, showDir, {
            recursive: true,
            filter: (src) => !/[\\/](Backup|RenderCache)$/.test(src),
        });
        const fseqs = (await fsp.readdir(showDir)).filter((f) => f.toLowerCase().endsWith('.fseq'));
        if (!fseqs.length) throw new Error(`${SHOW_FOLDER} holds no .fseq to distribute`);
        sequence = fseqs[0];
        ({ channels: showChannels, frames: showFrames } = await fseqHeader(path.join(showDir, sequence)));

        // Our own settings for the run: sync to the targets, and nothing
        // scheduled or viewer-driven starting a show behind our backs.
        const settings = JSON.parse(
            await fsp.readFile(path.join(showDir, '.ezplayer', 'playbackSettings.json'), 'utf8'),
        ) as Record<string, unknown>;
        settings.viewerControl = { enabled: false, type: 'disabled', schedule: [] };
        settings.sync = { multisync: { enabled: true, remotes: TARGETS, mediaSync: false } };
        await fsp.writeFile(
            path.join(showDir, '.ezplayer', 'playbackSettings.json'),
            JSON.stringify(settings, null, 4),
        );
        await fsp.writeFile(
            path.join(showDir, '.ezplayer', 'schedule.json'),
            JSON.stringify({ data: { scheduledPlaylists: [] } }, null, 4),
        );

        app = await startEzPlayer(showDir);
        ezp = new FppClient(app.base);

        // Introduce each device by address: a lab scan would sweep every
        // controller on the net, and the port-bearing address is enough.
        for (const address of TARGETS) {
            const res = await fetch(`${app.base}/api/ezp/controllers/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd: 'status', id: idOf(address), address, depth: 'full' }),
            });
            expect(res.status, `learning ${address}`).toBe(200);
        }
        await sleep(1500);
    }, 180_000);

    afterAll(async () => {
        for (const address of switched) {
            await new FppClient(`http://${address}`).command('Switch To Player Mode').catch(() => undefined);
        }
        await app?.stop();
        if (showDir) await fsp.rm(showDir, { recursive: true, force: true });
    });

    it('sees every lab FPP as a content target', async () => {
        for (const address of TARGETS) {
            const dev = await device(address);
            expect(dev?.driverType, address).toBe('FPP');
            expect(dev?.firmwareVersion, address).toBeTruthy();
            // The upload API is chosen from the version: v7+ takes chunked
            // PATCH, older firmware the jqupload POST.
            expect(dev?.contentStatus?.uploadMethod, address).toBeTruthy();
        }
    }, 120_000);

    it('sends the show, and each device holds what the show says', async () => {
        const report = await distribute();
        expect(report.totals.targetsFailed).toBe(0);
        expect(report.totals.failed).toBe(0);
        expect(report.targets.length).toBe(TARGETS.length);

        for (const address of TARGETS) {
            const dev = await device(address);
            expect(dev?.contentStatus?.missing, address).toBe(0);
            expect(dev?.contentStatus?.failed, address).toBe(0);
            expect(dev?.contentStatus?.error, address).toBeUndefined();

            // The device's own metadata, not our report: same timeline, and
            // the whole show while it is a player.
            const meta = await deviceMeta(address, sequence);
            expect(meta, `${address} holds ${sequence}`).toBeTruthy();
            expect(meta!.NumFrames, address).toBe(showFrames);
            if (dev?.mode !== 'remote') expect(meta!.ChannelCount, address).toBe(showChannels);
        }
    }, 300_000);

    it('sends nothing on a second run, and a check sends nothing either', async () => {
        const again = await distribute();
        expect(again.totals.uploaded).toBe(0);
        expect(again.totals.bytes).toBe(0);

        const checked = await distribute({ checkOnly: true });
        expect(checked.checkOnly).toBe(true);
        expect(checked.totals.uploaded).toBe(0);
        for (const address of TARGETS) {
            expect((await device(address))?.contentStatus?.missing, address).toBe(0);
        }
    }, 300_000);

    describe.skipIf(!REMOTES.length)('a device that plays its own copy', () => {
        /** Devices that reached remote mode and can be checked. */
        const ready: string[] = [];

        beforeAll(async () => {
            for (const address of REMOTES) {
                const before = await waitForFpp(address, () => true, 'API ready', 60_000);
                if (before.mode_name === 'remote') {
                    ready.push(address);
                    continue;
                }
                // Pre-7 firmware has no mode command; its mode is a settings
                // edit, so leave those alone rather than half-switch them.
                const commands = (await (await fetch(`http://${address}/api/commands`)).json()) as { name: string }[];
                if (!commands.some((c) => c.name === 'Switch To Remote Mode')) {
                    console.warn(`[lab-content-dist] ${address} has no mode command; skipping it`);
                    continue;
                }
                await new FppClient(`http://${address}`).command('Switch To Remote Mode');
                switched.push(address);
                try {
                    await waitForFpp(address, (s) => s.mode_name === 'remote', 'remote mode', 60_000);
                    ready.push(address);
                } catch {
                    console.warn(`[lab-content-dist] ${address} did not come back as a remote; skipping it`);
                }
            }
            // Re-read, so the player sees the new mode before it distributes.
            for (const address of ready) {
                await fetch(`${app.base}/api/ezp/controllers/command`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cmd: 'status', id: idOf(address), address, depth: 'full' }),
                });
            }
            await sleep(1500);
        }, 180_000);

        it('is sent only its own channels', async (ctx) => {
            if (!ready.length) return ctx.skip();
            const report = await distribute();
            expect(report.totals.failed).toBe(0);

            for (const address of ready) {
                const dev = await device(address);
                expect(dev?.mode, address).toBe('remote');
                const expected = sliceWidth(dev?.channelRanges, showChannels);
                expect(expected, `${address} drives part of the show`).toBeGreaterThan(0);
                expect(expected, `${address} drives less than all of it`).toBeLessThan(showChannels);

                // The device's own metadata agrees it holds a sparse cut of
                // the show, on the show's timeline.
                const meta = await deviceMeta(address, sequence);
                expect(meta!.ChannelCount, address).toBe(expected);
                // Only the channels were cut: same timeline as the master.
                expect(meta!.NumFrames, address).toBe(showFrames);

                const target = report.targets.find((t) => t.id === idOf(address));
                expect(target?.items.find((i) => i.kind === 'sequence')?.reason, address).toMatch(/sliced to/);
            }
        }, 300_000);

        it('recognises its slice on a second run', async (ctx) => {
            if (!ready.length) return ctx.skip();
            const again = await distribute();
            expect(again.totals.uploaded).toBe(0);
            expect(again.totals.bytes).toBe(0);
        }, 300_000);

        it.skipIf(!PLAY)(
            'plays its own copy in step with us',
            async (ctx) => {
                if (!ready.length) return ctx.skip();
                expect(
                    (
                        await ezp.putPlaylist(PLAYLIST, {
                            name: PLAYLIST,
                            mainPlaylist: [{ type: 'sequence', enabled: 1, playOnce: 0, sequenceName: sequence }],
                        })
                    ).status,
                ).toBe(200);

                await ezp.command('Start Playlist', PLAYLIST, '0');
                await ezp.waitForStatus((s) => s.status_name === 'playing', {
                    label: 'master playing',
                    timeoutMs: 20_000,
                });
                try {
                    for (const address of ready) {
                        const playing = await waitForFpp(
                            address,
                            (s) => s.status_name === 'playing',
                            'follows our start',
                        );
                        expect(playing.current_sequence, address).toBe(sequence);
                        const ours = Number(
                            ((await (await fetch(`${app.base}/api/fppd/status`)).json()) as FppStatus).seconds_elapsed,
                        );
                        // A remote that ignored our sync packets would run from
                        // its own start time and drift.
                        expect(Math.abs(ours - Number(playing.seconds_elapsed)), address).toBeLessThan(2.5);
                    }
                } finally {
                    await ezp.command('Stop Now');
                }
                for (const address of ready) {
                    await waitForFpp(address, (s) => s.status_name === 'idle', 'follows our stop');
                }
            },
            300_000,
        );
    });
});
