/**
 * The player's side of content distribution: which devices are targets, what
 * the plan holds, how the engine's report becomes the state every UI reads, and
 * when automatic distribution is allowed to act.
 */

import { describe, expect, it } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { promises as fsp } from 'fs';
import type {
    CloudPollScheduleEntry,
    ContentDistTargetReport,
    DiscoveredController,
    KnownController,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import type { ContentSyncReport, ContentSyncSnapshot, ContentSyncTargetSpec } from '@ezplayer/epp-controllers';
import { readFseqIdentity } from '@ezplayer/epp-controllers';
import { FseqV2Writer } from '@ezplayer/epp';
import {
    buildContentPlan,
    contentAutoDecision,
    contentStatusFor,
    contentTargetsFor,
    createSliceWorkspace,
    DEFAULT_CONTENT_PLAYLIST,
    isContentTarget,
    slicingFor,
    toContentDistReport,
    toContentDistRun,
} from './content-dist.js';

const device = (over: Partial<DiscoveredController> & { ip: string }): DiscoveredController => ({
    id: `${over.ip}|direct`,
    source: { via: 'direct' },
    seenAt: '2026-10-28T00:00:00.000Z',
    ...over,
});

// A minimal v2 fseq: enough header for the identity reader, no frames needed.
function fseqBytes(opts: { channels: number; frames: number; mediaName?: string }): Buffer {
    const mf = opts.mediaName
        ? Buffer.concat([Buffer.from('mf'), Buffer.from(opts.mediaName, 'utf8'), Buffer.from([0])])
        : Buffer.alloc(0);
    // 4-byte length-and-code prefix per variable header.
    const varHeader = mf.length ? Buffer.concat([Buffer.alloc(2), mf]) : Buffer.alloc(0);
    if (varHeader.length) varHeader.writeUInt16LE(varHeader.length, 0);
    const headerLen = 32 + varHeader.length;
    const head = Buffer.alloc(32);
    head.write('PSEQ', 0, 'ascii');
    head.writeUInt16LE(headerLen, 4); // offset to the first frame
    head[6] = 0; // minor
    head[7] = 2; // major
    head[8] = 32; // standard header length
    head.writeUInt32LE(opts.channels, 10); // channel count (frame stride)
    head.writeUInt32LE(opts.frames, 14);
    head[18] = 25; // step time ms
    head[19] = 0; // flags
    head[20] = 0; // compression: none, and 0 compression blocks
    head[21] = 0;
    head[22] = 0; // sparse ranges
    head[23] = 0;
    head.writeBigUInt64LE(123456789n, 24);
    return Buffer.concat([head, varHeader, Buffer.alloc(opts.channels * opts.frames)]);
}

describe('content distribution targets', () => {
    it('counts FPP as holding content and other drivers as not', () => {
        expect(isContentTarget(device({ ip: '10.0.0.5', driverType: 'FPP' }))).toBe(true);
        expect(isContentTarget(device({ ip: '10.0.0.6', driverType: 'Falcon' }))).toBe(false);
        expect(isContentTarget(device({ ip: '10.0.0.7' }))).toBe(false);
    });

    it('selects every FPP when no ids are given', () => {
        const targets = contentTargetsFor([
            device({ ip: '10.0.0.5', driverType: 'FPP', hostname: 'fpp-a', firmwareVersion: '8.4.2' }),
            device({ ip: '10.0.0.6', driverType: 'Falcon' }),
            device({ ip: '10.0.0.7', driverType: 'FPP', hostname: 'fpp-b', firmwareVersion: '6.3' }),
        ]);
        expect(targets.map((t) => t.hostName)).toEqual(['fpp-a', 'fpp-b']);
        expect(targets[0].label).toBe('fpp-a (10.0.0.5)');
    });

    it('reports a named non-content device rather than dropping it', () => {
        const dev = device({ ip: '10.0.0.6', driverType: 'Falcon' });
        const targets = contentTargetsFor([dev], [dev.id]);
        expect(targets).toHaveLength(1);
        expect(targets[0].supported).toBe(false);
        expect(targets[0].unsupportedReason).toMatch(/Falcon/);
    });

    it('marks an unreachable device unsupported, so a run does not hang on it', () => {
        const dev = device({ ip: '10.0.0.5', driverType: 'FPP', unreachable: true });
        expect(contentTargetsFor([dev])[0]).toMatchObject({ supported: false, unsupportedReason: 'not responding' });
    });

    it('addresses a proxied device through its proxy', () => {
        const dev = device({ ip: '192.168.7.9', driverType: 'FPP', source: { via: 'fpp-proxy', proxy: '10.0.0.5' } });
        // The endpoint keeps the device's own ip; only the base url goes via the proxy.
        expect(contentTargetsFor([dev])[0].endpoint.ip).toBe('192.168.7.9');
    });

    // A version we cannot read must not claim the chunked path a v6 device
    // would reject; it falls to the v6 route, which every version answers.
    it.each([
        ['8.4.2', true],
        ['v7.5', true],
        ['7.0', true],
        ['6.3', false],
        ['pre-7', false],
        [undefined, false],
    ])('reads %s as FPP 7 or later: %s', (version, atLeast7) => {
        const dev = device({ ip: '10.0.0.5', driverType: 'FPP', ...(version ? { firmwareVersion: version } : {}) });
        expect(contentTargetsFor([dev])[0].endpoint.isVersionAtLeast(7, 0)).toBe(atLeast7);
    });
});

describe('the plan', () => {
    const record = (over: Partial<SequenceRecord> & { id: string }): SequenceRecord => ({
        instanceId: `i-${over.id}`,
        work: { title: over.id, artist: '', length: 0 },
        ...over,
    });

    it('takes sequences with a file on disk, names media from the fseq header, and skips the rest', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-dist-'));
        const fseq = path.join(dir, 'Carol.fseq');
        const audio = path.join(dir, 'Carol-local.mp3');
        await fsp.writeFile(fseq, fseqBytes({ channels: 16, frames: 4, mediaName: 'Carol.mp3' }));
        await fsp.writeFile(audio, Buffer.alloc(2048, 7));

        const { plan, skipped } = await buildContentPlan(
            [
                record({ id: 'a', files: { fseq, audio } }),
                record({ id: 'b', files: { fseq: path.join(dir, 'Gone.fseq') } }),
                record({ id: 'c', deleted: true, files: { fseq } }),
                record({ id: 'd', render_enabled: false, files: { fseq } }),
                record({ id: 'e' }),
            ],
            undefined,
        );

        expect(plan.sequences.map((s) => s.name)).toEqual(['Carol.fseq']);
        expect(plan.sequences[0].identity.numFrames).toBe(4);
        // The device will ask for the name its own header carries, not ours.
        expect(plan.sequences[0].media?.name).toBe('Carol.mp3');
        expect(plan.sequences[0].media?.size).toBe(2048);
        expect(skipped).toEqual([{ name: 'Gone.fseq', reason: 'file not on disk' }]);
        expect(plan.playlistName).toBe(DEFAULT_CONTENT_PLAYLIST);
    });

    it('sends one copy when two records point at the same file', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-dist-'));
        const fseq = path.join(dir, 'Shared.fseq');
        await fsp.writeFile(fseq, fseqBytes({ channels: 8, frames: 2 }));
        const { plan } = await buildContentPlan(
            [record({ id: 'a', files: { fseq } }), record({ id: 'b', files: { fseq } })],
            undefined,
        );
        expect(plan.sequences).toHaveLength(1);
    });

    it('limits the plan to the named sequences', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-dist-'));
        const one = path.join(dir, 'One.fseq');
        const two = path.join(dir, 'Two.fseq');
        await fsp.writeFile(one, fseqBytes({ channels: 8, frames: 2 }));
        await fsp.writeFile(two, fseqBytes({ channels: 8, frames: 2 }));
        const { plan } = await buildContentPlan(
            [record({ id: 'a', files: { fseq: one } }), record({ id: 'b', files: { fseq: two } })],
            undefined,
            { only: ['Two.fseq'] },
        );
        expect(plan.sequences.map((s) => s.name)).toEqual(['Two.fseq']);
    });

    it('finds a per-host cut of the media beside the original', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-dist-'));
        const fseq = path.join(dir, 'Carol.fseq');
        await fsp.writeFile(fseq, fseqBytes({ channels: 8, frames: 2, mediaName: 'Carol.mp3' }));
        await fsp.writeFile(path.join(dir, 'Carol.mp3'), Buffer.alloc(100));
        await fsp.writeFile(path.join(dir, 'Carol-matrix-pi.mp3'), Buffer.alloc(200));

        const { plan } = await buildContentPlan(
            [record({ id: 'a', files: { fseq, audio: path.join(dir, 'Carol.mp3') } })],
            undefined,
        );
        const seq = plan.sequences[0];
        await expect(plan.resolveMedia!(seq, 'matrix-pi')).resolves.toMatchObject({
            name: 'Carol-matrix-pi.mp3',
            size: 200,
        });
        // No per-host file: the caller keeps the shared one.
        await expect(plan.resolveMedia!(seq, 'other-pi')).resolves.toBeUndefined();
    });

    it('honours an empty playlist name as "do not register"', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-dist-'));
        const fseq = path.join(dir, 'One.fseq');
        await fsp.writeFile(fseq, fseqBytes({ channels: 8, frames: 2 }));
        const { plan } = await buildContentPlan([record({ id: 'a', files: { fseq } })], {
            viewerControl: {},
            volumeControl: {},
            contentDistribution: { playlistName: '' },
        } as never);
        expect(plan.playlistName).toBeUndefined();
    });
});

