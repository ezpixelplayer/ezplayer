import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Audio extensions EZPlayer already recognizes for companion matching /
 * autodetection. Playback is MP3-only (mpg123), so non-MP3 files are converted
 * via ffmpeg (bundled `ffmpeg-static`, with PATH / FFMPEG_PATH fallbacks).
 */
/** Includes `.mp4` (audio track extracted; video discarded via ffmpeg `-vn`). */
export const CONVERTIBLE_AUDIO_EXTENSIONS = ['.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma', '.mp4'] as const;

/** MP3 + convertible formats. MP3 is never converted. */
export const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', ...CONVERTIBLE_AUDIO_EXTENSIONS] as const;

const require = createRequire(import.meta.url);

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export function isSupportedAudioPath(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

export function needsMp3Conversion(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return (CONVERTIBLE_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/** Prefer packaged binary; fall back to env / PATH. Exported for tests. */
export function resolveFfmpegBinary(): string {
    const fromEnv = process.env.FFMPEG_PATH?.trim();
    if (fromEnv && existsSync(fromEnv)) {
        return fromEnv;
    }

    // Packaged Electron: binary copied next to resources (optional).
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
        const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
        const candidate = path.join(resourcesPath, 'ffmpeg', name);
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    // Bundled ffmpeg-static (dev + asar.unpacked in production).
    try {
        let bundled = require('ffmpeg-static') as string | null | undefined;
        if (bundled) {
            // Binaries cannot be spawned from inside app.asar.
            if (bundled.includes('app.asar' + path.sep) || bundled.includes('app.asar/')) {
                bundled = bundled.replace('app.asar', 'app.asar.unpacked');
            }
            if (existsSync(bundled)) {
                return bundled;
            }
        }
    } catch {
        // Package missing — fall through to PATH.
    }

    return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function runFfmpegToMp3(sourcePath: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const ffmpegBin = resolveFfmpegBinary();
        console.log(`[AudioConvert] Using ffmpeg: "${ffmpegBin}"`);
        const child = spawn(
            ffmpegBin,
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-i',
                sourcePath,
                '-vn',
                '-codec:a',
                'libmp3lame',
                '-q:a',
                '2',
                destPath,
            ],
            { windowsHide: true },
        );
        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderr += String(chunk);
        });
        child.on('error', (err) => {
            reject(
                new Error(
                    `ffmpeg is not available (${err.message}). ` +
                        `Expected the bundled ffmpeg-static binary, or set FFMPEG_PATH / install ffmpeg on PATH.`,
                ),
            );
        });
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            const detail = stderr.trim();
            reject(
                new Error(
                    detail
                        ? `ffmpeg conversion failed (exit ${code}): ${detail}`
                        : `ffmpeg conversion failed (exit ${code})`,
                ),
            );
        });
    });
}

/**
 * Ensure `sourcePath` is playable as MP3.
 * - `.mp3` → returned unchanged (existing flow).
 * - Convertible formats → convert to a sibling `<basename>.mp3` via ffmpeg.
 * - Never modifies or deletes the original source file.
 * - If the sibling `.mp3` already exists, reuses it (does not overwrite).
 * - Uses a temp file during conversion and cleans it up on failure / after move.
 */
/**
 * Resolve a stored or picked audio path to an absolute playable MP3.
 * Relative paths are resolved under the show folder first, then the optional media folder.
 */
export async function preparePlayableAudioPath(
    audioPath: string,
    showFolder: string,
    mediaFolder?: string,
): Promise<string> {
    const trimmed = audioPath.trim();
    if (!trimmed) {
        throw new Error('Audio path is required');
    }

    let resolved = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.join(showFolder, trimmed);
    if (!(await fileExists(resolved))) {
        const media = mediaFolder?.trim();
        if (media) {
            const alt = path.join(media, path.basename(trimmed));
            if (await fileExists(alt)) {
                resolved = alt;
            }
        }
    }
    if (!(await fileExists(resolved))) {
        throw new Error(`Audio file not found: ${resolved}`);
    }
    return ensureMp3AudioFile(resolved);
}

export async function ensureMp3AudioFile(sourcePath: string): Promise<string> {
    if (!sourcePath?.trim()) {
        throw new Error('Audio path is required');
    }
    const resolved = path.resolve(sourcePath);
    if (!(await fileExists(resolved))) {
        throw new Error(`Audio file not found: ${resolved}`);
    }

    const ext = path.extname(resolved).toLowerCase();
    if (ext === '.mp3') {
        return resolved;
    }
    if (!(CONVERTIBLE_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new Error(`Unsupported audio format: ${ext || '(none)'}`);
    }

    const destPath = path.join(path.dirname(resolved), `${path.parse(resolved).name}.mp3`);
    if (await fileExists(destPath)) {
        console.log(`[AudioConvert] Reusing existing MP3: "${destPath}"`);
        return destPath;
    }

    const tmpPath = path.join(os.tmpdir(), `ezplayer-audio-${randomUUID()}.mp3`);
    try {
        console.log(`[AudioConvert] Converting "${resolved}" -> temp "${tmpPath}"`);
        await runFfmpegToMp3(resolved, tmpPath);
        try {
            await fs.rename(tmpPath, destPath);
        } catch {
            // Cross-device rename can fail; fall back to copy + unlink temp.
            await fs.copyFile(tmpPath, destPath);
            await fs.unlink(tmpPath).catch(() => undefined);
        }
        console.log(`[AudioConvert] Wrote "${destPath}" (original preserved)`);
        return destPath;
    } catch (err) {
        await fs.unlink(tmpPath).catch(() => undefined);
        throw err;
    }
}
