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
 * Derived playback audio.
 *
 * Playback is MP3-only (mpg123). A song record always keeps the user's original
 * file in `files.audio`; what playback actually decodes is a *derivation* of it:
 * a transcode for non-MP3 sources, optionally loudness-normalized (the record's
 * `settings.normalize`). Derivations are precomputed - building one is part of
 * committing the record, so a committed song is a playable song. Playback only
 * maps record -> derived path; it never builds.
 *
 * Derived files live under `<show>/.ezplayer/derived-audio/`, named by source
 * path + size + mtime + recipe + options, so a changed source, recipe, or option
 * yields a new file and the old one is pruned. They are disposable: a show-folder
 * load rebuilds anything missing.
 */

/** Bump when the ffmpeg recipe changes; every derived file is rebuilt on the next load. */
export const DERIVED_AUDIO_RECIPE = 1;
export const DERIVED_AUDIO_SUBDIR = path.join('.ezplayer', 'derived-audio');

/** EBU R128 single-pass loudness normalization; matches the cloud render recipe.
 *  Tuned for FM transmitters / patio speakers / phones, not for dynamic range. */
export const NORMALIZE_AUDIO_FILTER = 'loudnorm=I=-16:LRA=11:TP=-1.5';

/** Per-record options that select a derivation variant. */
export interface AudioDerivationOptions {
    /** Bake loudness normalization into the playable file (applies to MP3 sources too). */
    normalize?: boolean;
}

/** A record's audio plus its derivation options. */
export interface AudioDerivationItem extends AudioDerivationOptions {
    audio?: string;
}

/** A `.part` untouched for this long is a dead writer, not an in-flight build. */
const PART_STALE_MS = 60_000;
/** Upper bound on waiting for another process's in-flight build. */
const WAIT_FOR_WRITER_MS = 10 * 60_000;
/** Prune keeps anything newer than this - covers in-flight builds. */
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

/** Windows (Defender, indexer) can hold a just-written file for a moment. */
async function unlinkWithRetry(file: string, attempts = 4, delayMs = 250): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        try {
            await fs.unlink(file);
            return true;
        } catch (err) {
            const code = (err as { code?: string })?.code;
            if (code === 'ENOENT') return true;
            if (code !== 'EBUSY' && code !== 'EPERM') return false;
            if (i + 1 < attempts) await sleep(delayMs);
        }
    }
    return false;
}

export function isSupportedAudioPath(filePath: string): boolean {
    return isSupportedAudioName(filePath);
}

export function needsMp3Conversion(filePath: string): boolean {
    return needsAudioConversion(filePath);
}

/** True when playback needs a derived file rather than the source itself. */
export function needsDerivedAudio(filePath: string, opts?: AudioDerivationOptions): boolean {
    if (!filePath || !isSupportedAudioName(filePath)) return false;
    return needsAudioConversion(filePath) || !!opts?.normalize;
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

/** ffmpeg arguments for one derivation variant. Exported for tests. */
export function ffmpegArgsFor(sourcePath: string, destPath: string, opts?: AudioDerivationOptions): string[] {
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath, '-vn'];
    if (opts?.normalize) {
        args.push('-af', NORMALIZE_AUDIO_FILTER, '-codec:a', 'libmp3lame', '-q:a', '0');
    } else {
        args.push('-codec:a', 'libmp3lame', '-q:a', '2');
    }
    // The temp file has no .mp3 extension, so name the muxer explicitly.
    args.push('-f', 'mp3', destPath);
    return args;
}

