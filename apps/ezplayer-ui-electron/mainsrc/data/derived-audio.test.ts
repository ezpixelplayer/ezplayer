import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
    CONVERTIBLE_AUDIO_EXTENSIONS,
    DERIVED_AUDIO_SUBDIR,
    NORMALIZE_AUDIO_FILTER,
    deriveAudioForRecord,
    derivedAudioPathFor,
    ensureDerivedAudio,
    ffmpegArgsFor,
    isSupportedAudioPath,
    needsDerivedAudio,
    needsMp3Conversion,
    playableAudioPath,
    pruneStaleDerivedAudio,
    reconcileDerivedAudio,
    resolveFfmpegBinary,
} from './derived-audio.js';

// Runs the real ffmpeg binary (no mocks): fixtures are synthesized with it,
// then derived and decoded back to prove the output is playable. This is what
// guards the packaged ffmpeg-static binary.

const execFileAsync = promisify(execFile);
const FFMPEG = resolveFfmpegBinary();
const CONVERT_TIMEOUT_MS = 60_000;

async function ffmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
}

// 0.2 s of 440 Hz sine, 8 kHz mono - a few KB per fixture.
const SINE = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000:duration=0.2'];

function fixtureArgs(ext: string, dest: string): string[] {
    switch (ext) {
        case '.wav':
            return [...SINE, '-c:a', 'pcm_s16le', dest];
        case '.m4a':
            return [...SINE, '-c:a', 'aac', dest];
        case '.aac':
            return [...SINE, '-c:a', 'aac', '-f', 'adts', dest];
        case '.flac':
            return [...SINE, '-c:a', 'flac', dest];
        case '.ogg':
            return [...SINE, '-c:a', 'libvorbis', dest];
        case '.wma':
            return [...SINE, '-c:a', 'wmav2', dest];
        case '.mp4':
            // Real video track so the `-vn` path is exercised.
            return [
                ...SINE,
                '-f',
                'lavfi',
                '-i',
                'color=c=black:s=16x16:r=5:d=0.2',
                '-c:v',
                'mpeg4',
                '-c:a',
                'aac',
                '-shortest',
                dest,
            ];
        default:
            throw new Error(`No fixture recipe for ${ext}`);
    }
}

/** Quiet 6 s tone (about -30 LUFS) so normalization has something to do and
 *  enough length for an integrated-loudness measurement. */
function quietFixtureArgs(dest: string, codec: string[]): string[] {
    return [
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100:duration=6',
        '-af',
        'volume=0.03',
        ...codec,
        dest,
    ];
}