describe('mapping the engine onto the broadcast state', () => {
    const snapshot: ContentSyncSnapshot = {
        running: true,
        cancelled: false,
        startedAtMs: Date.parse('2026-10-28T01:00:00.000Z'),
        fraction: 0.5,
        targets: [
            {
                id: 'a|direct',
                label: 'fpp-a',
                phase: 'uploading',
                item: 'Carol.fseq',
                bytesSent: 500,
                bytesTotal: 1000,
                fraction: 0.5,
                itemsDone: 1,
                itemsTotal: 3,
                failures: 0,
            },
        ],
    };

    it('carries per-device progress and sums the bytes', () => {
        const run = toContentDistRun(snapshot, { opId: 'op_1', checkOnly: false, trigger: 'manual' });
        expect(run).toMatchObject({ opId: 'op_1', fraction: 0.5, bytesSent: 500, bytesTotal: 1000 });
        expect(run.startedAt).toBe('2026-10-28T01:00:00.000Z');
        expect(run.targets[0]).toMatchObject({ phase: 'uploading', item: 'Carol.fseq', itemsTotal: 3 });
    });

    it('turns a report into timestamps and totals', () => {
        const report: ContentSyncReport = {
            startedAtMs: Date.parse('2026-10-28T01:00:00.000Z'),
            finishedAtMs: Date.parse('2026-10-28T01:00:05.000Z'),
            cancelled: false,
            targets: [
                {
                    id: 'a|direct',
                    label: 'fpp-a',
                    hostName: 'fpp-a',
                    version: '8.4.2',
                    supported: true,
                    uploadMethod: 'patch',
                    items: [
                        {
                            kind: 'sequence',
                            name: 'Carol.fseq',
                            action: 'uploaded',
                            reason: 'not on device',
                            bytes: 900,
                            ms: 10,
                            method: 'patch',
                        },
                        { kind: 'media', name: 'Carol.mp3', action: 'skipped', reason: 'same size', bytes: 0, ms: 1 },
                    ],
                    bytesUploaded: 900,
                    startedAtMs: Date.parse('2026-10-28T01:00:00.000Z'),
                    finishedAtMs: Date.parse('2026-10-28T01:00:05.000Z'),
                },
            ],
            totals: { targets: 1, targetsFailed: 0, uploaded: 1, skipped: 1, failed: 0, planned: 0, bytes: 900 },
        };
        const out = toContentDistReport(report, { checkOnly: false, trigger: 'songs' });
        expect(out.startedAt).toBe('2026-10-28T01:00:00.000Z');
        expect(out.trigger).toBe('songs');
        expect(out.targets[0].items.map((i) => i.action)).toEqual(['uploaded', 'skipped']);
        expect(out.totals.bytes).toBe(900);
    });

    const targetReport = (
        items: ContentDistTargetReport['items'],
        over: Partial<ContentDistTargetReport> = {},
    ): ContentDistTargetReport => ({
        id: 'a|direct',
        label: 'fpp-a',
        hostName: 'fpp-a',
        supported: true,
        items,
        bytesUploaded: 0,
        startedAt: '2026-10-28T01:00:00.000Z',
        finishedAt: '2026-10-28T01:00:05.000Z',
        ...over,
    });

    it('counts a sent or current file as held, and prices what is missing', () => {
        const status = contentStatusFor(
            targetReport([
                { kind: 'sequence', name: 'a.fseq', action: 'uploaded', reason: '', bytes: 100, ms: 1 },
                { kind: 'media', name: 'a.mp3', action: 'skipped', reason: '', bytes: 0, ms: 1 },
                { kind: 'sequence', name: 'b.fseq', action: 'planned', reason: '', bytes: 400, ms: 0 },
                { kind: 'sequence', name: 'c.fseq', action: 'failed', reason: 'refused', bytes: 50, ms: 1 },
                // The inventory playlist is not content the device is missing.
                { kind: 'playlist', name: 'EZPlayer Content', action: 'uploaded', reason: '', bytes: 0, ms: 1 },
            ]),
        );
        expect(status).toMatchObject({ current: 2, missing: 1, failed: 1, missingBytes: 450 });
        expect(status.checkedAt).toBe('2026-10-28T01:00:05.000Z');
    });

    it('surfaces a device-level note as the row error', () => {
        const status = contentStatusFor(targetReport([], { note: 'not responding', supported: false }));
        expect(status.error).toBe('not responding');
    });
});

