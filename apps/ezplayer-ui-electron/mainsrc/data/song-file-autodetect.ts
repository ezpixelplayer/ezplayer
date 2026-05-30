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

export interface AutoDetectedSongFiles {
    audioFile?: string;
    imageFile?: string;
    imageGeneratedFromAudio?: boolean;
    detectedTitle?: string;
    detectedArtist?: string;
    durationSecs?: number;
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

export async function autoDetectSongFilesFromFseq(fseqFilePath: string): Promise<AutoDetectedSongFiles> {
    const out: AutoDetectedSongFiles = {};
    if (!fseqFilePath || path.extname(fseqFilePath).toLowerCase() !== '.fseq') {
        return out;
    }

    const fseqDir = path.dirname(fseqFilePath);
    const fseqBase = path.parse(fseqFilePath).name;

    let headerAudioName: string | undefined;
    try {
        const header = await FSEQReaderAsync.readFSEQHeaderAsync(fseqFilePath);
        out.durationSecs = (header.frames * header.msperframe) / 1000;
        const keys = Object.keys(header.headers);
        console.log(
            `[SongAutoDetect] FSEQ headers [${keys.join(', ')}]: ${keys.map((k) => `${k}="${header.headers[k]}"`).join(', ') || '(empty)'}`,
        );
        headerAudioName = getAudioNameFromFseqHeader(header.headers);
        console.log(
            `[SongAutoDetect] Audio name from header: ${headerAudioName ?? '(none)'}, duration: ${out.durationSecs}s`,
        );
    } catch (error) {
        console.warn(`[SongAutoDetect] FSEQ header read failed for "${fseqFilePath}":`, String(error));
    }

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
        if (!out.imageFile && metadata.imageFile) {
            out.imageFile = metadata.imageFile;
            out.imageGeneratedFromAudio = metadata.imageGeneratedFromAudio;
        }
    } else {
        out.imageFile =
            (await findWithBasename(fseqDir, fseqBase, IMAGE_EXTENSIONS)) ??
            (await findWithPrefix(fseqDir, fseqBase, IMAGE_EXTENSIONS));
    }

    console.log(
        `[SongAutoDetect] FSEQ "${fseqBase}" -> audio=${out.audioFile ?? '(none)'}, image=${out.imageFile ?? '(none)'}, title=${out.detectedTitle ?? '(none)'}, artist=${out.detectedArtist ?? '(none)'}`,
    );
    return out;
}
