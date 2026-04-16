import * as path from 'path';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { FSEQReaderAsync } from '@ezplayer/epp';

type CoverArt = {
    data: Buffer;
    codec: string;
    extension: string;
    mimeType: string;
};

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.wma'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const CODEC_TO_EXT: Record<string, { ext: string; mime: string }> = {
    mjpeg: { ext: '.jpg', mime: 'image/jpeg' },
    jpeg: { ext: '.jpg', mime: 'image/jpeg' },
    png: { ext: '.png', mime: 'image/png' },
};
const MIME_TO_EXT: Record<string, { ext: string; mime: string }> = {
    'image/jpeg': { ext: '.jpg', mime: 'image/jpeg' },
    'image/jpg': { ext: '.jpg', mime: 'image/jpeg' },
    'image/png': { ext: '.png', mime: 'image/png' },
    'image/webp': { ext: '.webp', mime: 'image/webp' },
    'image/gif': { ext: '.gif', mime: 'image/gif' },
    'image/bmp': { ext: '.bmp', mime: 'image/bmp' },
};

export interface AutoDetectedSongFiles {
    audioFile?: string;
    imageFile?: string;
    imageGeneratedFromAudio?: boolean;
    detectedTitle?: string;
    detectedArtist?: string;
}

export interface MP3TagMetadata {
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

function sanitizeHeaderValue(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const cleaned = value.replace(/\0/g, '').trim();
    return cleaned || undefined;
}

function extractAudioPathCandidate(rawValue: string): string | undefined {
    // Recover a valid audio path/name from noisy header bytes (e.g. trailing `"sp`).
    const matches = rawValue.match(/[^\0\r\n]*?\.(mp3|wav|m4a|aac|flac|ogg|wma)/gi);
    if (!matches?.length) return undefined;
    const best = matches[0].replace(/["']/g, '').trim();
    return best || undefined;
}

function getAudioNameFromFseqHeader(headers: Record<string, string> | undefined): string | undefined {
    if (!headers) return undefined;
    const preferredKeys = ['mf', 'mu', 'md'];
    for (const key of preferredKeys) {
        const val = sanitizeHeaderValue(headers[key]);
        if (!val) continue;
        const recovered = extractAudioPathCandidate(val) ?? val;
        const ext = path.extname(recovered).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
            return path.basename(recovered);
        }
    }

    for (const val of Object.values(headers)) {
        const candidate = sanitizeHeaderValue(val);
        if (!candidate) continue;
        const recovered = extractAudioPathCandidate(candidate) ?? candidate;
        const ext = path.extname(recovered).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
            return path.basename(recovered);
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

async function extractCoverArt(filePath: string): Promise<CoverArt | null> {
    return new Promise((resolve, reject) => {
        const probeProc = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath]);
        let stdout = '';
        let stderr = '';

        probeProc.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        probeProc.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        probeProc.on('error', reject);

        probeProc.on('close', (code) => {
            if (code !== 0) {
                if (stderr.includes('not recognized as an internal or external command')) {
                    resolve(null);
                    return;
                }
                reject(new Error(`ffprobe failed with code ${code}`));
                return;
            }

            let probe: any;
            try {
                probe = JSON.parse(stdout);
            } catch {
                resolve(null);
                return;
            }

            const picStream = (probe.streams ?? []).find(
                (s: any) => s.codec_type === 'video' && s.disposition?.attached_pic === 1,
            );
            if (!picStream) {
                resolve(null);
                return;
            }

            const codec = picStream.codec_name ?? 'mjpeg';
            const info = CODEC_TO_EXT[codec] ?? { ext: '.jpg', mime: 'image/jpeg' };

            const chunks: Uint8Array[] = [];
            const proc = spawn('ffmpeg', ['-i', filePath, '-an', '-vcodec', 'copy', '-f', 'image2pipe', 'pipe:1']);

            proc.stdout.on('data', (chunk: Uint8Array) => chunks.push(chunk));
            proc.stderr.on('data', () => {});
            proc.on('error', reject);
            proc.on('close', (extractCode) => {
                if (extractCode !== 0 || chunks.length === 0) {
                    resolve(null);
                    return;
                }
                resolve({
                    data: Buffer.concat(chunks),
                    codec,
                    extension: info.ext,
                    mimeType: info.mime,
                });
            });
        });
    });
}

function normalizePictureFormatToInfo(format: string | undefined): { ext: string; mime: string } {
    const normalized = (format ?? '').toLowerCase();
    if (MIME_TO_EXT[normalized]) return MIME_TO_EXT[normalized];
    const withPrefix = normalized.includes('/') ? normalized : `image/${normalized}`;
    if (MIME_TO_EXT[withPrefix]) return MIME_TO_EXT[withPrefix];
    return { ext: '.jpg', mime: 'image/jpeg' };
}

async function writeCoverArtNearAudio(audioPath: string, coverArt: CoverArt): Promise<string | undefined> {
    try {
        const imageBase = path.parse(audioPath).name;
        const outputPath = path.join(path.dirname(audioPath), `${imageBase}${coverArt.extension}`);
        await fs.writeFile(outputPath, coverArt.data);
        return outputPath;
    } catch {
        return undefined;
    }
}

async function extractMp3Metadata(
    filePath: string,
): Promise<{ title?: string; artist?: string; coverArt?: CoverArt } | null> {
    if (!filePath || path.extname(filePath).toLowerCase() !== '.mp3') return null;
    try {
        // Use Node parser in Electron main process. The browser build can break when bundled for main.
        const { parseFile } = await import('music-metadata');
        const metadata = await parseFile(filePath);
        console.log(`[SongAutoDetect][MP3] parseFile succeeded: "${filePath}"`);

        const title = sanitizeHeaderValue(metadata.common.title);
        const artist = sanitizeHeaderValue(metadata.common.artist);
        const picture = metadata.common.picture?.[0];
        let coverArt: CoverArt | undefined;

        if (picture?.data?.length) {
            const info = normalizePictureFormatToInfo(picture.format);
            coverArt = {
                data: Buffer.from(picture.data),
                codec: picture.format ?? info.mime,
                extension: info.ext,
                mimeType: info.mime,
            };
        }

        if (!title && !artist && !coverArt) return null;
        return { title, artist, coverArt };
    } catch (error) {
        console.warn(`[SongAutoDetect][MP3] Metadata parse failed for "${filePath}"`, error);
        return null;
    }
}

export async function extractMp3TagMetadata(mp3FilePath: string): Promise<MP3TagMetadata> {
    const out: MP3TagMetadata = {};
    const parsed = await extractMp3Metadata(mp3FilePath);
    if (!parsed) {
        console.log(`[SongAutoDetect][MP3] No parse result for "${mp3FilePath}"`);
        return out;
    }

    out.title = parsed.title;
    out.artist = parsed.artist;

    if (parsed.coverArt) {
        const imageFile = await writeCoverArtNearAudio(mp3FilePath, parsed.coverArt);
        if (imageFile) {
            out.imageFile = imageFile;
            out.imageGeneratedFromAudio = true;
            console.log(`[SongAutoDetect][MP3] Cover art extracted to: "${imageFile}"`);
        }
    }

    console.log(`[SongAutoDetect][MP3] Final extracted metadata for "${mp3FilePath}"`, {
        hasTitle: !!out.title,
        hasArtist: !!out.artist,
        hasImage: !!out.imageFile,
    });

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
        headerAudioName = getAudioNameFromFseqHeader(header.headers);
    } catch {
        // Keep existing flow when header is missing/invalid.
    }

    if (headerAudioName) {
        const direct = path.join(fseqDir, headerAudioName);
        if (await fileExists(direct)) {
            out.audioFile = direct;
        }
    }
    if (!out.audioFile) {
        out.audioFile = await findWithBasename(fseqDir, fseqBase, AUDIO_EXTENSIONS);
    }

    if (out.audioFile) {
        const audioBase = path.parse(out.audioFile).name;
        out.imageFile =
            (await findWithBasename(fseqDir, audioBase, IMAGE_EXTENSIONS)) ??
            (await findWithBasename(fseqDir, fseqBase, IMAGE_EXTENSIONS));

        const mp3Metadata = await extractMp3TagMetadata(out.audioFile);
        out.detectedTitle = mp3Metadata.title;
        out.detectedArtist = mp3Metadata.artist;
        if (!out.imageFile && mp3Metadata.imageFile) {
            out.imageFile = mp3Metadata.imageFile;
            out.imageGeneratedFromAudio = mp3Metadata.imageGeneratedFromAudio;
        }
    } else {
        out.imageFile = await findWithBasename(fseqDir, fseqBase, IMAGE_EXTENSIONS);
    }

    if (out.audioFile && !out.imageFile) {
        try {
            const coverArt = await extractCoverArt(out.audioFile);
            if (coverArt) {
                const outputPath = await writeCoverArtNearAudio(out.audioFile, coverArt);
                if (outputPath) {
                    out.imageFile = outputPath;
                    out.imageGeneratedFromAudio = true;
                }
            }
        } catch {
            // Non-intrusive fallback: keep original behavior when ffmpeg fails.
        }
    }

    return out;
}
