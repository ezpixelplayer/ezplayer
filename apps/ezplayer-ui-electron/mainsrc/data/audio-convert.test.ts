import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
    CONVERTIBLE_AUDIO_EXTENSIONS,
    ensureMp3AudioFile,
    isSupportedAudioPath,
    needsMp3Conversion,
    resolveFfmpegBinary,
} from './audio-convert.js';

// Runs the real ffmpeg binary (no mocks): fixtures are synthesized with it,
// then converted through ensureMp3AudioFile and decoded back to prove the
// output is playable. This is what guards the packaged ffmpeg-static binary.

const execFileAsync = promisify(execFile);
const FFMPEG = resolveFfmpegBinary();
const CONVERT_TIMEOUT_MS = 60_000;

async function ffmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
}

// 0.2 s of 440 Hz sine, 8 kHz mono — a few KB per fixture.
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

async function listTempMp3s(): Promise<string[]> {
    const entries = await fs.readdir(os.tmpdir());
    return entries.filter((e) => e.startsWith('ezplayer-audio-') && e.endsWith('.mp3')).sort();
}

describe('audio-convert (real ffmpeg)', () => {
    let fixtureDir: string;
    let tmpDir: string;

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
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ezplayer-audio-convert-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

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

    it('treats .mp3 as already playable (no conversion)', async () => {
        const mp3 = path.join(tmpDir, 'song.mp3');
        await fs.writeFile(mp3, 'not-really-mp3');
        const result = await ensureMp3AudioFile(mp3);
        expect(result).toBe(path.resolve(mp3));
        expect(await fs.readFile(mp3, 'utf8')).toBe('not-really-mp3');
    });

    it.each(CONVERTIBLE_AUDIO_EXTENSIONS)(
        'converts %s to a playable sibling .mp3 and leaves the original intact',
        async (ext) => {
            const src = path.join(tmpDir, `song${ext}`);
            await fs.copyFile(path.join(fixtureDir, `song${ext}`), src);
            const original = await fs.readFile(src);
            const tempsBefore = await listTempMp3s();

            const result = await ensureMp3AudioFile(src);

            expect(result).toBe(path.join(tmpDir, 'song.mp3'));
            expect(await fs.readFile(src)).toEqual(original);
            await assertDecodableMp3(result);
            expect((await fs.stat(result)).size).toBeGreaterThan(0);
            expect(await listTempMp3s()).toEqual(tempsBefore);
        },
        CONVERT_TIMEOUT_MS,
    );

    it('reuses an existing sibling .mp3 without overwriting', async () => {
        const wav = path.join(tmpDir, 'song.wav');
        const mp3 = path.join(tmpDir, 'song.mp3');
        await fs.copyFile(path.join(fixtureDir, 'song.wav'), wav);
        await fs.writeFile(mp3, 'existing-mp3');

        const result = await ensureMp3AudioFile(wav);
        expect(result).toBe(mp3);
        expect(await fs.readFile(mp3, 'utf8')).toBe('existing-mp3');
    });

    it('rejects unsupported extensions and missing files', async () => {
        const txt = path.join(tmpDir, 'song.txt');
        await fs.writeFile(txt, 'x');
        await expect(ensureMp3AudioFile(txt)).rejects.toThrow(/Unsupported audio format/);
        await expect(ensureMp3AudioFile(path.join(tmpDir, 'nope.wav'))).rejects.toThrow(/not found/);
    });

    it(
        'cleans up the temp file when ffmpeg fails on a corrupt input',
        async () => {
            const wav = path.join(tmpDir, 'song.wav');
            await fs.writeFile(wav, Buffer.alloc(64, 0x5a));
            const tempsBefore = await listTempMp3s();

            await expect(ensureMp3AudioFile(wav)).rejects.toThrow(/ffmpeg conversion failed/);
            expect(await fs.readdir(tmpDir)).toEqual(['song.wav']);
            expect(await listTempMp3s()).toEqual(tempsBefore);
        },
        CONVERT_TIMEOUT_MS,
    );
});
