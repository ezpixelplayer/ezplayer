import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { ensureMp3AudioFile, needsMp3Conversion, isSupportedAudioPath, CONVERTIBLE_AUDIO_EXTENSIONS, resolveFfmpegBinary } =
    await import('./audio-convert.js');

function mockFfmpegSuccess() {
    spawnMock.mockImplementation((_cmd: string, args: string[]) => {
        const dest = args[args.length - 1];
        const child = new EventEmitter() as EventEmitter & {
            stderr: EventEmitter;
            stdout: EventEmitter;
        };
        child.stderr = new EventEmitter();
        child.stdout = new EventEmitter();
        queueMicrotask(async () => {
            await fs.writeFile(dest, Buffer.from('ID3fake-mp3'));
            child.emit('close', 0);
        });
        return child;
    });
}

function mockFfmpegFailure(message = 'encoder error') {
    spawnMock.mockImplementation(() => {
        const child = new EventEmitter() as EventEmitter & {
            stderr: EventEmitter;
            stdout: EventEmitter;
        };
        child.stderr = new EventEmitter();
        child.stdout = new EventEmitter();
        queueMicrotask(() => {
            child.stderr.emit('data', Buffer.from(message));
            child.emit('close', 1);
        });
        return child;
    });
}

describe('audio-convert', () => {
    let tmpDir: string;

    beforeEach(async () => {
        spawnMock.mockReset();
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ezplayer-audio-convert-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('treats .mp3 as already playable (no conversion)', async () => {
        const mp3 = path.join(tmpDir, 'song.mp3');
        await fs.writeFile(mp3, 'mp3-bytes');
        const result = await ensureMp3AudioFile(mp3);
        expect(result).toBe(path.resolve(mp3));
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it('detects convertible vs supported extensions', () => {
        expect(isSupportedAudioPath('a.mp3')).toBe(true);
        expect(isSupportedAudioPath('a.wav')).toBe(true);
        expect(needsMp3Conversion('a.mp3')).toBe(false);
        expect(needsMp3Conversion('a.wav')).toBe(true);
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).toContain('.flac');
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).toContain('.mp4');
        expect(CONVERTIBLE_AUDIO_EXTENSIONS).not.toContain('.mp3');
    });

    it('converts non-MP3 to a sibling .mp3 and leaves the original intact', async () => {
        const wav = path.join(tmpDir, 'song.wav');
        await fs.writeFile(wav, 'wav-bytes');
        mockFfmpegSuccess();

        const result = await ensureMp3AudioFile(wav);
        const expectedMp3 = path.join(tmpDir, 'song.mp3');
        expect(result).toBe(expectedMp3);
        expect(await fs.readFile(wav, 'utf8')).toBe('wav-bytes');
        expect(await fs.readFile(expectedMp3)).toEqual(Buffer.from('ID3fake-mp3'));
        expect(spawnMock).toHaveBeenCalledTimes(1);
        const cmd = String(spawnMock.mock.calls[0][0]);
        expect(cmd.toLowerCase()).toMatch(/ffmpeg/);
        const args = spawnMock.mock.calls[0][1] as string[];
        expect(args).toContain(wav);
        expect(args[args.length - 1]).toMatch(/\.mp3$/);
    });

    it('resolves a usable ffmpeg binary path', async () => {
        const { resolveFfmpegBinary } = await import('./audio-convert.js');
        const bin = resolveFfmpegBinary();
        expect(bin.toLowerCase()).toMatch(/ffmpeg/);
        // In this workspace, ffmpeg-static should provide a real file.
        if (bin.includes('ffmpeg-static') || path.isAbsolute(bin)) {
            expect(await fs.access(bin).then(() => true).catch(() => false)).toBe(true);
        }
    });

    it('reuses an existing sibling .mp3 without overwriting or re-converting', async () => {
        const wav = path.join(tmpDir, 'song.wav');
        const mp3 = path.join(tmpDir, 'song.mp3');
        await fs.writeFile(wav, 'wav-bytes');
        await fs.writeFile(mp3, 'existing-mp3');

        const result = await ensureMp3AudioFile(wav);
        expect(result).toBe(mp3);
        expect(await fs.readFile(mp3, 'utf8')).toBe('existing-mp3');
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it('cleans up the temp file when ffmpeg fails', async () => {
        const wav = path.join(tmpDir, 'song.wav');
        await fs.writeFile(wav, 'wav-bytes');
        mockFfmpegFailure('boom');

        await expect(ensureMp3AudioFile(wav)).rejects.toThrow(/ffmpeg conversion failed/);
        expect(await fs.readFile(wav, 'utf8')).toBe('wav-bytes');
        const entries = await fs.readdir(tmpDir);
        expect(entries).toEqual(['song.wav']);
        // No leftover temps under os.tmpdir with our prefix from a successful write —
        // failure path unlinks the temp before/without leaving a sibling mp3.
        expect(entries).not.toContain('song.mp3');
    });
});
