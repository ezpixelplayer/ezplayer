/**
 * FPP command dispatcher — maps FPP command names (src/commands/*.cpp) onto
 * EZPlayerCommands. Pure logic: the transport (GET path args, POST JSON body)
 * and the RPC bridge are injected so this unit-tests standalone.
 *
 * FPP's /api/command returns a plain-text result with status 200 on success,
 * 404 for an unknown command, and 500 on failure — reproduced here.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import type { EZPlayerCommand, PlayerPStatusContent, PlaylistRecord, SequenceRecord } from '@ezplayer/ezplayer-core';

export interface FppCommandDeps {
    sendPlayerCommand: (cmd: EZPlayerCommand) => Promise<void> | void;
    getPStatus: () => PlayerPStatusContent | undefined;
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

function clampVolume(n: number): number {
    return Math.max(0, Math.min(100, Math.round(n)));
}

/** Resolve an FPP "playlist name" the way FPP does: a playlist by name first,
 *  falling back to a bare sequence (FPP lets integrators Start Playlist a
 *  .fseq file name). Matching is case-insensitive, extension optional. */
function resolvePlayable(
    name: string,
    playlists: PlaylistRecord[] | undefined,
    sequences: SequenceRecord[] | undefined,
): { playlistId?: string; songId?: string } | undefined {
    const lower = name.toLowerCase();
    const base = lower.replace(/\.(json|fseq)$/, '');
    const pl = playlists?.find((p) => !p.deleted && p.enabled !== false && p.title.toLowerCase() === base);
    if (pl) return { playlistId: pl.id };
    const seq = sequences?.find((s) => {
        if (s.deleted || s.render_enabled === false) return false;
        const fseqBase = s.files?.fseq ? path.basename(s.files.fseq).toLowerCase().replace(/\.fseq$/, '') : undefined;
        return fseqBase === base || s.work?.title?.toLowerCase() === base;
    });
    if (seq) return { songId: seq.id };
    return undefined;
}

export async function runFppCommand(
    name: string,
    args: string[],
    deps: FppCommandDeps,
): Promise<FppCommandResult> {
    switch (name) {
        case 'Start Playlist':
        case 'Start Playlist At Item':
        case 'Insert Playlist Immediate': {
            // Start Playlist args: name, repeat, startItem, scheduleProtected
            // Start Playlist At Item args: name, item, repeat, scheduleProtected
            const target = args[0];
            if (!target) return err(400, 'Playlist name required');
            const repeat = name === 'Start Playlist At Item' ? truthyArg(args[2]) : truthyArg(args[1]);
            const startItem = name === 'Start Playlist At Item' ? args[1] : args[2];
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

        case 'Stop Now':
            await deps.sendPlayerCommand({ command: 'stopnow' });
            return ok();

        case 'Stop Gracefully':
            // arg[0] true = "after loop" — EZP's graceful stop is the closest equivalent for both.
            await deps.sendPlayerCommand({ command: 'stopgraceful' });
            return ok();

        case 'Pause Playlist':
            await deps.sendPlayerCommand({ command: 'pause' });
            return ok();

        case 'Resume Playlist':
            await deps.sendPlayerCommand({ command: 'resume' });
            return ok();

        case 'Next Playlist Item':
            await deps.sendPlayerCommand({ command: 'endsong' });
            return ok();

        case 'Prev Playlist Item':
            return err(500, 'Prev Playlist Item is not supported by EZPlayer');

        case 'Volume Set': {
            const v = Number(args[0]);
            if (!Number.isFinite(v)) return err(400, 'Volume value required');
            await deps.sendPlayerCommand({ command: 'setvolume', volume: clampVolume(v) });
            return ok();
        }

        case 'Volume Increase':
        case 'Volume Decrease':
        case 'Adjust Volume': {
            const rawDelta = Number(args[0] ?? 1);
            if (!Number.isFinite(rawDelta)) return err(400, 'Volume delta required');
            const sign = name === 'Volume Decrease' ? -1 : 1;
            const delta = name === 'Adjust Volume' ? rawDelta : sign * Math.abs(rawDelta);
            const current = deps.getPStatus()?.volume?.level ?? 100;
            await deps.sendPlayerCommand({ command: 'setvolume', volume: clampVolume(current + delta) });
            return ok();
        }

        case 'All Lights Off':
            // suppressoutput is a no-op in the engine today; stopping playback is
            // the effective equivalent (senders emit a black frame on stop).
            await deps.sendPlayerCommand({ command: 'stopnow' });
            return ok();

        default:
            return err(404, `Unknown command: ${name}`);
    }
}

/** GET /api/commands — descriptors for exactly the supported set. */
export function fppCommandDescriptors(): Array<Record<string, unknown>> {
    const argDesc = (name: string, type: string, description: string, optional = true) => ({
        name,
        type,
        description,
        optional,
    });
    return [
        {
            name: 'Start Playlist',
            description: 'Start the named playlist (or a bare sequence name)',
            args: [
                argDesc('PlaylistName', 'string', 'Playlist or sequence name', false),
                argDesc('Repeat', 'bool', 'Loop until stopped'),
                argDesc('StartItem', 'int', 'Ignored (always starts at 1)'),
                argDesc('ScheduleProtected', 'bool', 'Ignored'),
            ],
        },
        {
            name: 'Start Playlist At Item',
            description: 'Start the named playlist (start item not supported, starts at 1)',
            args: [
                argDesc('PlaylistName', 'string', 'Playlist or sequence name', false),
                argDesc('Item', 'int', 'Ignored (always starts at 1)'),
                argDesc('Repeat', 'bool', 'Loop until stopped'),
            ],
        },
        { name: 'Stop Now', description: 'Stop playback immediately', args: [] },
        {
            name: 'Stop Gracefully',
            description: 'Stop at a convenient spot',
            args: [argDesc('AfterLoop', 'bool', 'Treated the same as a normal graceful stop')],
        },
        { name: 'Pause Playlist', description: 'Pause playback', args: [] },
        { name: 'Resume Playlist', description: 'Resume paused playback', args: [] },
        { name: 'Next Playlist Item', description: 'Skip to the next item', args: [] },
        { name: 'Volume Set', description: 'Set volume 0-100', args: [argDesc('Volume', 'int', '0-100', false)] },
        { name: 'Volume Increase', description: 'Increase volume', args: [argDesc('Amount', 'int', 'Percent to add')] },
        { name: 'Volume Decrease', description: 'Decrease volume', args: [argDesc('Amount', 'int', 'Percent to subtract')] },
        { name: 'Adjust Volume', description: 'Adjust volume by a signed delta', args: [argDesc('Delta', 'int', 'Signed percent')] },
        { name: 'All Lights Off', description: 'Stop playback (lights go dark)', args: [] },
    ];
}
