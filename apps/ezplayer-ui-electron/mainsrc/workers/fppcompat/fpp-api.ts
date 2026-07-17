/**
 * FPP-compat route registration. Mounted on the shared router (same port and
 * paths as a real FPP), translating onto EZPlayer's cached state and the
 * player-command RPC bridge. See doc/manual/docs/reference/fpp-compat.md.
 *
 * Anything FPP-shaped that is NOT registered here deliberately 404s — FPP
 * tools already branch on 404. Never stub a write endpoint with a fake 200.
 */

import type Router from '@koa/router';
import type { RouterContext } from '@koa/router';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import fsp from 'fs/promises';
import * as crypto from 'crypto';
import type { EZPlayerCommand, PlayerPStatusContent, PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '@ezplayer/ezplayer-core';
import { buildFppStatus, buildFppdVersion, buildSystemInfo, type FppIdentity, type FppStatusSources } from './fpp-status.js';
import { fppCommandDescriptors, runFppCommand, type FppCommandDeps } from './fpp-commands.js';
import { fppPlaylistToRecord, recordToFppPlaylist, type FppPlaylist } from './fpp-playlists.js';
import { fppScheduleToRecords, recordsToFppSchedule, type FppScheduleEntry } from './fpp-schedule.js';

export interface FppApiDeps {
    getShowFolder: () => string | undefined;
    getPStatus: () => PlayerPStatusContent | undefined;
    getSequences: () => SequenceRecord[] | undefined;
    getPlaylists: () => PlaylistRecord[] | undefined;
    getSchedule: () => ScheduledPlaylist[] | undefined;
    sendPlayerCommand: (cmd: EZPlayerCommand) => Promise<void>;
    updatePlaylists: (recs: unknown[]) => Promise<unknown[]>;
    updateSchedule: (recs: unknown[]) => Promise<unknown[]>;
    putSequences: (recs: unknown[]) => Promise<unknown[]>;
    appVersion: string;
}

// ---------------------------------------------------------------------------
// Identity — uuid persisted per show folder in .ezplayer/fpp-compat.json
// ---------------------------------------------------------------------------

let cachedUuid: { showFolder: string; uuid: string } | undefined;

async function getUuid(showFolder: string | undefined): Promise<string> {
    if (!showFolder) return 'EZP-unconfigured';
    if (cachedUuid?.showFolder === showFolder) return cachedUuid.uuid;
    const file = path.join(showFolder, '.ezplayer', 'fpp-compat.json');
    try {
        const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as { uuid?: string };
        if (parsed.uuid) {
            cachedUuid = { showFolder, uuid: parsed.uuid };
            return parsed.uuid;
        }
    } catch {}
    const uuid = `EZP-${crypto.randomUUID()}`;
    try {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, JSON.stringify({ uuid }, null, 2));
    } catch (e) {
        console.warn('[fpp-compat] could not persist uuid:', e);
    }
    cachedUuid = { showFolder, uuid };
    return uuid;
}

function localIPv4s(): string[] {
    const out: string[] = [];
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces ?? []) {
            if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
        }
    }
    return out;
}

async function identityOf(deps: FppApiDeps): Promise<FppIdentity> {
    return {
        hostName: os.hostname(),
        appVersion: deps.appVersion,
        uuid: await getUuid(deps.getShowFolder()),
        ips: localIPv4s(),
    };
}

function statusSources(deps: FppApiDeps): FppStatusSources {
    return {
        pStatus: deps.getPStatus(),
        sequences: deps.getSequences(),
        playlists: deps.getPlaylists(),
        schedule: deps.getSchedule(),
    };
}

// ---------------------------------------------------------------------------

