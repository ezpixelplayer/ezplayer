/**
 * FPP playlist JSON ⇄ EZPlayer PlaylistRecord. Intentionally lossy; the rules
 * live in doc/manual/docs/reference/fpp-compat.md.
 */

import { fileBaseName } from '../pathnames.js';
import * as crypto from 'crypto';
import type { PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';

export interface FppPlaylistEntry {
    type?: string;
    enabled?: number;
    playOnce?: number;
    duration?: number;
    sequenceName?: string;
    mediaName?: string;
    name?: string;
    [k: string]: unknown;
}

export interface FppPlaylist {
    name?: string;
    version?: number;
    repeat?: number;
    loopCount?: number;
    desc?: string;
    random?: number;
    leadIn?: FppPlaylistEntry[];
    mainPlaylist?: FppPlaylistEntry[];
    leadOut?: FppPlaylistEntry[];
    playlistInfo?: unknown;
    [k: string]: unknown;
}

export interface FppPlaylistIngest {
    record?: PlaylistRecord;
    warnings: string[];
    /** Set when the playlist cannot be represented at all (400 the request). */
    error?: string;
    /** sequenceName strings that didn't resolve to a registered sequence. */
    unresolved: string[];
}

/** Case-insensitive sequence lookup by fseq basename (extension optional) or
 *  work title. */
export function findSequenceByName(sequences: SequenceRecord[] | undefined, name: string): SequenceRecord | undefined {
    const base = name.toLowerCase().replace(/\.fseq$/, '');
    return sequences?.find((s) => {
        if (s.deleted) return false;
        const fseqBase = s.files?.fseq ? fileBaseName(s.files.fseq).toLowerCase().replace(/\.fseq$/, '') : undefined;
        return fseqBase === base || s.work?.title?.toLowerCase() === base;
    });
}

/** Translate an FPP playlist into a PlaylistRecord upsert. `existing` supplies
 *  id/createdAt continuity when a playlist with the same title already exists. */
export function fppPlaylistToRecord(
    fpp: FppPlaylist,
    name: string,
    existing: PlaylistRecord[] | undefined,
    sequences: SequenceRecord[] | undefined,
): FppPlaylistIngest {
    const warnings: string[] = [];
    const unresolved: string[] = [];

    const entries: FppPlaylistEntry[] = [...(fpp.leadIn ?? []), ...(fpp.mainPlaylist ?? []), ...(fpp.leadOut ?? [])];
    if ((fpp.leadIn?.length ?? 0) > 0 || (fpp.leadOut?.length ?? 0) > 0) {
        warnings.push('leadIn/leadOut entries were flattened into the playlist (EZPlayer handles pre/post shows at the schedule level)');
    }

    const items: { id: string; sequence: number }[] = [];
    for (const entry of entries) {
        switch (entry.type) {
            case 'sequence':
            case 'both': {
                const seqName = entry.sequenceName;
                if (!seqName) {
                    warnings.push('entry with no sequenceName skipped');
                    break;
                }
                const seq = findSequenceByName(sequences, seqName);
                if (!seq) {
                    unresolved.push(seqName);
                    break;
                }
                items.push({ id: seq.id, sequence: items.length + 1 });
                break;
            }
            case 'media':
                warnings.push(`audio-only entry '${entry.mediaName ?? ''}' skipped (EZPlayer playlist items are sequence-driven)`);
                break;
            case 'pause':
                warnings.push(`pause entry (${entry.duration ?? 0}s) skipped (no EZPlayer equivalent)`);
                break;
            case 'playlist':
                return {
                    warnings,
                    unresolved,
                    error: `nested playlist entry '${entry.name ?? ''}' is not representable in EZPlayer`,
                };
            default:
                warnings.push(`entry type '${entry.type ?? '?'}' skipped (not supported)`);
        }
    }

    if (fpp.repeat || fpp.loopCount) {
        warnings.push('repeat/loopCount are not stored on EZPlayer playlists — pass repeat to Start Playlist or set loop on the schedule');
    }

    const prior = existing?.find((p) => p.title.toLowerCase() === name.toLowerCase());
    const record: PlaylistRecord = {
        id: prior?.id ?? crypto.randomUUID(),
        title: prior?.title ?? name,
        tags: prior?.tags ?? [],
        createdAt: prior?.createdAt ?? Date.now(),
        items,
        deleted: false,
    };
    return { record, warnings, unresolved };
}

/** Translate a PlaylistRecord to FPP playlist JSON (GET /api/playlist/:name). */
export function recordToFppPlaylist(pl: PlaylistRecord, sequences: SequenceRecord[] | undefined): FppPlaylist {
    const mainPlaylist: FppPlaylistEntry[] = [];
    let totalDuration = 0;
    for (const item of pl.items) {
        const seq = sequences?.find((s) => s.id === item.id);
        if (!seq) continue;
        const duration = seq.work?.length ?? 0;
        totalDuration += duration;
        const entry: FppPlaylistEntry = {
            type: seq.files?.audio ? 'both' : 'sequence',
            enabled: 1,
            playOnce: 0,
            sequenceName: seq.files?.fseq ? fileBaseName(seq.files.fseq) : `${seq.work?.title ?? item.id}.fseq`,
            duration,
        };
        if (seq.files?.audio) entry.mediaName = fileBaseName(seq.files.audio);
        mainPlaylist.push(entry);
    }
    return {
        name: pl.title,
        version: 4,
        repeat: 0,
        loopCount: 0,
        empty: mainPlaylist.length === 0,
        desc: '',
        random: 0,
        leadIn: [],
        mainPlaylist,
        leadOut: [],
        playlistInfo: {
            total_duration: totalDuration,
            total_items: mainPlaylist.length,
            leadIn_items: 0,
            leadIn_duration: 0,
            mainPlaylist_items: mainPlaylist.length,
            mainPlaylist_duration: totalDuration,
            leadOut_items: 0,
            leadOut_duration: 0,
        },
    };
}
