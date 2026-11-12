/**
 * Building the files a card controller plays, end to end: the fseq a Falcon or
 * a Genius can read, the HSEQ a HinksPix plays in its own channel order, and
 * the AU that goes beside it.
 *
 * Everything written here is read back with the reader real playback uses, or
 * by hand from the format's documented offsets -- never through the writer
 * that produced it.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { promises as fsp } from 'fs';
import type { KnownController } from '@ezplayer/ezplayer-core';
import type { ContentSequenceSource, ControllerContentProfile } from '@ezplayer/epp-controllers';
import { HSEQ_HEADER_BYTES, blobFromFile, readFseqIdentity, validateFalconWav } from '@ezplayer/epp-controllers';
import { spawn } from 'node:child_process';
import { resolveFfmpegBinary } from './data/derived-audio.js';
import { FSEQReaderSync, FseqV2Writer } from '@ezplayer/epp';
import {
    armForRecord,
    contentFamilyOf,
    hseqLayoutFor,
    resolveCardMedia,
    resolveCardSequence,
    writeHseqFromFseq,
    type CardEncodeContext,
    type CardTargetSetup,
} from './content-dist-cards.js';

let dir = '';
beforeAll(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-cards-'));
});
afterAll(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
});

/** A value per (channel, frame) that makes a misplaced byte obvious. */
const val = (channel: number, frame: number) => (channel * 7 + frame * 13 + 1) & 0xff;

const FRAMES = 6;

/** A dense show fseq, written zstd the way the show's own files are. */
async function showFseq(name: string, channels: number, stepTimeMs = 50): Promise<string> {
    const file = path.join(dir, name);
    const w = new FseqV2Writer(file, {
        numFrames: FRAMES,
        stepTimeMs,
        channelCount: channels,
        compression: 'zstd',
        uniqueId: '424242',
        mediaName: 'Song.mp3',
    });
    const frame = new Uint8Array(channels);
    for (let f = 0; f < FRAMES; f++) {
        for (let c = 0; c < channels; c++) frame[c] = val(c, f);
        w.addFrame(frame);
    }
    w.close();
    return file;
}

function ctxFor(file: string, name: string): CardEncodeContext {
    const headers = new Map<string, Awaited<ReturnType<CardEncodeContext['header']>>>();
    return {
        workspaceDir: dir,
        sourceFile: (n) => (n === name ? file : undefined),
        async header(f) {
            if (headers.has(f)) return headers.get(f)!;
            const reader = new FSEQReaderSync(f);
            await reader.open();
            try {
                await reader.readHeader();
                headers.set(f, reader.header ?? null);
            } finally {
                await reader.close();
            }
            return headers.get(f) ?? null;
        },
    };
}

async function sequenceSource(file: string, name: string): Promise<ContentSequenceSource> {
    const bytes = await fsp.readFile(file);
    return {
        name,
        identity: readFseqIdentity(bytes),
        size: bytes.length,
        blob: blobFromFile(file, bytes.length),
    };
}

const FALCON: ControllerContentProfile = {
    sequenceFormat: 'fseq',
    // Uncompressed first: zstd it cannot read, zlib is unconfirmed on a board,
    // and an uncompressed file's size can be compared with the card's.
    compressions: ['none', 'zlib'],
    sparse: true,
    // A finished WAV, built here. The board can convert an MP3 itself and is
    // deliberately not asked to.
    media: {
        formats: ['wav'],
        storedExtension: '.wav',
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        pairing: 'sequence-name',
        convertedOnDevice: false,
    },
    standalone: 'device-managed',
    syncRemote: true,
};

const GENIUS: ControllerContentProfile = {
    sequenceFormat: 'fseq',
    // Uncompressed: a 2.x board lists a zlib file as unplayable until it has
    // been expanded on the card. No audio: the box has no output for it.
    compressions: ['none', 'zlib'],
    sparse: true,
    standalone: 'playlist',
    syncRemote: true,
};

const HINKS: ControllerContentProfile = {
    sequenceFormat: 'hseq',
    compressions: [],
    sparse: false,
    stepTimesMs: [25, 50],
    media: { formats: ['au'], storedExtension: '.au', sampleRate: 44100, channels: 2, pairing: 'playlist' },
    standalone: 'playlist',
    syncRemote: false,
};