export function registerFppCompatRoutes(router: Router, deps: FppApiDeps): void {
    const cmdDeps: FppCommandDeps = {
        sendPlayerCommand: deps.sendPlayerCommand,
        getPlaylists: deps.getPlaylists,
        getSequences: deps.getSequences,
    };

    // ---- status / identity -------------------------------------------------

    const serveStatus = async (ctx: RouterContext) => {
        ctx.body = buildFppStatus(statusSources(deps), await identityOf(deps), Date.now());
    };
    router.get('/api/system/status', serveStatus);
    router.get('/api/fppd/status', serveStatus);

    router.get('/api/system/info', async (ctx) => {
        ctx.body = buildSystemInfo(await identityOf(deps), { freemem: os.freemem(), totalmem: os.totalmem() });
    });

    router.get('/api/fppd/version', async (ctx) => {
        ctx.body = buildFppdVersion(await identityOf(deps));
    });

    // Some discovery flows probe the plugin list; an empty one is accurate.
    router.get('/api/plugin', (ctx) => {
        ctx.body = [];
    });

    // ---- command API -------------------------------------------------------

    const respondCommand = (ctx: RouterContext, result: { status: number; message: string }) => {
        ctx.status = result.status;
        ctx.type = 'text/plain';
        ctx.body = result.message;
    };

    // GET /api/command/{Name}[/{arg1}/{arg2}...] — name and args are path
    // segments (URL-encoded); regex route because the arg count is open-ended.
    // @koa/router exposes regex capture groups via ctx.captures (params stays
    // empty for regex paths, even with named groups).
    router.get(/^\/api\/command\/(.+)$/, async (ctx) => {
        const rest = ctx.captures?.[0];
        if (!rest) {
            respondCommand(ctx, { status: 400, message: 'command required' });
            return;
        }
        const segments = rest.split('/').map((s) => decodeURIComponent(s));
        const name = segments[0];
        respondCommand(ctx, await runFppCommand(name, segments.slice(1), cmdDeps));
    });

    // POST /api/command  {command, args[]}
    router.post('/api/command', async (ctx) => {
        const body = ctx.request.body as { command?: string; args?: unknown[] } | undefined;
        if (!body?.command) {
            respondCommand(ctx, { status: 400, message: 'command required' });
            return;
        }
        const args = Array.isArray(body.args) ? body.args.map(String) : [];
        respondCommand(ctx, await runFppCommand(body.command, args, cmdDeps));
    });

    // POST /api/command/{Name} with a JSON array body of args
    router.post(/^\/api\/command\/(.+)$/, async (ctx) => {
        const name = decodeURIComponent(ctx.captures?.[0] ?? '');
        const body = ctx.request.body;
        const args = Array.isArray(body) ? body.map(String) : [];
        respondCommand(ctx, await runFppCommand(name, args, cmdDeps));
    });

    router.get('/api/commands', (ctx) => {
        ctx.body = fppCommandDescriptors();
    });

    router.get('/api/commands/:name', (ctx) => {
        const found = fppCommandDescriptors().find((d) => d.name === ctx.params.name);
        if (!found) {
            ctx.status = 404;
            ctx.body = { Status: 'Error', Message: `Unknown command: ${ctx.params.name}` };
            return;
        }
        ctx.body = found;
    });

    // ---- playlist.php convenience GETs -------------------------------------

    const okJson = { Status: 'OK', Message: '' };

    const startPlaylist = async (ctx: RouterContext) => {
        const name = decodeURIComponent(String(ctx.params.name));
        const repeat = String(ctx.params.repeat ?? '0');
        const result = await runFppCommand('Start Playlist', [name, repeat, '0', '0'], cmdDeps);
        ctx.status = result.status;
        ctx.body = result.status === 200 ? okJson : { Status: 'Error', Message: result.message };
    };
    router.get('/api/playlist/:name/start', startPlaylist);
    router.get('/api/playlist/:name/start/:repeat', startPlaylist);
    router.get('/api/playlist/:name/start/:repeat/:scheduleProtected', startPlaylist);

    const simpleCommand = (command: string, args: string[] = []) => async (ctx: RouterContext) => {
        const result = await runFppCommand(command, args, cmdDeps);
        ctx.status = result.status;
        ctx.body = result.status === 200 ? okJson : { Status: 'Error', Message: result.message };
    };
    router.get('/api/playlists/stop', simpleCommand('Stop Now'));
    router.get('/api/playlists/stopgracefully', simpleCommand('Stop Gracefully'));
    router.get('/api/playlists/stopgracefullyafterloop', simpleCommand('Stop Gracefully', ['true']));
    router.get('/api/playlists/pause', simpleCommand('Pause Playlist'));
    router.get('/api/playlists/resume', simpleCommand('Resume Playlist'));

    // ---- playlists ----------------------------------------------------------

    const livePlaylists = () => (deps.getPlaylists() ?? []).filter((p) => !p.deleted && p.enabled !== false);

    router.get('/api/playlists', (ctx) => {
        ctx.body = livePlaylists()
            .map((p) => p.title)
            .sort((a, b) => a.localeCompare(b));
    });

    router.get('/api/playlists/playable', (ctx) => {
        const names = livePlaylists().map((p) => p.title);
        const fseqs = (deps.getSequences() ?? [])
            .filter((s) => !s.deleted && s.files?.fseq)
            .map((s) => path.basename(s.files!.fseq!));
        ctx.body = [...names, ...fseqs].sort((a, b) => a.localeCompare(b));
    });

    router.get('/api/playlist/:name', (ctx) => {
        const name = decodeURIComponent(String(ctx.params.name));
        const pl = livePlaylists().find((p) => p.title.toLowerCase() === name.toLowerCase());
        if (!pl) {
            ctx.status = 404;
            ctx.body = { Status: 'Error', Message: `Playlist ${name} not found` };
            return;
        }
        ctx.body = recordToFppPlaylist(pl, deps.getSequences());
    });

    /** For unresolved sequenceName entries whose fseq file actually exists in
     *  the show folder, register a SequenceRecord on the fly — an FPP tool
     *  that uploads an fseq and immediately references it in a playlist
     *  shouldn't need to know about EZP's registration step. */
    async function autoRegisterSequences(unresolved: string[]): Promise<boolean> {
        const showFolder = deps.getShowFolder();
        if (!showFolder || unresolved.length === 0) return false;
        const toCreate: unknown[] = [];
        for (const raw of unresolved) {
            const name = /\.fseq$/i.test(raw) ? raw : `${raw}.fseq`;
            if (name !== path.basename(name)) continue;
            try {
                await fsp.access(path.join(showFolder, name), fs.constants.R_OK);
                toCreate.push({
                    files: { fseq: name },
                    work: { title: name.replace(/\.fseq$/i, ''), artist: '', length: 0 },
                });
            } catch {}
        }
        if (toCreate.length === 0) return false;
        await deps.putSequences(toCreate);
        return true;
    }

    const upsertFppPlaylist = async (ctx: RouterContext, name: string, body: FppPlaylist) => {
        let ingest = fppPlaylistToRecord(body, name, deps.getPlaylists(), deps.getSequences());
        if (!ingest.error && ingest.unresolved.length > 0 && (await autoRegisterSequences(ingest.unresolved))) {
            ingest = fppPlaylistToRecord(body, name, deps.getPlaylists(), deps.getSequences());
        }
        if (ingest.error) {
            ctx.status = 400;
            ctx.body = { Status: 'Error', Message: ingest.error, Warnings: ingest.warnings };
            return;
        }
        const warnings = [
            ...ingest.warnings,
            ...ingest.unresolved.map((n) => `sequence '${n}' not found in the show folder — entry skipped`),
        ];
        await deps.updatePlaylists([ingest.record]);
        ctx.body = { Status: 'OK', Message: warnings.join('; ') };
    };

    router.post('/api/playlist/:name', async (ctx) => {
        const name = decodeURIComponent(String(ctx.params.name));
        await upsertFppPlaylist(ctx, name, (ctx.request.body ?? {}) as FppPlaylist);
    });

    // FPP create-one. (EZP's replace-all bulk write lives at /api/ezp/playlists.)
    router.post('/api/playlists', async (ctx) => {
        const body = ctx.request.body as FppPlaylist | undefined;
        if (!body || Array.isArray(body) || typeof body !== 'object' || !body.name) {
            ctx.status = 400;
            ctx.body = {
                Status: 'Error',
                Message: 'Body must be an FPP playlist object with a name. (EZPlayer bulk playlist writes moved to POST /api/ezp/playlists.)',
            };
            return;
        }
        await upsertFppPlaylist(ctx, String(body.name), body);
    });

    router.delete('/api/playlist/:name', async (ctx) => {
        const name = decodeURIComponent(String(ctx.params.name));
        const pl = (deps.getPlaylists() ?? []).find((p) => !p.deleted && p.title.toLowerCase() === name.toLowerCase());
        if (!pl) {
            ctx.status = 404;
            ctx.body = { Status: 'Error', Message: `Playlist ${name} not found` };
            return;
        }
        await deps.updatePlaylists([{ ...pl, deleted: true }]);
        ctx.body = { Status: 'OK', Message: '' };
    });

    // ---- schedule -----------------------------------------------------------

    router.get('/api/schedule', (ctx) => {
        ctx.body = recordsToFppSchedule(deps.getSchedule());
    });

    router.get('/api/fppd/schedule', (ctx) => {
        ctx.body = { schedule: recordsToFppSchedule(deps.getSchedule()), Status: 'OK' };
    });

    // Full replace, FPP semantics: entries not in the new set are deleted.
    router.post('/api/schedule', async (ctx) => {
        const body = ctx.request.body;
        if (!Array.isArray(body)) {
            ctx.status = 400;
            ctx.body = { Status: 'Error', Message: 'Body must be an array of FPP schedule entries' };
            return;
        }
        const { records, warnings } = fppScheduleToRecords(body as FppScheduleEntry[], deps.getPlaylists(), Date.now());
        const removals = (deps.getSchedule() ?? []).filter((s) => !s.deleted).map((s) => ({ ...s, deleted: true }));
        await deps.updateSchedule([...removals, ...records]);
        ctx.body = { Status: 'OK', Message: warnings.join('; ') };
    });

    // EZPlayer reconciles schedule changes live — reload is inherently a no-op.
    router.post('/api/schedule/reload', (ctx) => {
        ctx.body = { Status: 'OK', Message: '' };
    });

    // ---- volume ------------------------------------------------------------

    router.get('/api/system/volume', (ctx) => {
        ctx.body = { status: 'OK', method: 'EZPlayer', volume: Math.round(deps.getPStatus()?.volume?.level ?? 100) };
    });

    // Volume writes are settings/schedule-driven in EZPlayer; see fpp-commands.ts.
    router.post('/api/system/volume', (ctx) => {
        ctx.status = 500;
        ctx.body = { status: 'error', error: 'Volume is schedule/settings-driven in EZPlayer; set it via playback settings' };
    });
}