function looksLikeMp3(buf: Buffer): boolean {
    if (buf.length < 4) return false;
    if (buf.subarray(0, 3).toString('latin1') === 'ID3') return true;
    // MPEG audio frame sync: 11 set bits.
    return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

async function assertDecodableMp3(mp3Path: string): Promise<void> {
    const head = Buffer.alloc(4);
    const fh = await fs.open(mp3Path, 'r');
    try {
        await fh.read(head, 0, 4, 0);
    } finally {
        await fh.close();
    }
    expect(looksLikeMp3(head)).toBe(true);
    // Full decode; non-zero exit on corrupt output.
    await ffmpeg(['-i', mp3Path, '-f', 'null', '-']);
}

/** Integrated loudness (LUFS) per EBU R128, from ffmpeg's ebur128 summary. */
async function integratedLoudness(file: string): Promise<number> {
    const { stderr } = await execFileAsync(
        FFMPEG,
        ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
        { windowsHide: true },
    );
    const m = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(stderr);
    if (!m) throw new Error(`no integrated loudness in ffmpeg output:\n${stderr}`);
    return Number(m[1]);
}

describe('derived-audio (real ffmpeg)', () => {
    let fixtureDir: string;
    let show: string;
    let derivedDir: string;

    beforeAll(async () => {
        fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ezplayer-audio-fixtures-'));
        for (const ext of CONVERTIBLE_AUDIO_EXTENSIONS) {
            await ffmpeg(fixtureArgs(ext, path.join(fixtureDir, `song${ext}`)));
        }
        await ffmpeg(quietFixtureArgs(path.join(fixtureDir, 'quiet.wav'), ['-c:a', 'pcm_s16le']));
        await ffmpeg(quietFixtureArgs(path.join(fixtureDir, 'quiet.mp3'), ['-c:a', 'libmp3lame', '-q:a', '4']));
    }, CONVERT_TIMEOUT_MS);

    afterAll(async () => {
        await fs.rm(fixtureDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        show = await fs.mkdtemp(path.join(os.tmpdir(), 'ezplayer-show-'));
        derivedDir = path.join(show, DERIVED_AUDIO_SUBDIR);
    });

    afterEach(async () => {
        await fs.rm(show, { recursive: true, force: true });
    });

    async function stageFixture(ext: string, name = 'song', from = `song${ext}`): Promise<string> {
        const dest = path.join(show, `${name}${ext}`);
        await fs.copyFile(path.join(fixtureDir, from), dest);
        return dest;
    }

    async function derivedFiles(): Promise<string[]> {
        return (await fs.readdir(derivedDir).catch(() => [] as string[])).sort();
    }

    it('resolves the packaged ffmpeg-static binary', async () => {
        expect(path.isAbsolute(FFMPEG)).toBe(true);
        expect(existsSync(FFMPEG)).toBe(true);
        if (!process.env.FFMPEG_PATH) {
            // The shipped app relies on this; a PATH fallback would hide a packaging bug.
            expect(FFMPEG).toContain('ffmpeg-static');
        }
        const { stdout } = await execFileAsync(FFMPEG, ['-hide_banner', '-encoders'], { windowsHide: true });
        expect(stdout).toContain('libmp3lame');
        const filters = await execFileAsync(FFMPEG, ['-hide_banner', '-filters'], { windowsHide: true });
        expect(filters.stdout).toMatch(/\bloudnorm\b/);
    });

    it('detects which sources need a derived file', () => {
        expect(isSupportedAudioPath('a.mp3')).toBe(true);
        expect(isSupportedAudioPath('a.wav')).toBe(true);
        expect(isSupportedAudioPath('a.txt')).toBe(false);
        expect(needsMp3Conversion('a.mp3')).toBe(false);
        expect(needsMp3Conversion('a.WAV')).toBe(true);
        expect(needsDerivedAudio('a.mp3')).toBe(false);
        expect(needsDerivedAudio('a.mp3', { normalize: true })).toBe(true);
        expect(needsDerivedAudio('a.wav')).toBe(true);
        expect(needsDerivedAudio('a.txt', { normalize: true })).toBe(false);
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).toContain('.flac');
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).toContain('.mp4');
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).not.toContain('.mp3');
    });

    it('uses the cloud normalization recipe', () => {
        const plain = ffmpegArgsFor('in.wav', 'out.part');
        const norm = ffmpegArgsFor('in.wav', 'out.part', { normalize: true });
        expect(plain).not.toContain('-af');
        expect(norm).toContain('-af');
        expect(norm[norm.indexOf('-af') + 1]).toBe(NORMALIZE_AUDIO_FILTER);
        expect(NORMALIZE_AUDIO_FILTER).toBe('loudnorm=I=-16:LRA=11:TP=-1.5');
        expect(norm[norm.indexOf('-q:a') + 1]).toBe('0');
        for (const args of [plain, norm]) {
            expect(args).toContain('-vn');
            expect(args.slice(-3)).toEqual(['-f', 'mp3', 'out.part']);
        }
    });

    it('plays .mp3 sources directly; relative paths resolve under the show folder', async () => {
        const mp3 = path.join(show, 'song.mp3');
        await fs.writeFile(mp3, 'not-really-mp3');
        expect(await ensureDerivedAudio(mp3, show)).toBe(mp3);
        expect(await playableAudioPath(mp3, show)).toBe(mp3);
        expect(await playableAudioPath('song.mp3', show)).toBe(mp3);
        expect(await playableAudioPath(mp3, show, { normalize: false })).toBe(mp3);
        expect(await fs.readFile(mp3, 'utf8')).toBe('not-really-mp3');
        expect(await derivedFiles()).toEqual([]);
    });

    it('playback never builds: a missing derived file is an error until it is derived', async () => {
        const src = await stageFixture('.wav');
        await expect(playableAudioPath(src, show)).rejects.toThrow(/Derived audio not built yet/);
        expect(await derivedFiles()).toEqual([]);

        const derived = await ensureDerivedAudio(src, show);
        expect(await playableAudioPath(src, show)).toBe(derived);
        expect(await playableAudioPath('song.wav', show)).toBe(derived);
        // The normalized variant is a different file and is still unbuilt.
        await expect(playableAudioPath(src, show, { normalize: true })).rejects.toThrow(/Derived audio not built/);
    });

    it.each(CONVERTIBLE_AUDIO_EXTENSIONS)(
        'derives %s into the show derived-audio folder and leaves the source intact',
        async (ext) => {
            const src = await stageFixture(ext);
            const original = await fs.readFile(src);

            const result = await ensureDerivedAudio(src, show);

            expect(path.dirname(result)).toBe(derivedDir);
            expect(result).toBe(await derivedAudioPathFor(src, show));
            expect(await fs.readFile(src)).toEqual(original);
            await assertDecodableMp3(result);
            expect(await derivedFiles()).toEqual([path.basename(result)]); // no .part left behind
            // Source folder untouched: no sibling .mp3.
            expect((await fs.readdir(show)).sort()).toEqual(['.ezplayer', path.basename(src)]);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'reuses the derived file, and a changed source gets a new one',
        async () => {
            const src = await stageFixture('.wav');
            const first = await ensureDerivedAudio(src, show);
            const stamp = await fs.stat(first);

            // Same source -> same file, not rewritten.
            expect(await ensureDerivedAudio(src, show)).toBe(first);
            expect((await fs.stat(first)).mtimeMs).toBe(stamp.mtimeMs);

            // Rewrite the source (new size) -> different key; old file stays until pruned.
            await fs.copyFile(path.join(fixtureDir, 'song.flac'), src);
            await fs.utimes(src, new Date(), new Date(Date.now() + 5_000));
            const second = await ensureDerivedAudio(src, show);
            expect(second).not.toBe(first);
            expect(await derivedFiles()).toEqual([path.basename(first), path.basename(second)].sort());
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'dedupes concurrent builds of the same derived file',
        async () => {
            const src = await stageFixture('.ogg');
            const [a, b, c] = await Promise.all([
                ensureDerivedAudio(src, show),
                ensureDerivedAudio(src, show),
                ensureDerivedAudio('song.ogg', show),
            ]);
            expect(b).toBe(a);
            expect(c).toBe(a);
            expect(await derivedFiles()).toEqual([path.basename(a)]);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'ignores a stale .part from a dead writer',
        async () => {
            const src = await stageFixture('.wav');
            const dest = (await derivedAudioPathFor(src, show))!;
            await fs.mkdir(derivedDir, { recursive: true });
            const stalePart = `${dest}.999999.part`;
            await fs.writeFile(stalePart, 'junk');
            const old = new Date(Date.now() - 10 * 60_000);
            await fs.utimes(stalePart, old, old);

            expect(await ensureDerivedAudio(src, show)).toBe(dest);
            await assertDecodableMp3(dest);
        },
        CONVERT_TIMEOUT_MS,
    );

    it('rejects unsupported extensions and missing files', async () => {
        const txt = path.join(show, 'song.txt');
        await fs.writeFile(txt, 'x');
        await expect(ensureDerivedAudio(txt, show)).rejects.toThrow(/Unsupported audio format/);
        await expect(playableAudioPath(txt, show)).rejects.toThrow(/Unsupported audio format/);
        await expect(ensureDerivedAudio(path.join(show, 'nope.wav'), show)).rejects.toThrow(/not found/);
        expect(await derivedAudioPathFor(path.join(show, 'nope.wav'), show)).toBeUndefined();
    });

    it(
        'leaves no derived file or .part when ffmpeg fails on a corrupt input',
        async () => {
            const wav = path.join(show, 'song.wav');
            await fs.writeFile(wav, Buffer.alloc(64, 0x5a));

            await expect(ensureDerivedAudio(wav, show)).rejects.toThrow(/ffmpeg conversion failed/);
            await expect(deriveAudioForRecord({ audio: wav }, show)).rejects.toThrow(/ffmpeg conversion failed/);
            expect(await derivedFiles()).toEqual([]);
            expect((await fs.readdir(show)).sort()).toEqual(['.ezplayer', 'song.wav']);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'normalizes a quiet WAV to about -16 LUFS as a separate variant',
        async () => {
            const src = await stageFixture('.wav', 'quiet', 'quiet.wav');
            expect(await integratedLoudness(src)).toBeLessThan(-24);

            const plain = await ensureDerivedAudio(src, show);
            const norm = await ensureDerivedAudio(src, show, { normalize: true });

            expect(norm).not.toBe(plain);
            expect(path.basename(norm)).toMatch(/-norm-/);
            expect(await derivedFiles()).toEqual([path.basename(plain), path.basename(norm)].sort());
            await assertDecodableMp3(norm);
            // Plain transcode keeps the source level; normalized lands near target.
            expect(await integratedLoudness(plain)).toBeLessThan(-24);
            expect(Math.abs((await integratedLoudness(norm)) - -16)).toBeLessThan(2);
            // Both variants resolve for playback without rebuilding.
            expect(await playableAudioPath(src, show, { normalize: false })).toBe(plain);
            expect(await playableAudioPath(src, show, { normalize: true })).toBe(norm);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'normalizes an MP3 source into a derived file and plays the source when unset',
        async () => {
            const src = await stageFixture('.mp3', 'quiet', 'quiet.mp3');
            const original = await fs.readFile(src);

            const norm = await ensureDerivedAudio(src, show, { normalize: true });
            expect(path.dirname(norm)).toBe(derivedDir);
            expect(norm).toBe(await derivedAudioPathFor(src, show, { normalize: true }));
            await assertDecodableMp3(norm);
            expect(Math.abs((await integratedLoudness(norm)) - -16)).toBeLessThan(2);
            expect(await fs.readFile(src)).toEqual(original);

            // Unset -> the source itself; the normalized file is left for prune.
            expect(await playableAudioPath(src, show)).toBe(src);
            expect(await derivedFiles()).toEqual([path.basename(norm)]);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'reconciles every record that needs a derived file and prunes files no record maps to',
        async () => {
            const wav = await stageFixture('.wav', 'a');
            const flac = await stageFixture('.flac', 'b');
            const mp3 = await stageFixture('.mp3', 'c', 'quiet.mp3');

            await reconcileDerivedAudio(
                [
                    { audio: wav },
                    { audio: 'b.flac', normalize: true },
                    { audio: mp3 },
                    { audio: mp3, normalize: true },
                    { audio: '' },
                    { audio: path.join(show, 'missing.wav') },
                ],
                show,
            );
            const wavFile = path.basename((await derivedAudioPathFor(wav, show))!);
            const flacNorm = path.basename((await derivedAudioPathFor(flac, show, { normalize: true }))!);
            const mp3Norm = path.basename((await derivedAudioPathFor(mp3, show, { normalize: true }))!);
            expect(await derivedFiles()).toEqual([wavFile, flacNorm, mp3Norm].sort());

            // Nothing is older than the grace window yet -> nothing pruned.
            expect(await pruneStaleDerivedAudio(show, [{ audio: wav }], { graceMs: 60_000 })).toBe(0);
            // With no grace: keep the live variants exactly, drop the rest.
            expect(
                await pruneStaleDerivedAudio(show, [{ audio: wav }, { audio: 'b.flac', normalize: true }], {
                    graceMs: 0,
                }),
            ).toBe(1);
            expect(await derivedFiles()).toEqual([wavFile, flacNorm].sort());
            // A flipped flag no longer maps to the old variant.
            expect(await pruneStaleDerivedAudio(show, [{ audio: wav }, { audio: 'b.flac' }], { graceMs: 0 })).toBe(1);
            expect(await derivedFiles()).toEqual([wavFile]);
            expect(await pruneStaleDerivedAudio(show, [], { graceMs: 0 })).toBe(1);
            expect(await derivedFiles()).toEqual([]);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'prunes with no grace even when the filesystem stamps the file slightly in the future',
        async () => {
            const wav = await stageFixture('.wav');
            const derived = await ensureDerivedAudio(wav, show);
            const ahead = new Date(Date.now() + 2_000);
            await fs.utimes(derived, ahead, ahead);

            expect(await pruneStaleDerivedAudio(show, [], { graceMs: 60_000 })).toBe(0);
            expect(await pruneStaleDerivedAudio(show, [], { graceMs: 0 })).toBe(1);
            expect(await derivedFiles()).toEqual([]);
        },
        CONVERT_TIMEOUT_MS,
    );
});
