import * as path from 'path';
import * as fs from 'node:fs/promises';
import { parseAudioTags } from 'audiofile';
import { FSEQReaderAsync } from '@ezplayer/epp';

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
};

/** Directories skipped while walking a media-folder tree. */
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.ezplayer', '__MACOSX', '.Trash', '$RECYCLE.BIN']);

export interface AutoDetectOptions {
    /** Optional media folder — searched only after existing co-located lookup fails. */
    mediaFolder?: string;
}

export interface AutoDetectedSongFiles {
    audioFile?: string;
    imageFile?: string;
    imageGeneratedFromAudio?: boolean;
    detectedTitle?: string;
    detectedArtist?: string;
    durationSecs?: number;
    /**
     * True when the FSEQ header names an audio file (`mf`/`mu`/`md`).
     * Bulk import uses this to fail sequences whose required audio is missing.
     */
    audioRequired?: boolean;
    /** Basename of the audio file named in the FSEQ header, when present. */
    headerAudioName?: string;
}

export interface AudioTagMetadata {
    title?: string;
    artist?: string;
    imageFile?: string;
    imageGeneratedFromAudio?: boolean;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function getAudioNameFromFseqHeader(headers: Record<string, string> | undefined): string | undefined {
    if (!headers) return undefined;
    for (const key of ['mf', 'mu', 'md']) {
        const val = headers[key]?.trim();
        if (!val) continue;
        const ext = path.extname(val).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
            return path.basename(val);
        }
    }
    return undefined;
}

/**
 * Pick the first non-empty header value for any of the candidate 2-char codes
 * (FSEQ variable headers are always two bytes). Values that look binary / non-
 * printable are ignored so malformed or extended-data headers never surface.
 */
function firstPrintableHeader(headers: Record<string, string>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const raw = headers[key];
        if (typeof raw !== 'string') continue;
        const val = raw.replace(/\0/g, '').trim();
        if (!val) continue;
        // Reject binary / control-heavy payloads (e.g. unresolved ED blobs).
        if (/[\x00-\x08\x0E-\x1F]/.test(val)) continue;
        return val;
    }
    return undefined;
}

/**
 * Optional title/artist tags some sequencers embed as FSEQ variable headers.
 * Official FSEQ only defines `mf` / `sp`; these codes are best-effort extras
 * (vendor custom tags + recommended authorship codes). Returns empty when absent.
 */
function getTitleArtistFromFseqHeaders(headers: Record<string, string> | undefined): {
    title?: string;
    artist?: string;
} {
    if (!headers) return {};
    try {
        // Title: tt/ti (title), sn/st (song name/title) — common custom codes.
        const title = firstPrintableHeader(headers, ['tt', 'ti', 'sn', 'st']);
        // Artist: ta/ar (artist), sa (song artist), an (author name — recommended).
        const artist = firstPrintableHeader(headers, ['ta', 'ar', 'sa', 'an']);
        return {
            title: title || undefined,
            artist: artist || undefined,
        };
    } catch {
        // Malformed header maps must never break import.
        return {};
    }
}

async function findWithBasename(dir: string, baseName: string, exts: string[]): Promise<string | undefined> {
    for (const ext of exts) {
        const p = path.join(dir, `${baseName}${ext}`);
        if (await fileExists(p)) return p;
    }
    return undefined;
}

async function findWithPrefix(dir: string, prefix: string, exts: string[]): Promise<string | undefined> {
    const extSet = new Set(exts);
    const lowerPrefix = prefix.toLowerCase();
    try {
        const entries = await fs.readdir(dir);
        for (const entry of entries) {
            const ext = path.extname(entry).toLowerCase();
            if (!extSet.has(ext)) continue;
            if (entry.toLowerCase().startsWith(lowerPrefix)) {
                return path.join(dir, entry);
            }
        }
    } catch {
        // Directory unreadable — caller will proceed without a match.
    }
    return undefined;
}

/** Existing co-located search: exact basename, then prefix match (non-recursive). */
async function findAudioInDirectory(dir: string, baseNames: string[]): Promise<string | undefined> {
    for (const base of baseNames) {
        const hit =
            (await findWithBasename(dir, base, AUDIO_EXTENSIONS)) ??
            (await findWithPrefix(dir, base, AUDIO_EXTENSIONS));
        if (hit) return hit;
    }
    return undefined;
}

/** Recursive walk of `root` looking for an audio file whose basename (no ext)
 *  equals or starts with any candidate. Used only as media-folder fallback. */
