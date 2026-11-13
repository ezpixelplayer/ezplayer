/**
 * Distribution to the controllers that play from a card of their own: Falcon
 * V4/V5, Genius 2.x and HinksPix.
 *
 * These are not FPPs and the differences are not small. An FPP takes the
 * show's own zstd fseq, works out what to play from a playlist it already
 * keeps, and tells us what it has in detail. These boxes take a file built for
 * them -- a different compression, a different container, sometimes a
 * different channel order -- have to be told what to play, and answer very
 * little about what they are holding.
 *
 * What differs is already written down per family in the driver's
 * `contentProfile`, so this module is about applying it: pick the compression,
 * convert the audio, build an HSEQ where an fseq will not do, and hand the
 * transfer to `controllerTargetAdapter`.
 *
 * The host module (content-dist.ts) still owns who is in the show and what the
 * show consists of; this is only the part that is specific to a card.
 */

import * as path from 'path';
import { promises as fsp } from 'fs';
import { spawn } from 'node:child_process';
import type { DiscoveredController, KnownController } from '@ezplayer/ezplayer-core';
import { contentRoleOf } from '@ezplayer/ezplayer-core';
import type {
    BaseController,
    ContentMediaSource,
    ContentSequenceSource,
    ContentTargetAdapter,
    ControllerContentArm,
    ControllerContentProfile,
    ControllerMediaFormat,
    HseqLayout,
    HseqSegment,
    HseqSpec,
    ResolvedSequence,
    UnsupportedSequence,
} from '@ezplayer/epp-controllers';
import {
    HINKS_AU_BYTES_PER_SECOND,
    HINKS_AU_CHANNELS,
    HINKS_AU_SAMPLE_RATE,
    HSEQ_HEADER_BYTES,
    HseqWriter,
    blobFromFile,
    controllerTargetAdapter,
    hinksFileName,
    hseqGatherRanges,
    preferredCompression,
    probeController,
    stepTimeSupported,
    validateFalconWav,
    writeHinksAuFile,
} from '@ezplayer/epp-controllers';
import type { FSEQHeader, FseqRange } from '@ezplayer/epp';
import { FSEQReaderSync, planFseqGather, sliceFseqFile } from '@ezplayer/epp';
import { resolveFfmpegBinary } from './data/derived-audio.js';

// Who holds content lives in ezplayer-core, because the UI decides whether to
// offer the action from the same list this module distributes by.
export { CARD_DRIVER_TYPES, contentFamilyOf } from '@ezplayer/ezplayer-core';
export type { ContentFamily } from '@ezplayer/ezplayer-core';

/** What a card controller is being set up to be, from its show record. */
export function armForRecord(record: KnownController | undefined, device?: DiscoveredController): ControllerContentArm {
    const role = record ? contentRoleOf(record) : (device?.mode ?? '').toLowerCase() === 'remote' ? 'remote' : 'none';
    if (role === 'remote') return 'remote';
    // A card controller named as a player runs the show by itself: it drives
    // nothing but its own ports, so there is nothing else for "player" to mean.
    return role === 'player' ? 'standalone' : 'none';
}

/** One card controller, set up and ready to be sent to. */
export interface CardTargetSetup {
    id: string;
    /** The controller's own address, which an HSEQ header carries. */
    ip: string;
    profile: ControllerContentProfile;
    adapter: ContentTargetAdapter;
    /**
     * The connected driver, kept for the rest of the run: the transfer, the
     * playlist and the player role are three writes to one device, and a fresh
     * probe for each costs a second the operator watches.
     */
    driver: BaseController;
    arm: ControllerContentArm;
    /** Channels this box drives, for the cut it gets. */
    ranges?: FseqRange[];
    /** Where those channels came from, for the report. */
    rangeSource?: 'device' | 'xlights' | 'remainder';
    /** A HinksPix' packed port order; absent for the other families. */
    hseq?: HseqLayout;
}

export interface CardSetupInput {
    id: string;
    ip: string;
    proxy?: string;
    driverType?: string;
    record?: KnownController;
    device?: DiscoveredController;
    ranges?: FseqRange[];
    rangeSource?: 'device' | 'xlights' | 'remainder';
}

export interface CardSetupResult {
    setup?: CardTargetSetup;
    /** Why this device cannot be sent content, for the target's report line. */
    unsupportedReason?: string;
}

/**
 * Connect to one card controller and work out what it can be sent.
 *
 * A device that cannot take content is not an error: it comes back with the
 * reason, which the run reports against that device rather than dropping it.
 */