describe('when automatic distribution acts', () => {
    const now = new Date('2026-10-28T02:00:00.000Z');
    const nowMs = now.getTime();
    // Local time, since the schedule is read in the player's own timezone.
    const allDay: CloudPollScheduleEntry[] = [{ id: 'w', days: 'all', startTime: '00:00', endTime: '23:59' }];

    it('does nothing by default', () => {
        expect(contentAutoDecision(undefined, now, { queued: 3, lastRunMs: undefined, nowMs })).toEqual({
            act: false,
            hold: 'off',
        });
    });

    it('acts on queued content as soon as it is allowed', () => {
        expect(contentAutoDecision({ mode: 'always' }, now, { queued: 1, lastRunMs: nowMs, nowMs })).toEqual({
            act: true,
            trigger: 'songs',
        });
    });

    it('leaves queued content alone when following song adds is off', () => {
        const d = contentAutoDecision({ mode: 'always', followSongAdds: false }, now, {
            queued: 1,
            lastRunMs: nowMs,
            nowMs,
        });
        expect(d).toEqual({ act: false, hold: 'idle' });
    });

    it('polls on the configured cadence and waits in between', () => {
        const settings = { mode: 'always' as const, pollMinutes: 30 };
        expect(contentAutoDecision(settings, now, { queued: 0, lastRunMs: nowMs - 29 * 60_000, nowMs })).toEqual({
            act: false,
            hold: 'idle',
        });
        expect(contentAutoDecision(settings, now, { queued: 0, lastRunMs: nowMs - 31 * 60_000, nowMs })).toEqual({
            act: true,
            trigger: 'schedule',
        });
        // Never run before: there is work to look for straight away.
        expect(contentAutoDecision(settings, now, { queued: 0, lastRunMs: undefined, nowMs })).toEqual({
            act: true,
            trigger: 'schedule',
        });
    });

    it('holds outside the window, and inside it acts', () => {
        expect(
            contentAutoDecision({ mode: 'scheduled', schedule: allDay }, now, { queued: 1, lastRunMs: nowMs, nowMs }),
        ).toEqual({ act: true, trigger: 'songs' });
        expect(
            contentAutoDecision({ mode: 'scheduled', schedule: [] }, now, { queued: 1, lastRunMs: nowMs, nowMs }),
        ).toEqual({ act: false, hold: 'outside-window' });
    });

    it('treats a zero cadence as "only what is queued"', () => {
        expect(
            contentAutoDecision({ mode: 'always', pollMinutes: 0 }, now, { queued: 0, lastRunMs: undefined, nowMs }),
        ).toEqual({ act: false, hold: 'idle' });
    });
});

