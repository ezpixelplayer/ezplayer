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

export interface AutoDetectedSongFiles {
    audioFile?: string;
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
            const proc = spawn('ffmpeg', [
                '-i',
                filePath,
                '-an',
                '-vcodec',
                'copy',
                '-f',
                'image2pipe',
                'pipe:1',
            ]);

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
        out.imageFile = (await findWithBasename(fseqDir, audioBase, IMAGE_EXTENSIONS))
            ?? (await findWithBasename(fseqDir, fseqBase, IMAGE_EXTENSIONS));
    } else {
        out.imageFile = await findWithBasename(fseqDir, fseqBase, IMAGE_EXTENSIONS);
    }

    if (out.audioFile && !out.imageFile) {
        try {
            const coverArt = await extractCoverArt(out.audioFile);
            if (coverArt) {
                const imageBase = path.parse(out.audioFile).name;
                const outputPath = path.join(path.dirname(out.audioFile), `${imageBase}${coverArt.extension}`);
                await fs.writeFile(outputPath, coverArt.data);
                out.imageFile = outputPath;
                out.imageGeneratedFromAudio = true;
            }
        } catch {
            // Non-intrusive fallback: keep original behavior when ffmpeg fails.
        }
    }

    return out;
}