/** A setup with no device behind it: the encoders never touch one. */
const setup = (over: Partial<CardTargetSetup> & { profile: ControllerContentProfile }): CardTargetSetup =>
    ({
        id: 'c1',
        ip: '192.168.1.57',
        arm: 'standalone',
        ...over,
    }) as CardTargetSetup;

describe('which family a device belongs to', () => {
    it('separates the boxes that take the show’s own files from those that do not', () => {
        expect(contentFamilyOf('FPP')).toBe('fpp');
        expect(contentFamilyOf('Falcon')).toBe('card');
        expect(contentFamilyOf('Genius')).toBe('card');
        expect(contentFamilyOf('HinksPix')).toBe('card');
        expect(contentFamilyOf('WLED')).toBeUndefined();
        expect(contentFamilyOf(undefined)).toBeUndefined();
    });

    it('reads the arm from the show’s role for the box', () => {
        const rec = (over: Partial<KnownController>): KnownController => ({ name: 'c', source: 'xlights', ...over });
        expect(armForRecord(rec({ role: 'remote' }))).toBe('remote');
        expect(armForRecord(rec({ role: 'player' }))).toBe('standalone');
        // xLights Only means the show does not send it pixels, so it plays its
        // own channels from its own copy: a remote.
        expect(armForRecord(rec({ enableState: 'xlightsOnly' }))).toBe('remote');
        // Active: the show sends it pixels live and it needs no files.
        expect(armForRecord(rec({ role: 'enabled' }))).toBe('none');
        expect(armForRecord(undefined)).toBe('none');
    });
});

describe('an fseq a Falcon or a Genius can read', () => {
    it('rebuilds uncompressed and cuts to the box’s own channels', async () => {
        const name = 'Song.fseq';
        const file = await showFseq(name, 2048);
        const resolved = await resolveCardSequence(
            setup({ profile: GENIUS, ranges: [{ startch: 1000, chcount: 512 }], rangeSource: 'device' }),
            await sequenceSource(file, name),
            ctxFor(file, name),
        );
        expect(resolved && 'identity' in resolved).toBe(true);
        if (!resolved || !('identity' in resolved)) return;

        // 0 is uncompressed: the show's own file is zstd, which no card-playing
        // family reads, and zlib needs a step on the device first.
        expect(resolved.identity.compressionType).toBe(0);
        expect(resolved.identity.channelCount).toBe(512);
        expect(resolved.note).toMatch(/cut to 512 of 2,048 channels.*as uncompressed fseq/);
        // The id and the media name carry over, so the device sees one
        // sequence shared with the show rather than an unrelated file.
        expect(resolved.identity.uniqueId).toBe('424242');
        expect(resolved.identity.mediaName).toBe('Song.mp3');

        const built = await resolved.open();
        // The size was predicted from the header alone, before a byte was
        // written: 32-byte header + one range + the media name, padded, plus
        // frames x stride.
        expect(resolved.expectedBytes).toBe(built.size);
        const bytes = await built.blob.read(0, built.size);
        const written = readFseqIdentity(bytes);
        expect(written.compressionType).toBe(0);
        expect(written.ranges).toEqual([{ start: 1000, length: 512 }]);
        expect(written.numFrames).toBe(FRAMES);

        // And the bytes are the right channels, read back by the real reader.
        const dest = path.join(dir, 'readback.fseq');
        await fsp.writeFile(dest, bytes);
        const reader = new FSEQReaderSync(dest);
        await reader.open();
        try {
            await reader.readHeader();
            const frames: Uint8Array[] = [];
            await reader.processFrames(({ frame }) => frames.push(Uint8Array.from(frame)));
            for (let f = 0; f < FRAMES; f++) {
                for (const i of [0, 1, 511]) expect(frames[f][i], `frame ${f} ch ${i}`).toBe(val(1000 + i, f));
            }
        } finally {
            await reader.close();
        }
    });

    /**
     * Even a box taking the whole show gets a file built for it: the show's own
     * copy is zstd, which none of these families can read.
     */
    it('rebuilds for a box that takes the whole show, and predicts its size', async () => {
        const name = 'Whole.fseq';
        const file = await showFseq(name, 600);
        const resolved = await resolveCardSequence(
            setup({ profile: FALCON }),
            await sequenceSource(file, name),
            ctxFor(file, name),
        );
        if (!resolved || !('identity' in resolved)) throw new Error('expected a file');
        expect(resolved.identity.channelCount).toBe(600);
        expect(resolved.note).toMatch(/600 channels, as uncompressed fseq/);
        const built = await resolved.open();
        const bytes = await built.blob.read(0, built.size);
        expect(readFseqIdentity(bytes).compressionType).toBe(0);
        // Uncompressed, so the size was knowable before it was built -- which
        // is what lets a Falcon's name-only listing be checked at all.
        expect(resolved.expectedBytes).toBe(built.size);
    });

    /**
     * zlib is still built when a profile asks for it -- a Genius can be given
     * one and told to expand it on the card -- but its size cannot be
     * predicted, and saying so is better than guessing.
     */
    it('builds zlib when asked, and then admits it cannot predict the size', async () => {
        const name = 'Zlib.fseq';
        const file = await showFseq(name, 2048);
        const resolved = await resolveCardSequence(
            setup({ profile: { ...GENIUS, compressions: ['zlib'] }, ranges: [{ startch: 0, chcount: 512 }] }),
            await sequenceSource(file, name),
            ctxFor(file, name),
        );
        if (!resolved || !('identity' in resolved)) throw new Error('expected a file');
        expect(resolved.identity.compressionType).toBe(2);
        expect(resolved.expectedBytes).toBeUndefined();
        const built = await resolved.open();
        expect(readFseqIdentity(await built.blob.read(0, built.size)).compressionType).toBe(2);
    });
});