export async function setUpCardTarget(input: CardSetupInput): Promise<CardSetupResult> {
    let probe;
    try {
        probe = await probeController(input.ip, input.proxy, {
            ...(input.driverType ? { preferDriver: input.driverType } : {}),
            expectController: true,
        });
    } catch (e) {
        return { unsupportedReason: `did not answer: ${(e as Error).message}` };
    }
    if (!probe.success || !probe.driver) {
        return { unsupportedReason: `did not answer: ${probe.error ?? 'no driver identified'}` };
    }
    const driver = probe.driver;
    const profile = driver.contentProfile;
    if (!profile) {
        return { unsupportedReason: `${driver.driverName} holds no content on this model` };
    }
    if (profile.unavailable) return { unsupportedReason: profile.unavailable };

    const arm = armForRecord(input.record, input.device);
    const hseq = profile.sequenceFormat === 'hseq' ? hseqLayoutFor(input.record) : undefined;
    if (profile.sequenceFormat === 'hseq' && !hseq) {
        return {
            unsupportedReason:
                'no port layout for this controller in the show, and a HinksPix sequence is built from its ports',
        };
    }
    return {
        setup: {
            id: input.id,
            ip: input.ip,
            profile,
            driver,
            arm,
            adapter: controllerTargetAdapter(driver, {
                arm,
                // The run sets every device's role in one place, before any
                // files go; the adapter would be doing it a second time.
                setMode: false,
                transport: `${driver.driverName} card`,
            }),
            ...(input.ranges ? { ranges: input.ranges } : {}),
            ...(input.rangeSource ? { rangeSource: input.rangeSource } : {}),
            ...(hseq ? { hseq } : {}),
        },
    };
}

/**
 * A HinksPix' own channel order, from the show's record for it.
 *
 * This is the piece that makes an HSEQ unlike a slice. A HinksPix does not
 * store show channels; it stores *its ports'* channels, packed in port order
 * -- every model on pixel port 1, then port 2, and so on, then the serial
 * ports -- so a model at show channel 40 000 can sit ahead of one at channel
 * 100. The map is exactly xLights' `getModelChannelMap`, read from the layout
 * records we already keep for configuring the ports.
 */
export function hseqLayoutFor(record: KnownController | undefined): HseqLayout | undefined {
    if (!record) return undefined;
    const master: HseqSegment[] = [];

    // Pixel ports first, in port order, models in channel order within a port.
    const byPort = new Map<number, HseqSegment[]>();
    for (const m of record.modelIntents ?? []) {
        if (!m.controllerPort) continue;
        const starts = m.stringStartChannels?.length ? m.stringStartChannels : [m.startChannel];
        const counts = m.stringChannels?.length
            ? m.stringChannels
            : m.stringNodeCounts?.length
              ? m.stringNodeCounts.map((n) => n * (m.channelsPerPixel ?? 3))
              : [m.channels ?? m.nodeCount * (m.channelsPerPixel ?? 3)];
        starts.forEach((start, i) => {
            const channels = counts[i] ?? 0;
            if (!start || channels <= 0) return;
            const list = byPort.get(m.controllerPort) ?? [];
            list.push({ startChannel: start, channels, label: m.name });
            byPort.set(m.controllerPort, list);
        });
    }
    for (const port of [...byPort.keys()].sort((a, b) => a - b)) {
        const segments = byPort.get(port)!.sort((a, b) => a.startChannel - b.startChannel);
        master.push(...segments);
    }

    // Then the serial ports, which a HinksPix packs after the pixels.
    for (const sp of [...(record.serialPorts ?? [])].sort((a, b) => a.port - b.port)) {
        const models = sp.modelChannels?.length
            ? [...sp.modelChannels].sort((a, b) => a.startChannel - b.startChannel)
            : sp.startChannel
              ? [{ name: `serial ${sp.port}`, startChannel: sp.startChannel, channels: sp.channels }]
              : [];
        for (const m of models) {
            if (m.channels > 0) master.push({ startChannel: m.startChannel, channels: m.channels, label: m.name });
        }
    }

    return master.length ? { master } : undefined;
}

export interface CardEncodeContext {
    /** Where per-target files are written for this run. */
    workspaceDir: string;
    /** The show's own fseq for a sequence name. */
    sourceFile(name: string): string | undefined;
    /** One header read per source file, however many targets ask. */
    header(file: string): Promise<FSEQHeader | null>;
}

/** A file name that cannot collide between targets or sequences. */
function perTargetName(targetId: string, name: string): string {
    return `${targetId.replace(/[^A-Za-z0-9._-]/g, '_')}__${name}`;
}

const stemOf = (name: string): string => path.basename(name, path.extname(name));

