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
import type { EZPlayerCommand, PlayerPStatusContent, PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';

export interface FppCommandDeps {
    sendPlayerCommand: (cmd: EZPlayerCommand) => Promise<void> | void;
    getPlaylists: () => PlaylistRecord[] | undefined;
    getSequences: () => SequenceRecord[] | undefined;
    /** Current player state, for the "if not running" argument. */
    getPStatus?: () => PlayerPStatusContent | undefined;
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
        const fseqBase = s.files?.fseq
            ? fileBaseName(s.files.fseq)
                  .toLowerCase()
                  .replace(/\.fseq$/, '')
            : undefined;
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
    /** FPP sends a default for every optional argument. */
    default?: string;
}

interface FppCommandDef {
    name: string;
    /** FPP groups commands by category in its UI. */
    category: string;
    /** FPP's permission level: 0 for everyday playback commands. */
    level: number;
    description: string;
    args: FppArgDesc[];
    run: (args: string[], deps: FppCommandDeps) => Promise<FppCommandResult>;
}

/** Argument names and types are FPP's own: clients pass them positionally,
 *  and FPP's UI labels its forms from these. An argument with a default is
 *  optional, as in FPP. */
const arg = (name: string, type: string, description: string, dflt?: string): FppArgDesc =>
    dflt === undefined
        ? { name, type, description, optional: false }
        : { name, type, description, optional: true, default: dflt };

/** Something is playing or paused: what FPP's "if not running" flag checks. */
function isRunning(deps: FppCommandDeps): boolean {
    const status = deps.getPStatus?.()?.status;
    return status === 'Playing' || status === 'Paused' || status === 'Stopping' || status === 'Suppressed';
}

async function startPlaylist(
    deps: FppCommandDeps,
    target: string | undefined,
    repeat: boolean,
    startItem: string | undefined,
    ifNotRunning = false,
): Promise<FppCommandResult> {
    if (!target) return err(400, 'Playlist name required');
    if (ifNotRunning && isRunning(deps)) return ok(`Playlist ${target} not started: something is already playing`);
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
    const warn =
        startItem && startItem !== '0' && startItem !== '1' ? ' (start item not supported, starting at 1)' : '';
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
        category: 'Playlist',
        level: 0,
        description: 'Start the named playlist (or a bare sequence name)',
        args: [
            arg('name', 'string', 'Playlist Name'),
            arg('repeat', 'bool', 'Repeat', 'false'),
            arg('ifNotRunning', 'bool', 'If Not Running', 'false'),
            arg('scheduleProtected', 'bool', 'Ignored (EZPlayer has no schedule override)', 'false'),
        ],
        run: (args, deps) => startPlaylist(deps, args[0], truthyArg(args[1]), undefined, truthyArg(args[2])),
    },
    {
        name: 'Start Playlist At Item',
        category: 'Playlist',
        level: 1,
        description: 'Start the named playlist (start item not supported, starts at 1)',
        args: [
            arg('name', 'string', 'Playlist Name'),
            arg('item', 'int', 'Ignored (always starts at 1)'),
            arg('repeat', 'bool', 'Repeat', 'false'),
            arg('ifNotRunning', 'bool', 'If Not Running', 'false'),
            arg('scheduleProtected', 'bool', 'Ignored (EZPlayer has no schedule override)', 'false'),
        ],
        run: (args, deps) => startPlaylist(deps, args[0], truthyArg(args[2]), args[1], truthyArg(args[3])),
    },
    {
        name: 'Insert Playlist Immediate',
        category: 'Playlist',
        level: 0,
        description: 'Start the named playlist immediately',
        args: [
            arg('name', 'string', 'Playlist Name'),
            arg('startItem', 'int', 'Ignored (always starts at 1)', '0'),
            arg('endItem', 'int', 'Ignored (plays to the end)', '0'),
            arg('ifNotRunning', 'bool', 'If Not Running', 'false'),
        ],
        run: (args, deps) => startPlaylist(deps, args[0], false, args[1], truthyArg(args[3])),
    },
    {
        name: 'Stop Now',
        category: 'Playlist',
        level: 0,
        description: 'Stop playback immediately',
        args: [],
        run: simple({ command: 'stopnow' }),
    },
    {
        name: 'Stop Gracefully',
        category: 'Playlist',
        level: 0,
        description: 'Stop at a convenient spot',
        args: [arg('loop', 'bool', 'Treated the same as a normal graceful stop', 'false')],
        run: simple({ command: 'stopgraceful' }),
    },
    {
        name: 'Pause Playlist',
        category: 'Playlist',
        level: 0,
        description: 'Pause playback',
        args: [],
        run: simple({ command: 'pause' }),
    },
    {
        name: 'Resume Playlist',
        category: 'Playlist',
        level: 0,
        description: 'Resume paused playback',
        args: [],
        run: simple({ command: 'resume' }),
    },
    {
        name: 'Next Playlist Item',
        category: 'Playlist',
        level: 0,
        description: 'Skip to the next item',
        args: [],
        run: simple({ command: 'endsong' }),
    },
    {
        name: 'Prev Playlist Item',
        category: 'Playlist',
        level: 0,
        description: 'Not supported',
        args: [],
        run: notSupported('Prev Playlist Item'),
    },
    {
        name: 'All Lights Off',
        category: 'Effects',
        level: 0,
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
export function fppCommandDescriptors(): Array<Omit<FppCommandDef, 'run'>> {
    return COMMANDS.map(({ name, category, level, description, args }) => ({
        name,
        category,
        level,
        description,
        args,
    }));
}
