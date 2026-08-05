/**
 * FPP command dispatcher. One table maps each FPP command name to its
 * descriptor (served by GET /api/commands) and its handler, so the two can't
 * drift. Results follow FPP: text 200 on success, 404 unknown command,
 * 500 on failure.
 *
 * Volume write commands are deliberately not supported: EZPlayer volume is
 * settings/schedule-driven, and a one-shot override has no clean semantics
 * against that automation.
 */

import * as crypto from 'crypto';
import { fileBaseName } from '../pathnames.js';
import type { EZPlayerCommand, PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';

export interface FppCommandDeps {
    sendPlayerCommand: (cmd: EZPlayerCommand) => Promise<void> | void;
    getPlaylists: () => PlaylistRecord[] | undefined;
    getSequences: () => SequenceRecord[] | undefined;
}

export interface FppCommandResult {
    status: number;
    /** text/plain body, FPP-style. */
    message: string;
}

const ok = (message = 'OK'): FppCommandResult => ({ status: 200, message });
const err = (status: number, message: string): FppCommandResult => ({ status, message });

function truthyArg(v: string | undefined): boolean {
    return v === '1' || v?.toLowerCase() === 'true';
}

/** Resolve an FPP "playlist name": a playlist by title first, else a bare
 *  sequence (FPP allows starting an .fseq by name). Case-insensitive,
 *  extension optional. */
function resolvePlayable(
    name: string,
    playlists: PlaylistRecord[] | undefined,
    sequences: SequenceRecord[] | undefined,
): { playlistId?: string; songId?: string } | undefined {
    const base = name.toLowerCase().replace(/\.(json|fseq)$/, '');
    const pl = playlists?.find((p) => !p.deleted && p.enabled !== false && p.title.toLowerCase() === base);
    if (pl) return { playlistId: pl.id };
    const seq = sequences?.find((s) => {
        if (s.deleted || s.render_enabled === false) return false;
        const fseqBase = s.files?.fseq ? fileBaseName(s.files.fseq).toLowerCase().replace(/\.fseq$/, '') : undefined;
        return fseqBase === base || s.work?.title?.toLowerCase() === base;
    });
    if (seq) return { songId: seq.id };
    return undefined;
}

interface FppArgDesc {
    name: string;
    type: string;
    description: string;
    optional: boolean;
}

interface FppCommandDef {
    name: string;
    description: string;
    args: FppArgDesc[];
    run: (args: string[], deps: FppCommandDeps) => Promise<FppCommandResult>;
}

const arg = (name: string, type: string, description: string, optional = true): FppArgDesc => ({
    name,
    type,
    description,
    optional,
});

async function startPlaylist(
    deps: FppCommandDeps,
    target: string | undefined,
    repeat: boolean,
    startItem: string | undefined,
): Promise<FppCommandResult> {
    if (!target) return err(400, 'Playlist name required');
    const resolved = resolvePlayable(target, deps.getPlaylists(), deps.getSequences());
    if (!resolved) return err(500, `Unknown playlist or sequence: ${target}`);

    const requestId = crypto.randomUUID();
    if (resolved.playlistId) {
        await deps.sendPlayerCommand({
            command: 'playplaylist',
            playlistId: resolved.playlistId,
            immediate: true,
            priority: 1,
            requestId,
            loop: repeat,
        });
    } else {
        await deps.sendPlayerCommand({
            command: 'playsong',
            songId: resolved.songId!,
            immediate: true,
            priority: 1,
            requestId,
        });
    }
    const warn = startItem && startItem !== '0' && startItem !== '1' ? ' (start item not supported, starting at 1)' : '';
    return ok(`Playlist ${target} started${warn}`);
}

const simple = (cmd: EZPlayerCommand) => async (_args: string[], deps: FppCommandDeps) => {
    await deps.sendPlayerCommand(cmd);
    return ok();
};

const notSupported = (what: string) => async () => err(500, `${what} is not supported by EZPlayer`);

const COMMANDS: FppCommandDef[] = [
    {
        name: 'Start Playlist',
        description: 'Start the named playlist (or a bare sequence name)',
        args: [
            arg('PlaylistName', 'string', 'Playlist or sequence name', false),
            arg('Repeat', 'bool', 'Loop until stopped'),
            arg('StartItem', 'int', 'Ignored (always starts at 1)'),
            arg('ScheduleProtected', 'bool', 'Ignored'),
        ],
        run: (args, deps) => startPlaylist(deps, args[0], truthyArg(args[1]), args[2]),
    },
    {
        name: 'Start Playlist At Item',
        description: 'Start the named playlist (start item not supported, starts at 1)',
        args: [
            arg('PlaylistName', 'string', 'Playlist or sequence name', false),
            arg('Item', 'int', 'Ignored (always starts at 1)'),
            arg('Repeat', 'bool', 'Loop until stopped'),
        ],
        run: (args, deps) => startPlaylist(deps, args[0], truthyArg(args[2]), args[1]),
    },
    {
        name: 'Insert Playlist Immediate',
        description: 'Start the named playlist immediately',
        args: [arg('PlaylistName', 'string', 'Playlist or sequence name', false)],
        run: (args, deps) => startPlaylist(deps, args[0], truthyArg(args[1]), undefined),
    },
    { name: 'Stop Now', description: 'Stop playback immediately', args: [], run: simple({ command: 'stopnow' }) },
    {
        name: 'Stop Gracefully',
        description: 'Stop at a convenient spot',
        args: [arg('AfterLoop', 'bool', 'Treated the same as a normal graceful stop')],
        run: simple({ command: 'stopgraceful' }),
    },
    { name: 'Pause Playlist', description: 'Pause playback', args: [], run: simple({ command: 'pause' }) },
    { name: 'Resume Playlist', description: 'Resume paused playback', args: [], run: simple({ command: 'resume' }) },
    { name: 'Next Playlist Item', description: 'Skip to the next item', args: [], run: simple({ command: 'endsong' }) },
    {
        name: 'Prev Playlist Item',
        description: 'Not supported',
        args: [],
        run: notSupported('Prev Playlist Item'),
    },
    {
        name: 'All Lights Off',
        description: 'Stop playback (lights go dark)',
        args: [],
        run: simple({ command: 'stopnow' }),
    },
];

const COMMANDS_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

export async function runFppCommand(name: string, args: string[], deps: FppCommandDeps): Promise<FppCommandResult> {
    const def = COMMANDS_BY_NAME.get(name);
    if (!def) return err(404, `Unknown command: ${name}`);
    return def.run(args, deps);
}

/** GET /api/commands — descriptors for exactly the supported set. */
export function fppCommandDescriptors(): Array<{ name: string; description: string; args: FppArgDesc[] }> {
    return COMMANDS.map(({ name, description, args }) => ({ name, description, args }));
}