/**
 * The sequence as one card controller needs it.
 *
 * Every one of these targets gets a file built for it, even when it is taking
 * the whole show: the show's own fseq is zstd, and neither a Falcon nor a
 * Genius has a zstd decoder, so "send it unchanged" is not an option the way
 * it is for an FPP.
 */
export async function resolveCardSequence(
    setup: CardTargetSetup,
    sequence: ContentSequenceSource,
    ctx: CardEncodeContext,
): Promise<ResolvedSequence | UnsupportedSequence | undefined> {
    const file = ctx.sourceFile(sequence.name);
    if (!file) return undefined;
    const header = await ctx.header(file);
    if (!header) return { unsupported: 'the show’s own file could not be read' };

    const profile = setup.profile;
    if (!stepTimeSupported(profile, header.msperframe)) {
        return {
            unsupported:
                `the controller plays ${profile.stepTimesMs?.join(' or ')} ms frames and this sequence is ` +
                `${header.msperframe} ms`,
        };
    }

    return profile.sequenceFormat === 'hseq'
        ? resolveHseq(setup, sequence, header, file, ctx)
        : resolveCardFseq(setup, sequence, header, file, ctx);
}

/** An fseq in the compression this family's player can actually read. */
async function resolveCardFseq(
    setup: CardTargetSetup,
    sequence: ContentSequenceSource,
    header: FSEQHeader,
    file: string,
    ctx: CardEncodeContext,
): Promise<ResolvedSequence> {
    const compression = preferredCompression(setup.profile);
    // Its own channels where the show knows them; otherwise the whole file,
    // which is still re-compressed into something it can read.
    const ranges = setup.ranges?.length ? setup.ranges : [{ startch: 0, chcount: header.channels }];
    const stride = ranges.reduce((n, r) => n + r.chcount, 0);
    const note =
        (setup.ranges?.length
            ? `cut to ${stride.toLocaleString()} of ${header.channels.toLocaleString()} channels`
            : `${header.channels.toLocaleString()} channels`) +
        (setup.rangeSource === 'xlights' ? ', from the xLights layout' : '') +
        `, as ${compression === 'none' ? 'uncompressed' : compression} fseq`;

    return {
        identity: {
            ...sequence.identity,
            versionMajor: 2,
            versionMinor: 2,
            channelCount: stride,
            // 0 = none, 2 = zlib, as FPP's own enum orders them.
            compressionType: compression === 'zlib' ? 2 : 0,
            ranges: ranges.map((r) => ({ start: r.startch, length: r.chcount })),
        },
        // An uncompressed file's size is arithmetic, so it can be compared
        // with what the device is holding without building anything. A
        // compressed one's is not, and guessing it would be worse than not
        // knowing: see the check in controller-content.ts.
        ...(compression === 'none' ? { expectedBytes: uncompressedFseqBytes(header, ranges.length, stride) } : {}),
        note,
        async open() {
            const dest = path.join(ctx.workspaceDir, perTargetName(setup.id, sequence.name));
            const written = await sliceFseqFile(file, dest, ranges, { compression });
            if (!written) throw new Error(`could not build ${sequence.name} for ${setup.id}`);
            return { blob: blobFromFile(dest, written.bytes), size: written.bytes };
        },
    };
}

/**
 * Bytes an uncompressed sparse fseq v2 comes out as.
 *
 * The header is the fixed 32 bytes, the range table, and the `mf` media-name
 * block, padded to a 4-byte boundary -- which is exactly what FseqV2Writer
 * lays out, and has to stay in step with it.
 */
function uncompressedFseqBytes(header: FSEQHeader, rangeCount: number, stride: number): number {
    const media = header.headers?.mf;
    const vars = media ? 4 + Buffer.byteLength(media, 'utf8') + 1 : 0;
    const dataOffset = Math.ceil((32 + rangeCount * 6 + vars) / 4) * 4;
    return dataOffset + header.frames * stride;
}

/**
 * An HSEQ: the HinksPix' own container, in its own channel order.
 *
 * The size is exactly predictable because the format has no compression, which
 * is worth having -- it is the one thing that lets a check skip a file on a
 * card that cannot be listed.
 */
