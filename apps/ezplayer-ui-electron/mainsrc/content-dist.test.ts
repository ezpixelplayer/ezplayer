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
import { derivedAudioPathFor } from './data/derived-audio.js';
import {
    buildContentPlan,
    contentAutoDecision,
    contentHostsForShow,
    contentStatusFor,
    contentTargetsFor,
    contentTargetsForHosts,
    createSliceWorkspace,
    DEFAULT_CONTENT_PLAYLIST,
    isContentTarget,
    proxyForDevice,
    slicingFor,
    recordHoldsContent,
    slicingPlanFor,
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

describe('how a device is reached', () => {
    const known = (over: Partial<KnownController> & { name: string }): KnownController => ({
        source: 'xlights',
        ...over,
    });

    it('uses the proxy discovery found the device behind', () => {
        const dev = device({ ip: '10.0.0.9', source: { via: 'fpp-proxy', proxy: '10.0.0.5' } });
        expect(proxyForDevice(dev, [])).toBe('10.0.0.5');
    });

    it('uses the proxy the layout names for a device we learned by address', () => {
        // The case that matters: nothing but the layout knows the controller
        // sits on a network only the player can see.
        const dev = device({ ip: '192.168.101.72' });
        const recs = [known({ name: 'wled digquad', address: '192.168.101.72', proxy: '192.168.1.23' })];
        expect(proxyForDevice(dev, recs)).toBe('192.168.1.23');
    });

    it('prefers what discovery saw over what the layout says', () => {
        const dev = device({ ip: '10.0.0.9', source: { via: 'fpp-proxy', proxy: '10.0.0.5' } });
        const recs = [known({ name: 'stale', address: '10.0.0.9', proxy: '10.0.0.77' })];
        expect(proxyForDevice(dev, recs)).toBe('10.0.0.5');
    });

    it('goes direct when the layout names no proxy', () => {
        const dev = device({ ip: '10.0.0.9' });
        expect(proxyForDevice(dev, [known({ name: 'plain', address: '10.0.0.9' })])).toBeUndefined();
    });

    it('refuses to proxy a device through itself', () => {
        const dev = device({ ip: '192.168.1.23', hostname: 'fpp4-lab' });
        const recs = [known({ name: 'fpp4-lab', address: '192.168.1.23', proxy: '192.168.1.23' })];
        expect(proxyForDevice(dev, recs)).toBeUndefined();
    });

    it('refuses a proxy naming the device by its own hostname', () => {
        const dev = device({ ip: '192.168.1.23', hostname: 'fpp4-lab' });
        const recs = [known({ name: 'fpp4-lab', address: '192.168.1.23', proxy: 'FPP4-Lab' })];
        expect(proxyForDevice(dev, recs)).toBeUndefined();
    });

    it('addresses content for a proxied controller through that proxy', async () => {
        const dev = device({ ip: '192.168.101.60', driverType: 'FPP' });
        const recs = [known({ name: 'k16max-lab', address: '192.168.101.60', proxy: '192.168.1.23' })];
        const target = contentTargetsFor([dev], undefined, recs)[0];
        // The endpoint keeps its base URL private, so watch where it goes.
        const seen: string[] = [];
        const original = globalThis.fetch;
        globalThis.fetch = (async (url: string | URL) => {
            seen.push(String(url));
            return new Response('{}', { status: 200 });
        }) as typeof fetch;
        try {
            await target.endpoint.contentGetJson('/api/system/info');
        } finally {
            globalThis.fetch = original;
        }
        expect(seen).toEqual(['http://192.168.1.23/proxy/192.168.101.60/api/system/info']);
    });
});

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

describe('who is in the show for content', () => {
    const known = (over: Partial<KnownController> & { name: string }): KnownController => ({
        source: 'xlights',
        ...over,
    });

    it('reads FPP-ness out of the capability file, not the vendor name', () => {
        // A Kulp cape and a Wally's board are FPP boards sold under their own
        // names; nothing but the capability file's Base chain says so.
        expect(recordHoldsContent(known({ name: 'k32', vendor: 'KulpLights', model: 'K32', variant: 'K32-Pro' }))).toBe(
            true,
        );
        expect(recordHoldsContent(known({ name: 'wb', vendor: 'Wallys Lights', model: 'WB1616' }))).toBe(true);
        expect(recordHoldsContent(known({ name: 'p', vendor: 'FPP', model: 'FPP Player Only' }))).toBe(true);
        expect(recordHoldsContent(known({ name: 'f', vendor: 'Falcon', model: 'F16V3' }))).toBe(false);
        expect(
            recordHoldsContent(known({ name: 'w', vendor: 'WLED', model: 'QuinLED-Dig-Quad', variant: 'ESP32' })),
        ).toBe(false);
        expect(recordHoldsContent(known({ name: 'bare' }))).toBe(false);
    });

    it('builds the run from records, before anything has been scanned', () => {
        const recs = [
            known({
                name: 'fpp4-lab',
                address: '192.168.1.23',
                enableState: 'xlightsOnly',
                protocol: 'Player Only',
                vendor: 'FPP',
                model: 'FPP Player Only',
            }),
            known({
                name: 'wb1616-lab',
                address: '10.0.0.58',
                enableState: 'xlightsOnly',
                vendor: 'Wallys Lights',
                model: 'WB1616',
            }),
        ];
        const hosts = contentHostsForShow(recs, {});
        expect(hosts.map((h) => [h.id, h.role])).toEqual([
            ['192.168.1.23|record', 'player'],
            ['10.0.0.58|record', 'remote'],
        ]);
        // Reachable by address alone; the version is what a scan would add, and
        // without it the route every FPP answers is the one taken.
        const targets = contentTargetsForHosts(hosts, recs);
        expect(targets.map((t) => t.label)).toEqual(['fpp4-lab (192.168.1.23)', 'wb1616-lab (10.0.0.58)']);
        expect(targets[0].endpoint.isVersionAtLeast(7, 0)).toBe(false);
        expect(targets.every((t) => t.supported === undefined)).toBe(true);
    });

    it('leaves out an Active FPP, which is sent pixels rather than files', () => {
        // The resolver calls this one a "player" -- the layout has it in the
        // show and a player drives it -- but it holds no copy of anything.
        const recs = [
            known({
                name: 'k32pro-lab',
                address: '10.0.0.61',
                enableState: 'enabled',
                vendor: 'KulpLights',
                model: 'K32',
                variant: 'K32-Pro',
            }),
        ];
        expect(contentHostsForShow(recs, {})).toEqual([]);
    });

    it('answers for a controller named by hand, rather than returning nothing', () => {
        const recs = [
            known({
                name: 'k32pro-lab',
                address: '10.0.0.61',
                enableState: 'enabled',
                vendor: 'KulpLights',
                model: 'K32',
                variant: 'K32-Pro',
            }),
        ];
        const hosts = contentHostsForShow(recs, {}, ['10.0.0.61|record']);
        expect(hosts).toHaveLength(1);
        const target = contentTargetsForHosts(hosts, recs)[0];
        expect(target.supported).toBe(false);
        expect(target.unsupportedReason).toMatch(/neither the show player nor a remote/);
    });

    it('prefers the scanned device, and keeps a record-only host beside it', () => {
        const recs = [
            known({
                name: 'wb1616-lab',
                address: '10.0.0.58',
                enableState: 'xlightsOnly',
                vendor: 'Wallys Lights',
                model: 'WB1616',
            }),
            known({
                name: 'k16max-lab',
                address: '10.0.0.59',
                enableState: 'xlightsOnly',
                vendor: 'KulpLights',
                model: 'K16',
                variant: 'K16-Max',
            }),
        ];
        const devices = {
            '10.0.0.58|direct': device({ ip: '10.0.0.58', driverType: 'FPP', firmwareVersion: '8.4.2' }),
        };
        const hosts = contentHostsForShow(recs, devices);
        expect(hosts.map((h) => h.id)).toEqual(['10.0.0.58|direct', '10.0.0.59|record']);
        expect(contentTargetsForHosts(hosts, recs)[0].endpoint.isVersionAtLeast(7, 0)).toBe(true);
    });

    it('does not skip a box whose record says to presume it up', () => {
        const recs = [
            known({ name: 'quiet', address: '10.0.0.70', enableState: 'xlightsOnly', presumeUp: true }),
            known({ name: 'gone', address: '10.0.0.71', enableState: 'xlightsOnly' }),
        ];
        const devices = {
            '10.0.0.70|direct': device({ ip: '10.0.0.70', driverType: 'FPP', unreachable: true }),
            '10.0.0.71|direct': device({ ip: '10.0.0.71', driverType: 'FPP', unreachable: true }),
        };
        const targets = contentTargetsForHosts(contentHostsForShow(recs, devices), recs);
        expect(targets[0].supported).toBeUndefined();
        expect(targets[1]).toMatchObject({ supported: false, unsupportedReason: 'not responding' });
    });
});

describe('who is sent which channels', () => {
    const known = (over: Partial<KnownController> & { name: string }): KnownController => ({
        source: 'xlights',
        ...over,
    });

    // A show of 900 channels: the player owns 0-299 and 600-899, the remote
    // 300-599. Channel numbers in a layout count from 1.
    const recs = [
        known({ name: 'player', address: '10.0.0.1', enableState: 'xlightsOnly', protocol: 'Player Only' }),
        known({
            name: 'remote',
            address: '10.0.0.2',
            enableState: 'xlightsOnly',
            startChannel: 301,
            channelCount: 300,
        }),
        known({ name: 'falcon', address: '10.0.0.3', enableState: 'enabled', startChannel: 1, channelCount: 300 }),
        known({ name: 'falcon2', address: '10.0.0.4', enableState: 'enabled', startChannel: 601, channelCount: 300 }),
    ];
    const devices = {
        'player|direct': device({ ip: '10.0.0.1', driverType: 'FPP' }),
        'remote|direct': device({ ip: '10.0.0.2', driverType: 'FPP' }),
    };
    const ids = [{ id: 'player|direct' }, { id: 'remote|direct' }];

    it('gives a remote its own channels and the player what is left', () => {
        const plan = slicingPlanFor(ids, devices, recs);
        expect(plan.get('remote|direct')).toEqual({
            ranges: [{ startch: 300, chcount: 300 }],
            source: 'xlights',
        });
        // Exactly the complement, so the two together are the whole show with
        // no gap and nothing sent twice.
        expect(plan.get('player|direct')).toEqual({
            ranges: [
                { startch: 0, chcount: 300 },
                { startch: 600, chcount: 300 },
            ],
            source: 'remainder',
        });
    });

    it('prefers what the remote says it drives over what the layout says', () => {
        const reported = {
            ...devices,
            'remote|direct': device({ ip: '10.0.0.2', driverType: 'FPP', channelRanges: '350-499' }),
        };
        const plan = slicingPlanFor(ids, reported, recs);
        // A reported pair is inclusive: 350-499 is 150 channels from 350.
        expect(plan.get('remote|direct')).toEqual({
            ranges: [{ startch: 350, chcount: 150 }],
            source: 'device',
        });
        // The player's remainder is cut from the same source, so it covers
        // what the remote is not actually taking -- including the 50 channels
        // the layout gave the remote that it turns out not to drive.
        expect(plan.get('player|direct')?.ranges).toEqual([
            { startch: 0, chcount: 350 },
            { startch: 500, chcount: 400 },
        ]);
    });

    it('sends the player the show unsliced when there are no remotes', () => {
        const noRemotes = recs.map((r) => (r.name === 'remote' ? { ...r, enableState: 'enabled' as const } : r));
        const plan = slicingPlanFor([{ id: 'player|direct' }], devices, noRemotes);
        expect(plan.get('player|direct')).toBeUndefined();
    });

    it('does not slice for a device that holds no content', () => {
        const falcon = { 'falcon|direct': device({ ip: '10.0.0.3', driverType: 'Falcon' }) };
        expect(slicingPlanFor([{ id: 'falcon|direct' }], falcon, recs).size).toBe(0);
    });
});

describe('the plan', () => {
    const record = (over: Partial<SequenceRecord> & { id: string }): SequenceRecord => ({
        instanceId: `i-${over.id}`,
        work: { title: over.id, artist: '', length: 0 },
        ...over,
    });

    it('sends the audio playback would decode, named for the song', async () => {
        // A .wav source plays from a derived mp3, so that is what a device has
        // to be given: the same bytes, under a name that reads as the song.
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-dist-'));
        const fseq = path.join(dir, 'Carol.fseq');
        const audio = path.join(dir, 'Carol Of The Bells.wav');
        await fsp.writeFile(fseq, fseqBytes({ channels: 16, frames: 4 }));
        await fsp.writeFile(audio, Buffer.alloc(4096, 3));
        const derived = await derivedAudioPathFor(audio, dir, { normalize: false });
        await fsp.mkdir(path.dirname(derived!), { recursive: true });
        await fsp.writeFile(derived!, Buffer.alloc(512, 9));

        const { plan } = await buildContentPlan([record({ id: 'a', files: { fseq, audio } })], undefined, {
            showFolder: dir,
        });

        expect(plan.sequences[0].media?.name).toBe('Carol Of The Bells.mp3');
        // The derived bytes, not the 4096-byte source.
        expect(plan.sequences[0].media?.size).toBe(512);
    });

    it('falls back to the source when the derived audio is not built', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-dist-'));
        const fseq = path.join(dir, 'Carol.fseq');
        const audio = path.join(dir, 'Carol.wav');
        await fsp.writeFile(fseq, fseqBytes({ channels: 16, frames: 4 }));
        await fsp.writeFile(audio, Buffer.alloc(4096, 3));

        const { plan } = await buildContentPlan([record({ id: 'a', files: { fseq, audio } })], undefined, {
            showFolder: dir,
        });

        expect(plan.sequences[0].media?.name).toBe('Carol.wav');
        expect(plan.sequences[0].media?.size).toBe(4096);
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
        // The song's own name, as the fseq header gives it.
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
        // xLights records a show remote as "xLights Only".
        enableState: 'xlightsOnly',
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

    it('goes by the layout, not the role the device still reports', () => {
        // Not switched over yet: the layout says remote, so it gets a slice.
        const asRemote = [layout({ name: 'Far Side', address: '10.0.0.5', startChannel: 1, channelCount: 64 })];
        expect(slicingFor(remote({ mode: 'player' }), asRemote)?.source).toBe('xlights');
        // Left a remote by a previous show: the layout wants it playing it all.
        const asPlayer = [
            layout({
                name: 'Far Side',
                address: '10.0.0.5',
                enableState: 'enabled',
                startChannel: 1,
                channelCount: 64,
            }),
        ];
        expect(slicingFor(remote({ channelRanges: '0-509' }), asPlayer)).toBeNull();
    });

    it('does not slice for a player, which drives the whole show', () => {
        const known = [layout({ name: 'Far Side', address: '10.0.0.5', enableState: 'enabled' })];
        expect(slicingFor(remote({ channelRanges: '0-509' }), known)).toBeNull();
        expect(slicingFor(device({ ip: '10.0.0.5', driverType: 'FPP', channelRanges: '0-509' }), known)).toBeNull();
    });

    it('does not slice for a controller the layout leaves out of the show', () => {
        const known = [layout({ name: 'Far Side', address: '10.0.0.5', enableState: 'disabled' })];
        expect(slicingFor(remote({ channelRanges: '0-509' }), known)).toBeNull();
    });

    it('takes a device the layout has never heard of at its own word', () => {
        // No record to go on, so the device's own claim is all there is.
        expect(slicingFor(remote({ channelRanges: '0-59' }), [])).toEqual({
            source: 'device',
            ranges: [{ startch: 0, chcount: 60 }],
        });
        expect(slicingFor(remote({ mode: 'player', channelRanges: '0-59' }), [])).toBeNull();
    });

    it('does not slice for a device that is not ours to fill, or that says nothing', () => {
        const known = [layout({ name: 'Far Side', address: '10.0.0.6', startChannel: 1, channelCount: 64 })];
        expect(slicingFor(device({ ip: '10.0.0.6', driverType: 'Falcon', mode: 'remote' }), known)).toBeNull();
        // Claims to be a remote, but names no channels and has no record.
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
