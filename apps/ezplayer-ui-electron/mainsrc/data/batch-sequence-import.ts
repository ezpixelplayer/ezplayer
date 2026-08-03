import * as path from 'path';
import * as crypto from 'crypto';
import type { SequenceRecord } from '@ezplayer/ezplayer-core';
import {
    autoDetectSongFilesFromFseq,
    listFseqFilesInDirectory,
    type AutoDetectOptions,
    type AutoDetectedSongFiles,
} from './song-file-autodetect.js';

export interface BatchImportFailure {
    fseqPath: string;
    fseqName: string;
    reason: string;
}

export interface BatchImportSuccess {
    fseqPath: string;
    fseqName: string;
    title: string;
    artist: string;
    mediaFound: boolean;
}

export interface BatchImportSummary {
    total: number;
    imported: number;
    failed: number;
    successes: BatchImportSuccess[];
    failures: BatchImportFailure[];
}

export interface BatchImportOptions extends AutoDetectOptions {
    /** Persist one or more SequenceRecords (typically putSequencesWithDurations). */
    putSequences: (recs: SequenceRecord[]) => Promise<SequenceRecord[]>;
}

/**
 * Build a SequenceRecord from an FSEQ path + autodetection result.
 * Missing optional media is allowed — title/artist fall back to the fseq
 * basename / "Unknown Artist" so the sequence can still be saved.
 */
export function buildSequenceRecordFromDetected(
    fseqPath: string,
    detected: AutoDetectedSongFiles,
): SequenceRecord {
    const id = crypto.randomUUID();
    const fseqBase = path.parse(fseqPath).name;
    return {
        instanceId: id,
        id,
        work: {
            title: detected.detectedTitle?.trim() || fseqBase,
            artist: detected.detectedArtist?.trim() || 'Unknown Artist',
            length: detected.durationSecs ?? 0,
            description: '',
            tags: [],
            genre: '',
            music_url: '',
            artwork: undefined,
        },
        sequence: {
            vendor: '',
            variant: '',
            sku: '',
            vendor_url: '',
            preview_url: '',
        },
        files: {
            fseq: fseqPath,
            audio: detected.audioFile,
            thumb: detected.imageFile,
        },
        updatedAt: Date.now(),
        deleted: false,
        settings: {
            lead_time: 0,
            trail_time: 0,
            volume_adj: 0,
            tags: [],
        },
    };
}

async function importOneFseq(
    fseqPath: string,
    options: BatchImportOptions,
): Promise<{ ok: true; success: BatchImportSuccess } | { ok: false; failure: BatchImportFailure }> {
    const fseqName = path.basename(fseqPath);
    try {
        if (path.extname(fseqPath).toLowerCase() !== '.fseq') {
            return { ok: false, failure: { fseqPath, fseqName, reason: 'Not an .fseq file' } };
        }

        const detected = await autoDetectSongFilesFromFseq(fseqPath, {
            mediaFolder: options.mediaFolder,
        });

        if (detected.audioRequired && !detected.audioFile) {
            const wanted = detected.headerAudioName ? ` (${detected.headerAudioName})` : '';
            return {
                ok: false,
                failure: {
                    fseqPath,
                    fseqName,
                    reason: `Audio file not found${wanted}`,
                },
            };
        }

        const record = buildSequenceRecordFromDetected(fseqPath, detected);
        await options.putSequences([record]);

        return {
            ok: true,
            success: {
                fseqPath,
                fseqName,
                title: record.work.title,
                artist: record.work.artist,
                mediaFound: !!detected.audioFile,
            },
        };
    } catch (error) {
        return {
            ok: false,
            failure: {
                fseqPath,
                fseqName,
                reason: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

/**
 * Import many FSEQ paths independently. One failure never aborts the rest.
 * Reuses `autoDetectSongFilesFromFseq` + the caller's putSequences.
 */
export async function batchImportSequences(
    fseqPaths: string[],
    options: BatchImportOptions,
): Promise<BatchImportSummary> {
    const successes: BatchImportSuccess[] = [];
    const failures: BatchImportFailure[] = [];
    const unique = [...new Set(fseqPaths.filter(Boolean))];

    console.log(`[BatchImport] Starting import of ${unique.length} sequence(s)`);

    for (const fseqPath of unique) {
        const result = await importOneFseq(fseqPath, options);
        if (result.ok) {
            successes.push(result.success);
            console.log(`[BatchImport] Imported "${result.success.fseqName}"`);
        } else {
            failures.push(result.failure);
            console.warn(`[BatchImport] Skipped "${result.failure.fseqName}": ${result.failure.reason}`);
        }
    }

    const summary: BatchImportSummary = {
        total: unique.length,
        imported: successes.length,
        failed: failures.length,
        successes,
        failures,
    };
    console.log(`[BatchImport] Done: imported=${summary.imported}, failed=${summary.failed}`);
    return summary;
}

/** Resolve a folder to FSEQ paths, then run {@link batchImportSequences}. */
export async function batchImportSequencesFromFolder(
    folderPath: string,
    options: BatchImportOptions,
): Promise<BatchImportSummary> {
    const fseqs = await listFseqFilesInDirectory(folderPath);
    if (!fseqs.length) {
        return {
            total: 0,
            imported: 0,
            failed: 1,
            successes: [],
            failures: [
                {
                    fseqPath: folderPath,
                    fseqName: path.basename(folderPath),
                    reason: 'No .fseq files found in folder',
                },
            ],
        };
    }
    return batchImportSequences(fseqs, options);
}