async function resolveHseq(
    setup: CardTargetSetup,
    sequence: ContentSequenceSource,
    header: FSEQHeader,
    file: string,
    ctx: CardEncodeContext,
): Promise<ResolvedSequence | UnsupportedSequence> {
    const layout = setup.hseq;
    if (!layout) return { unsupported: 'no port layout for this controller in the show' };
    const { ranges, masterChannels, totalChannels } = hseqGatherRanges(layout);
    if (!totalChannels) return { unsupported: 'the layout gives this controller no channels' };
    // Several header fields are 16-bit, and the format simply cannot say more.
    if (header.frames > 0xffff) {
        return {
            unsupported: `an HSEQ holds 65535 frames and this sequence has ${header.frames.toLocaleString()}`,
        };
    }
    if (totalChannels > 0xffff) {
        return {
            unsupported: `an HSEQ holds 65535 channels per controller and this group needs ${totalChannels.toLocaleString()}`,
        };
    }

    const name = hinksFileName(stemOf(sequence.name), '.hseq');
    const spec: HseqSpec = {
        totalChannels,
        masterChannels,
        masterIp: setup.ip,
        frames: header.frames,
        msPerFrame: header.msperframe,
        originalChannels: Math.min(header.channels, 0xffff),
        ...(layout.slaves?.length ? { slaves: layout.slaves.map((s) => s.spec) } : {}),
    };
    return {
        name,
        identity: {
            ...sequence.identity,
            channelCount: totalChannels,
            compressionType: 0,
            ranges: ranges.map((r) => ({ start: r.startch, length: r.chcount })),
        },
        expectedBytes: HSEQ_HEADER_BYTES + header.frames * totalChannels,
        note:
            `HSEQ, ${totalChannels.toLocaleString()} channels in the controller's own port order` +
            (layout.slaves?.length ? ` including ${layout.slaves.length} slave controller(s)` : ''),
        async open() {
            const dest = path.join(ctx.workspaceDir, perTargetName(setup.id, name));
            const bytes = await writeHseqFromFseq(file, dest, spec, ranges);
            return { blob: blobFromFile(dest, bytes), size: bytes };
        },
    };
}

/**
 * Read an fseq and write the HSEQ a HinksPix plays.
 *
 * The gather is planned from the source's own layout, so a sparse show file
 * works as well as a dense one, and channels the sequence does not hold are
 * left at zero -- a layout routinely reaches past a sequence rendered against
 * an older one, and dark is the same answer xLights gives.
 */
export async function writeHseqFromFseq(
    src: string,
    dest: string,
    spec: HseqSpec,
    ranges: FseqRange[],
): Promise<number> {
    const reader = new FSEQReaderSync(src);
    await reader.open();
    try {
        await reader.readHeader();
        if (!reader.header) throw new Error(`could not read the header of ${src}`);
        const plan = planFseqGather(reader.header, ranges);
        const writer = new HseqWriter(dest, spec);
        const out = new Uint8Array(writer.frameBytes);
        try {
            await reader.processFrames(({ frame }) => {
                out.fill(0);
                for (const g of plan.gather) {
                    out.set(frame.subarray(g.srcOffset, g.srcOffset + g.len), g.dstOffset);
                }
                writer.addFrame(out);
            });
            writer.close();
        } catch (e) {
            writer.abort();
            await fsp.rm(dest, { force: true });
            throw e;
        }
    } finally {
        await reader.close();
    }
    const st = await fsp.stat(dest);
    return st.size;
}

/**
 * The audio one card controller needs, or null when it has none.
 *
 * Always finished here, never on the controller: a Falcon gets a WAV, a
 * HinksPix an AU, and a Genius nothing at all, having no audio output.
 *
 * `source` is what the show would send an FPP: the playable (normalized) file,
 * already derived, usually an mp3.
 */
export async function resolveCardMedia(
    setup: CardTargetSetup,
    sequence: ContentSequenceSource,
    source: ContentMediaSource | undefined,
    ctx: CardEncodeContext,
): Promise<ContentMediaSource | undefined | null> {
    const media = setup.profile.media;
    if (!media?.formats.length) return null;
    if (!source) return undefined;

    const want = media.formats[0];
    const have = path.extname(source.name).replace('.', '').toLowerCase();
    if (want === 'au') return buildHinksAu(setup, sequence, source, ctx);
    if (want === 'wav') return buildWav(setup, sequence, source, ctx);
    // A family that takes the show's own file as it is (FPP's own path does not
    // come through here, but a profile could say so).
    return media.formats.includes(have as ControllerMediaFormat) ? source : undefined;
}

