import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
    CONVERTIBLE_AUDIO_EXTENSIONS,
    MP3_EXTENSION,
    SUPPORTED_AUDIO_EXTENSIONS,
    isSupportedAudioName,
    needsAudioConversion,
} from '@ezplayer/ezplayer-core';

export { CONVERTIBLE_AUDIO_EXTENSIONS, SUPPORTED_AUDIO_EXTENSIONS };

/**
 * Playback is MP3-only (mpg123). Other formats are transcoded with the bundled
 * ffmpeg into a per-show cache; the song record always keeps the original file.
 * Cache entries are keyed by source path + size + mtime + recipe, so a changed
 * source or a changed recipe yields a new entry and the old one is pruned.
 */

/** Bump when the ffmpeg recipe changes; every cached artifact is rebuilt. */
export const AUDIO_CACHE_RECIPE = 1;
export const AUDIO_CACHE_SUBDIR = path.join('.ezplayer', 'audio-cache');

/** A `.part` untouched for this long is a dead writer, not an in-flight conversion. */
const PART_STALE_MS = 60_000;
/** Upper bound on waiting for another process's in-flight conversion. */
const WAIT_FOR_WRITER_MS = 10 * 60_000;
/** Prune keeps anything newer than this - covers in-flight and just-warmed entries. */
const DEFAULT_PRUNE_GRACE_MS = 60 * 60_000;

const require = createRequire(import.meta.url);

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isSupportedAudioPath(filePath: string): boolean {
    return isSupportedAudioName(filePath);
}

export function needsMp3Conversion(filePath: string): boolean {
    return needsAudioConversion(filePath);
}

/** `FFMPEG_PATH` override, else the bundled ffmpeg-static binary. Never PATH:
 *  a host ffmpeg would mask a packaging bug. */
export function resolveFfmpegBinary(): string {
    const fromEnv = process.env.FFMPEG_PATH?.trim();
    if (fromEnv) {
        if (existsSync(fromEnv)) return fromEnv;
        throw new Error(`FFMPEG_PATH is set but does not exist: "${fromEnv}"`);
    }

    let bundled: string | null | undefined;
    try {
        bundled = require('ffmpeg-static') as string | null | undefined;
    } catch {
        bundled = undefined;
    }
    if (bundled) {
        // Binaries cannot be spawned from inside app.asar.
        if (bundled.includes('app.asar' + path.sep) || bundled.includes('app.asar/')) {
            bundled = bundled.replace('app.asar', 'app.asar.unpacked');
        }
        if (existsSync(bundled)) return bundled;
    }
    throw new Error(
        `Bundled ffmpeg binary not found${bundled ? ` at "${bundled}"` : ''}. ` +
            `The ffmpeg-static install script must run (pnpm onlyBuiltDependencies), or set FFMPEG_PATH.`,
    );
}

