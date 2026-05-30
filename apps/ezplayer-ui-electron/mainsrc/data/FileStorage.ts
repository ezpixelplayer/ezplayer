import {
    type CombinedPlayerStatus,
    type PlaylistRecord,
    type ScheduledPlaylist,
    type SequenceRecord,
} from '@ezplayer/ezplayer-core';

import { FSEQReaderAsync } from '@ezplayer/epp';

import * as path from 'path';
import fsp from 'fs/promises';
import { atomicWriteFile } from './atomicWrite.js';

// sequences.json
interface TempSeqsAPIPayload {
    data: {
        allSongs?: SequenceRecord[];
    };
}

// playlists.json
interface TempPlaylistsPayload {
    data: {
        playlists?: PlaylistRecord[];
    };
}

// schedule.json
interface TempScheduleAPIPayload {
    data: {
        scheduledPlaylists?: ScheduledPlaylist[];
    };
}

/**
 * Log a load failure as a single line.  Missing-file (ENOENT) is expected on
 * first run for every show-folder JSON we read, so we suppress those entirely
 * and only surface real errors (parse failures, permission denied, etc.).
 */
function logLoadFailure(file: string, err: unknown): void {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return;
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[FileStorage] ${file}: ${msg}`);
}

/**
 * Ensure path is absolute relative to a base directory.
 */
function ensureAbsolute(p: string, base: string): string {
    if (path.isAbsolute(p)) {
        return p;
    }
    return path.join(base, p);
}

/**
 * Get relative path of a file against a base directory.
 * If not under base, returns the absolute path unchanged.
 */
function toRelative(p: string, base: string): string {
    const rel = path.relative(base, p);
    // path.relative returns things like "..\.." if not inside base
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return p; // not relative to base, return as-is
    }
    return rel;
}

/** Resolve a show-folder JSON file to its `.ezplayer/`-prefixed location. */
const sf = (folder: string, name: string) => path.join(folder, '.ezplayer', name);

export async function loadSequencesAPI(folder: string): Promise<SequenceRecord[]> {
    try {
        const p: TempSeqsAPIPayload = await JSON.parse(await fsp.readFile(sf(folder, 'sequences.json'), 'utf-8'));
        const seqs = p?.data?.allSongs ?? [];
        for (const s of seqs) {
            if (s.files?.fseq) {
                s.files.fseq = ensureAbsolute(s.files.fseq, folder);
            }
            if (s.files?.audio) {
                s.files.audio = ensureAbsolute(s.files.audio, folder);
            }
            if (s.files?.thumb) {
                s.files.thumb = ensureAbsolute(s.files.thumb, folder);
            }
            // This is supposed to be seconds; for now if it looks like it could be milliseconds we will verify it.
            if (s.files?.fseq && (!s.work.length || s.work.length > 10000)) {
                try {
                    const fhdr = await FSEQReaderAsync.readFSEQHeaderAsync(s.files.fseq);
                    s.work.length = (fhdr.frames * fhdr.msperframe) / 1000;
                } catch (e) {
                    console.log(e);
                }
            }
        }
        return seqs;
    } catch (e) {
        logLoadFailure('sequences.json', e);
        return [];
    }
}

export async function saveSequencesAPI(folder: string, payload: SequenceRecord[]) {
    const npayload = JSON.parse(JSON.stringify(payload)) as SequenceRecord[];
    for (const s of npayload) {
        if (s.files?.fseq) {
            s.files.fseq = toRelative(s.files.fseq, folder);
        }
        if (s.files?.audio) {
            s.files.audio = toRelative(s.files.audio, folder);
        }
        if (s.files?.thumb) {
            s.files.thumb = toRelative(s.files.thumb, folder);
        }
    }
    const userData: TempSeqsAPIPayload = {
        data: {
            allSongs: npayload,
        },
    };
    await atomicWriteFile(sf(folder, 'sequences.json'), JSON.stringify(userData, null, 4));
}

export async function loadPlaylistsAPI(folder: string): Promise<PlaylistRecord[]> {
    try {
        const p: TempPlaylistsPayload = await JSON.parse(await fsp.readFile(sf(folder, 'playlists.json'), 'utf-8'));
        return p.data.playlists ?? [];
    } catch (e) {
        logLoadFailure('playlists.json', e);
        return [];
    }
}

export const savePlaylistsAPI = async (folder: string, payload: PlaylistRecord[]) => {
    const userData: TempPlaylistsPayload = {
        data: {
            playlists: payload,
        },
    };
    await atomicWriteFile(sf(folder, 'playlists.json'), JSON.stringify(userData, null, 4));
};

export async function loadScheduleAPI(folder: string) {
    try {
        const p: TempScheduleAPIPayload = await JSON.parse(await fsp.readFile(sf(folder, 'schedule.json'), 'utf-8'));
        return p.data.scheduledPlaylists ?? [];
    } catch (e) {
        logLoadFailure('schedule.json', e);
        return [];
    }
}

export const saveScheduleAPI = async (folder: string, payload: ScheduledPlaylist[]) => {
    const userData: TempScheduleAPIPayload = {
        data: {
            scheduledPlaylists: payload,
        },
    };
    await atomicWriteFile(sf(folder, 'schedule.json'), JSON.stringify(userData, null, 4));
};

export async function loadStatusAPI(): Promise<CombinedPlayerStatus> {
    return {};
    /*
    return {
        player_updated: new Date().getTime(),
        player: {
            ptype: 'EZP', // FPP or EZP
            status: 'Playing',
            reported_time: new Date().getTime() - 1000,
            now_playing: 'Daytime Static',
            now_playing_until: new Date().getTime() + 1000000,
            upcoming: [{ title: 'Weeknight Show', at: new Date().getTime() + 1000000 }],
            // versions, system status, storage, memory, temp, etc?
        },
        content_updated: new Date().getTime() - 10000,
        content: {
            n_sequences: 12,
            n_needing_download: 2,
            sequence_sync_time: new Date().getTime() - 5000,
            n_playlists: 6,
            n_schedules: 10,
            schedule_sync_time: new Date().getTime() - 5000,
        },
        controller_updated: new Date().getTime() - 5000,
        controller: {
            controllers: [
                {
                    name: 'House',
                    status: 'green',
                    reported_time: new Date().getTime() - 8000,
                },
                {
                    name: 'Yard',
                    status: 'green',
                    reported_time: new Date().getTime() - 8000,
                },
                {
                    name: 'Garage',
                    status: 'yellow',
                    reported_time: new Date().getTime() - 80000,
                },
            ],
            n_models: 354,
            n_channels: 764943,
        },
        show: {
            show_name: 'Winter Wonderland Drive',
        },
    };
    */
}