function runFfmpegToMp3(sourcePath: string, destPath: string, opts?: AudioDerivationOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        let ffmpegBin: string;
        try {
            ffmpegBin = resolveFfmpegBinary();
        } catch (err) {
            reject(err);
            return;
        }
        const child = spawn(ffmpegBin, ffmpegArgsFor(sourcePath, destPath, opts), { windowsHide: true });
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

export function derivedAudioDir(showFolder: string): string {
    return path.join(showFolder, DERIVED_AUDIO_SUBDIR);
}

function absoluteUnder(p: string, showFolder: string): string {
    const t = p.trim();
    return path.isAbsolute(t) ? path.resolve(t) : path.join(showFolder, t);
}

/** Derived file a source maps to, or undefined when the source is missing. Pure: never builds. */
export async function derivedAudioPathFor(
    sourcePath: string,
    showFolder: string,
    opts?: AudioDerivationOptions,
): Promise<string | undefined> {
    const resolved = absoluteUnder(sourcePath, showFolder);
    let st: Awaited<ReturnType<typeof fs.stat>>;
    try {
        st = await fs.stat(resolved);
    } catch {
        return undefined;
    }
    const variant = opts?.normalize ? '|norm' : '';
    const digest = createHash('sha1')
        .update(`${resolved}|${st.size}|${Math.floor(st.mtimeMs)}|r${DERIVED_AUDIO_RECIPE}${variant}`)
        .digest('hex')
        .slice(0, 16);
    const base = path
        .parse(resolved)
        .name.replace(/[^\w.-]+/g, '_')
        .slice(0, 60);
    const suffix = opts?.normalize ? '-norm' : '';
    return path.join(derivedAudioDir(showFolder), `${base}${suffix}-${digest}${MP3_EXTENSION}`);
}

function checkSupported(resolved: string): string {
    const ext = path.extname(resolved).toLowerCase();
    if (!(SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new Error(`Unsupported audio format: ${ext || '(none)'}`);
    }
    return ext;
}

/**
 * The file playback decodes for a record's `files.audio`. Pure: never builds.
 * - `.mp3` without normalization -> the source itself.
 * - Anything else -> its derived file, which must already exist (built at commit
 *   or by the show-folder reconcile); otherwise throws.
 */
export async function playableAudioPath(
    sourcePath: string,
    showFolder: string,
    opts?: AudioDerivationOptions,
): Promise<string> {
    if (!sourcePath?.trim()) {
        throw new Error('Audio path is required');
    }
    const resolved = absoluteUnder(sourcePath, showFolder);
    const ext = checkSupported(resolved);
    if (ext === MP3_EXTENSION && !opts?.normalize) {
        return resolved;
    }
    const derived = await derivedAudioPathFor(resolved, showFolder, opts);
    if (!derived) {
        throw new Error(`Audio file not found: ${resolved}`);
    }
    if (!(await fileExists(derived))) {
        throw new Error(`Derived audio not built yet for "${resolved}" (re-save the song or reload the show)`);
    }
    return derived;
}

/** Same-process dedupe: concurrent requests for one derived file share the build. */
const inflight = new Map<string, Promise<string>>();

/**
 * Make sure the derived file for a record's `files.audio` exists, building it
 * when missing. Returns the path playback will use. Never touches the source.
 */
export async function ensureDerivedAudio(
    sourcePath: string,
    showFolder: string,
    opts?: AudioDerivationOptions,
): Promise<string> {
    if (!sourcePath?.trim()) {
        throw new Error('Audio path is required');
    }
    const resolved = absoluteUnder(sourcePath, showFolder);
    const ext = checkSupported(resolved);
    if (ext === MP3_EXTENSION && !opts?.normalize) {
        return resolved;
    }
    const dest = await derivedAudioPathFor(resolved, showFolder, opts);
    if (!dest) {
        throw new Error(`Audio file not found: ${resolved}`);
    }
    if (await fileExists(dest)) {
        return dest;
    }
    const pending = inflight.get(dest);
    if (pending) return pending;
    const job = buildDerivedAudio(resolved, dest, opts).finally(() => inflight.delete(dest));
    inflight.set(dest, job);
    return job;
}

async function buildDerivedAudio(source: string, dest: string, opts?: AudioDerivationOptions): Promise<string> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    // Two processes (commit vs. reconcile) may race on one file.
    if (await waitForOtherWriter(dest)) {
        return dest;
    }
    const tmp = `${dest}.${process.pid}.part`;
    try {
        console.log(`[DerivedAudio] ${opts?.normalize ? 'Normalizing' : 'Converting'} "${source}" -> "${dest}"`);
        await runFfmpegToMp3(source, tmp, opts);
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

/** Derive audio for a record before it is committed. Throws on failure - a song
 *  whose audio cannot be derived is not playable and must not be saved as if it were. */
export async function deriveAudioForRecord(item: AudioDerivationItem, showFolder: string): Promise<void> {
    if (!item.audio || !needsDerivedAudio(item.audio, item)) return;
    await ensureDerivedAudio(item.audio, showFolder, { normalize: item.normalize });
}

/** Rebuild any missing derived files for the given records, sequentially. Used on
 *  show-folder load (recipe bumps, deleted files); failures are logged, not thrown. */
export async function reconcileDerivedAudio(items: Iterable<AudioDerivationItem>, showFolder: string): Promise<void> {
    const seen = new Set<string>();
    for (const item of items) {
        const p = item.audio;
        if (!p || !needsDerivedAudio(p, item)) continue;
        const abs = absoluteUnder(p, showFolder);
        const id = `${abs}|${item.normalize ? 'norm' : 'plain'}`;
        if (seen.has(id)) continue;
        seen.add(id);
        try {
            await ensureDerivedAudio(abs, showFolder, { normalize: item.normalize });
        } catch (err) {
            console.warn(`[DerivedAudio] Could not derive "${abs}":`, err instanceof Error ? err.message : err);
        }
    }
}

/** Delete derived files no live record maps to. Files newer than `graceMs` are
 *  kept (in-flight builds). Returns the number deleted. */
export async function pruneStaleDerivedAudio(
    showFolder: string,
    liveItems: Iterable<AudioDerivationItem>,
    opts?: { graceMs?: number },
): Promise<number> {
    const dir = derivedAudioDir(showFolder);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    if (!names.length) return 0;

    const keep = new Set<string>();
    for (const item of liveItems) {
        const p = item.audio;
        if (!p || !needsDerivedAudio(p, item)) continue;
        const c = await derivedAudioPathFor(p, showFolder, { normalize: item.normalize });
        if (c) keep.add(path.basename(c));
    }

    const grace = opts?.graceMs ?? DEFAULT_PRUNE_GRACE_MS;
    let deleted = 0;
    for (const name of names) {
        if (keep.has(name)) continue;
        const full = path.join(dir, name);
        const st = await fs.stat(full).catch(() => undefined);
        if (!st?.isFile()) continue;
        // A filesystem stamp can sit a hair ahead of Date.now(); with no grace, age is irrelevant.
        if (grace > 0 && Date.now() - st.mtimeMs < grace) continue;
        if (await unlinkWithRetry(full)) deleted += 1; // else: retry on the next sweep
    }
    if (deleted > 0) {
        console.log(`[DerivedAudio] pruned ${deleted} stale files`);
    }
    return deleted;
}