describe('a HinksPix’ own channel order', () => {
    /** Two pixel ports whose models are not in show-channel order, plus DMX. */
    const record: KnownController = {
        name: 'HinksPix',
        source: 'xlights',
        address: '192.168.1.57',
        modelIntents: [
            { name: 'Roof', controllerPort: 1, protocol: 'ws2811', startChannel: 1801, nodeCount: 50, channels: 150 },
            { name: 'Arch', controllerPort: 2, protocol: 'ws2811', startChannel: 1, nodeCount: 30, channels: 90 },
            { name: 'Star', controllerPort: 2, protocol: 'ws2811', startChannel: 91, nodeCount: 10, channels: 30 },
        ],
        serialPorts: [
            {
                port: 1,
                models: ['Flood'],
                channels: 12,
                startChannel: 1201,
                protocol: 'dmx',
                modelChannels: [{ name: 'Flood', startChannel: 1201, channels: 12 }],
            },
        ],
    };

    it('packs pixel ports in port order, then the serial ports', () => {
        const layout = hseqLayoutFor(record);
        expect(layout?.master).toEqual([
            { startChannel: 1801, channels: 150, label: 'Roof' },
            { startChannel: 1, channels: 90, label: 'Arch' },
            { startChannel: 91, channels: 30, label: 'Star' },
            { startChannel: 1201, channels: 12, label: 'Flood' },
        ]);
    });

    it('has nothing to say about a record with no models', () => {
        expect(hseqLayoutFor({ name: 'x', source: 'xlights' })).toBeUndefined();
        expect(hseqLayoutFor(undefined)).toBeUndefined();
    });

    it('builds an HSEQ whose frames are in that order, not the show’s', async () => {
        const name = 'Song.fseq';
        const file = await showFseq(name, 2048);
        const resolved = await resolveCardSequence(
            setup({ profile: HINKS, hseq: hseqLayoutFor(record)! }),
            await sequenceSource(file, name),
            ctxFor(file, name),
        );
        if (!resolved || !('identity' in resolved)) throw new Error('expected a file');

        // 150 + 90 + 30 + 12, and the size is exactly predictable because the
        // format has no compression -- which is what lets a card that cannot
        // be listed still be checked.
        expect(resolved.identity.channelCount).toBe(282);
        expect(resolved.name).toBe('Song.hseq');
        expect(resolved.expectedBytes).toBe(HSEQ_HEADER_BYTES + FRAMES * 282);

        const built = await resolved.open();
        expect(built.size).toBe(resolved.expectedBytes);
        const bytes = Buffer.from(await built.blob.read(0, built.size));
        expect(bytes.subarray(0, 4).toString('latin1')).toBe('HSEQ');
        expect(bytes.readUInt32LE(24)).toBe(282);
        expect(bytes.readUInt16LE(68)).toBe(282);
        expect(bytes.subarray(28, 40).toString('latin1')).toBe('192.168.1.57');
        expect(bytes.readUInt16LE(16)).toBe(2205); // 44100 * 50 / 1000

        // Frame for frame: the controller's order, mapped back to the show's.
        const order = [
            { at: 0, from: 1800, len: 150 },
            { at: 150, from: 0, len: 90 },
            { at: 240, from: 90, len: 30 },
            { at: 270, from: 1200, len: 12 },
        ];
        for (let f = 0; f < FRAMES; f++) {
            const frame = bytes.subarray(HSEQ_HEADER_BYTES + f * 282, HSEQ_HEADER_BYTES + (f + 1) * 282);
            for (const seg of order) {
                for (const i of [0, seg.len - 1]) {
                    expect(frame[seg.at + i], `frame ${f} dst ${seg.at + i}`).toBe(val(seg.from + i, f));
                }
            }
        }
    });

    it('refuses a frame rate the controller does not play', async () => {
        const name = 'Fast.fseq';
        const file = await showFseq(name, 600, 33);
        const resolved = await resolveCardSequence(
            setup({ profile: HINKS, hseq: hseqLayoutFor(record)! }),
            await sequenceSource(file, name),
            ctxFor(file, name),
        );
        expect(resolved).toEqual({
            unsupported: 'the controller plays 25 or 50 ms frames and this sequence is 33 ms',
        });
    });

    it('leaves channels the sequence does not reach dark', async () => {
        // The layout claims channel 1801 up; this sequence stops at 600.
        const name = 'Short.fseq';
        const file = await showFseq(name, 600);
        const dest = path.join(dir, 'short.hseq');
        const layout = hseqLayoutFor(record)!;
        const bytes = await writeHseqFromFseq(
            file,
            dest,
            {
                totalChannels: 282,
                masterChannels: 282,
                masterIp: '192.168.1.57',
                frames: FRAMES,
                msPerFrame: 50,
                originalChannels: 600,
            },
            layout.master.map((m) => ({ startch: m.startChannel - 1, chcount: m.channels })),
        );
        const out = await fsp.readFile(dest);
        expect(bytes).toBe(HSEQ_HEADER_BYTES + FRAMES * 282);
        const frame = out.subarray(HSEQ_HEADER_BYTES, HSEQ_HEADER_BYTES + 282);
        // Roof (1801+) is past the end of the sequence: all zero.
        expect([...frame.subarray(0, 150)].every((b) => b === 0)).toBe(true);
        // Arch is within it, and present.
        expect(frame[150]).toBe(val(0, 0));
    });
});