describe('slicing for a remote', () => {
    const remote = (over: Partial<DiscoveredController> = {}) =>
        device({ ip: '10.0.0.5', driverType: 'FPP', mode: 'remote', ...over });

    const layout = (over: Partial<KnownController> & { name: string }): KnownController => ({
        source: 'xlights',
        ...over,
    });

    it('takes the ranges the device reports, in preference to the layout', () => {
        const known = [layout({ name: 'Far Side', address: '10.0.0.5', startChannel: 1, channelCount: 9999 })];
        expect(slicingFor(remote({ channelRanges: '0-509,1024-2047' }), known)).toEqual({
            source: 'device',
            ranges: [
                { startch: 0, chcount: 510 },
                { startch: 1024, chcount: 1024 },
            ],
        });
    });

    it('falls back to the xLights span, counting from zero', () => {
        const known = [layout({ name: 'Far Side', address: '10.0.0.5', startChannel: 2049, channelCount: 1024 })];
        expect(slicingFor(remote(), known)).toEqual({
            source: 'xlights',
            // xLights' channel 2049 is a sequence's channel 2048.
            ranges: [{ startch: 2048, chcount: 1024 }],
        });
    });

    it('matches an xLights record by hostname as well as address', () => {
        const known = [layout({ name: 'Far Side', address: 'FPP-Far', startChannel: 1, channelCount: 64 })];
        expect(slicingFor(remote({ hostname: 'fpp-far' }), known)?.source).toBe('xlights');
    });

    it('does not slice for a player, which drives the whole show', () => {
        expect(slicingFor(remote({ mode: 'player', channelRanges: '0-509' }))).toBeNull();
        expect(slicingFor(remote({ mode: 'bridge', channelRanges: '0-509' }))).toBeNull();
        expect(slicingFor(device({ ip: '10.0.0.5', driverType: 'FPP', channelRanges: '0-509' }))).toBeNull();
    });

    it('does not slice for a device that is not ours to fill, or says nothing', () => {
        expect(slicingFor(device({ ip: '10.0.0.6', driverType: 'Falcon', mode: 'remote' }))).toBeNull();
        expect(slicingFor(remote(), [])).toBeNull();
    });
});

