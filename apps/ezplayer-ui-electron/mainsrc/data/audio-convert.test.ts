import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
    AUDIO_CACHE_SUBDIR,
    CONVERTIBLE_AUDIO_EXTENSIONS,
    audioCachePathFor,
    isSupportedAudioPath,
    needsMp3Conversion,
    pruneAudioCache,
    resolveFfmpegBinary,
    resolvePlayableAudio,
    warmAudioCache,
} from './audio-convert.js';

// Runs the real ffmpeg binary (no mocks): fixtures are synthesized with it,
// then resolved through the audio cache and decoded back to prove the output
// is playable. This is what guards the packaged ffmpeg-static binary.

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

describe('audio-convert (real ffmpeg)', () => {
    let fixtureDir: string;
    let show: string;
    let cacheDir: string;

    beforeAll(async () => {
        fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ezplayer-audio-fixtures-'));
        for (const ext of CONVERTIBLE_AUDIO_EXTENSIONS) {
            await ffmpeg(fixtureArgs(ext, path.join(fixtureDir, `song${ext}`)));
        }
    }, CONVERT_TIMEOUT_MS);

    afterAll(async () => {
        await fs.rm(fixtureDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        show = await fs.mkdtemp(path.join(os.tmpdir(), 'ezplayer-show-'));
        cacheDir = path.join(show, AUDIO_CACHE_SUBDIR);
    });

    afterEach(async () => {
        await fs.rm(show, { recursive: true, force: true });
    });

    async function stageFixture(ext: string, name = 'song'): Promise<string> {
        const dest = path.join(show, `${name}${ext}`);
        await fs.copyFile(path.join(fixtureDir, `song${ext}`), dest);
        return dest;
    }

    async function cacheEntries(): Promise<string[]> {
        return (await fs.readdir(cacheDir).catch(() => [] as string[])).sort();
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
    });

    it('detects convertible vs supported extensions', () => {
        expect(isSupportedAudioPath('a.mp3')).toBe(true);
        expect(isSupportedAudioPath('a.wav')).toBe(true);
        expect(isSupportedAudioPath('a.txt')).toBe(false);
        expect(needsMp3Conversion('a.mp3')).toBe(false);
        expect(needsMp3Conversion('a.WAV')).toBe(true);
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).toContain('.flac');
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).toContain('.mp4');
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).not.toContain('.mp3');
    });

    it('passes .mp3 through untouched and resolves relative paths under the show folder', async () => {
        const mp3 = path.join(show, 'song.mp3');
        await fs.writeFile(mp3, 'not-really-mp3');
        expect(await resolvePlayableAudio(mp3, show)).toBe(mp3);
        expect(await resolvePlayableAudio('song.mp3', show)).toBe(mp3);
        expect(await fs.readFile(mp3, 'utf8')).toBe('not-really-mp3');
        expect(await cacheEntries()).toEqual([]);
    });

    it.each(CONVERTIBLE_AUDIO_EXTENSIONS)(
        'transcodes %s into the show audio cache and leaves the source intact',
        async (ext) => {
            const src = await stageFixture(ext);
            const original = await fs.readFile(src);

            const result = await resolvePlayableAudio(src, show);

            expect(path.dirname(result)).toBe(cacheDir);
            expect(result).toBe(await audioCachePathFor(src, show));
            expect(await fs.readFile(src)).toEqual(original);
            await assertDecodableMp3(result);
            expect(await cacheEntries()).toEqual([path.basename(result)]); // no .part left behind
            // Source folder untouched: no sibling .mp3.
            expect((await fs.readdir(show)).sort()).toEqual(['.ezplayer', path.basename(src)]);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'reuses the cache entry, and a changed source gets a new entry',
        async () => {
            const src = await stageFixture('.wav');
            const first = await resolvePlayableAudio(src, show);
            const stamp = await fs.stat(first);

            // Same source -> same file, not rewritten.
            expect(await resolvePlayableAudio(src, show)).toBe(first);
            expect((await fs.stat(first)).mtimeMs).toBe(stamp.mtimeMs);

            // Rewrite the source (new size) -> different key; old entry stays until pruned.
            await fs.copyFile(path.join(fixtureDir, 'song.flac'), src);
            await fs.utimes(src, new Date(), new Date(Date.now() + 5_000));
            const second = await resolvePlayableAudio(src, show);
            expect(second).not.toBe(first);
            expect(await cacheEntries()).toEqual([path.basename(first), path.basename(second)].sort());
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'dedupes concurrent requests for the same entry',
        async () => {
            const src = await stageFixture('.ogg');
            const [a, b, c] = await Promise.all([
                resolvePlayableAudio(src, show),
                resolvePlayableAudio(src, show),
                resolvePlayableAudio('song.ogg', show),
            ]);
            expect(b).toBe(a);
            expect(c).toBe(a);
            expect(await cacheEntries()).toEqual([path.basename(a)]);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'ignores a stale .part from a dead writer',
        async () => {
            const src = await stageFixture('.wav');
            const dest = (await audioCachePathFor(src, show))!;
            await fs.mkdir(cacheDir, { recursive: true });
            const stalePart = `${dest}.999999.part`;
            await fs.writeFile(stalePart, 'junk');
            const old = new Date(Date.now() - 10 * 60_000);
            await fs.utimes(stalePart, old, old);

            expect(await resolvePlayableAudio(src, show)).toBe(dest);
            await assertDecodableMp3(dest);
        },
        CONVERT_TIMEOUT_MS,
    );

    it('rejects unsupported extensions and missing files', async () => {
        const txt = path.join(show, 'song.txt');
        await fs.writeFile(txt, 'x');
        await expect(resolvePlayableAudio(txt, show)).rejects.toThrow(/Unsupported audio format/);
        await expect(resolvePlayableAudio(path.join(show, 'nope.wav'), show)).rejects.toThrow(/not found/);
        expect(await audioCachePathFor(path.join(show, 'nope.wav'), show)).toBeUndefined();
    });

    it(
        'leaves no cache entry or .part when ffmpeg fails on a corrupt input',
        async () => {
            const wav = path.join(show, 'song.wav');
            await fs.writeFile(wav, Buffer.alloc(64, 0x5a));

            await expect(resolvePlayableAudio(wav, show)).rejects.toThrow(/ffmpeg conversion failed/);
            expect(await cacheEntries()).toEqual([]);
            expect((await fs.readdir(show)).sort()).toEqual(['.ezplayer', 'song.wav']);
        },
        CONVERT_TIMEOUT_MS,
    );

    it(
        'warms every convertible path and prunes entries no live path maps to',
        async () => {
            const wav = await stageFixture('.wav', 'a');
            const flac = await stageFixture('.flac', 'b');
            const mp3 = path.join(show, 'c.mp3');
            await fs.writeFile(mp3, 'mp3');

            await warmAudioCache([wav, 'b.flac', mp3, '', path.join(show, 'missing.wav')], show);
            const wavEntry = path.basename((await audioCachePathFor(wav, show))!);
            const flacEntry = path.basename((await audioCachePathFor(flac, show))!);
            expect(await cacheEntries()).toEqual([wavEntry, flacEntry].sort());

            // Nothing is older than the grace window yet -> nothing pruned.
            expect(await pruneAudioCache(show, [wav], { graceMs: 60_000 })).toBe(0);
            // With no grace, the entry without a live source goes; the live one stays.
            expect(await pruneAudioCache(show, [wav], { graceMs: 0 })).toBe(1);
            expect(await cacheEntries()).toEqual([wavEntry]);
            // Relative live paths count too.
            expect(await pruneAudioCache(show, ['a.wav'], { graceMs: 0 })).toBe(0);
            expect(await pruneAudioCache(show, [], { graceMs: 0 })).toBe(1);
            expect(await cacheEntries()).toEqual([]);
        },
        CONVERT_TIMEOUT_MS,
    );
});
