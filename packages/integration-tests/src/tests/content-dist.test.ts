/**
 * Content distribution against a live headless app, driven entirely through the
 * HTTP API — the surface a script has, with no UI involved.
 *
 * Two runs through it:
 *  - add a song, send it, confirm each device holds it, then play it and watch
 *    the output arrive;
 *  - send with one device down, see it reported behind, bring it back, see that
 *    it still needs the content, send again, and play again.
 *
 * The mock controllers answer FPP's content API in process, so what they end up
 * holding can be read directly rather than inferred from our own report.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import type { ControllerOpsState, DiscoveredController } from '@ezplayer/ezplayer-core';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

const CHANNELS = 150;
const FRAMES = 200; // 10s at 50ms

let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;
/** The device every scenario distributes to, plus its DDP sink. */
let primary: MockController;

/** Address the player uses for a mock; the port makes it unambiguous. */
const addressOf = (mock: MockController) => `127.0.0.1:${mock.httpPort}`;
const idOf = (mock: MockController) => `${addressOf(mock)}|direct`;

async function controllers(): Promise<ControllerOpsState> {
    const res = await fetch(`${app.base}/api/ezp/controllers`);
    expect(res.status).toBe(200);
    return (await res.json()) as ControllerOpsState;
}

async function device(mock: MockController): Promise<DiscoveredController | undefined> {
    return (await controllers()).devices[idOf(mock)];
}

/** Issue a controller command over HTTP, as a script would. */
async function command(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${app.base}/api/ezp/controllers/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status, `${JSON.stringify(body)} -> ${JSON.stringify(json)}`).toBe(200);
    return json;
}

/** Introduce a device to the player without a network scan. */
const learnAbout = (mock: MockController) =>
    command({ cmd: 'status', id: idOf(mock), address: addressOf(mock), depth: 'full' });

/** Sequence file names the mock holds. */
const heldSequences = (mock: MockController) => [...(mock.http.content.files.get('sequences')?.keys() ?? [])].sort();

beforeAll(async () => {
    primary = await startMockController({ channels: CHANNELS, ddpPort: 0 });
    show = await createFixtureShow({ channels: CHANNELS });
    // An ephemeral DDP port so playback output lands on the mock we can read.
    await fsp.mkdir(path.join(show.dir, '.ezplayer'), { recursive: true });
    await fsp.writeFile(
        path.join(show.dir, '.ezplayer', 'playbackSettings.json'),
        JSON.stringify({
            audioSyncAdjust: 0,
            backgroundSequence: 'overlay',
            viewerControl: { enabled: false, type: 'disabled', schedule: [] },
            volumeControl: { defaultVolume: 100, schedule: [] },
            advanced: { ddpPort: primary.ddpPort },
        }),
    );
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
}, 120_000);

afterAll(async () => {
    await app?.stop();
    await primary?.stop();
    await show?.cleanup();
});