describe('a plan that slices', () => {
    const record = (over: Partial<SequenceRecord> & { id: string }): SequenceRecord => ({
        instanceId: `i-${over.id}`,
        work: { title: over.id, artist: '', length: 0 },
        ...over,
    });

    /** A real, readable source: 2,048 channels of a recognisable pattern. */
    async function showWithOneSequence(dir: string) {
        const file = path.join(dir, 'Song.fseq');
        const w = new FseqV2Writer(file, {
            numFrames: 4,
            stepTimeMs: 25,
            channelCount: 2048,
            uniqueId: '424242',
            mediaName: 'Song.mp3',
        });
        const frame = new Uint8Array(2048);
        for (let f = 0; f < 4; f++) {
            for (let c = 0; c < 2048; c++) frame[c] = (c + f) & 0xff;
            w.addFrame(frame);
        }
        w.close();
        return [record({ id: 'a', files: { fseq: file } })];
    }

    const target = (id: string): ContentSyncTargetSpec =>
        contentTargetsFor([device({ ip: '10.0.0.5', driverType: 'FPP', mode: 'remote' })], [id])[0];

    it('offers the remote a sliced identity, and writes the slice only when asked', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-slice-plan-'));
        const sequences = await showWithOneSequence(dir);
        const workspace = await createSliceWorkspace();
        try {
            const id = '10.0.0.5|direct';
            const slicing = new Map([[id, { source: 'device' as const, ranges: [{ startch: 100, chcount: 64 }] }]]);
            const { plan } = await buildContentPlan(sequences, undefined, { slicing, workspace });
            const seq = plan.sequences[0];
            expect(seq.identity.channelCount).toBe(2048);

            const resolved = await plan.resolveSequence!(seq, target(id));
            expect(resolved).toBeTruthy();
            // The identity describes the slice without having written it.
            expect(resolved!.identity.channelCount).toBe(64);
            expect(resolved!.identity.ranges).toEqual([{ start: 100, length: 64 }]);
            expect(resolved!.identity.maxChannel).toBe(164);
            expect(resolved!.identity.numFrames).toBe(4);
            // Same sequence, same audio: only the channels differ.
            expect(resolved!.identity.uniqueId).toBe('424242');
            expect(resolved!.identity.mediaName).toBe('Song.mp3');
            expect(resolved!.note).toMatch(/sliced to 64 of 2,048 channels/);
            expect(await fsp.readdir(workspace.dir)).toEqual([]);

            // Only now is a file written, and it holds the right bytes.
            const bytes = await resolved!.open();
            expect(bytes.size).toBeGreaterThan(0);
            expect(await fsp.readdir(workspace.dir)).toHaveLength(1);
            const written = await bytes.blob.read(0, bytes.size);
            expect(readFseqIdentity(written).ranges).toEqual([{ start: 100, length: 64 }]);
        } finally {
            await workspace.dispose();
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('leaves a target with no slicing on the show file', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-slice-plan-'));
        try {
            const sequences = await showWithOneSequence(dir);
            const { plan } = await buildContentPlan(sequences, undefined);
            expect(await plan.resolveSequence!(plan.sequences[0], target('10.0.0.5|direct'))).toBeUndefined();
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('sends the show file when a slice would be no smaller', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-slice-plan-'));
        const workspace = await createSliceWorkspace();
        try {
            const sequences = await showWithOneSequence(dir);
            const id = '10.0.0.5|direct';
            // The remote drives the whole show: cutting it would gain nothing.
            const slicing = new Map([[id, { source: 'device' as const, ranges: [{ startch: 0, chcount: 4096 }] }]]);
            const { plan } = await buildContentPlan(sequences, undefined, { slicing, workspace });
            expect(await plan.resolveSequence!(plan.sequences[0], target(id))).toBeUndefined();
        } finally {
            await workspace.dispose();
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });
});