/** The AU a HinksPix plays: our 24-byte header over raw 44.1 kHz stereo PCM. */
async function buildHinksAu(
    setup: CardTargetSetup,
    sequence: ContentSequenceSource,
    source: ContentMediaSource,
    ctx: CardEncodeContext,
): Promise<ContentMediaSource> {
    const name = hinksFileName(stemOf(sequence.name), '.au');
    const dest = path.join(ctx.workspaceDir, perTargetName(setup.id, name));
    const pcm = `${dest}.pcm`;
    const input = await stageSource(setup, source, ctx, name);
    try {
        await runFfmpeg([...decodeArgs(input), '-f', 's16le', pcm]);
        const size = await writeHinksAuFile(dest, pcm, (await fsp.stat(pcm)).size);
        return { name, size, blob: blobFromFile(dest, size) };
    } finally {
        await Promise.all([fsp.rm(input, { force: true }), fsp.rm(pcm, { force: true })]);
    }
}

/**
 * The WAV a Falcon plays: PCM, stereo, 16-bit, at the rate the profile asks
 * for.
 *
 * A source that is already such a WAV is sent as it is -- re-encoding it would
 * only cost time and risk a rounding difference. Anything else is converted,
 * and then checked with the board's own rule before it goes anywhere near the
 * wire, because an unplayable WAV is accepted silently and simply never heard.
 */
async function buildWav(
    setup: CardTargetSetup,
    sequence: ContentSequenceSource,
    source: ContentMediaSource,
    ctx: CardEncodeContext,
): Promise<ContentMediaSource> {
    // Named after the *audio*, not the sequence: a Falcon finds the audio for a
    // sequence by name, and the name it looks for comes from the fseq's own
    // `mf` header -- which the slice carries through from the show's file. So
    // `Carol.mp3` in the header means the card must hold `Carol.wav`.
    const stem = stemOf(source.name) || stemOf(sequence.name);
    const name = `${stem}.wav`;
    if (path.extname(source.name).toLowerCase() === '.wav') {
        const header = await source.blob.read(0, Math.min(64, source.blob.size));
        if (validateFalconWav(header).ok) return { ...source, name };
    }

    const dest = path.join(ctx.workspaceDir, perTargetName(setup.id, name));
    const input = await stageSource(setup, source, ctx, name);
    try {
        const rate = setup.profile.media?.sampleRate ?? 44100;
        const channels = setup.profile.media?.channels ?? 2;
        await runFfmpeg([
            ...decodeArgs(input, { rate, channels }),
            // Source tags would land in a LIST chunk and make the size depend
            // on the song's metadata, which a size comparison cannot have.
            '-map_metadata',
            '-1',
            '-f',
            'wav',
            dest,
        ]);
        const size = (await fsp.stat(dest)).size;
        const verdict = validateFalconWav(await blobFromFile(dest, size).read(0, Math.min(64, size)));
        if (!verdict.ok) throw new Error(`built a WAV the controller will not play: ${verdict.reason}`);
        return { name, size, blob: blobFromFile(dest, size) };
    } finally {
        await fsp.rm(input, { force: true });
    }
}

/** Put the show's audio on disk where ffmpeg can read it. */
async function stageSource(
    setup: CardTargetSetup,
    source: ContentMediaSource,
    ctx: CardEncodeContext,
    name: string,
): Promise<string> {
    const input = path.join(ctx.workspaceDir, `${perTargetName(setup.id, name)}.in${path.extname(source.name)}`);
    await fsp.writeFile(input, await source.blob.read(0, source.blob.size));
    return input;
}

/**
 * Decode any audio the show holds to the shape these controllers want: 44.1 kHz
 * stereo 16-bit by default, which is what both the AU header and the Falcon's
 * WAV rule state. Nothing in a raw PCM file says what it is, so these have to
 * match what the container will claim.
 */
function decodeArgs(source: string, opts: { rate?: number; channels?: number } = {}): string[] {
    return [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        source,
        '-vn',
        '-ac',
        String(opts.channels ?? HINKS_AU_CHANNELS),
        '-ar',
        String(opts.rate ?? HINKS_AU_SAMPLE_RATE),
        '-c:a',
        'pcm_s16le',
    ];
}

/** Run the bundled ffmpeg, failing with whatever it said on stderr. */
async function runFfmpeg(args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        let bin: string;
        try {
            bin = resolveFfmpegBinary();
        } catch (e) {
            reject(e as Error);
            return;
        }
        const child = spawn(bin, args, { windowsHide: true });
        let err = '';
        child.stderr?.on('data', (d) => {
            err += String(d);
        });
        child.on('error', (e) => reject(new Error(`ffmpeg could not be started (${e.message})`)));
        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg failed (exit ${code})${err ? `: ${err.trim().slice(0, 300)}` : ''}`));
        });
    });
}

/** Seconds of audio an AU of this size holds, for a report or a playlist gap. */
export function auDurationSeconds(bytes: number): number {
    return Math.max(0, (bytes - 24) / HINKS_AU_BYTES_PER_SECOND);
}