describe('add a song, send it, play it', () => {
    it('distributes a newly added song and leaves the device holding it', async () => {
        // A song arrives the way the Songs screen adds one: file, then record.
        await fpp.upload('sequences', 'Carol.fseq', buildFseq({ channels: CHANNELS, frames: FRAMES, value: 42 }));
        const reg = await fetch(`${app.base}/api/ezp/sequences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ files: { fseq: 'Carol.fseq' }, work: { title: 'Carol', artist: '', length: 0 } }]),
        });
        expect(reg.status).toBe(200);

        await learnAbout(primary);
        const seen = await device(primary);
        expect(seen?.driverType).toBe('FPP');
        // The mock answers as a remote, so the player will cut the show down.
        expect(seen?.mode).toBe('remote');
        expect(seen?.channelRanges).toBeTruthy();

        // Nothing has been sent yet.
        expect(heldSequences(primary)).toEqual([]);

        await command({ cmd: 'distribute' });

        expect(heldSequences(primary)).toEqual(['Carol.fseq']);
        const after = await device(primary);
        expect(after?.contentStatus?.missing).toBe(0);
        expect(after?.contentStatus?.failed).toBe(0);
        expect(after?.contentStatus?.current).toBeGreaterThan(0);
        expect(after?.contentStatus?.error).toBeUndefined();

        // The inventory playlist is an FYI list of what we left there.
        expect([...primary.http.content.playlists.keys()]).toContain('EZPlayer Content');

        // The report says the same, and names the path it took.
        const dist = (await controllers()).contentDist;
        expect(dist?.lastReport?.totals.failed).toBe(0);
        expect(dist?.lastReport?.totals.uploaded).toBeGreaterThan(0);
        expect(dist?.lastReport?.targets[0].uploadMethod).toBe('patch');
    }, 120_000);

    it('sends nothing on a second run', async () => {
        const before = primary.http.content.uploadLog.length;
        await command({ cmd: 'distribute' });
        expect(primary.http.content.uploadLog.length).toBe(before);
        expect((await controllers()).contentDist?.lastReport?.totals).toMatchObject({ uploaded: 0, bytes: 0 });
    }, 120_000);

    it('plays the song, and the output reaches the device', async () => {
        const res = await fpp.putPlaylist('ContentShow', {
            name: 'ContentShow',
            mainPlaylist: [{ type: 'sequence', sequenceName: 'Carol.fseq' }],
        });
        expect(res.status).toBe(200);

        primary.ddp.reset?.();
        await fpp.command('Start Playlist', 'ContentShow', 0, 0, 0);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'content play', timeoutMs: 20_000 });
        await primary.ddp.waitForFrames(10, { timeoutMs: 20_000 });
        expect(Array.from(primary.ddp.channelRange(0, 3))).toEqual([42, 42, 42]);
        await fpp.command('Stop Now');
    }, 120_000);
});

describe('one device down, then back', () => {
    let spare: MockController;
    let sparePort = 0;

    beforeAll(async () => {
        spare = await startMockController({ channels: CHANNELS, ddpPort: 0 });
        sparePort = spare.httpPort;
        await learnAbout(spare);
        expect((await device(spare))?.driverType).toBe('FPP');
    }, 60_000);

    afterAll(async () => {
        await spare?.stop();
    });

    it('reports the device that could not be reached, and still sends to the other', async () => {
        // It goes down between being learned about and being sent to.
        await spare.stop();

        await command({ cmd: 'distribute' });

        // A device failing is not the request failing: the report carries it.
        const report = (await controllers()).contentDist?.lastReport;
        expect(report?.totals.targetsFailed).toBe(1);
        // A device that answered the check and then stopped answering records a
        // failed file rather than being passed over, so the failure is per item.
        const failed = report?.targets.find((t) => t.id === `127.0.0.1:${sparePort}|direct`);
        expect(failed?.items.some((i) => i.action === 'failed')).toBe(true);
        expect(report?.totals.failed).toBeGreaterThan(0);

        // The reachable one is unaffected and still current.
        expect(heldSequences(primary)).toEqual(['Carol.fseq']);
        expect((await device(primary))?.contentStatus?.missing).toBe(0);

        // And the one that was down is marked as needing content, with the
        // reason on the row rather than only in the report.
        const down = await device(spare);
        expect(down?.contentStatus?.failed).toBeGreaterThan(0);
        expect(down?.contentStatus?.error ?? '').not.toBe('');
    }, 120_000);

    it('sees the content still missing once it is back, then fills it', async () => {
        // Back on the same port, so it is the same device to the player. A
        // retry of this test restarts it, which is the state it wants anyway.
        await spare?.stop().catch(() => undefined);
        spare = await startMockController({ channels: CHANNELS, ddpPort: 0, httpPort: sparePort });
        expect(spare.httpPort).toBe(sparePort);
        expect(heldSequences(spare)).toEqual([]);

        // A check reads the device's own file list and sends nothing.
        await command({ cmd: 'distribute', checkOnly: true });
        const checked = await device(spare);
        expect(checked?.contentStatus?.error).toBeUndefined();
        expect(checked?.contentStatus?.missing).toBeGreaterThan(0);
        expect(heldSequences(spare)).toEqual([]);

        // Then a real run, limited to the device that needs it.
        await command({ cmd: 'distribute', ids: [idOf(spare)] });
        expect(heldSequences(spare)).toEqual(['Carol.fseq']);
        const filled = await device(spare);
        expect(filled?.contentStatus?.missing).toBe(0);
        expect(filled?.contentStatus?.failed).toBe(0);
    }, 120_000);

    it('plays again with both devices holding the show', async () => {
        primary.ddp.reset?.();
        await fpp.command('Start Playlist', 'ContentShow', 0, 0, 0);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'replay', timeoutMs: 20_000 });
        await primary.ddp.waitForFrames(10, { timeoutMs: 20_000 });
        expect(Array.from(primary.ddp.channelRange(0, 3))).toEqual([42, 42, 42]);
        await fpp.command('Stop Now');
    }, 120_000);
});

describe('a remote that drives only part of the show', () => {
    /** 60 of the show's 150 channels, so a slice is worth making. */
    const REMOTE_CHANNELS = 60;
    let partial: MockController;

    beforeAll(async () => {
        partial = await startMockController({ channels: REMOTE_CHANNELS, ddpPort: 0 });
        await learnAbout(partial);
    }, 60_000);

    afterAll(async () => {
        await partial?.stop();
    });

    it('is sent a cut-down sequence, not the whole show', async () => {
        const seen = await device(partial);
        expect(seen?.mode).toBe('remote');
        expect(seen?.channelRanges).toBe(`0-${REMOTE_CHANNELS - 1}`);

        await command({ cmd: 'distribute', ids: [idOf(partial)] });

        expect(heldSequences(partial)).toEqual(['Carol.fseq']);
        const landed = partial.http.content.files.get('sequences')!.get('Carol.fseq')!;
        const whole = primary.http.content.files.get('sequences')!.get('Carol.fseq')!;
        // Fewer channels per frame means a materially smaller file.
        expect(landed.length).toBeLessThan(whole.length);

        // The device's own metadata agrees it holds a sparse 60-channel cut.
        const meta = (await (await fetch(`${partial.url}/api/sequence/Carol.fseq/meta`)).json()) as {
            ChannelCount: number;
            Ranges: { Start: number; Length: number }[];
            NumFrames: number;
        };
        expect(meta.ChannelCount).toBe(REMOTE_CHANNELS);
        expect(meta.Ranges).toEqual([{ Start: 0, Length: REMOTE_CHANNELS }]);
        // Same timeline as the master: only the channels were cut.
        expect(meta.NumFrames).toBe(FRAMES);

        const report = (await controllers()).contentDist?.lastReport;
        const target = report?.targets.find((t) => t.id === idOf(partial));
        expect(target?.items.find((i) => i.kind === 'sequence')?.reason).toMatch(/sliced to 60 of 150 channels/);
    }, 120_000);

    it('recognises its slice on a second run and sends nothing', async () => {
        const before = partial.http.content.uploadLog.length;
        await command({ cmd: 'distribute', ids: [idOf(partial)] });
        expect(partial.http.content.uploadLog.length).toBe(before);
        expect((await device(partial))?.contentStatus?.missing).toBe(0);
    }, 120_000);
});
