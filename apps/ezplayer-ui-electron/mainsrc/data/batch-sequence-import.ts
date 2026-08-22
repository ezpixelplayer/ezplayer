import * as path from 'path';
import * as crypto from 'crypto';
import type {
    BatchImportFailure,
    BatchImportSkipped,
    BatchImportSuccess,
    BatchImportSummary,
    SequenceRecord,
} from '@ezplayer/ezplayer-core';
import {
    autoDetectSongFilesFromFseq,
    listFseqFilesInDirectory,
    type AutoDetectOptions,
    type AutoDetectedSongFiles,
} from './song-file-autodetect.js';

export interface BatchImportOptions extends AutoDetectOptions {
    /** Persist one or more SequenceRecords (typically putSequencesWithDurations). */
    putSequences: (recs: SequenceRecord[]) => Promise<SequenceRecord[]>;
    /** Current catalog. Basename matches are skipped. */
    existingSequences?: SequenceRecord[];
}

/**
 * Build a SequenceRecord from an FSEQ path + autodetection result.
 * `audio` is left undefined for animations; title/artist fall back to the
 * fseq basename / "Unknown Artist" when tags are absent.
 */
export function buildSequenceRecordFromDetected(fseqPath: string, detected: AutoDetectedSongFiles): SequenceRecord {
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
    options: AutoDetectOptions,
): Promise<
    { ok: true; success: BatchImportSuccess; record: SequenceRecord } | { ok: false; failure: BatchImportFailure }
> {
    const fseqName = path.basename(fseqPath);
    try {
        if (path.extname(fseqPath).toLowerCase() !== '.fseq') {
            return { ok: false, failure: { fseqPath, fseqName, reason: 'Not an .fseq file' } };
        }

        const detected = await autoDetectSongFilesFromFseq(fseqPath, {
            mediaFolder: options.mediaFolder,
            exactAudioMatch: true,
            colocatedAudioAllowlist: options.colocatedAudioAllowlist,
        });

        // `audioRequired` is only undefined when the header couldn't be read at
        // all — nothing to import from then.
        if (detected.audioRequired === undefined) {
            return { ok: false, failure: { fseqPath, fseqName, reason: 'Could not read FSEQ header' } };
        }

        // Audio is required only when the FSEQ header names a media file; an
        // animation (no media in the header) imports without audio. Same rule
        // for Electron IPC and LAN HTTP so both UIs stay in lockstep.
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

        return {
            ok: true,
            record,
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
    const skipped: BatchImportSkipped[] = [];
    const unique = [...new Set(fseqPaths.filter(Boolean))];

    // Existing song entries by fseq basename, so re-importing a folder does
    // not create duplicate songs.
    const existingByBasename = new Map<string, SequenceRecord>();
    for (const rec of options.existingSequences ?? []) {
        if (rec.deleted || !rec.files?.fseq) continue;
        existingByBasename.set(path.basename(rec.files.fseq).toLowerCase(), rec);
    }

    console.log(`[BatchImport] Starting import of ${unique.length} sequence(s)`);

    const recordsToSave: SequenceRecord[] = [];
    for (const fseqPath of unique) {
        const fseqName = path.basename(fseqPath);
        const existing = existingByBasename.get(fseqName.toLowerCase());
        if (existing) {
            skipped.push({ fseqPath, fseqName, existingTitle: existing.work?.title });
            console.log(`[BatchImport] Skipped "${fseqName}" (already imported)`);
            continue;
        }
        const result = await importOneFseq(fseqPath, options);
        if (result.ok) {
            successes.push(result.success);
            recordsToSave.push(result.record);
            console.log(`[BatchImport] Imported "${result.success.fseqName}"`);
        } else {
            failures.push(result.failure);
            console.warn(`[BatchImport] Failed "${result.failure.fseqName}": ${result.failure.reason}`);
        }
    }

    if (recordsToSave.length) {
        await options.putSequences(recordsToSave);
    }

    const summary: BatchImportSummary = {
        total: unique.length,
        imported: successes.length,
        failed: failures.length,
        successes,
        failures,
        skipped,
    };
    console.log(
        `[BatchImport] Done: imported=${summary.imported}, failed=${summary.failed}, skipped=${skipped.length}`,
    );
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