async function findAudioRecursive(root: string, baseNames: string[]): Promise<string | undefined> {
    const lowerBases = baseNames.map((b) => b.toLowerCase());
    const extSet = new Set(AUDIO_EXTENSIONS);
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop()!;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const name = String(entry.name);
            if (entry.isDirectory()) {
                if (SKIP_DIR_NAMES.has(name)) continue;
                stack.push(path.join(dir, name));
                continue;
            }
            if (!entry.isFile()) continue;
            const ext = path.extname(name).toLowerCase();
            if (!extSet.has(ext)) continue;
            const nameNoExt = path.parse(name).name.toLowerCase();
            if (lowerBases.some((b) => nameNoExt === b || nameNoExt.startsWith(b))) {
                return path.join(dir, name);
            }
        }
    }
    return undefined;
}

export async function extractAudioTagMetadata(audioFilePath: string): Promise<AudioTagMetadata> {
    const out: AudioTagMetadata = {};
    try {
        const data = await fs.readFile(audioFilePath);
        const tags = parseAudioTags(new Uint8Array(data));

        out.title = tags.title;
        out.artist = tags.artist;

        if (tags.coverArt?.data?.length) {
            const ext = MIME_TO_EXT[tags.coverArt.mimeType] ?? '.jpg';
            const imageBase = path.parse(audioFilePath).name;
            const outputPath = path.join(path.dirname(audioFilePath), `${imageBase}${ext}`);
            await fs.writeFile(outputPath, tags.coverArt.data);
            out.imageFile = outputPath;
            out.imageGeneratedFromAudio = true;
        }
        console.log(
            `[SongAutoDetect] "${audioFilePath}" -> title=${out.title ?? '(none)'}, artist=${out.artist ?? '(none)'}, image=${out.imageFile ?? '(none)'}`,
        );
    } catch (error) {
        console.warn(`[SongAutoDetect] Metadata parse failed for "${audioFilePath}": ${String(error)}`);
    }
    return out;
}

/**
 * Locate companion audio/image and title/artist for an FSEQ.
 * Optional `mediaFolder` is searched only after the existing same-directory
 * lookup fails — existing single-sequence behavior is unchanged when unset.
 */