function runFfmpegToMp3(sourcePath: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let ffmpegBin: string;
        try {
            ffmpegBin = resolveFfmpegBinary();
        } catch (err) {
            reject(err);
            return;
        }
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
                '-f',
                'mp3',
                destPath,
            ],
            { windowsHide: true },
        );
        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer | string) => {
            stderr += String(chunk);
        });
        child.on('error', (err) => {
            reject(new Error(`ffmpeg could not be started (${err.message})`));
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

export function audioCacheDir(showFolder: string): string {
    return path.join(showFolder, AUDIO_CACHE_SUBDIR);
}

function absoluteUnder(p: string, showFolder: string): string {
    const t = p.trim();
    return path.isAbsolute(t) ? path.resolve(t) : path.join(showFolder, t);
}

/** Cache file a source would transcode to, or undefined when the source is missing. */
export async function audioCachePathFor(sourcePath: string, showFolder: string): Promise<string | undefined> {
    const resolved = absoluteUnder(sourcePath, showFolder);
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
        st = await fs.stat(resolved);
    } catch {
        return undefined;
    }
    const digest = createHash('sha1')
        .update(`${resolved}|${st.size}|${Math.floor(st.mtimeMs)}|r${AUDIO_CACHE_RECIPE}`)
        .digest('hex')
        .slice(0, 16);
    const base = path
        .parse(resolved)
        .name.replace(/[^\w.-]+/g, '_')
        .slice(0, 60);
    return path.join(audioCacheDir(showFolder), `${base}-${digest}${MP3_EXTENSION}`);
}

/** Same-process dedupe: concurrent requests for one cache entry share the conversion. */
const inflight = new Map<string, Promise<string>>();

/**
 * Resolve a record's `files.audio` to a playable MP3 path.
 * - `.mp3` -> the source itself (relative paths resolved under the show folder).
 * - Convertible formats -> the cached MP3, transcoding on a miss.
 * - Never touches the source file.
 */
export async function resolvePlayableAudio(sourcePath: string, showFolder: string): Promise<string> {
    if (!sourcePath?.trim()) {
        throw new Error('Audio path is required');
    }
    const resolved = absoluteUnder(sourcePath, showFolder);
    const ext = path.extname(resolved).toLowerCase();
    if (ext === MP3_EXTENSION) {
        return resolved;
    }
    if (!(CONVERTIBLE_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new Error(`Unsupported audio format: ${ext || '(none)'}`);
    }
    const dest = await audioCachePathFor(resolved, showFolder);
    if (!dest) {
        throw new Error(`Audio file not found: ${resolved}`);
    }
    if (await fileExists(dest)) {
        return dest;
    }
    const pending = inflight.get(dest);
    if (pending) return pending;
    const job = convertIntoCache(resolved, dest).finally(() => inflight.delete(dest));
    inflight.set(dest, job);
    return job;
}

async function convertIntoCache(source: string, dest: string): Promise<string> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // The main process (warming) and the playback worker may race on one entry.
    if (await waitForOtherWriter(dest)) {
        return dest;
    }
    const tmp = `${dest}.${process.pid}.part`;
    try {
        console.log(`[AudioCache] Converting "${source}" -> "${dest}"`);
        await runFfmpegToMp3(source, tmp);
        await fs.rename(tmp, dest);
        return dest;
    } catch (err) {
        await fs.unlink(tmp).catch(() => undefined);
        throw err;
    }
}

/** True when another writer finished `dest` while we waited on its live `.part`. */
async function waitForOtherWriter(dest: string): Promise<boolean> {
    const dir = path.dirname(dest);
    const prefix = `${path.basename(dest)}.`;
    const deadline = Date.now() + WAIT_FOR_WRITER_MS;
    while (Date.now() < deadline) {
        if (await fileExists(dest)) return true;
        const names = (await fs.readdir(dir).catch(() => [] as string[])).filter(
            (n) => n.startsWith(prefix) && n.endsWith('.part'),
        );
        let live = false;
        for (const n of names) {
            const st = await fs.stat(path.join(dir, n)).catch(() => undefined);
            if (st && Date.now() - st.mtimeMs < PART_STALE_MS) live = true;
        }
        if (!live) return false;
        await sleep(500);
    }
    return fileExists(dest);
}

/** Build cache entries for every convertible path, sequentially; failures are logged, not thrown. */
export async function warmAudioCache(audioPaths: Iterable<string>, showFolder: string): Promise<void> {
    const seen = new Set<string>();
    for (const p of audioPaths) {
        if (!p || !needsAudioConversion(p)) continue;
        const abs = absoluteUnder(p, showFolder);
        if (seen.has(abs)) continue;
        seen.add(abs);
        try {
            await resolvePlayableAudio(abs, showFolder);
        } catch (err) {
            console.warn(`[AudioCache] Could not prepare "${abs}":`, err instanceof Error ? err.message : err);
        }
    }
}

/** Delete cache entries no live audio path maps to. Entries newer than `graceMs`
 *  are kept (in-flight or just warmed). Returns the number deleted. */
export async function pruneAudioCache(
    showFolder: string,
    liveAudioPaths: Iterable<string>,
    opts?: { graceMs?: number },
): Promise<number> {
    const dir = audioCacheDir(showFolder);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    if (!names.length) return 0;

    const keep = new Set<string>();
    for (const p of liveAudioPaths) {
        if (!p || !needsAudioConversion(p)) continue;
        const c = await audioCachePathFor(p, showFolder);
        if (c) keep.add(path.basename(c));
    }

    const grace = opts?.graceMs ?? DEFAULT_PRUNE_GRACE_MS;
    let deleted = 0;
    for (const name of names) {
        if (keep.has(name)) continue;
        const full = path.join(dir, name);
        const st = await fs.stat(full).catch(() => undefined);
        if (!st?.isFile()) continue;
        if (Date.now() - st.mtimeMs < grace) continue;
        try {
            await fs.unlink(full);
            deleted += 1;
        } catch {
            // EBUSY/EPERM - retry on the next sweep.
        }
    }
    if (deleted > 0) {
        console.log(`[AudioCache] pruned ${deleted} stale entries`);
    }
    return deleted;
}