describe('the audio each family takes', () => {
    const name = 'Song.fseq';

    /** The show's own audio as the player derives it: an mp3. */
    async function mp3File(): Promise<{ file: string; size: number }> {
        const wav = await wavFile();
        const out = path.join(dir, 'Song.mp3');
        await new Promise<void>((resolve, reject) => {
            const child = spawn(
                resolveFfmpegBinary(),
                [
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-y',
                    '-i',
                    wav.file,
                    '-codec:a',
                    'libmp3lame',
                    '-q:a',
                    '2',
                    out,
                ],
                { windowsHide: true },
            );
            child.on('error', reject);
            child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
        });
        return { file: out, size: (await fsp.stat(out)).size };
    }

    /** A 0.2 s 44.1 kHz stereo WAV, so ffmpeg has something real to decode. */
    async function wavFile(): Promise<{ file: string; size: number }> {
        const samples = 44100 / 5;
        const data = Buffer.alloc(samples * 4);
        for (let i = 0; i < samples; i++) {
            const v = Math.round(10000 * Math.sin((i / 44100) * 2 * Math.PI * 440));
            data.writeInt16LE(v, i * 4);
            data.writeInt16LE(v, i * 4 + 2);
        }
        const header = Buffer.alloc(44);
        header.write('RIFF', 0, 'latin1');
        header.writeUInt32LE(36 + data.length, 4);
        header.write('WAVEfmt ', 8, 'latin1');
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(2, 22);
        header.writeUInt32LE(44100, 24);
        header.writeUInt32LE(44100 * 4, 28);
        header.writeUInt16LE(4, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36, 'latin1');
        header.writeUInt32LE(data.length, 40);
        const file = path.join(dir, 'Song.wav');
        await fsp.writeFile(file, Buffer.concat([header, data]));
        return { file, size: 44 + data.length };
    }

    it('sends a Genius none at all, because it has no audio output', async () => {
        const file = await showFseq('G.fseq', 64);
        const seq = await sequenceSource(file, 'G.fseq');
        const wav = await wavFile();
        const media = { name: 'Song.wav', size: wav.size, blob: blobFromFile(wav.file, wav.size) };
        await expect(resolveCardMedia(setup({ profile: GENIUS }), seq, media, ctxFor(file, name))).resolves.toBeNull();
    });

    it('passes a WAV that already meets the board’s rule straight through', async () => {
        const file = await showFseq('F.fseq', 64);
        const seq = await sequenceSource(file, 'F.fseq');
        const wav = await wavFile();
        const media = { name: 'Song.wav', size: wav.size, blob: blobFromFile(wav.file, wav.size) };
        const built = await resolveCardMedia(setup({ profile: FALCON }), seq, media, ctxFor(file, name));
        // Same bytes, same size: re-encoding a conforming file would only cost
        // time and risk a rounding difference.
        expect(built?.size).toBe(media.size);
        expect(built?.name).toBe('Song.wav');
    });

    /**
     * The path a real show takes. The board *can* convert an MP3 itself, and
     * is deliberately not asked to: that conversion is a process on the
     * controller with its own progress and its own ways to fail.
     */
    it('converts the show’s mp3 into a WAV the board will play', async () => {
        const file = await showFseq('F2.fseq', 64);
        const seq = await sequenceSource(file, 'F2.fseq');
        const mp3 = await mp3File();
        const media = { name: 'Song.mp3', size: mp3.size, blob: blobFromFile(mp3.file, mp3.size) };
        const built = await resolveCardMedia(setup({ profile: FALCON }), seq, media, ctxFor(file, name));
        expect(built?.name).toBe('Song.wav');
        const bytes = Buffer.from(await built!.blob.read(0, built!.size));
        // The board's own rule, applied to what we built: RIFF/WAVE, PCM,
        // stereo, 16-bit, block align 4, at a rate it accepts.
        expect(validateFalconWav(bytes)).toEqual({ ok: true });
        expect(bytes.readUInt32LE(24)).toBe(44100);
        expect(bytes.readUInt16LE(22)).toBe(2);
        expect(bytes.readUInt16LE(34)).toBe(16);
        // Roughly the duration of the source, as 44.1 kHz stereo 16-bit.
        expect(built!.size).toBeGreaterThan(44100 * 4 * 0.15);
        expect(built!.size).toBeLessThan(44100 * 4 * 0.3);
        // And nothing is left behind in the workspace.
        expect((await fsp.readdir(dir)).filter((f) => f.endsWith('.in.mp3'))).toEqual([]);
    });

    it('builds the AU a HinksPix plays, at 44.1 kHz stereo', async () => {
        const file = await showFseq('H.fseq', 64);
        const seq = await sequenceSource(file, 'Song.fseq');
        const wav = await wavFile();
        const media = { name: 'Song.wav', size: wav.size, blob: blobFromFile(wav.file, wav.size) };
        const built = await resolveCardMedia(setup({ profile: HINKS }), seq, media, ctxFor(file, name));
        expect(built?.name).toBe('Song.au');
        const bytes = Buffer.from(await built!.blob.read(0, built!.size));
        // Little-endian magic, so `.snd` lands as `dns.` -- see hinkspix-au.ts.
        expect(bytes.subarray(0, 4).toString('latin1')).toBe('dns.');
        expect(bytes.readUInt32LE(16)).toBe(44100);
        expect(bytes.readUInt32LE(20)).toBe(2);
        expect(bytes.readUInt32LE(8)).toBe(bytes.length - 24);
        // 0.2 s of stereo 16-bit at 44.1 kHz, within a frame or two of ffmpeg's
        // own rounding.
        expect(bytes.length - 24).toBeGreaterThan(44100 * 4 * 0.19);
        expect(bytes.length - 24).toBeLessThan(44100 * 4 * 0.21);
        // The working files do not survive the build.
        const left = await fsp.readdir(dir);
        expect(left.filter((f) => f.endsWith('.pcm'))).toEqual([]);
    });
});