export async function autoDetectSongFilesFromFseq(
    fseqFilePath: string,
    options?: AutoDetectOptions,
): Promise<AutoDetectedSongFiles> {
    const out: AutoDetectedSongFiles = {};
    if (!fseqFilePath || path.extname(fseqFilePath).toLowerCase() !== '.fseq') {
        return out;
    }

    const fseqDir = path.dirname(fseqFilePath);
    const fseqBase = path.parse(fseqFilePath).name;
    const mediaFolder = options?.mediaFolder?.trim() || undefined;

    let headerAudioName: string | undefined;
    let fseqMeta: { title?: string; artist?: string } = {};
    try {
        const header = await FSEQReaderAsync.readFSEQHeaderAsync(fseqFilePath);
        out.durationSecs = (header.frames * header.msperframe) / 1000;
        const keys = Object.keys(header.headers);
        console.log(
            `[SongAutoDetect] FSEQ headers [${keys.join(', ')}]: ${keys.map((k) => `${k}="${header.headers[k]}"`).join(', ') || '(empty)'}`,
        );
        headerAudioName = getAudioNameFromFseqHeader(header.headers);
        out.headerAudioName = headerAudioName;
        out.audioRequired = !!headerAudioName;
        fseqMeta = getTitleArtistFromFseqHeaders(header.headers);
        console.log(
            `[SongAutoDetect] Audio name from header: ${headerAudioName ?? '(none)'}, duration: ${out.durationSecs}s` +
                `, fseqTitle=${fseqMeta.title ?? '(none)'}, fseqArtist=${fseqMeta.artist ?? '(none)'}`,
        );
    } catch (error) {
        console.warn(`[SongAutoDetect] FSEQ header read failed for "${fseqFilePath}":`, String(error));
    }

    // --- Existing / default search (unchanged): FSEQ directory only ---
    if (headerAudioName) {
        const direct = path.join(fseqDir, headerAudioName);
        if (await fileExists(direct)) {
            out.audioFile = direct;
        }
        if (!out.audioFile) {
            const headerBase = path.parse(headerAudioName).name;
            out.audioFile =
                (await findWithBasename(fseqDir, headerBase, AUDIO_EXTENSIONS)) ??
                (await findWithPrefix(fseqDir, headerBase, AUDIO_EXTENSIONS));
        }
    }
    if (!out.audioFile) {
        out.audioFile =
            (await findWithBasename(fseqDir, fseqBase, AUDIO_EXTENSIONS)) ??
            (await findWithPrefix(fseqDir, fseqBase, AUDIO_EXTENSIONS));
    }

    // --- Additive fallback: optional Media Folder ---
    if (!out.audioFile && mediaFolder) {
        const baseNames = [
            ...new Set([headerAudioName ? path.parse(headerAudioName).name : undefined, fseqBase].filter(Boolean)),
        ] as string[];
        out.audioFile =
            (await findAudioInDirectory(mediaFolder, baseNames)) ??
            (await findAudioRecursive(mediaFolder, baseNames));
        if (out.audioFile) {
            console.log(`[SongAutoDetect] Audio found in media folder: ${out.audioFile}`);
        }
    }

    // Prefer MP3/ID3 title/artist; fall back to FSEQ headers only for gaps.
    let titleSource: 'fseq' | 'mp3' | 'none' = 'none';
    let artistSource: 'fseq' | 'mp3' | 'none' = 'none';

    if (out.audioFile) {
        const audioBase = path.parse(out.audioFile).name;
        out.imageFile =
            (await findWithBasename(fseqDir, audioBase, IMAGE_EXTENSIONS)) ??
            (await findWithPrefix(fseqDir, audioBase, IMAGE_EXTENSIONS)) ??
            (await findWithBasename(fseqDir, fseqBase, IMAGE_EXTENSIONS)) ??
            (await findWithPrefix(fseqDir, fseqBase, IMAGE_EXTENSIONS));

        const metadata = await extractAudioTagMetadata(out.audioFile);
        out.detectedTitle = metadata.title;
        out.detectedArtist = metadata.artist;
        if (metadata.title) titleSource = 'mp3';
        if (metadata.artist) artistSource = 'mp3';
        if (!out.imageFile && metadata.imageFile) {
            out.imageFile = metadata.imageFile;
            out.imageGeneratedFromAudio = metadata.imageGeneratedFromAudio;
        }
    } else {
        out.imageFile =
            (await findWithBasename(fseqDir, fseqBase, IMAGE_EXTENSIONS)) ??
            (await findWithPrefix(fseqDir, fseqBase, IMAGE_EXTENSIONS));
        console.log('[SongAutoDetect] No MP3 linked; will try FSEQ metadata tags for title/artist.');
    }

    if (!out.detectedTitle && fseqMeta.title) {
        out.detectedTitle = fseqMeta.title;
        titleSource = 'fseq';
        console.log(`[SongAutoDetect] Title taken from FSEQ: "${fseqMeta.title}"`);
    } else if (out.detectedTitle && fseqMeta.title && titleSource === 'mp3') {
        console.log(
            `[SongAutoDetect] Title kept from MP3 ("${out.detectedTitle}"); ignoring FSEQ title ("${fseqMeta.title}")`,
        );
    }

    if (!out.detectedArtist && fseqMeta.artist) {
        out.detectedArtist = fseqMeta.artist;
        artistSource = 'fseq';
        console.log(`[SongAutoDetect] Artist taken from FSEQ: "${fseqMeta.artist}"`);
    } else if (out.detectedArtist && fseqMeta.artist && artistSource === 'mp3') {
        console.log(
            `[SongAutoDetect] Artist kept from MP3 ("${out.detectedArtist}"); ignoring FSEQ artist ("${fseqMeta.artist}")`,
        );
    }

    console.log(
        `[SongAutoDetect] FSEQ "${fseqBase}" -> audio=${out.audioFile ?? '(none)'}, image=${out.imageFile ?? '(none)'}, ` +
            `title=${out.detectedTitle ?? '(none)'} [from ${titleSource}], artist=${out.detectedArtist ?? '(none)'} [from ${artistSource}]`,
    );
    return out;
}

/** Recursively collect `.fseq` paths under a directory (for bulk folder import). */
export async function listFseqFilesInDirectory(dirPath: string): Promise<string[]> {
    const results: string[] = [];
    const stack = [dirPath];
    while (stack.length) {
        const dir = stack.pop()!;
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const name = String(entry.name);
            if (entry.isDirectory()) {
                if (SKIP_DIR_NAMES.has(name)) continue;
                stack.push(path.join(dir, name));
                continue;
            }
            if (entry.isFile() && path.extname(name).toLowerCase() === '.fseq') {
                results.push(path.join(dir, name));
            }
        }
    }
    return results.sort((a, b) => a.localeCompare(b));
}
